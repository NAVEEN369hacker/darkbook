/**
 * Arena — daily-administered debate topics with multiple "parties" (sides).
 *
 * Storage:
 *   data/arena_topics.json  — { id, title, description, parties[], createdByDid,
 *                                createdAt, expiresAt, postsByParty }
 *   data/arena_posts.json   — { id, topicId, partyId, uid, did, text, createdAt }
 *
 * Endpoints (all auth-required):
 *   GET  /api/arena/topics                   -> active topics only (today's rotation window)
 *   GET  /api/arena/topics/:id               -> topic + posts grouped by party
 *   POST /api/arena/topics/:id/posts         body: { partyId, text }
 *                                            costs 10 coins (post_arena)
 *
 * Admin-only:
 *   POST /api/admin/arena/topics             body: { title, description, parties }
 *
 * Topics auto-expire at the next UTC midnight (same sweep that rotates UIDs).
 */

const { v7: uuidv7 } = require('uuid');
const { readAll, filter, find, insert } = require('../lib/storage');
const { spendCoins } = require('../lib/coins');
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

function nextMidnightUtcIso() {
  const now = new Date();
  const tomorrow = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 1,
    0, 0, 0, 0,
  ));
  return tomorrow.toISOString();
}

function isAdmin(req) {
  const did = authedDid(req);
  if (!did) return false;
  const device = find('devices', (d) => d.did === did);
  return !!(device && device.isAdmin);
}

function enrichArenaPost(row) {
  const author = findUidRow(row.uid);
  return {
    id: row.id,
    topicId: row.topicId,
    partyId: row.partyId,
    parentId: row.parentId || null,
    text: row.text,
    createdAt: row.createdAt,
    author: {
      uid: row.uid,
      handle: author ? author.handle : null,
      displayName: author ? author.displayName : 'Unknown',
      colorHex: author ? author.colorHex : '#888',
    },
  };
}

// =============================================================
// GET /api/arena/topics
// =============================================================
function handleListTopics(_req, res) {
  const now = Date.now();
  const topics = filter('arena_topics', (t) =>
    new Date(t.expiresAt).getTime() > now,
  );
  // newest first
  topics.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json({ topics });
}

// =============================================================
// GET /api/arena/topics/:id
// =============================================================
function handleGetTopic(req, res) {
  const topic = find('arena_topics', (t) => t.id === req.params.id);
  if (!topic) return res.status(404).json({ error: 'not_found' });

  const posts = filter('arena_posts', (p) => p.topicId === topic.id);
  posts.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  res.json({
    topic,
    posts: posts.map(enrichArenaPost),
  });
}

// =============================================================
// POST /api/arena/topics/:id/posts
// body: { partyId, text, parentId? }
// Costs 10 coins (post_arena). Author must be authed.
// =============================================================
const MAX_TEXT = 1000;

