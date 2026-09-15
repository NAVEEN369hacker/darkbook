// lib/admin.ts — admin-only operations.
//
// Mirrors Server/routes/admin.js. Admin posts are FREE (no coin spend).

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  generateDid,
  generateUid,
  generatePassword,
  generateToken,
  hashPassword,
  pickDisplayName,
  pickColor,
  generateHandle,
  ensureUniqueHandle,
  computeExpiresAt,
} from './identity.ts';
import { takenActiveHandles, issueSession } from './auth.ts';

export interface CreateUserResult {
  ok: true;
  did: string;
  uid: string;
  handle: string;
  displayName: string;
  colorHex: string;
  password: string;
  accessToken: string;
  expiresAt: string;
}

export async function createUser(
  supabase: SupabaseClient,
  adminDid: string,
  input: { displayName?: string; colorHex?: string },
): Promise<CreateUserResult> {
  const did = generateDid();
  const password = generatePassword();
  const passwordHash = await hashPassword(password);
  const now = new Date().toISOString();

  await supabase.from('devices').insert({
    did,
    password_hash: passwordHash,
    is_admin: false,
    ip: 'admin-created',
    user_agent: 'admin',
    fingerprint: 'admin',
    platform: 'admin',
    screen: 'admin',
    created_at: now,
    last_active_at: now,
    created_by_admin_did: adminDid,
  });

  const uid = generateUid();
  const displayName = input.displayName && input.displayName.trim()
    ? input.displayName.trim().slice(0, 40)
    : pickDisplayName(uid);
  const colorHex = input.colorHex && /^#[0-9a-fA-F]{6}$/.test(input.colorHex)
    ? input.colorHex
    : pickColor(uid);

  const taken = await takenActiveHandles(supabase);
  const handle = ensureUniqueHandle(generateHandle(uid), taken);
  const expiresAt = computeExpiresAt();

  await supabase.from('daily_identities').insert({
    uid,
    did,
    handle,
    display_name: displayName,
    color_hex: colorHex,
    status: 'active',
    issued_at: now,
    expires_at: expiresAt,
  });

  const accessToken = await issueSession(supabase, did, uid);

  return {
    ok: true,
    did,
    uid,
    handle,
    displayName,
    colorHex,
    password,
    accessToken,
    expiresAt,
  };
}

export async function listDevices(supabase: SupabaseClient): Promise<Array<Record<string, unknown>>> {
  const { data: devices, error } = await supabase
    .from('devices')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) return [];
  const { data: ids } = await supabase
    .from('daily_identities')
    .select('did, handle, display_name, color_hex')
    .eq('status', 'active');
  const byDid = new Map<string, { handle: string | null; display_name: string | null; color_hex: string | null }>();
  for (const i of (ids ?? []) as Array<{ did: string; handle: string | null; display_name: string | null; color_hex: string | null }>) {
    byDid.set(i.did, i);
  }
  return ((devices ?? []) as Array<Record<string, unknown>>).map((d) => {
    const active = byDid.get(d.did as string);
    return {
      did: d.did,
      isAdmin: !!d.is_admin,
      createdAt: d.created_at,
      lastActiveAt: d.last_active_at,
      handle: active?.handle ?? null,
      displayName: active?.display_name ?? null,
      colorHex: active?.color_hex ?? null,
      createdByAdminDid: d.created_by_admin_did ?? null,
    };
  });
}

export interface CreatePollForPostInput {
  question: string;
  options: Array<{ label: string }>;
}

export interface CreateAdminPostInput {
  adminDid: string;
  adminUid: string;
  text: string;
  photoUrl: string | null;
  pinned?: boolean;
  poll?: CreatePollForPostInput;
}

export interface CreateAdminPostOk { ok: true; post: Record<string, unknown>; pollId: string | null; }
export interface CreateAdminPostFail { ok: false; reason: string; message: string; }
export type CreateAdminPostResult = CreateAdminPostOk | CreateAdminPostFail;

