/**
 * Admin routes — all guarded by isAdmin flag on the device row.
 *
 * Endpoints:
 *   POST   /api/admin/users           create a brand-new device+identity (admin
 *                                      receives the password to share OOB)
 *   GET    /api/admin/devices         list all devices
 *   POST   /api/admin/posts           admin-authored post (text + optional photo
 *                                      + optional poll + optional pin)
 *   POST   /api/admin/posts/:id/pin   set pinnedAt = now on an existing post
 *   DELETE /api/admin/posts/:id       remove a post + cascade
 *   POST   /api/admin/arena/topics    (re-exported here from routes/arena.js
 *                                      for routing surface — see server.js)
 */

const fs = require('fs');
const path = require('path');
const { v7: uuidv7 } = require('uuid');
const { find, filter, readAll, insert } = require('../lib/storage');
const { uploadMedia } = require('../lib/upload');
const {
  generateDid,
  generateUid,
  generatePassword,
  generateToken,
  pickDisplayName,
  pickColor,
  computeExpiresAt,
  hashPassword,
  generateHandle,
  ensureUniqueHandle,
} = require('../lib/identity');
const { spendCoins } = require('../lib/coins');
const tokens = require('./auth').tokens;
const arenaRoutes = require('./arena');

function authedDid(req) {
  const auth = req.headers.authorization || '';
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (!m) return null;
  const session = tokens.get(m[1]);
  return session ? session.did : null;
}

function isAdmin(req) {
  const did = authedDid(req);
  if (!did) return false;
  const device = find('devices', (d) => d.did === did);
  return !!(device && device.isAdmin);
}

function requireAdmin(req, res) {
  if (!authedDid(req)) {
    res.status(401).json({ error: 'unauthenticated' });
    return false;
  }
  if (!isAdmin(req)) {
    res.status(403).json({ error: 'admin_only' });
    return false;
  }
  return true;
}

// =============================================================
// POST /api/admin/users
// body: { displayName?, colorHex? }  — both optional. If omitted the server
// picks an animal-adjective pair and a color using the same logic as a
// normal user registration.
// Returns the brand-new device's identity + token. The admin must share
// the password to the new user out-of-band.
// =============================================================
async function handleCreateUser(req, res) {
  if (!requireAdmin(req, res)) return;
  try {
    const { displayName: customName, colorHex: customColor } = req.body || {};

    const did = generateDid();
    const password = generatePassword();
    const passwordHash = await hashPassword(password);

    const now = new Date().toISOString();
    const device = {
      did,
      passwordHash,
      ip: 'admin-created',
      userAgent: 'admin',
      fingerprint: 'admin',
      platform: 'admin',
      screen: 'admin',
      isAdmin: false,
      createdAt: now,
      lastActiveAt: now,
      createdByAdminDid: authedDid(req),
    };
    insert('devices', device);

    const uid = generateUid();
    const displayName = customName && customName.trim()
      ? customName.trim().slice(0, 40)
      : pickDisplayName(uid);
    const colorHex = customColor && /^#[0-9a-fA-F]{6}$/.test(customColor)
      ? customColor
      : pickColor(uid);

    // Mint a unique handle against existing active handles.
    const base = generateHandle(uid);
    const taken = new Set(
      filter('daily_identities', (r) => r.status === 'active' && r.handle).map((r) => r.handle),
    );
    const handle = ensureUniqueHandle(base, taken);

    const expiresAt = computeExpiresAt();
    insert('daily_identities', {
      uid,
      did,
      handle,
      displayName,
      colorHex,
      status: 'active',
      issuedAt: now,
      expiresAt,
    });

    // Mint an opaque token for the new session.
    const token = generateToken();
    tokens.set(token, { did, uid, issuedAt: now });

    // Persist token map (same shape auth.js uses).
    const tokenRows = Array.from(tokens.entries()).map(([t, s]) => ({
      token: t, did: s.did, uid: s.uid, issuedAt: s.issuedAt,
    }));
    const tokenFile = path.join(__dirname, '..', 'data', 'tokens.json');
    fs.writeFileSync(tokenFile, JSON.stringify(tokenRows, null, 2), 'utf8');

    res.status(201).json({
      did,
      uid,
      handle,
      displayName,
      colorHex,
      password,         // admin shares this to the new user
      accessToken: token,
      expiresAt,
    });
  } catch (err) {
    console.error('[admin create user]', err);
    res.status(500).json({ error: 'create_user_failed', message: err.message });
  }
}