function handleCreateArgument(req, res) {
  const did = authedDid(req);
  const uid = authedUid(req);
  if (!did || !uid) return res.status(401).json({ error: 'unauthenticated' });

  const topic = find('arena_topics', (t) => t.id === req.params.id);
  if (!topic) return res.status(404).json({ error: 'not_found', message: 'topic not found' });
  if (new Date(topic.expiresAt).getTime() <= Date.now()) {
    return res.status(410).json({ error: 'topic_expired' });
  }

  const { partyId, text, parentId } = req.body || {};
  if (!partyId || typeof partyId !== 'string') {
    return res.status(422).json({ error: 'validation_failed', message: 'partyId required' });
  }
  if (!topic.parties.find((p) => p.id === partyId)) {
    return res.status(422).json({ error: 'validation_failed', message: 'unknown partyId' });
  }
  if (typeof text !== 'string' || !text.trim()) {
    return res.status(422).json({ error: 'validation_failed', message: 'text is required' });
  }
  if (text.length > MAX_TEXT) {
    return res.status(422).json({ error: 'validation_failed', message: `text must be ≤ ${MAX_TEXT} chars` });
  }

  // Coin-gate the post. Idempotent "open" charge is handled at /api/arena/topics
  // entry (App.tsx Gate); this charges the "post" cost on every submit.
  const spend = spendCoins(did, 'post_arena');
  if (!spend.ok) {
    if (spend.reason === 'insufficient') {
      return res.status(402).json({
        error: 'insufficient_coins',
        message: `You need ${spend.needed} coins to post, but you have ${spend.have}.`,
        needed: spend.needed,
        have: spend.have,
      });
    }
    return res.status(422).json({ error: spend.reason });
  }

  const post = {
    id: `arena_post_${uuidv7()}`,
    topicId: topic.id,
    partyId,
    parentId: typeof parentId === 'string' && parentId.trim() ? parentId.trim() : null,
    uid,
    did,
    text: text.trim(),
    createdAt: new Date().toISOString(),
  };
  insert('arena_posts', post);

  // bump postsByParty on the topic (in place via update-style rewrite)
  const topics = readAll('arena_topics');
  const idx = topics.findIndex((t) => t.id === topic.id);
  if (idx >= 0) {
    topics[idx].postsByParty = topics[idx].postsByParty || {};
    topics[idx].postsByParty[partyId] = (topics[idx].postsByParty[partyId] || 0) + 1;
    const fs = require('fs');
    const path = require('path');
    const file = path.join(__dirname, '..', 'data', 'arena_topics.json');
    fs.writeFileSync(file, JSON.stringify(topics, null, 2), 'utf8');
  }

  res.status(201).json({
    post: enrichArenaPost(post),
    balance: spend.row.balance,
  });
}

// =============================================================
// ADMIN: POST /api/admin/arena/topics
// body: { title, description?, parties: [{ label, emoji? }] }
// Party ids are auto-minted. Topic expires at next UTC midnight.
// =============================================================
function handleAdminCreateTopic(req, res) {
  if (!isAdmin(req)) return res.status(403).json({ error: 'admin_only' });

  const { title, description, parties } = req.body || {};
  if (typeof title !== 'string' || !title.trim()) {
    return res.status(422).json({ error: 'validation_failed', message: 'title required' });
  }
  if (!Array.isArray(parties) || parties.length < 2 || parties.length > 6) {
    return res.status(422).json({
      error: 'validation_failed',
      message: 'parties must be an array of 2-6 entries',
    });
  }

  const DEFAULT_PARTY_COLORS = ['#FFD60A', '#FF7B72', '#3FB950', '#A371F7', '#D29922', '#FB7185'];

  const builtParties = parties.map((p, i) => ({
    id: `p${i + 1}`,
    label: typeof p.label === 'string' ? p.label.trim().slice(0, 80) : '',
    emoji: typeof p.emoji === 'string' && p.emoji.trim() ? p.emoji.trim().slice(0, 4) : '⚖️',
    colorHex: typeof p.colorHex === 'string' && p.colorHex.trim() ? p.colorHex.trim() : DEFAULT_PARTY_COLORS[i % DEFAULT_PARTY_COLORS.length],
  })).filter((p) => p.label);
  if (builtParties.length < 2) {
    return res.status(422).json({ error: 'validation_failed', message: 'at least 2 parties with non-empty labels' });
  }

  const topic = {
    id: `topic_${uuidv7()}`,
    title: title.trim().slice(0, 200),
    description: typeof description === 'string' ? description.trim().slice(0, 1000) : '',
    parties: builtParties,
    postsByParty: builtParties.reduce((acc, p) => { acc[p.id] = 0; return acc; }, {}),
    createdByDid: authedDid(req),
    createdAt: new Date().toISOString(),
    expiresAt: nextMidnightUtcIso(),
  };
  insert('arena_topics', topic);
  res.status(201).json({ topic });
}

module.exports = {
  handleListTopics,
  handleGetTopic,
  handleCreateArgument,
  handleAdminCreateTopic,
  isAdmin,                  // exported for use by routes/admin.js
  authedDid,                // ditto
  authedUid,                // ditto
};