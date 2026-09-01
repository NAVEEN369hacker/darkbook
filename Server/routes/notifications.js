/**
 * Notifications routes — activity feed for each user.
 *
 * Storage: data/notifications.json
 * Row shape: { id, recipientUid, type, actorUid, actorName, actorColor, text, createdAt, readAt|null }
 *
 * Types: 'upvote' | 'comment' | 'dm' | 'system'
 *
 * Endpoints:
 *   GET  /api/notifications           — my notifications, newest first
 *   GET  /api/notifications/unread-count — just { count }
 *   POST /api/notifications/:id/read  — mark one as read
 *   POST /api/notifications/read-all  — mark all as read
 *
 * Notifications are inserted by routes/posts.js (votes, comments) and
 * routes/dms.js on send.
 */

const { filter, insert, update } = require('../lib/storage');
const { v7: uuidv7 } = require('uuid');
const tokens = require('./auth').tokens;

function generateNotifId() {
  return `notif_${uuidv7()}`;
}

function authedUid(req) {
  const auth = req.headers.authorization || '';
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (!m) return null;
  const session = tokens.get(m[1]);
  return session ? session.uid : null;
}

// ============================================================
// Public helper — called by posts.js / dms.js
// ============================================================
function createNotification({ recipientUid, type, actorUid, actorName, actorColor, text }) {
  if (!recipientUid || recipientUid === actorUid) return; // never notify yourself
  const notif = {
    id: generateNotifId(),
    recipientUid,
    type,
    actorUid: actorUid || null,
    actorName: actorName || null,
    actorColor: actorColor || null,
    text,
    createdAt: new Date().toISOString(),
    readAt: null,
  };
  insert('notifications', notif);
  return notif;
}

// ============================================================
// GET /api/notifications — my notifications, newest first
// ============================================================
function handleListNotifications(req, res) {
  const myUid = authedUid(req);
  if (!myUid) return res.status(401).json({ error: 'unauthenticated' });

  const rows = filter('notifications', (n) => n.recipientUid === myUid);
  rows.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  res.json({
    notifications: rows.map((n) => ({
      id: n.id,
      type: n.type,
      actorUid: n.actorUid,
      actorName: n.actorName,
      actorColor: n.actorColor,
      text: n.text,
      createdAt: n.createdAt,
      read: !!n.readAt,
    })),
  });
}

// ============================================================
// GET /api/notifications/unread-count
// ============================================================
function handleUnreadCount(req, res) {
  const myUid = authedUid(req);
  if (!myUid) return res.status(401).json({ error: 'unauthenticated' });

  const count = filter('notifications', (n) => n.recipientUid === myUid && !n.readAt).length;
  res.json({ count });
}

// ============================================================
// POST /api/notifications/:id/read
// ============================================================
function handleMarkOneRead(req, res) {
  const myUid = authedUid(req);
  if (!myUid) return res.status(401).json({ error: 'unauthenticated' });

  const id = req.params.id;
  const now = new Date().toISOString();
  const changed = update(
    'notifications',
    (n) => n.id === id && n.recipientUid === myUid,
    { readAt: now },
  );
  if (!changed) return res.status(404).json({ error: 'not_found' });
  res.json({ ok: true });
}

// ============================================================
// POST /api/notifications/read-all
// ============================================================
function handleMarkAllRead(req, res) {
  const myUid = authedUid(req);
  if (!myUid) return res.status(401).json({ error: 'unauthenticated' });

  const now = new Date().toISOString();
  update(
    'notifications',
    (n) => n.recipientUid === myUid && !n.readAt,
    { readAt: now },
  );
  res.json({ ok: true });
}

module.exports = {
  createNotification,
  handleListNotifications,
  handleUnreadCount,
  handleMarkOneRead,
  handleMarkAllRead,
};
