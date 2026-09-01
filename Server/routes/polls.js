/**
 * Polls — read + vote. Creation is in routes/admin.js (admin-only).
 *
 * Storage: data/polls.json
 * Row: { id, postId, question, options: [{id,label,voteCount}], voters: { did -> optionId }, createdByDid, createdAt }
 *
 * Endpoints (auth required for vote):
 *   GET  /api/polls/:id            -> { poll, myVote? }
 *   POST /api/polls/:id/vote       body: { optionId }  -> { poll, myVote }
 *
 * One vote per device (did). Re-voting replaces the prior optionId and the
 * voteCount shifts correctly.
 */

const fs = require('fs');
const path = require('path');
const { readAll, find } = require('../lib/storage');
const tokens = require('./auth').tokens;

function authedDid(req) {
  const auth = req.headers.authorization || '';
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (!m) return null;
  const session = tokens.get(m[1]);
  return session ? session.did : null;
}

const POLLS_FILE = path.join(__dirname, '..', 'data', 'polls.json');

function writePolls(rows) {
  fs.writeFileSync(POLLS_FILE, JSON.stringify(rows, null, 2), 'utf8');
}

function enrichPoll(poll, viewerDid) {
  return {
    id: poll.id,
    postId: poll.postId,
    question: poll.question,
    options: poll.options.map((o) => ({
      id: o.id,
      label: o.label,
      voteCount: o.voteCount,
    })),
    createdAt: poll.createdAt,
    myVote: viewerDid && poll.voters ? poll.voters[viewerDid] || null : null,
    totalVotes: poll.options.reduce((s, o) => s + (o.voteCount || 0), 0),
  };
}

// =============================================================
// GET /api/polls/:id
// =============================================================
function handleGetPoll(req, res) {
  const poll = find('polls', (p) => p.id === req.params.id);
  if (!poll) return res.status(404).json({ error: 'not_found' });
  res.json({ poll: enrichPoll(poll, authedDid(req)) });
}

// =============================================================
// POST /api/polls/:id/vote
// body: { optionId }
// =============================================================
function handleVote(req, res) {
  const did = authedDid(req);
  if (!did) return res.status(401).json({ error: 'unauthenticated' });

  const rows = readAll('polls');
  const idx = rows.findIndex((p) => p.id === req.params.id);
  if (idx < 0) return res.status(404).json({ error: 'not_found' });

  const poll = rows[idx];
  const { optionId } = req.body || {};
  if (!optionId || !poll.options.find((o) => o.id === optionId)) {
    return res.status(422).json({ error: 'validation_failed', message: 'unknown optionId' });
  }

  const prior = poll.voters && poll.voters[did];
  if (prior === optionId) {
    // already voted for that option — no-op
    return res.json({ poll: enrichPoll(poll, did), changed: false });
  }

  if (prior) {
    const prevOpt = poll.options.find((o) => o.id === prior);
    if (prevOpt && prevOpt.voteCount > 0) prevOpt.voteCount -= 1;
  }
  const newOpt = poll.options.find((o) => o.id === optionId);
  newOpt.voteCount = (newOpt.voteCount || 0) + 1;

  poll.voters = poll.voters || {};
  poll.voters[did] = optionId;
  writePolls(rows);
  res.json({ poll: enrichPoll(poll, did), changed: true });
}

module.exports = {
  handleGetPoll,
  handleVote,
  enrichPoll,           // exported so posts.js feed can inline the poll
};