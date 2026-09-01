/**
 * Posts, feed, reactions (like + shake), and comments — the social layer.
 *
 * Storage: JSON files under Server/data/ (posts.json, reactions.json,
 * comments.json, polls.json). The feed is a 25h-bounded, room-filtered
 * list. Reactions are per-(did, postId) and per-(did, commentId).
 *
 * Auth: writes (POST) require Authorization: Bearer <token>. Reads (GET feed,
 * GET comments) are public — same as a real anonymous social app.
 *
 * Coin costs: posting to the Feed costs 10 coins (post_feed). The "open" cost
 * for the Feed (open_feed) is charged client-side on entering /, and is
 * idempotent per UTC day.
 *
 * Photo uploads: posts can carry an optional `photo` file via multipart
 * (multer), or `photoUrl` via JSON. Admin posts can also carry `isAdminPost`,
 * `pinnedAt`, and `pollId`.
 */

const path = require('path');
const { readAll, filter, find, insert, update, writeAll } = require('../lib/storage');
const {
  generatePostId,
  generateCommentId,
  generateReactionId,
} = require('../lib/identity');
const { createNotification } = require('./notifications');
const { spendCoins } = require('../lib/coins');
const { enrichPoll } = require('./polls');
const { uploadMedia } = require('../lib/upload');

// Look up the authed did/uid from the bearer token. Mirrors the pattern in
// routes/auth.js — we re-implement the small lookup here to avoid a circular
// require.
const tokens = require('./auth').tokens;

function authedDid(req) {
  const auth = req.headers.authorization || '';
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (!m) return null;
  const session = tokens.get(m[1]);
  return session ? session.did : null;
}

function authedUid(req) {
  const auth = req.headers.authorization || '';
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (!m) return null;
  const session = tokens.get(m[1]);
  return session ? session.uid : null;
}

function findUidRow(uid) {
  return find('daily_identities', (r) => r.uid === uid);
}

function postReactionCounts(postId, viewerDid) {
  const rows = filter('reactions', (r) => r.targetType === 'post' && r.targetId === postId);
  let likeCount = 0;
  let shakeCount = 0;
  let myReaction = null;
  for (const r of rows) {
    if (r.type === 'like') likeCount++;
    else if (r.type === 'shake') shakeCount++;
    if (viewerDid && r.did === viewerDid) myReaction = r.type;
  }
  return { likeCount, shakeCount, myReaction };
}

function commentReactionCounts(commentId, viewerDid) {
  const rows = filter('reactions', (r) => r.targetType === 'comment' && r.targetId === commentId);
  let likeCount = 0;
  let shakeCount = 0;
  let myReaction = null;
  for (const r of rows) {
    if (r.type === 'like') likeCount++;
    else if (r.type === 'shake') shakeCount++;
    if (viewerDid && r.did === viewerDid) myReaction = r.type;
  }
  return { likeCount, shakeCount, myReaction };
}

function enrichPost(post, viewerDid) {
  const writer = findUidRow(post.uid);
  const { likeCount, shakeCount, myReaction } = postReactionCounts(post.id, viewerDid);
  const commentCount = filter('comments', (c) => c.postId === post.id).length;
  const poll = find('polls', (p) => p.postId === post.id);
  return {
    id: post.id,
    roomId: post.roomId,
    text: post.text,
    createdAt: post.createdAt,
    likeCount,
    shakeCount,
    commentCount,
    myReaction,
    author: {
      uid: post.uid,
      handle: writer ? writer.handle : null,
      displayName: writer ? writer.displayName : 'Unknown',
      colorHex: writer ? writer.colorHex : '#888',
    },
    photoUrl: post.photoUrl || null,
    isAdminPost: !!post.isAdminPost,
    pinnedAt: post.pinnedAt || null,
    poll: poll ? enrichPoll(poll, viewerDid) : null,
  };
}

// =============================================================
// POST /api/posts  — create a post in a room
// Accepts either JSON { roomId, text, photoUrl? } or
// multipart/form-data with a 'photo' file field.
// Costs 10 coins (post_feed).
// =============================================================
const MAX_TEXT = 500;