export async function createAdminPost(
  supabase: SupabaseClient,
  input: CreateAdminPostInput,
): Promise<CreateAdminPostResult> {
  if (typeof input.text !== 'string' || !input.text.trim()) {
    return { ok: false, reason: 'validation_failed', message: 'text required' };
  }
  if (input.text.length > 500) {
    return { ok: false, reason: 'validation_failed', message: 'text must be ≤ 500 chars' };
  }
  const postId = `post_${crypto.randomUUID()}`;
  const now = new Date().toISOString();

  let pollId: string | null = null;
  if (input.poll && Array.isArray(input.poll.options) && input.poll.options.length >= 2) {
    pollId = `poll_${crypto.randomUUID()}`;
    const options = input.poll.options.slice(0, 6).map((o, i) => ({
      id: `o${i + 1}`,
      label: (typeof o.label === 'string' ? o.label : `Option ${i + 1}`).slice(0, 60),
      voteCount: 0,
    }));
    const { error } = await supabase.from('polls').insert({
      id: pollId,
      post_id: postId,
      question: typeof input.poll.question === 'string' ? input.poll.question.trim().slice(0, 200) : 'Vote',
      options,
      created_at: now,
    });
    if (error) {
      console.error('[admin.createAdminPost.poll]', error.message);
      return { ok: false, reason: 'server_error', message: error.message };
    }
  }

  const { data: ident } = await supabase
    .from('daily_identities')
    .select('handle, display_name, color_hex')
    .eq('uid', input.adminUid)
    .maybeSingle();

  const row = {
    id: postId,
    room_id: 'random',
    author_uid: input.adminUid,
    author_did: input.adminDid,
    author_handle: ident?.handle ?? null,
    author_display_name: ident?.display_name ?? null,
    author_color_hex: ident?.color_hex ?? null,
    content: input.text.trim(),
    photo_url: input.photoUrl,
    created_at: now,
    is_pinned: !!input.pinned,
    pinned_at: input.pinned ? now : null,
    poll_id: pollId,
  };
  const { error } = await supabase.from('posts').insert(row);
  if (error) {
    console.error('[admin.createAdminPost]', error.message);
    return { ok: false, reason: 'server_error', message: error.message };
  }
  return { ok: true, post: { ...row, isAdminPost: true, text: row.content, photoUrl: row.photo_url }, pollId };
}

export interface PinPostOk { ok: true; post: Record<string, unknown>; }
export interface PinPostFail { ok: false; reason: string; message: string; }
export type PinPostResult = PinPostOk | PinPostFail;

export async function pinPost(
  supabase: SupabaseClient,
  postId: string,
): Promise<PinPostResult> {
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from('posts')
    .update({ is_pinned: true, pinned_at: now })
    .eq('id', postId)
    .select('*')
    .maybeSingle();
  if (error || !data) return { ok: false, reason: 'not_found', message: 'post not found' };
  return { ok: true, post: { ...data, isAdminPost: true, text: data.content, photoUrl: data.photo_url, pinnedAt: now } };
}

export interface DeletePostOk { ok: true; removedId: string; }
export interface DeletePostFail { ok: false; reason: string; message: string; }
export type DeletePostResult = DeletePostOk | DeletePostFail;

export async function deletePost(
  supabase: SupabaseClient,
  postId: string,
): Promise<DeletePostResult> {
  const { data: post } = await supabase
    .from('posts')
    .select('id, poll_id')
    .eq('id', postId)
    .maybeSingle();
  if (!post) return { ok: false, reason: 'not_found', message: 'post not found' };
  // Cascade delete: reactions + comments first (FKs use ON DELETE CASCADE,
  // but the reactions table has target_type/target_id polymorphic — no FK,
  // so delete explicitly).
  await supabase.from('reactions').delete().eq('target_type', 'post').eq('target_id', postId);
  await supabase.from('comments').delete().eq('post_id', postId);
  if (post.poll_id) {
    await supabase.from('votes').delete().eq('poll_id', post.poll_id);
    await supabase.from('polls').delete().eq('id', post.poll_id);
  }
  await supabase.from('posts').delete().eq('id', postId);
  return { ok: true, removedId: postId };
}

export async function listAccounts(supabase: SupabaseClient): Promise<Array<Record<string, unknown>>> {
  const nowIso = new Date().toISOString();
  const { data, error } = await supabase
    .from('daily_identities')
    .select('*')
    .eq('status', 'active')
    .gt('expires_at', nowIso)
    .order('issued_at', { ascending: false });
  if (error) return [];
  return ((data ?? []) as Array<Record<string, unknown>>).map((i) => ({
    uid: i.uid,
    did: i.did,
    handle: i.handle ?? null,
    displayName: i.display_name,
    colorHex: i.color_hex,
    expiresAt: i.expires_at,
  }));
}

export interface SwitchAccountOk { ok: true; did: string; uid: string; handle: string | null; displayName: string; colorHex: string; accessToken: string; expiresAt: string | null; }
export interface SwitchAccountFail { ok: false; reason: string; message: string; }
export type SwitchAccountResult = SwitchAccountOk | SwitchAccountFail;

export async function switchAccount(
  supabase: SupabaseClient,
  adminDid: string,
  targetUid: string,
): Promise<SwitchAccountResult> {
  const { data: target, error } = await supabase
    .from('daily_identities')
    .select('*')
    .eq('uid', targetUid)
    .maybeSingle();
  if (error || !target) {
    return { ok: false, reason: 'not_found', message: 'target user identity not found' };
  }
  const now = new Date().toISOString();
  const token = generateToken();
  await supabase.from('tokens').insert({
    token,
    did: adminDid,
    uid: targetUid,
    issued_at: now,
  });
  return {
    ok: true,
    did: adminDid,
    uid: targetUid,
    handle: target.handle ?? null,
    displayName: target.display_name,
    colorHex: target.color_hex,
    accessToken: token,
    expiresAt: target.expires_at,
  };
}
