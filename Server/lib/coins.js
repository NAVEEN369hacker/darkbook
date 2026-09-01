/**
 * Coin helpers — daily coin balance per device.
 *
 * Storage: data/coins.json
 * Row shape:
 *   {
 *     did: string,
 *     balance: number,
 *     adsWatchedToday: number,
 *     lastResetAt: ISO,
 *     spentToday: { [reason: string]: number },   // counts of spends keyed by reason
 *     history: [{ at: ISO, delta: number, reason: string }, ...]   // last 50
 *   }
 *
 * Reset policy: at the daily rotation tick, every row whose lastResetAt is
 * before today UTC midnight gets balance=0, adsWatchedToday=0, spentToday={}.
 * History is NOT cleared (so users can see what they did yesterday).
 */

const { readAll, writeAll, insert, update } = require('./storage');

const HISTORY_LIMIT = 50;

// Coin costs (single source of truth — 60 coins overall: 20 per daily feature unlock).
const COIN_COSTS = {
  open_feed: 20,
  open_dms: 20,
  open_arena: 20,
  post_feed: 0,
  post_arena: 0,
  ad_reward: 10,
};

// "Open" actions are per-day-idempotent: opening the same page twice in one
// day does not charge again. "Post" actions cost 0 once feature is opened.
const OPEN_REASONS = new Set(['open_feed', 'open_dms', 'open_arena']);

function getRow(did) {
  const rows = readAll('coins');
  let row = rows.find((r) => r.did === did);
  if (!row) {
    row = {
      did,
      balance: 0,
      adsWatchedToday: 0,
      lastResetAt: new Date().toISOString(),
      spentToday: {},
      history: [],
    };
    insert('coins', row);
  }
  return row;
}

function updateRow(did, mutator) {
  const row = getRow(did);
  mutator(row);
  update('coins', (r) => r.did === did, row);
  return row;
}

function publicView(row) {
  return {
    balance: row.balance,
    adsWatchedToday: row.adsWatchedToday,
    lastResetAt: row.lastResetAt,
    spentToday: row.spentToday,
    history: row.history.slice().reverse(), // newest first
    costs: COIN_COSTS,
  };
}

function appendHistory(row, delta, reason) {
  row.history.push({ at: new Date().toISOString(), delta, reason });
  if (row.history.length > HISTORY_LIMIT) {
    row.history.splice(0, row.history.length - HISTORY_LIMIT);
  }
}

/**
 * Add coins (called only from /api/ads/reward on success).
 */
function addCoins(did, amount, reason) {
  if (typeof amount !== 'number' || amount <= 0) {
    throw new Error('amount must be positive');
  }
  return updateRow(did, (row) => {
    row.balance += amount;
    row.adsWatchedToday += 1;
    appendHistory(row, +amount, reason);
  });
}

/**
 * Spend coins. Returns either { ok: true, row } or { ok: false, reason }.
 *
 *   - For "open_*" reasons: idempotent per day. If spentToday[reason] > 0
 *     already, this is a no-op success (no charge).
 *   - For other reasons (post_*): every call charges.
 *
 * The caller is expected to handle the response. On { ok: false, reason: 'insufficient' }
 * the HTTP layer returns 402.
 */
function spendCoins(did, reason) {
  const cost = COIN_COSTS[reason];
  if (typeof cost !== 'number') {
    return { ok: false, reason: 'unknown_reason' };
  }

  let result;
  updateRow(did, (row) => {
    if (OPEN_REASONS.has(reason)) {
      const already = (row.spentToday[reason] || 0) > 0;
      if (already) {
        result = { ok: true, row, charged: false };
        return;
      }
    }
    if (row.balance < cost) {
      result = { ok: false, reason: 'insufficient', needed: cost, have: row.balance };
      return;
    }
    row.balance -= cost;
    row.spentToday[reason] = (row.spentToday[reason] || 0) + 1;
    appendHistory(row, -cost, reason);
    result = { ok: true, row, charged: true };
  });

  return result;
}

/**
 * Reset every coin row whose lastResetAt is before today UTC midnight.
 * Called from the rotation tick.
 */
function resetAllIfNewDay(now = new Date()) {
  const todayMidnightUtc = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
    0, 0, 0, 0,
  ));
  const cutoffMs = todayMidnightUtc.getTime();
  const rows = readAll('coins');
  let reset = 0;
  for (const row of rows) {
    if (new Date(row.lastResetAt).getTime() < cutoffMs) {
      row.balance = 0;
      row.adsWatchedToday = 0;
      row.spentToday = {};
      row.lastResetAt = now.toISOString();
      reset++;
    }
  }
  if (reset > 0) writeAll('coins', rows);
  return { reset };
}

module.exports = {
  COIN_COSTS,
  OPEN_REASONS,
  getRow,
  publicView,
  addCoins,
  spendCoins,
  resetAllIfNewDay,
};