// lib/dms.ts — direct messages between users, keyed by handle.
//
// Mirrors Server/routes/dms.js. Thread key is the (sender_uid, recipient_uid) tuple.

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { generateId } from './identity.ts';
import { findActiveIdentityByHandle } from './auth.ts';
import { createNotification } from './notifications.ts';

export interface DmRow {
  id: string;
  sender_uid: string;
  recipient_uid: string;
  sender_handle: string | null;
  recipient_handle: string | null;
  content: string;
  photo_url: string | null;
  is_read: boolean | null;
  created_at: string;
}

const MAX_DM = 1000;

export async function listConversations(
  supabase: SupabaseClient,
  myUid: string,
): Promise<Array<Record<string, unknown>>> {
  const { data, error } = await supabase
    .from('dms')
    .select('*')
    .or(`sender_uid.eq.${myUid},recipient_uid.eq.${myUid}`)
    .order('created_at', { ascending: false });
  if (error) {
    console.error('[dms.listConversations]', error.message);
    return [];
  }
  const mine = (data ?? []) as DmRow[];

  // Group by partner uid.
  const byPartner = new Map<string, DmRow[]>();
  for (const m of mine) {
    const partner = m.sender_uid === myUid ? m.recipient_uid : m.sender_uid;
    if (!byPartner.has(partner)) byPartner.set(partner, []);
    byPartner.get(partner)!.push(m);
  }

  const conversations: Array<Record<string, unknown>> = [];
  for (const [partnerUid, msgs] of byPartner) {
    msgs.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    const latest = msgs[0];
    const unread = msgs.filter((m) => m.recipient_uid === myUid && !m.is_read).length;
    const { data: partner } = await supabase
      .from('daily_identities')
      .select('handle, display_name, color_hex')
      .eq('uid', partnerUid)
      .maybeSingle();
    conversations.push({
      partnerUid,
      partnerName: partner?.display_name ?? 'Unknown',
      partnerHandle: partner?.handle ?? null,
      partnerColor: partner?.color_hex ?? '#888',
      lastMessage: latest.content,
      lastMessageAt: latest.created_at,
      unread,
    });
  }
  conversations.sort((a, b) =>
    new Date(b.lastMessageAt as string).getTime() - new Date(a.lastMessageAt as string).getTime(),
  );
  return conversations;
}

export interface ThreadResultData {
  partnerUid: string;
  partnerName: string;
  partnerHandle: string;
  partnerColor: string;
  messages: Array<Record<string, unknown>>;
}
export type ThreadResult = ThreadResultData | null;

export async function getThread(
  supabase: SupabaseClient,
  myUid: string,
  handle: string,
): Promise<ThreadResult> {
  const partner = await findActiveIdentityByHandle(supabase, handle);
  if (!partner) return null;
  const partnerUid = partner.uid;
  const { data, error } = await supabase
    .from('dms')
    .select('*')
    .or(
      `and(sender_uid.eq.${myUid},recipient_uid.eq.${partnerUid}),` +
      `and(sender_uid.eq.${partnerUid},recipient_uid.eq.${myUid})`,
    )
    .order('created_at', { ascending: true });
  if (error) {
    console.error('[dms.getThread]', error.message);
    return null;
  }
  return {
    partnerUid,
    partnerName: partner.display_name,
    partnerHandle: partner.handle,
    partnerColor: partner.color_hex,
    messages: ((data ?? []) as DmRow[]).map((m) => ({
      id: m.id,
      fromUid: m.sender_uid,
      text: m.content,
      createdAt: m.created_at,
      read: !!m.is_read,
      readAt: m.is_read ? m.created_at : null,
    })),
  };
}

export interface SendMessageOk { ok: true; message: Record<string, unknown>; recipient: Record<string, unknown>; }
export interface SendMessageFail { ok: false; reason: string; message: string; }
export type SendMessageResult = SendMessageOk | SendMessageFail;

export async function sendMessage(
  supabase: SupabaseClient,
  myUid: string,
  handle: string,
  text: string,
): Promise<SendMessageResult> {
  const partner = await findActiveIdentityByHandle(supabase, handle);
  if (!partner) return { ok: false, reason: 'not_found', message: 'no active user with that handle' };
  const toUid = partner.uid;
  if (toUid === myUid) return { ok: false, reason: 'validation_failed', message: 'cannot DM yourself' };
  if (typeof text !== 'string' || !text.trim()) {
    return { ok: false, reason: 'validation_failed', message: 'text is required' };
  }
  if (text.length > MAX_DM) {
    return { ok: false, reason: 'validation_failed', message: `text must be ≤ ${MAX_DM} chars` };
  }

  const id = generateId('dm');
  const now = new Date().toISOString();
  const row: DmRow = {
    id,
    sender_uid: myUid,
    recipient_uid: toUid,
    sender_handle: null,
    recipient_handle: null,
    content: text.trim(),
    photo_url: null,
    is_read: false,
    created_at: now,
  };
  const { error } = await supabase.from('dms').insert(row);
  if (error) {
    console.error('[dms.sendMessage.insert]', error.message);
    return { ok: false, reason: 'server_error', message: error.message };
  }
  const { data: sender } = await supabase
    .from('daily_identities')
    .select('display_name, color_hex')
    .eq('uid', myUid)
    .maybeSingle();
  await createNotification(supabase, {
    recipientUid: toUid,
    type: 'dm',
    actorUid: myUid,
    actorName: sender?.display_name ?? 'Someone',
    actorColor: sender?.color_hex ?? '#888',
    text: `sent you a message: "${text.trim().slice(0, 50)}${text.trim().length > 50 ? '…' : ''}"`,
  });

  return {
    ok: true,
    message: {
      id,
      fromUid: myUid,
      text: text.trim(),
      createdAt: now,
      read: false,
      readAt: null,
    },
    recipient: {
      uid: partner.uid,
      handle: partner.handle,
      displayName: partner.display_name,
      colorHex: partner.color_hex,
    },
  };
}

export async function markThreadRead(
  supabase: SupabaseClient,
  myUid: string,
  partnerUid: string,
): Promise<void> {
  await supabase
    .from('dms')
    .update({ is_read: true })
    .eq('sender_uid', partnerUid)
    .eq('recipient_uid', myUid)
    .eq('is_read', false);
}
