// routes/profile.ts — public profile + follow/unfollow.

import type { RequestCtx } from '../_shared/types.ts';
import { json, badRequest, notFound, unauthorized } from '../_shared/response.ts';
import { requireAuth } from '../lib/auth.ts';
import { getProfile, followUser, unfollowUser } from '../lib/profile.ts';

export async function profile(ctx: RequestCtx, handle: string): Promise<Response> {
  const callerDid = ctx.auth?.did ?? null;
  const p = await getProfile(ctx.supabase, handle, callerDid);
  if (!p) return notFound('no active user with that handle');
  return json(p);
}

export async function follow(ctx: RequestCtx, handle: string): Promise<Response> {
  const auth = await requireAuth(ctx);
  const r = await followUser(ctx.supabase, auth.did, auth.uid, handle);
  if (!r.ok) {
    if (r.reason === 'not_found') return notFound(r.message);
    return badRequest(r.message);
  }
  return json(r);
}

export async function unfollow(ctx: RequestCtx, handle: string): Promise<Response> {
  const auth = await requireAuth(ctx);
  const r = await unfollowUser(ctx.supabase, auth.did, handle);
  if (!r.ok) {
    if (r.reason === 'not_found') return notFound(r.message);
    return badRequest(r.message);
  }
  return json(r);
}
