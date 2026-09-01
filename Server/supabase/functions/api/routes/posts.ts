// routes/posts.ts — feed, posts, comments, reactions.
//
// Mirrors Server/routes/posts.js. Two endpoints accept multipart/form-data
// (POST /api/posts and POST /api/admin/posts); everything else is JSON.

import type { RequestCtx } from '../_shared/types.ts';
import { json, badRequest, notFound, unauthorized, paymentRequired } from '../_shared/response.ts';
import { readJson, readMultipart, getClientIp } from '../_shared/parse.ts';
import { requireAuth } from '../lib/auth.ts';
import {
  listFeed,
  createPost,
  reactToPost,
  reactToComment,
  listComments,
  createComment,
  enrichPost,
} from '../lib/feed.ts';
import { uploadMedia, UnsupportedTypeError, TooLargeError, UploadFailedError } from '../lib/media.ts';
import { getOptionalEnv } from '../_shared/env.ts';

const FEED_DEFAULT_LIMIT = 50;
const FEED_MAX_LIMIT = 100;
const MEDIA_BUCKET = getOptionalEnv('SUPABASE_MEDIA_BUCKET', 'ghostline-media');

export async function feed(ctx: RequestCtx): Promise<Response> {
  const roomId = ctx.url.searchParams.get('roomId') ?? 'random';
  if (roomId !== 'random') return badRequest('unknown roomId');
  const limit = Math.min(
    FEED_MAX_LIMIT,
    Math.max(1, parseInt(ctx.url.searchParams.get('limit') ?? '', 10) || FEED_DEFAULT_LIMIT),
  );
  const viewerDid = ctx.auth?.did ?? null;
  const viewerUid = ctx.auth?.uid ?? null;
  const posts = await listFeed(ctx.supabase, roomId, limit, viewerDid, viewerUid);
  return json({ posts });
}

export async function create(ctx: RequestCtx): Promise<Response> {
  const auth = await requireAuth(ctx);

  const ct = ctx.req.headers.get('content-type') ?? '';
  let text = '';
  let providedPhotoUrl: string | null = null;
  let photoFile: { bytes: Uint8Array; name: string; type: string } | null = null;

  if (ct.startsWith('multipart/form-data')) {
    const fd = await readMultipart(ctx.req);
    text = (fd.fields.text ?? '').toString();
    if (fd.fields.photoUrl) providedPhotoUrl = fd.fields.photoUrl.toString();
    if (fd.files.photo) photoFile = fd.files.photo;
  } else {
    const body = await readJson(ctx.req);
    text = ((body.text as string | undefined) ?? '').toString();
    if (typeof body.photoUrl === 'string' && body.photoUrl.startsWith('/uploads/')) {
      providedPhotoUrl = body.photoUrl;
    }
  }

  let photoUrl: string | null = providedPhotoUrl;
  if (photoFile) {
    try {
      const result = await uploadMedia(
        ctx.supabase,
        MEDIA_BUCKET,
        photoFile.bytes,
        photoFile.name,
        photoFile.type,
      );
      photoUrl = result.url;
    } catch (e) {
      if (e instanceof UnsupportedTypeError) return badRequest('photo must be JPEG/PNG/WebP/GIF');
      if (e instanceof TooLargeError) return badRequest('photo must be ≤ 5 MB');
      if (e instanceof UploadFailedError) {
        return new Response(JSON.stringify({ error: 'upload_failed', message: 'photo upload failed' }), { status: 500 });
      }
      throw e;
    }
  }

  const result = await createPost(ctx.supabase, {
    did: auth.did,
    uid: auth.uid,
    roomId: 'random',
    text,
    photoUrl,
  });
  if (!result.ok) {
    if (result.reason === 'insufficient') {
      return paymentRequired(
        `You need ${result.needed} coins to post, but you have ${result.have}. Visit your Vault to earn more.`,
        { needed: result.needed, have: result.have },
      );
    }
    return badRequest(result.message ?? result.reason);
  }
  const enriched = await enrichPost(ctx.supabase, result.post, auth.did, auth.uid);
  return json({ post: enriched, balance: result.balance < 0 ? undefined : result.balance }, 201);
}

export async function react(ctx: RequestCtx, postId: string): Promise<Response> {
  const auth = await requireAuth(ctx);
  const body = await readJson(ctx.req);
  const type = body.type as 'like' | 'shake' | null | undefined;
  const r = await reactToPost(ctx.supabase, auth.did, auth.uid, postId, type ?? null);
  if (!r) return notFound('post not found');
  return json({ postId, likeCount: r.likeCount, shakeCount: r.shakeCount, myReaction: r.myReaction });
}

export async function comments(ctx: RequestCtx, postId: string): Promise<Response> {
  const viewerUid = ctx.auth?.uid ?? null;
  const list = await listComments(ctx.supabase, postId, viewerUid);
  return json({ comments: list, viewerDid: ctx.auth?.did ?? null });
}

export async function createCommentRoute(ctx: RequestCtx, postId: string): Promise<Response> {
  const auth = await requireAuth(ctx);
  const body = await readJson(ctx.req);
  const r = await createComment(ctx.supabase, postId, auth.did, auth.uid, (body.text as string | undefined) ?? '');
  if (!r.ok) {
    if (r.reason === 'not_found') return notFound(r.message);
    return badRequest(r.message ?? r.reason);
  }
  return json({ comment: r.comment }, 201);
}

export async function reactComment(ctx: RequestCtx, commentId: string): Promise<Response> {
  const auth = await requireAuth(ctx);
  const body = await readJson(ctx.req);
  const type = body.type as 'like' | 'shake' | null | undefined;
  const r = await reactToComment(ctx.supabase, auth.did, auth.uid, commentId, type ?? null);
  if (!r) return notFound('comment not found');
  return json({ commentId, likeCount: r.likeCount, shakeCount: r.shakeCount, myReaction: r.myReaction });
}
