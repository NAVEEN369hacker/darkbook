// lib/notifications.ts — create + list + read helpers.
//
// All notification writes go through createNotification so we keep
// the recipientUid/actorUid contract consistent (see Server/routes/notifications.js).

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { generateId } from './identity.ts';

export interface NotificationInput {
  recipientUid: string;
  type: string; // 'dm', 'comment', 'reaction' (like/shake), 'follow'
  actorUid?: string | null;
  actorName?: string | null;
  actorColor?: string | null;
  text: string;
  title?: string | null;
  body?: string | null;
  link?: string | null;
}

export async function createNotification(
  supabase: SupabaseClient,
  input: NotificationInput,
): Promise<void> {
  // Never notify yourself.
  if (input.actorUid && input.recipientUid === input.actorUid) return;

  const row = {
    id: generateId('notif'),
    recipient_uid: input.recipientUid,
    type: input.type,
    actor_uid: input.actorUid ?? null,
    actor_name: input.actorName ?? null,
    actor_color: input.actorColor ?? null,
    title: input.title ?? null,
    body: input.body ?? null,
    link: input.link ?? null,
    text: input.text,
    is_read: false,
    created_at: new Date().toISOString(),
  };
  const { error } = await supabase.from('notifications').insert(row);
  if (error) console.warn('[notifications.insert]', error.message);
}

export async function listNotifications(
  supabase: SupabaseClient,
  recipientUid: string,
): Promise<Array<Record<string, unknown>>> {
  const { data, error } = await supabase
    .from('notifications')
    .select('*')
    .eq('recipient_uid', recipientUid)
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) {
    console.error('[notifications.list]', error.message);
    return [];
  }
  return (data ?? []).map((r: Record<string, unknown>) => ({
    id: r.id,
    type: r.type,
    title: r.title ?? null,
    body: r.body ?? null,
    link: r.link ?? null,
    text: r.text ?? null,
    actorUid: r.actor_uid ?? null,
    actorName: r.actor_name ?? null,
    actorColor: r.actor_color ?? null,
    read: !!r.is_read,
    isRead: !!r.is_read,
    readAt: r.is_read ? r.created_at : null,
    createdAt: r.created_at,
  }));
}

export async function unreadCount(
  supabase: SupabaseClient,
  recipientUid: string,
): Promise<number> {
  const { count, error } = await supabase
    .from('notifications')
    .select('*', { count: 'exact', head: true })
    .eq('recipient_uid', recipientUid)
    .eq('is_read', false);
  if (error) {
    console.error('[notifications.unreadCount]', error.message);
    return 0;
  }
  return count ?? 0;
}

export async function markOneRead(
  supabase: SupabaseClient,
  recipientUid: string,
  id: string,
): Promise<boolean> {
  const { error } = await supabase
    .from('notifications')
    .update({ is_read: true })
    .eq('id', id)
    .eq('recipient_uid', recipientUid);
  return !error;
}

export async function markAllRead(
  supabase: SupabaseClient,
  recipientUid: string,
): Promise<void> {
  await supabase
    .from('notifications')
    .update({ is_read: true })
    .eq('recipient_uid', recipientUid)
    .eq('is_read', false);
}
