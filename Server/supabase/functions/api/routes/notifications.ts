// routes/notifications.ts — list, unread count, mark one/all read.

import type { RequestCtx } from '../_shared/types.ts';
import { json, notFound } from '../_shared/response.ts';
import { requireAuth } from '../lib/auth.ts';
import { listNotifications, unreadCount, markOneRead, markAllRead } from '../lib/notifications.ts';

export async function list(ctx: RequestCtx): Promise<Response> {
  const auth = await requireAuth(ctx);
  const notifications = await listNotifications(ctx.supabase, auth.uid);
  return json({ notifications });
}

export async function unread(ctx: RequestCtx): Promise<Response> {
  const auth = await requireAuth(ctx);
  const count = await unreadCount(ctx.supabase, auth.uid);
  return json({ count });
}

export async function markOne(ctx: RequestCtx, id: string): Promise<Response> {
  const auth = await requireAuth(ctx);
  const ok = await markOneRead(ctx.supabase, auth.uid, id);
  if (!ok) return notFound('notification not found');
  return json({ ok: true });
}

export async function markAll(ctx: RequestCtx): Promise<Response> {
  const auth = await requireAuth(ctx);
  await markAllRead(ctx.supabase, auth.uid);
  return json({ ok: true });
}