// =============================================================
// GET /api/admin/devices
// =============================================================
function handleListDevices(req, res) {
  if (!requireAdmin(req, res)) return;
  const devices = readAll('devices');
  const identities = readAll('daily_identities');
  const todayActive = identities.filter((i) => i.status === 'active');

  const enriched = devices.map((d) => {
    const active = todayActive.find((i) => i.did === d.did);
    return {
      did: d.did,
      isAdmin: !!d.isAdmin,
      createdAt: d.createdAt,
      lastActiveAt: d.lastActiveAt,
      handle: active ? active.handle : null,
      displayName: active ? active.displayName : null,
      colorHex: active ? active.colorHex : null,
      createdByAdminDid: d.createdByAdminDid || null,
    };
  });
  res.json({ devices: enriched });
}

// =============================================================
// POST /api/admin/posts
// body: { text, photoUrl?, pinned?, poll?: { question, options: [{label}] } }
//
// Admin posts are FREE (no coin spend). The admin role is the point.
// =============================================================
function handleAdminCreatePost(req, res) {
  if (!requireAdmin(req, res)) return;
  const did = authedDid(req);
  const uid = (() => {
    const auth = req.headers.authorization || '';
    const m = auth.match(/^Bearer\s+(.+)$/i);
    if (!m) return null;
    const session = tokens.get(m[1]);
    return session ? session.uid : null;
  })();

  const { text, photoUrl, pinned, poll } = req.body || {};
  if (typeof text !== 'string' || !text.trim()) {
    return res.status(422).json({ error: 'validation_failed', message: 'text required' });
  }
  if (text.length > 500) {
    return res.status(422).json({ error: 'validation_failed', message: 'text must be ≤ 500 chars' });
  }

  const postId = `post_${uuidv7()}`;
  const nowIso = new Date().toISOString();

  // Optional poll
  let pollId = null;
  if (poll && typeof poll === 'object' && Array.isArray(poll.options) && poll.options.length >= 2) {
    pollId = `poll_${uuidv7()}`;
    const options = poll.options.slice(0, 6).map((o, i) => ({
      id: `o${i + 1}`,
      label: (typeof o.label === 'string' ? o.label : `Option ${i + 1}`).slice(0, 60),
      voteCount: 0,
    }));
    insert('polls', {
      id: pollId,
      postId,
      question: typeof poll.question === 'string' ? poll.question.trim().slice(0, 200) : 'Vote',
      options,
      voters: {},
      createdByDid: did,
      createdAt: nowIso,
    });
  }

  const post = {
    id: postId,
    roomId: 'random',
    uid,
    did,
    text: text.trim(),
    createdAt: nowIso,
    isAdminPost: true,
    pinnedAt: pinned ? nowIso : null,
    photoUrl: typeof photoUrl === 'string' ? photoUrl : null,
    pollId,
  };

  // Async wrapper so we can await the Supabase Storage upload.
  return (async () => {
    try {
      // Admin posts can also come with a multipart photo. Pull from req.files (multer.any()).
      if (Array.isArray(req.files) && req.files.length > 0) {
        const photo = req.files.find((f) => f.fieldname === 'photo') || req.files[0];
        if (photo && photo.buffer) {
          const result = await uploadMedia(photo.buffer, photo.originalname, photo.mimetype);
          post.photoUrl = result.url;
        }
      }
    } catch (err) {
      if (err && err.code === 'UNSUPPORTED_TYPE') {
        return res.status(422).json({ error: 'validation_failed', message: 'photo must be JPEG/PNG/WebP/GIF' });
      }
      if (err && err.code === 'LIMIT_FILE_SIZE') {
        return res.status(422).json({ error: 'validation_failed', message: 'photo must be ≤ 5 MB' });
      }
      console.error('[admin] photo upload failed:', err && err.message);
      return res.status(500).json({ error: 'upload_failed', message: 'photo upload failed' });
    }

    insert('posts', post);
    return res.status(201).json({ post });
  })();
}

// =============================================================
// POST /api/admin/posts/:id/pin
// =============================================================
function handleAdminPinPost(req, res) {
  if (!requireAdmin(req, res)) return;
  const rows = readAll('posts');
  const idx = rows.findIndex((p) => p.id === req.params.id);
  if (idx < 0) return res.status(404).json({ error: 'not_found' });
  rows[idx].pinnedAt = new Date().toISOString();
  rows[idx].isAdminPost = true;
  const file = path.join(__dirname, '..', 'data', 'posts.json');
  fs.writeFileSync(file, JSON.stringify(rows, null, 2), 'utf8');
  res.json({ ok: true, post: rows[idx] });
}