function handleCreatePost(req, res) {
  const did = authedDid(req);
  const uid = authedUid(req);
  if (!did || !uid) {
    return res.status(401).json({ error: 'unauthenticated', message: 'missing or invalid token' });
  }

  // Multer puts text fields on req.body when content-type is multipart.
  // When JSON, req.body is the parsed object.
  const body = req.body || {};
  const roomId = body.roomId;
  const text = body.text;
  const providedPhotoUrl = body.photoUrl;

  if (roomId !== 'random') {
    return res.status(422).json({ error: 'validation_failed', message: 'unknown roomId' });
  }
  if (typeof text !== 'string' || !text.trim()) {
    return res.status(422).json({ error: 'validation_failed', message: 'text is required' });
  }
  if (text.length > MAX_TEXT) {
    return res.status(422).json({ error: 'validation_failed', message: `text must be ≤ ${MAX_TEXT} chars` });
  }

  // Coin-gate the post.
  const spend = spendCoins(did, 'post_feed');
  if (!spend.ok) {
    if (spend.reason === 'insufficient') {
      return res.status(402).json({
        error: 'insufficient_coins',
        message: `You need ${spend.needed} coins to post, but you have ${spend.have}. Visit your Vault to earn more.`,
        needed: spend.needed,
        have: spend.have,
      });
    }
    return res.status(422).json({ error: spend.reason });
  }

  // Run the route as async so we can await Supabase Storage upload.
  return (async () => {
    let photoUrl = null;
    try {
      // multer.any() populates req.files[] (array). We accept a file with
      // fieldname 'photo' if present. memoryStorage gives us photo.buffer.
      if (Array.isArray(req.files) && req.files.length > 0) {
        const photo = req.files.find((f) => f.fieldname === 'photo') || req.files[0];
        if (photo && photo.buffer) {
          const result = await uploadMedia(photo.buffer, photo.originalname, photo.mimetype);
          photoUrl = result.url;
        }
      } else if (typeof providedPhotoUrl === 'string' && providedPhotoUrl.startsWith('/uploads/')) {
        // Backwards-compat: caller-supplied legacy local URL.
        photoUrl = providedPhotoUrl;
      }
    } catch (err) {
      if (err && err.code === 'UNSUPPORTED_TYPE') {
        return res.status(422).json({ error: 'validation_failed', message: 'photo must be JPEG/PNG/WebP/GIF' });
      }
      if (err && err.code === 'LIMIT_FILE_SIZE') {
        return res.status(422).json({ error: 'validation_failed', message: 'photo must be ≤ 5 MB' });
      }
      console.error('[posts] photo upload failed:', err && err.message);
      return res.status(500).json({ error: 'upload_failed', message: 'photo upload failed' });
    }

    const post = {
      id: generatePostId(),
      roomId,
      uid,
      did,
      text: text.trim(),
      photoUrl,
      createdAt: new Date().toISOString(),
      isAdminPost: false,
      pinnedAt: null,
      pollId: null,
    };
    insert('posts', post);
    return res.status(201).json({
      post: enrichPost(post, did),
      balance: spend.row.balance,
    });
  })();
}

// =============================================================
// GET /api/feed?roomId=random&limit=50
// Public read. 25h-bounded. Pinned-first, then newest-first.
// =============================================================
const FEED_WINDOW_MS = 25 * 60 * 60 * 1000;
const FEED_DEFAULT_LIMIT = 50;
const FEED_MAX_LIMIT = 100;

function handleFeed(req, res) {
  const roomId = req.query.roomId || 'random';
  if (roomId !== 'random') {
    return res.status(422).json({ error: 'validation_failed', message: 'unknown roomId' });
  }
  const limit = Math.min(
    FEED_MAX_LIMIT,
    Math.max(1, parseInt(req.query.limit, 10) || FEED_DEFAULT_LIMIT),
  );

  const viewerDid = authedDid(req);
  const cutoff = Date.now() - FEED_WINDOW_MS;
  const rows = filter('posts', (p) =>
    p.roomId === roomId && new Date(p.createdAt).getTime() >= cutoff,
  );
  // pinned first (most-recent pin wins), then newest-first by createdAt.
  rows.sort((a, b) => {
    const ap = a.pinnedAt ? new Date(a.pinnedAt).getTime() : 0;
    const bp = b.pinnedAt ? new Date(b.pinnedAt).getTime() : 0;
    if (ap !== bp) return bp - ap;
    return new Date(b.createdAt) - new Date(a.createdAt);
  });
  const sliced = rows.slice(0, limit);
  res.json({ posts: sliced.map((p) => enrichPost(p, viewerDid)) });
}

