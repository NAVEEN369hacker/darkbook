/**
 * Coins + rewarded ads.
 *
 * Storage: data/coins.json (per-device daily balance + history)
 *
 * Endpoints:
 *   GET  /api/coins/balance          -> public view of the authed device's coin row
 *   POST /api/coins/spend            body: { reason } -> idempotent for open_* reasons
 *   POST /api/ads/reward             -> simulated GAM rewarded ad result.
 *                                        80% ok:true (+10 coins),
 *                                        20% ok:false reason:'ad_unavailable'.
 *                                        The "real" GAM SDK can replace this
 *                                        function body later without changing
 *                                        the contract.
 *
 * Auth: all routes require a valid bearer token.
 */

const { v7: uuidv7 } = require('uuid');
const { getRow, publicView, addCoins, spendCoins, COIN_COSTS, OPEN_REASONS } = require('../lib/coins');
const tokens = require('./auth').tokens;

function authedDid(req) {
  const auth = req.headers.authorization || '';
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (!m) return null;
  const session = tokens.get(m[1]);
  return session ? session.did : null;
}

// =============================================================
// GET /api/coins/balance
// =============================================================
function handleGetBalance(req, res) {
  const did = authedDid(req);
  if (!did) return res.status(401).json({ error: 'unauthenticated' });
  const row = getRow(did);
  res.json(publicView(row));
}

// =============================================================
// POST /api/coins/spend
// body: { reason: 'open_feed' | 'open_dms' | 'open_arena' | 'post_feed' | 'post_arena' }
// =============================================================
function handleSpend(req, res) {
  const did = authedDid(req);
  if (!did) return res.status(401).json({ error: 'unauthenticated' });

  const { reason } = req.body || {};
  if (!reason || !(reason in COIN_COSTS)) {
    return res.status(422).json({
      error: 'validation_failed',
      message: `reason must be one of: ${Object.keys(COIN_COSTS).join(', ')}`,
    });
  }
  const result = spendCoins(did, reason);
  if (!result.ok) {
    if (result.reason === 'insufficient') {
      return res.status(402).json({
        error: 'insufficient_coins',
        message: `You need ${result.needed} coins to do that, but you have ${result.have}.`,
        needed: result.needed,
        have: result.have,
        reason,
      });
    }
    return res.status(422).json({ error: result.reason });
  }
  res.json({
    ok: true,
    charged: result.charged,
    idempotent: OPEN_REASONS.has(reason) && !result.charged,
    balance: result.row.balance,
  });
}

// =============================================================
// POST /api/ads/reward — simulated Google Ad Manager rewarded ad
//
// In production this would call GAM's RewardEvent verification, but for the
// prototype we model the contract: the caller reports "the user finished
// watching a rewarded ad" and we either credit 10 coins or report that
// no ad was available. The client UI must handle both branches.
// =============================================================
function handleWatchAd(req, res) {
  const did = authedDid(req);
  if (!did) return res.status(401).json({ error: 'unauthenticated' });

  // Simulated fill rate. With ~20% the ad slot has no fill — that's the
  // realistic AdManager behavior. The client surfaces the failure UX.
  const available = Math.random() < 0.8;
  if (!available) {
    return res.json({
      ok: false,
      reason: 'ad_unavailable',
      message: 'Sorry for some reasons the Ad is not available',
    });
  }

  const rewardId = `reward_${uuidv7()}`;
  const row = addCoins(did, 10, 'ad_reward');
  res.json({
    ok: true,
    rewardId,
    coins: 10,
    balance: row.balance,
    adsWatchedToday: row.adsWatchedToday,
  });
}

module.exports = {
  handleGetBalance,
  handleSpend,
  handleWatchAd,
};