/**
 * Ghostline — basic-level identity + feed server, with coins/arena/admin/polls.
 *
 * Endpoints:
 *   POST /api/auth/recognize
 *   POST /api/auth/register
 *   POST /api/auth/login
 *   POST /api/auth/rotate
 *   GET  /api/auth/me
 *
 *   GET  /api/health
 *   GET  /api/rooms
 *
 *   POST /api/posts                   (multipart with 'photo' OR JSON; costs 10 coins)
 *   GET  /api/feed?roomId=...
 *   POST /api/posts/:id/react
 *   POST /api/comments/:id/react
 *   GET  /api/posts/:id/comments
 *   POST /api/posts/:id/comments
 *
 *   GET  /api/dms                     (handle-based)
 *   GET  /api/dms/by-handle/:handle
 *   POST /api/dms/by-handle/:handle
 *   POST /api/dms/by-handle/:handle/read
 *
 *   GET  /api/users/:handle           (public profile)
 *
 *   GET  /api/notifications
 *   GET  /api/notifications/unread-count
 *   POST /api/notifications/read-all
 *   POST /api/notifications/:id/read
 *
 *   GET  /api/coins/balance
 *   POST /api/coins/spend
 *   POST /api/ads/reward              (Google Ad Manager rewarded ad — stubbed)
 *
 *   GET  /api/arena/topics
 *   GET  /api/arena/topics/:id
 *   POST /api/arena/topics/:id/posts  (costs 10 coins)
 *
 *   GET  /api/polls/:id
 *   POST /api/polls/:id/vote
 *
 *   POST /api/admin/arena/topics       (admin only)
 *   POST /api/admin/users              (admin only)
 *   GET  /api/admin/devices            (admin only)
 *   POST /api/admin/posts              (admin only; can carry photo+poll+pin)
 *   POST /api/admin/posts/:id/pin      (admin only)
 *   DELETE /api/admin/posts/:id        (admin only)
 *
 *   POST /api/_debug/force-rotate      (only when DEBUG=1)
 *
 * Storage: JSON files in ./data/ + uploaded photos in ./uploads/.
 *
 * Env:
 *   PORT=XXXX         listen port (default 3001)
 *   DEBUG=1           enable /api/_debug/force-rotate
 *   DEBUG_FAST=1      UIDs expire in 60s
 *   ADMIN_BOOTSTRAP_DID=did_dev_xxx  mark this device's row as isAdmin on boot
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const multer = require('multer');

const {
  handleRegister,
  handleLogin,
  handleRotate,
  handleMe,
  handleRecognize,
} = require('./routes/auth');
const { handleListRooms } = require('./routes/rooms');
const {
  handleCreatePost,
  handleFeed,
  handlePostReact,
  handleCommentReact,
  handleListComments,
  handleCreateComment,
} = require('./routes/posts');
const {
  handleListConversations,
  handleGetThread,
  handleSendMessage,
  handleMarkRead: handleMarkDMRead,
} = require('./routes/dms');
const {
  handleListNotifications,
  handleUnreadCount,
  handleMarkOneRead,
  handleMarkAllRead,
} = require('./routes/notifications');
const { handleGetProfile, handleFollowUser, handleUnfollowUser } = require('./routes/profile');
const {
  handleGetBalance,
  handleSpend,
  handleWatchAd,
} = require('./routes/coins');
const {
  handleListTopics,
  handleGetTopic,
  handleCreateArgument,
} = require('./routes/arena');
const {
  handleGetPoll,
  handleVote,
} = require('./routes/polls');
const {
  handleCreateUser,
  handleListDevices,
  handleAdminCreatePost,
  handleAdminPinPost,
  handleAdminDeletePost,
  handleAdminCreateTopic,
  handleListAccounts,
  handleSwitchAccount,
} = require('./routes/admin');
const { runRotationTick } = require('./lib/rotation');
const { find, update } = require('./lib/storage');

const app = express();
app.use(cors());

// --- multer for photo uploads (used by POST /api/posts and POST /api/admin/posts) ---
// We use memoryStorage so routes can hand the Buffer to lib/upload.js, which
// sends it to Supabase Storage. lib/upload.js falls back to local disk on
// any Supabase error so uploads never break.
const UPLOADS_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME.has(file.mimetype)) return cb(null, true);
    cb(new Error('unsupported_image_type'));
  },
});

// Body parsers. /api/posts and /api/admin/posts accept EITHER JSON (text+photoUrl)
// or multipart/form-data (text + 'photo' file). We branch on content-type.
//
// For multipart we use upload.any() rather than .single('photo') — .single()
// requires the file field to actually be present, which means a text-only
// multipart body (no photo) would 500 with "Unexpected end of form". .any()
// parses every part (text + files) without that requirement, and we pick
// out the first file under 'photo' manually in the handler.
app.use((req, res, next) => {
  if ((req.path === '/api/posts' || req.path === '/api/admin/posts') && req.method === 'POST') {
    const ct = req.headers['content-type'] || '';
    if (ct.startsWith('multipart/form-data')) {
      return upload.any()(req, res, next);
    }
    return express.json()(req, res, next);
  }
  return express.json()(req, res, next);
});

// --- request logger ---
app.use((req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

// --- Static uploads ---
app.use('/uploads', express.static(UPLOADS_DIR, { maxAge: '7d' }));

// --- Health ---
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, serverNow: new Date().toISOString() });
});

// --- Auth ---
app.post('/api/auth/recognize', handleRecognize);
app.post('/api/auth/register', handleRegister);
app.post('/api/auth/login', handleLogin);
app.post('/api/auth/rotate', handleRotate);
app.get('/api/auth/me', handleMe);

// --- Rooms ---
app.get('/api/rooms', handleListRooms);

// --- Posts / feed / reactions / comments ---
// multer runs in the body-parser middleware above (it parses both text fields
// and any uploaded files). Routes just receive req.body + req.files.
app.post('/api/posts', handleCreatePost);
app.get('/api/feed', handleFeed);
app.post('/api/posts/:id/react', handlePostReact);
app.post('/api/comments/:id/react', handleCommentReact);
app.get('/api/posts/:id/comments', handleListComments);
app.post('/api/posts/:id/comments', handleCreateComment);

// --- DMs ---
app.get('/api/dms', handleListConversations);
app.get('/api/dms/by-handle/:handle', handleGetThread);
app.post('/api/dms/by-handle/:handle', handleSendMessage);
app.post('/api/dms/by-handle/:handle/read', handleMarkDMRead);

// --- Profile & Follows ---
app.get('/api/users/:handle', handleGetProfile);
app.post('/api/users/:handle/follow', handleFollowUser);
app.post('/api/users/:handle/unfollow', handleUnfollowUser);
app.delete('/api/users/:handle/follow', handleUnfollowUser);

// --- Notifications ---
app.get('/api/notifications', handleListNotifications);
app.get('/api/notifications/unread-count', handleUnreadCount);
app.post('/api/notifications/read-all', handleMarkAllRead);
app.post('/api/notifications/:id/read', handleMarkOneRead);

// --- Coins + rewarded ads ---
app.get('/api/coins/balance', handleGetBalance);
app.post('/api/coins/spend', handleSpend);
app.post('/api/ads/reward', handleWatchAd);

// --- Arena ---
app.get('/api/arena/topics', handleListTopics);
app.get('/api/arena/topics/:id', handleGetTopic);
app.post('/api/arena/topics/:id/posts', handleCreateArgument);

// --- Polls ---
app.get('/api/polls/:id', handleGetPoll);
app.post('/api/polls/:id/vote', handleVote);

// --- Admin ---
app.get('/api/admin/accounts', handleListAccounts);
app.post('/api/admin/switch-account', handleSwitchAccount);
app.post('/api/admin/arena/topics', handleAdminCreateTopic);
app.post('/api/admin/users', handleCreateUser);
app.get('/api/admin/devices', handleListDevices);
app.post('/api/admin/posts', handleAdminCreatePost);
app.post('/api/admin/posts/:id/pin', handleAdminPinPost);
app.delete('/api/admin/posts/:id', handleAdminDeletePost);

// --- Debug force-rotate (only when DEBUG=1) ---
if (process.env.DEBUG === '1') {
  app.post('/api/_debug/force-rotate', (req, res) => {
    handleRotate({ headers: req.headers, body: {} }, res);
  });
  console.log('[ghostline] DEBUG mode ON — POST /api/_debug/force-rotate is enabled');
}

// --- Multer / generic error handler (so unsupported_image_type etc. → 4xx) ---
app.use((err, _req, res, _next) => {
  if (err) {
    if (err.message === 'unsupported_image_type') {
      return res.status(422).json({ error: 'validation_failed', message: 'photo must be JPEG/PNG/WebP/GIF' });
    }
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(422).json({ error: 'validation_failed', message: 'photo must be ≤ 5 MB' });
    }
    console.error('[server] unhandled error:', err);
    return res.status(500).json({ error: 'server_error', message: err.message });
  }
  res.status(404).json({ error: 'not_found' });
});

// --- Admin bootstrap: mark device as admin if ADMIN_BOOTSTRAP_DID is set ---
function bootstrapAdmin() {
  const target = process.env.ADMIN_BOOTSTRAP_DID;
  if (!target) return;
  const device = find('devices', (d) => d.did === target);
  if (!device) {
    console.warn(`[ghostline] ADMIN_BOOTSTRAP_DID=${target} does not match any device yet — register first, then restart.`);
    return;
  }
  if (device.isAdmin) {
    console.log(`[ghostline] admin bootstrap: ${target} already isAdmin`);
    return;
  }
  update('devices', (d) => d.did === target, { isAdmin: true });
  console.log(`[ghostline] admin bootstrap: ${target} marked isAdmin=true`);
}
bootstrapAdmin();

// --- Rotation scheduler: every 60s, sweep expired UIDs + coins reset + arena expiry ---
setInterval(() => {
  try {
    const { rotated, purged, events } = runRotationTick();
    if (rotated > 0) {
      console.log(`[ghostline] rotation tick: rotated ${rotated} UID(s)`);
    }
    const purgedTotal = (purged.posts || 0) + (purged.reactions || 0) + (purged.comments || 0);
    if (purgedTotal > 0) {
      console.log(
        `[ghostline] purge tick: removed ${purged.posts} post(s), ` +
        `${purged.reactions} reaction(s), ${purged.comments} comment(s)`,
      );
    }
    if (events.coinsReset > 0 || events.arenaTopicsDropped > 0) {
      console.log(
        `[ghostline] daily reset: coinsReset=${events.coinsReset}, ` +
        `arenaTopicsDropped=${events.arenaTopicsDropped}, ` +
        `arenaPostsDropped=${events.arenaPostsDropped}`,
      );
    }
  } catch (err) {
    console.error('[ghostline] rotation tick failed:', err);
  }
}, 60_000).unref();

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`[ghostline] identity server listening on http://localhost:${PORT}`);
  if (process.env.DEBUG_FAST === '1') {
    console.log('[ghostline] DEBUG_FAST=1 — UIDs expire in 60s (for testing rotation)');
  }
});