// =============================================================
// DELETE /api/admin/posts/:id
// =============================================================
function handleAdminDeletePost(req, res) {
  if (!requireAdmin(req, res)) return;
  const rows = readAll('posts');
  const idx = rows.findIndex((p) => p.id === req.params.id);
  if (idx < 0) return res.status(404).json({ error: 'not_found' });
  const removed = rows.splice(idx, 1)[0];
  const file = path.join(__dirname, '..', 'data', 'posts.json');
  fs.writeFileSync(file, JSON.stringify(rows, null, 2), 'utf8');

  // Cascade: reactions on this post, comments on this post, the poll.
  const reactions = readAll('reactions').filter((r) => !(r.targetType === 'post' && r.targetId === removed.id));
  fs.writeFileSync(path.join(__dirname, '..', 'data', 'reactions.json'), JSON.stringify(reactions, null, 2), 'utf8');
  const comments = readAll('comments').filter((c) => c.postId !== removed.id);
  fs.writeFileSync(path.join(__dirname, '..', 'data', 'comments.json'), JSON.stringify(comments, null, 2), 'utf8');
  if (removed.pollId) {
    const polls = readAll('polls').filter((p) => p.id !== removed.pollId);
    fs.writeFileSync(path.join(__dirname, '..', 'data', 'polls.json'), JSON.stringify(polls, null, 2), 'utf8');
  }

  res.json({ ok: true, removedId: removed.id });
}

// =============================================================
// GET /api/admin/accounts — list all active managed daily identities
// =============================================================
function handleListAccounts(req, res) {
  if (!requireAdmin(req, res)) return;
  const now = Date.now();
  const dailyIdentities = readAll('daily_identities');
  const active = dailyIdentities.filter(
    (i) => i.status === 'active' && i.expiresAt && new Date(i.expiresAt).getTime() > now,
  );

  const accounts = active.map((i) => ({
    uid: i.uid,
    did: i.did,
    handle: i.handle || null,
    displayName: i.displayName,
    colorHex: i.colorHex,
    expiresAt: i.expiresAt,
  }));

  res.json({ accounts });
}

// =============================================================
// POST /api/admin/switch-account — body: { uid }
// Switches the admin's active session handle to targetUid while keeping
// admin privileges (adminDid).
// =============================================================
function handleSwitchAccount(req, res) {
  if (!requireAdmin(req, res)) return;
  const adminDid = authedDid(req);
  const { uid: targetUid } = req.body || {};
  if (!targetUid) {
    return res.status(422).json({ error: 'validation_failed', message: 'uid is required' });
  }

  const targetIdentity = find('daily_identities', (i) => i.uid === targetUid);
  if (!targetIdentity) {
    return res.status(404).json({ error: 'not_found', message: 'target user identity not found' });
  }

  const now = new Date().toISOString();
  const token = generateToken();
  tokens.set(token, { did: adminDid, uid: targetIdentity.uid, issuedAt: now });

  const tokenRows = Array.from(tokens.entries()).map(([t, s]) => ({
    token: t,
    did: s.did,
    uid: s.uid,
    issuedAt: s.issuedAt,
  }));
  const tokenFile = path.join(__dirname, '..', 'data', 'tokens.json');
  fs.writeFileSync(tokenFile, JSON.stringify(tokenRows, null, 2), 'utf8');

  res.json({
    did: adminDid,
    uid: targetIdentity.uid,
    handle: targetIdentity.handle || null,
    displayName: targetIdentity.displayName,
    colorHex: targetIdentity.colorHex,
    password: '',
    accessToken: token,
    expiresAt: targetIdentity.expiresAt,
    isAdmin: true,
  });
}

// Re-export arena admin route so server.js can wire them together.
const handleAdminCreateTopic = arenaRoutes.handleAdminCreateTopic;

module.exports = {
  isAdmin,
  requireAdmin,
  handleCreateUser,
  handleListDevices,
  handleAdminCreatePost,
  handleAdminPinPost,
  handleAdminDeletePost,
  handleAdminCreateTopic,
  handleListAccounts,
  handleSwitchAccount,
};