/**
 * Media upload helper.
 *
 * Primary: Supabase Storage (bucket `ghostline-media`), public-read.
 * Fallback: local disk under ./uploads/ (served at /uploads/<filename>).
 *
 * Returns an object URL the caller should store as `photoUrl`.
 *   - Supabase:  https://<project>.supabase.co/storage/v1/object/public/ghostline-media/<key>
 *   - Local:     /uploads/<filename>
 *
 * Switch from R2 to Supabase for now; later swap to an R2 adapter without
 * changing route handlers.
 */

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { supabaseAdmin } = require('./db');

const BUCKET = process.env.SUPABASE_MEDIA_BUCKET || 'ghostline-media';
const UPLOADS_DIR = path.join(__dirname, '..', 'uploads');

const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

/**
 * Build a stable, collision-resistant object key:
 *   <yyyy>/<mm>/<dd>/<random>-<safeOriginalName>
 */
function buildObjectKey(originalName) {
  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(now.getUTCDate()).padStart(2, '0');
  const ext = (path.extname(originalName || '') || '.jpg').toLowerCase();
  const rand = crypto.randomBytes(8).toString('hex');
  const safeBase = (path.basename(originalName || 'photo', ext)
    .replace(/[^a-zA-Z0-9_-]/g, '')
    .slice(0, 32) || 'photo');
  return `${yyyy}/${mm}/${dd}/${rand}-${safeBase}${ext}`;
}

/**
 * Ensure the bucket exists and is public-read. Idempotent.
 * If the bucket already exists, this is a fast no-op.
 */
async function ensureBucket() {
  if (!supabaseAdmin) return false;
  try {
    const { data: existing, error: getErr } = await supabaseAdmin.storage.getBucket(BUCKET);
    if (getErr && getErr.message && !/not found/i.test(getErr.message)) {
      console.warn('[upload] storage.getBucket warning:', getErr.message);
    }
    if (!existing) {
      const { error: createErr } = await supabaseAdmin.storage.createBucket(BUCKET, {
        public: true,
        fileSizeLimit: 5 * 1024 * 1024, // 5 MB
        allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
      });
      if (createErr) {
        console.warn('[upload] createBucket warning:', createErr.message);
        return false;
      }
      console.log(`[upload] created Supabase Storage bucket: ${BUCKET} (public)`);
    }
    return true;
  } catch (err) {
    console.error('[upload] ensureBucket error:', err.message);
    return false;
  }
}

/**
 * Upload a single file (Buffer) to Supabase Storage.
 * Returns { url, provider: 'supabase' | 'local', key }.
 * On any Supabase error, falls back to local disk so uploads never break.
 */
async function uploadMedia(buffer, originalName, mime) {
  if (!Buffer.isBuffer(buffer)) {
    throw new Error('uploadMedia: buffer required');
  }
  if (mime && !ALLOWED_MIME.has(mime)) {
    const err = new Error('unsupported_image_type');
    err.code = 'UNSUPPORTED_TYPE';
    throw err;
  }

  // --- Try Supabase Storage first ---
  if (supabaseAdmin) {
    try {
      await ensureBucket();
      const key = buildObjectKey(originalName);
      const { error } = await supabaseAdmin.storage
        .from(BUCKET)
        .upload(key, buffer, {
          contentType: mime || 'image/jpeg',
          cacheControl: '31536000', // 1 year — URLs are content-addressed-ish
          upsert: false,
        });
      if (!error) {
        const { data: pub } = supabaseAdmin.storage.from(BUCKET).getPublicUrl(key);
        return { url: pub.publicUrl, provider: 'supabase', key };
      }
      console.warn('[upload] Supabase upload failed, falling back to local disk:', error.message);
    } catch (err) {
      console.error('[upload] Supabase upload threw, falling back to local disk:', err.message);
    }
  }

  // --- Local fallback ---
  if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  const ext = (path.extname(originalName || '') || '.jpg').toLowerCase();
  const filename = `${Date.now()}_${crypto.randomBytes(4).toString('hex')}${ext}`;
  fs.writeFileSync(path.join(UPLOADS_DIR, filename), buffer);
  return { url: `/uploads/${filename}`, provider: 'local', key: filename };
}

module.exports = {
  uploadMedia,
  ensureBucket,
  BUCKET,
  ALLOWED_MIME,
};
