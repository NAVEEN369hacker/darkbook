// routes/polls.ts — read + vote.

import type { RequestCtx } from '../_shared/types.ts';
import { json, badRequest, notFound } from '../_shared/response.ts';
import { readJson } from '../_shared/parse.ts';
import { requireAuth } from '../lib/auth.ts';
import { getPoll, vote } from '../lib/polls.ts';

export async function detail(ctx: RequestCtx, pollId: string): Promise<Response> {
  const viewerDid = ctx.auth?.did ?? null;
  const poll = await getPoll(ctx.supabase, pollId, viewerDid);
  if (!poll) return notFound('poll not found');
  return json({ poll });
}

export async function castVote(ctx: RequestCtx, pollId: string): Promise<Response> {
  const auth = await requireAuth(ctx);
  const body = await readJson(ctx.req);
  const r = await vote(ctx.supabase, pollId, auth.did, (body.optionId as string | undefined) ?? '');
  if (!r.ok) {
    if (r.reason === 'not_found') return notFound(r.message);
    return badRequest(r.message);
  }
  return json(r);
}