// =============================================================
// POST /api/posts/:id/react  body: { type: 'like' | 'shake' | null }
// =============================================================
function handlePostReact(req, res) {
  const did = authedDid(req);
  const uid = authedUid(req);
  if (!did || !uid) {
    return res.status(401).json({ error: 'unauthenticated', message: 'missing or invalid token' });
  }
  const postId = req.params.id;
  const type = (req.body || {}).type;
  if (type !== null && type !== 'like' && type !== 'shake') {
    return res.status(422).json({ error: 'validation_failed', message: 'type must be like, shake, or null' });
  }
  const post = find('posts', (p) => p.id === postId);
  if (!post) {
    return res.status(404).json({ error: 'not_found', message: 'post not found' });
  }

  const existing = find('reactions', (r) =>
    r.targetType === 'post' && r.targetId === postId && r.did === did,
  );

  if (type === null) {
    if (existing) {
      const remaining = readAll('reactions').filter((r) =>
        !(r.targetType === 'post' && r.targetId === postId && r.did === did),
      );
      writeAll('reactions', remaining);
    }
  } else {
    if (existing) {
      if (existing.type !== type) {
        update(
          'reactions',
          (r) => r.id === existing.id,
          { type, updatedAt: new Date().toISOString() },
        );
      }
    } else {
      insert('reactions', {
        id: generateReactionId(),
        targetType: 'post',
        targetId: postId,
        uid,
        did,
        type,
        createdAt: new Date().toISOString(),
      });
    }
  }

  const wasNew = !existing && type !== null;
  if (wasNew) {
    const voterRow = find('daily_identities', (r) => r.uid === uid);
    if (post.uid && post.uid !== uid) {
      createNotification({
        recipientUid: post.uid,
        type: type === 'shake' ? 'shake' : 'like',
        actorUid: uid,
        actorName: voterRow ? voterRow.displayName : 'Someone',
        actorColor: voterRow ? voterRow.colorHex : '#888',
        text: type === 'shake' ? 'shook your post.' : 'liked your post.',
      });
    }
  }

  const counts = postReactionCounts(postId, did);
  res.json({
    postId,
    likeCount: counts.likeCount,
    shakeCount: counts.shakeCount,
    myReaction: counts.myReaction,
  });
}

// =============================================================
// POST /api/comments/:id/react
// =============================================================
function handleCommentReact(req, res) {
  const did = authedDid(req);
  const uid = authedUid(req);
  if (!did || !uid) {
    return res.status(401).json({ error: 'unauthenticated', message: 'missing or invalid token' });
  }
  const commentId = req.params.id;
  const type = (req.body || {}).type;
  if (type !== null && type !== 'like' && type !== 'shake') {
    return res.status(422).json({ error: 'validation_failed', message: 'type must be like, shake, or null' });
  }
  const comment = find('comments', (c) => c.id === commentId);
  if (!comment) {
    return res.status(404).json({ error: 'not_found', message: 'comment not found' });
  }

  const existing = find('reactions', (r) =>
    r.targetType === 'comment' && r.targetId === commentId && r.did === did,
  );

  if (type === null) {
    if (existing) {
      const remaining = readAll('reactions').filter((r) =>
        !(r.targetType === 'comment' && r.targetId === commentId && r.did === did),
      );
      writeAll('reactions', remaining);
    }
  } else {
    if (existing) {
      if (existing.type !== type) {
        update(
          'reactions',
          (r) => r.id === existing.id,
          { type, updatedAt: new Date().toISOString() },
        );
      }
    } else {
      insert('reactions', {
        id: generateReactionId(),
        targetType: 'comment',
        targetId: commentId,
        uid,
        did,
        type,
        createdAt: new Date().toISOString(),
      });
    }
  }

  const wasNew = !existing && type !== null;
  if (wasNew) {
    const voterRow = find('daily_identities', (r) => r.uid === uid);
    if (comment.uid && comment.uid !== uid) {
      createNotification({
        recipientUid: comment.uid,
        type: type === 'shake' ? 'shake' : 'like',
        actorUid: uid,
        actorName: voterRow ? voterRow.displayName : 'Someone',
        actorColor: voterRow ? voterRow.colorHex : '#888',
        text: type === 'shake' ? 'shook your comment.' : 'liked your comment.',
      });
    }
  }

  const counts = commentReactionCounts(commentId, did);
  res.json({
    commentId,
    likeCount: counts.likeCount,
    shakeCount: counts.shakeCount,
    myReaction: counts.myReaction,
  });
}

