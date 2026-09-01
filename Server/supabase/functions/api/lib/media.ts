// lib/media.ts — Supabase Storage uploads.
//
// Deno Edge Functions have no persistent filesystem, so the previous local-disk
// fallback in Server/lib/upload.js is intentionally NOT carried over — every
// upload must succeed against Supabase Storage or the handler returns 422.

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

export const ALLOWED_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
]);

const MAX_BYTES = 5 * 1024 * 1024; // 5 MB

export function buildObjectKey(originalName: string): string {
  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(now.getUTCDate()).padStart(2, '0');
  const dot = originalName.lastIndexOf('.');
  const ext = (dot >= 0 ? originalName.slice(dot) : '.jpg').toLowerCase();
  const rand = Array.from(crypto.getRandomValues(new Uint8Array(8)))
    .map((b) => b.toString(16).padStart(2, '0')).join('');
  const base = (originalName.slice(0, dot) || 'photo')
    .replace(/[^a-zA-Z0-9_-]/g, '')
    .slice(0, 32) || 'photo';
  return `${yyyy}/${mm}/${dd}/${rand}-${base}${ext}`;
}

export class UnsupportedTypeError extends Error {
  code = 'UNSUPPORTED_TYPE';
}
export class TooLargeError extends Error {
  code = 'LIMIT_FILE_SIZE';
}
export class UploadFailedError extends Error {
  code = 'UPLOAD_FAILED';
}

export interface UploadResult {
  url: string;
  key: string;
}

export async function ensureBucket(
  supabase: SupabaseClient,
  bucket: string,
): Promise<boolean> {
  try {
    const { data: existing } = await supabase.storage.getBucket(bucket);
    if (existing) return true;
    const { error } = await supabase.storage.createBucket(bucket, {
      public: true,
      fileSizeLimit: String(MAX_BYTES),
      allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
    });
    if (error) {
      console.warn('[media.createBucket]', error.message);
      return false;
    }
    console.log(`[media] created bucket ${bucket}`);
    return true;
  } catch (e) {
    console.warn('[media.ensureBucket]', (e as Error).message);
    return false;
  }
}

export async function uploadMedia(
  supabase: SupabaseClient,
  bucket: string,
  bytes: Uint8Array,
  originalName: string,
  mime: string,
): Promise<UploadResult> {
  if (mime && !ALLOWED_MIME.has(mime)) throw new UnsupportedTypeError('unsupported_image_type');
  if (bytes.byteLength > MAX_BYTES) throw new TooLargeError('photo must be ≤ 5 MB');

  await ensureBucket(supabase, bucket);
  const key = buildObjectKey(originalName);
  const { error } = await supabase.storage.from(bucket).upload(key, bytes, {
    contentType: mime || 'image/jpeg',
    cacheControl: '31536000',
    upsert: false,
  });
  if (error) {
    console.error('[media.upload]', error.message);
    throw new UploadFailedError('photo upload failed');
  }
  const { data: pub } = supabase.storage.from(bucket).getPublicUrl(key);
  return { url: pub.publicUrl, key };
}
