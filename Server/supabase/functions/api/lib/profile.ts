// lib/profile.ts — public profile + follow/unfollow.
//
// Mirrors Server/routes/profile.js. The follow notification call is FIXED
// here — the Node code passed (did, {title, body, link}) to createNotification
// instead of the proper signature, so follow notifications never fired.
// We pass { recipientUid, type, actorUid, actorName, actorColor, text }.

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { findActiveIdentityByHandle } from './auth.ts';
import { createNotification } from './notifications.ts';

const FEED_WINDOW_MS = 25 * 60 * 60 * 1000;

export interface ProfileResponse {
  profile: Record<string, unknown>;
  stats: Record<string, unknown>;
  posts: Array<Record<string, unknown>>;
} | null

export async function getProfile(
  supabase: SupabaseClient,
  handle: string,
  callerDid: string | null,
): Promise<ProfileResponse> {
  const ident = await findActiveIdentityByHandle(supabase, handle);
  if (!ident) return null;
  const uid = ident.uid;
  const targetDid = ident.did;

  const cutoff = new Date(Date.now() - FEED_WINDOW_MS).toISOString();
  const { data: postRows } = await supabase
    .from('posts')
    .select('*')
    .eq('author_uid', uid)
    .gte('created_at', cutoff)
    .order('created_at', { ascending: false });
  const posts = (postRows ?? []) as Array<Record<string, unknown>>;
  const enrichedPosts: Array<Record<string, unknown>> = [];
  let lifetimeLikes = 0;
  let lifetimeShakes = 0;
  let lifetimeComments = 0;
  for (const p of posts) {
    const { count: likeCount } = await supabase
      .from('reactions')
      .select('*', { count: 'exact', head: true })
      .eq('target_type', 'post')
      .eq('target_id', p.id as string)
      .eq('emoji', 'like');
    const { count: shakeCount } = await supabase
      .from('reactions')
      .select('*', { count: 'exact', head: true })
      .eq('target_type', 'post')
      .eq('target_id', p.id as string)
      .eq('emoji', 'shake');
    const { count: commentCount } = await supabase
      .from('comments')
      .select('*', { count: 'exact', head: true })
      .eq('post_id', p.id as string);
    lifetimeLikes += likeCount ?? 0;
    lifetimeShakes += shakeCount ?? 0;
    lifetimeComments += commentCount ?? 0;
    enrichedPosts.push({
      id: p.id,
      text: p.content,
      createdAt: p.created_at,
      likeCount: likeCount ?? 0,
      shakeCount: shakeCount ?? 0,
      commentCount: commentCount ?? 0,
    });
  }

  const { count: myComments } = await supabase
    .from('comments')
    .select('*', { count: 'exact', head: true })
    .eq('author_uid', uid);
  const { data: myDms } = await supabase
    .from('dms')
    .select('sender_uid, recipient_uid')
    .or(`sender_uid.eq.${uid},recipient_uid.eq.${uid}`);
  const counterparties = new Set<string>();
  for (const m of (myDms ?? []) as Array<{ sender_uid: string; recipient_uid: string }>) {
    counterparties.add(m.sender_uid === uid ? m.recipient_uid : m.sender_uid);
  }
  const { count: followersCount } = await supabase
    .from('follows')
    .select('*', { count: 'exact', head: true })
    .eq('following_did', targetDid);
  const { count: followingCount } = await supabase
    .from('follows')
    .select('*', { count: 'exact', head: true })
    .eq('follower_did', targetDid);
  let isFollowing = false;
  if (callerDid) {
    const { data: f } = await supabase
      .from('follows')
      .select('id')
      .eq('follower_did', callerDid)
      .eq('following_did', targetDid)
      .maybeSingle();
    isFollowing = !!f;
  }

  return {
    profile: {
      uid,
      did: targetDid,
      handle: ident.handle,
      displayName: ident.display_name,
      colorHex: ident.color_hex,
      expiresAt: null,
      followersCount: followersCount ?? 0,
      followingCount: followingCount ?? 0,
      isFollowing,
    },
    stats: {
      postCount: posts.length,
      lifetimeLikes,
      lifetimeShakes,
      lifetimeComments,
      commentCount: myComments ?? 0,
      conversationCount: counterparties.size,
      followersCount: followersCount ?? 0,
      followingCount: followingCount ?? 0,
    },
    posts: enrichedPosts,
  };
}

export interface FollowResult {
  ok: true;
  isFollowing: boolean;
  followersCount: number;
} | { ok: false; reason: string; message: string }

export async function followUser(
  supabase: SupabaseClient,
  callerDid: string,
  callerUid: string,
  handle: string,
): Promise<FollowResult> {
  const target = await findActiveIdentityByHandle(supabase, handle);
  if (!target) return { ok: false, reason: 'not_found', message: 'user not found' };
  if (target.did === callerDid) {
    return { ok: false, reason: 'bad_request', message: 'cannot follow yourself' };
  }

  // Idempotent: ON CONFLICT DO NOTHING.
  const { error } = await supabase
    .from('follows')
    .insert({
      follower_did: callerDid,
      following_did: target.did,
    });
  if (error && !/duplicate/i.test(error.message)) {
    console.error('[profile.followUser.insert]', error.message);
    return { ok: false, reason: 'server_error', message: error.message };
  }

  // Fixed notification call — was passing (did, {title, body, link}) before.
  const { data: callerIdent } = await supabase
    .from('daily_identities')
    .select('display_name, color_hex')
    .eq('uid', callerUid)
    .maybeSingle();
  await createNotification(supabase, {
    recipientUid: target.uid,
    type: 'follow',
    actorUid: callerUid,
    actorName: callerIdent?.display_name ?? 'Someone',
    actorColor: callerIdent?.color_hex ?? '#888',
    text: 'started following you.',
    title: 'New Follower',
    link: `/users/${target.handle}`,
  });

  const { count } = await supabase
    .from('follows')
    .select('*', { count: 'exact', head: true })
    .eq('following_did', target.did);
  return { ok: true, isFollowing: true, followersCount: count ?? 0 };
}

export async function unfollowUser(
  supabase: SupabaseClient,
  callerDid: string,
  handle: string,
): Promise<FollowResult> {
  const target = await findActiveIdentityByHandle(supabase, handle);
  if (!target) return { ok: false, reason: 'not_found', message: 'user not found' };
  await supabase
    .from('follows')
    .delete()
    .eq('follower_did', callerDid)
    .eq('following_did', target.did);
  const { count } = await supabase
    .from('follows')
    .select('*', { count: 'exact', head: true })
    .eq('following_did', target.did);
  return { ok: true, isFollowing: false, followersCount: count ?? 0 };
}
