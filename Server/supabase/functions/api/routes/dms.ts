// routes/dms.ts — direct messages.

import type { RequestCtx } from '../_shared/types.ts';
import { json, badRequest, notFound } from '../_shared/response.ts';
import { readJson } from '../_shared/parse.ts';
import { requireAuth } from '../lib/auth.ts';
import { listConversations, getThread, sendMessage, markThreadRead } from '../lib/dms.ts';
import { findActiveIdentityByHandle } from '../lib/auth.ts';

export async function list(ctx: RequestCtx): Promise<Response> {
  const auth = await requireAuth(ctx);
  const conversations = await listConversations(ctx.supabase, auth.uid);
  return json({ conversations });
}

export async function thread(ctx: RequestCtx, handle: string): Promise<Response> {
  const auth = await requireAuth(ctx);
  const t = await getThread(ctx.supabase, auth.uid, handle);
  if (!t) return notFound('no active user with that handle');
  return json(t);
}

export async function send(ctx: RequestCtx, handle: string): Promise<Response> {
  const auth = await requireAuth(ctx);
  const body = await readJson(ctx.req);
  const r = await sendMessage(ctx.supabase, auth.uid, handle, (body.text as string | undefined) ?? '');
  if (!r.ok) {
    if (r.reason === 'not_found') return notFound(r.message);
    return badRequest(r.message);
  }
  return json(r, 201);
}

export async function markRead(ctx: RequestCtx, handle: string): Promise<Response> {
  const auth = await requireAuth(ctx);
  const partner = await findActiveIdentityByHandle(ctx.supabase, handle);
  if (!partner) return notFound('no active user with that handle');
  await markThreadRead(ctx.supabase, auth.uid, partner.uid);
  return json({ ok: true });
}
