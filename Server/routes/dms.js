/**
 * DM routes — real direct messages between users.
 *
 * Storage: data/dms.json  — rows: { id, fromUid, toUid, text, createdAt, readAt|null }
 *
 * URLs take the recipient's public HANDLE (e.g. "blue_panda_42"), not the
 * opaque uid. The handle is the user-facing identifier — the uid is an
 * internal token that rotates daily with the handle. Internally we still
 * key rows by uid because uid is stable per-day for a given did, but the
 * URL surface is handle-based to match what users see in the app.
 *
 * Endpoints:
 *   GET  /api/dms                       — list my conversations (latest msg per partner)
 *   GET  /api/dms/by-handle/:handle     — full thread with one partner
 *   POST /api/dms/by-handle/:handle     — send a message
 *   POST /api/dms/by-handle/:handle/read — mark all messages from partner as read
 */

const { readAll, filter, find, insert, update } = require('../lib/storage');
const { v7: uuidv7 } = require('uuid');
const tokens = require('./auth').tokens;
const { createNotification } = require('./notifications');

function generateDmId() {
  return `dm_${uuidv7()}`;
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

// Look up an ACTIVE daily-identity row by its public handle. The handle
// matches whatever the recipient sees in the app right now — i.e. an
// `active` row whose handle field equals `handle`. Returns the row or null.
function findByHandle(handle) {
  const cleanHandle = (handle || '').replace(/^@/, '').trim().toLowerCase();
  if (!cleanHandle) return null;
  return find('daily_identities', (r) =>
    r.status === 'active' &&
    typeof r.handle === 'string' &&
    r.handle.toLowerCase() === cleanHandle,
  );
}

// ============================================================
// GET /api/dms  — list conversations for the current user
// ============================================================
function handleListConversations(req, res) {
  const myUid = authedUid(req);
  if (!myUid) return res.status(401).json({ error: 'unauthenticated' });

  const all = readAll('dms');

  // All messages where I am sender or receiver
  const mine = all.filter((m) => m.fromUid === myUid || m.toUid === myUid);

  // Group by the "other" uid
  const byPartner = new Map();
  for (const msg of mine) {
    const partner = msg.fromUid === myUid ? msg.toUid : msg.fromUid;
    if (!byPartner.has(partner)) byPartner.set(partner, []);
    byPartner.get(partner).push(msg);
  }

  const conversations = [];
  for (const [partnerUid, msgs] of byPartner) {
    // Sort descending to find the latest
    msgs.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    const latest = msgs[0];
    const unread = msgs.filter((m) => m.toUid === myUid && !m.readAt).length;
    const partnerRow = findUidRow(partnerUid);
    conversations.push({
      partnerUid,
      partnerName: partnerRow ? partnerRow.displayName : 'Unknown',
      partnerHandle: partnerRow ? (partnerRow.handle || null) : null,
      partnerColor: partnerRow ? partnerRow.colorHex : '#888',
      lastMessage: latest.text,
      lastMessageAt: latest.createdAt,
      unread,
    });
  }

  // Sort by most-recent message
  conversations.sort((a, b) => new Date(b.lastMessageAt) - new Date(a.lastMessageAt));
  res.json({ conversations });
}

// ============================================================
// GET /api/dms/by-handle/:handle  — get thread with one partner (by handle)
// Returns `readAt` per message so the client can render seen ticks on the
// sender's outgoing bubbles.
// ============================================================
function handleGetThread(req, res) {
  const myUid = authedUid(req);
  if (!myUid) return res.status(401).json({ error: 'unauthenticated' });

  const partnerRow = findByHandle(req.params.handle);
  if (!partnerRow) {
    return res.status(404).json({ error: 'not_found', message: 'no active user with that handle' });
  }
  const partnerUid = partnerRow.uid;

  const all = readAll('dms');
  const thread = all
    .filter(
      (m) =>
        (m.fromUid === myUid && m.toUid === partnerUid) ||
        (m.fromUid === partnerUid && m.toUid === myUid),
    )
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

  res.json({
    partnerUid,
    partnerName: partnerRow.displayName,
    partnerHandle: partnerRow.handle,
    partnerColor: partnerRow.colorHex,
    messages: thread.map((m) => ({
      id: m.id,
      fromUid: m.fromUid,
      text: m.text,
      createdAt: m.createdAt,
      read: !!m.readAt,
      readAt: m.readAt || null,
    })),
  });
}

// ============================================================
// POST /api/dms/by-handle/:handle  — send a message
// ============================================================
const MAX_DM = 1000;
function handleSendMessage(req, res) {
  const myUid = authedUid(req);
  if (!myUid) return res.status(401).json({ error: 'unauthenticated' });

  const partnerRow = findByHandle(req.params.handle);
  if (!partnerRow) {
    return res.status(404).json({ error: 'not_found', message: 'no active user with that handle' });
  }
  const toUid = partnerRow.uid;
  if (toUid === myUid) {
    return res.status(422).json({ error: 'validation_failed', message: 'cannot DM yourself' });
  }

  const { text } = req.body || {};
  if (typeof text !== 'string' || !text.trim()) {
    return res.status(422).json({ error: 'validation_failed', message: 'text is required' });
  }
  if (text.length > MAX_DM) {
    return res.status(422).json({ error: 'validation_failed', message: `text must be ≤ ${MAX_DM} chars` });
  }

  const msg = {
    id: generateDmId(),
    fromUid: myUid,
    toUid,
    text: text.trim(),
    createdAt: new Date().toISOString(),
    readAt: null,
  };
  insert('dms', msg);

  // Notify recipient in the notifications feed
  const senderRow = findUidRow(myUid);
  createNotification({
    recipientUid: toUid,
    type: 'dm',
    actorUid: myUid,
    actorName: senderRow ? senderRow.displayName : 'Someone',
    actorColor: senderRow ? senderRow.colorHex : '#888',
    text: `sent you a message: "${text.trim().slice(0, 50)}${text.trim().length > 50 ? '…' : ''}"`,
  });

  res.status(201).json({
    message: {
      id: msg.id,
      fromUid: msg.fromUid,
      text: msg.text,
      createdAt: msg.createdAt,
      read: false,
      readAt: null,
    },
    recipient: {
      uid: partnerRow.uid,
      handle: partnerRow.handle,
      displayName: partnerRow.displayName,
      colorHex: partnerRow.colorHex,
    },
  });
}

// ============================================================
// POST /api/dms/by-handle/:handle/read  — mark all from partner as read
// ============================================================
function handleMarkRead(req, res) {
  const myUid = authedUid(req);
  if (!myUid) return res.status(401).json({ error: 'unauthenticated' });

  const partnerRow = findByHandle(req.params.handle);
  if (!partnerRow) {
    return res.status(404).json({ error: 'not_found', message: 'no active user with that handle' });
  }
  const partnerUid = partnerRow.uid;
  const now = new Date().toISOString();
  // Mark every unread message TO me FROM the partner
  update(
    'dms',
    (m) => m.fromUid === partnerUid && m.toUid === myUid && !m.readAt,
    { readAt: now },
  );
  res.json({ ok: true });
}

module.exports = {
  handleListConversations,
  handleGetThread,
  handleSendMessage,
  handleMarkRead,
};
