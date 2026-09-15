// routes/admin.ts — admin operations.
//
// All handlers require requireAdmin() (bearer token + is_admin flag).

import type { RequestCtx } from '../_shared/types.ts';
import { json, badRequest, notFound } from '../_shared/response.ts';
import { readJson, readMultipart } from '../_shared/parse.ts';
import { requireAdmin } from '../lib/auth.ts';
import {
  createUser,
  listDevices,
  createAdminPost,
  pinPost,
  deletePost,
  listAccounts,
  switchAccount,
} from '../lib/admin.ts';
import { uploadMedia, UnsupportedTypeError, TooLargeError, UploadFailedError } from '../lib/media.ts';
import { createTopic } from '../lib/arena.ts';
import { getOptionalEnv } from '../_shared/env.ts';

const MEDIA_BUCKET = getOptionalEnv('SUPABASE_MEDIA_BUCKET', 'ghostline-media');

export async function users(ctx: RequestCtx): Promise<Response> {
  const auth = await requireAdmin(ctx);
  const body = await readJson(ctx.req);
  const r = await createUser(ctx.supabase, auth.did, {
    displayName: body.displayName as string | undefined,
    colorHex: body.colorHex as string | undefined,
  });
  return json(r, 201);
}

export async function devices(ctx: RequestCtx): Promise<Response> {
  await requireAdmin(ctx);
  const devices = await listDevices(ctx.supabase);
  return json({ devices });
}

export async function accounts(ctx: RequestCtx): Promise<Response> {
  await requireAdmin(ctx);
  const accounts = await listAccounts(ctx.supabase);
  return json({ accounts });
}

export async function switchAccountRoute(ctx: RequestCtx): Promise<Response> {
  const auth = await requireAdmin(ctx);
  const body = await readJson(ctx.req);
  const targetUid = body.uid as string | undefined;
  if (!targetUid) return badRequest('uid is required');
  const r = await switchAccount(ctx.supabase, auth.did, targetUid);
  if (!r.ok) return notFound(r.message);
  return json({ ...r, isAdmin: true, password: '' });
}

export async function adminCreatePost(ctx: RequestCtx): Promise<Response> {
  const auth = await requireAdmin(ctx);

  const ct = ctx.req.headers.get('content-type') ?? '';
  let text = '';
  let providedPhotoUrl: string | null = null;
  let pinned = false;
  let pollInput: { question?: string; options?: Array<{ label: string }> } | undefined;
  let photoFile: { bytes: Uint8Array; name: string; type: string } | null = null;

  if (ct.startsWith('multipart/form-data')) {
    const fd = await readMultipart(ctx.req);
    text = (fd.fields.text ?? '').toString();
    if (fd.fields.photoUrl) providedPhotoUrl = fd.fields.photoUrl.toString();
    pinned = fd.fields.pinned === 'true';
    if (fd.fields.poll) {
      try {
        const p = JSON.parse(fd.fields.poll);
        if (Array.isArray(p.options)) pollInput = p;
      } catch { /* ignore */ }
    }
    if (fd.files.photo) photoFile = fd.files.photo;
  } else {
    const body = await readJson(ctx.req);
    text = ((body.text as string | undefined) ?? '').toString();
    if (typeof body.photoUrl === 'string' && body.photoUrl.startsWith('/uploads/')) providedPhotoUrl = body.photoUrl;
    pinned = !!body.pinned;
    if (body.poll && typeof body.poll === 'object' && Array.isArray((body.poll as { options?: unknown[] }).options)) {
      pollInput = body.poll as { question?: string; options?: Array<{ label: string }> };
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

  const r = await createAdminPost(ctx.supabase, {
    adminDid: auth.did,
    adminUid: auth.uid,
    text,
    photoUrl,
    pinned,
    poll: pollInput,
  });
  if (!r.ok) return badRequest(r.message);
  return json({ post: r.post }, 201);
}

export async function adminPin(ctx: RequestCtx, postId: string): Promise<Response> {
  await requireAdmin(ctx);
  const r = await pinPost(ctx.supabase, postId);
  if (!r.ok) return notFound(r.message);
  return json({ ok: true, post: r.post });
}

export async function adminDelete(ctx: RequestCtx, postId: string): Promise<Response> {
  await requireAdmin(ctx);
  const r = await deletePost(ctx.supabase, postId);
  if (!r.ok) return notFound(r.message);
  return json({ ok: true, removedId: r.removedId });
}

export async function adminArenaTopic(ctx: RequestCtx): Promise<Response> {
  const auth = await requireAdmin(ctx);
  const body = await readJson(ctx.req);
  const r = await createTopic(ctx.supabase, auth.did, {
    title: (body.title as string | undefined) ?? '',
    description: body.description as string | undefined,
    parties: Array.isArray(body.parties)
      ? (body.parties as Array<{ label: string; emoji?: string; colorHex?: string }>)
      : [],
  });
  if (!r.ok) return badRequest(r.message);
  return json({ topic: r.topic }, 201);
}
