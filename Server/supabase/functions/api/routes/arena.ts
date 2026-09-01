// routes/arena.ts — debate topics.

import type { RequestCtx } from '../_shared/types.ts';
import { json, badRequest, notFound, paymentRequired } from '../_shared/response.ts';
import { readJson } from '../_shared/parse.ts';
import { requireAuth } from '../lib/auth.ts';
import { listTopics, getTopic, createArgument } from '../lib/arena.ts';

export async function list(ctx: RequestCtx): Promise<Response> {
  const topics = await listTopics(ctx.supabase);
  return json({ topics });
}

export async function detail(ctx: RequestCtx, topicId: string): Promise<Response> {
  const t = await getTopic(ctx.supabase, topicId);
  if (!t) return notFound('topic not found');
  return json(t);
}

export async function create(ctx: RequestCtx, topicId: string): Promise<Response> {
  const auth = await requireAuth(ctx);
  const body = await readJson(ctx.req);
  const r = await createArgument(
    ctx.supabase,
    topicId,
    auth.did,
    auth.uid,
    (body.partyId as string | undefined) ?? '',
    (body.text as string | undefined) ?? '',
  );
  if (!r.ok) {
    if (r.reason === 'insufficient') {
      return paymentRequired(
        `You need ${r.needed} coins to post, but you have ${r.have}.`,
        { needed: r.needed, have: r.have },
      );
    }
    if (r.reason === 'not_found') return notFound(r.message);
    if (r.reason === 'topic_expired') {
      return new Response(JSON.stringify({ error: r.reason, message: r.message }), { status: 410 });
    }
    return badRequest(r.message);
  }
  return json({ post: r.post, balance: r.balance }, 201);
}