// =============================================================
// GET /api/posts/:id/comments  (oldest first)
// =============================================================
function handleListComments(req, res) {
  const postId = req.params.id;
  const post = find('posts', (p) => p.id === postId);
  if (!post) {
    return res.status(404).json({ error: 'not_found', message: 'post not found' });
  }
  const viewerDid = authedDid(req);
  const rows = filter('comments', (c) => c.postId === postId);
  rows.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  res.json({
    comments: rows.map((c) => {
      const writer = findUidRow(c.uid);
      const counts = commentReactionCounts(c.id, viewerDid);
      return {
        id: c.id,
        text: c.text,
        createdAt: c.createdAt,
        likeCount: counts.likeCount,
        shakeCount: counts.shakeCount,
        myReaction: counts.myReaction,
        author: {
          uid: c.uid,
          handle: writer ? writer.handle : null,
          displayName: writer ? writer.displayName : 'Unknown',
          colorHex: writer ? writer.colorHex : '#888',
        },
      };
    }),
    viewerDid,
  });
}

// =============================================================
// POST /api/posts/:id/comments  body: { text }
// =============================================================
function handleCreateComment(req, res) {
  const did = authedDid(req);
  const uid = authedUid(req);
  if (!did || !uid) {
    return res.status(401).json({ error: 'unauthenticated', message: 'missing or invalid token' });
  }
  const postId = req.params.id;
  const post = find('posts', (p) => p.id === postId);
  if (!post) {
    return res.status(404).json({ error: 'not_found', message: 'post not found' });
  }
  const { text } = req.body || {};
  if (typeof text !== 'string' || !text.trim()) {
    return res.status(422).json({ error: 'validation_failed', message: 'text is required' });
  }
  if (text.length > MAX_TEXT) {
    return res.status(422).json({ error: 'validation_failed', message: `text must be ≤ ${MAX_TEXT} chars` });
  }
  const comment = {
    id: generateCommentId(),
    postId,
    uid,
    did,
    text: text.trim(),
    createdAt: new Date().toISOString(),
    parentId: null,
  };
  insert('comments', comment);

  const commenterRow = findUidRow(uid);

  if (post.uid && post.uid !== uid) {
    createNotification({
      recipientUid: post.uid,
      type: 'comment',
      actorUid: uid,
      actorName: commenterRow ? commenterRow.displayName : 'Someone',
      actorColor: commenterRow ? commenterRow.colorHex : '#888',
      text: `commented: "${text.trim().slice(0, 60)}${text.trim().length > 60 ? '…' : ''}"`,
    });
  }

  res.status(201).json({
    comment: {
      id: comment.id,
      text: comment.text,
      createdAt: comment.createdAt,
      likeCount: 0,
      shakeCount: 0,
      myReaction: null,
      author: {
        uid: comment.uid,
        handle: commenterRow ? commenterRow.handle : null,
        displayName: commenterRow ? commenterRow.displayName : 'Unknown',
        colorHex: commenterRow ? commenterRow.colorHex : '#888',
      },
    },
  });
}

module.exports = {
  handleCreatePost,
  handleFeed,
  handlePostReact,
  handleCommentReact,
  handleListComments,
  handleCreateComment,
  enrichPost,            // exported for admin.js / other route modules
};