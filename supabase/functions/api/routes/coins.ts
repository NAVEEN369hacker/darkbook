// routes/coins.ts — balance, spend, ad reward.

import type { RequestCtx } from '../_shared/types.ts';
import { json, badRequest, paymentRequired, unauthorized } from '../_shared/response.ts';
import { readJson } from '../_shared/parse.ts';
import { requireAuth } from '../lib/auth.ts';
import { getBalance, spendCoins, addCoins } from '../lib/coins.ts';
import { generateId } from '../lib/identity.ts';

const COIN_COSTS: Record<string, number> = {
  open_feed: 1,
  open_dms: 0,
  open_arena: 0,
  post_feed: 10,
  post_arena: 10,
};
const OPEN_REASONS = new Set(['open_feed', 'open_dms', 'open_arena']);

export async function balance(ctx: RequestCtx): Promise<Response> {
  const auth = await requireAuth(ctx);
  const row = await getBalance(ctx.supabase, auth.did);
  return json({
    balance: row.balance,
    adsWatchedToday: row.ads_watched_today,
    spentToday: row.spent_today,
    history: row.history,
  });
}

export async function spend(ctx: RequestCtx): Promise<Response> {
  const auth = await requireAuth(ctx);
  const body = await readJson(ctx.req);
  const reason = body.reason as string | undefined;
  if (!reason || !(reason in COIN_COSTS)) {
    return badRequest(`reason must be one of: ${Object.keys(COIN_COSTS).join(', ')}`);
  }
  const result = await spendCoins(ctx.supabase, auth.did, reason);
  if (!result.ok) {
    if (result.reason === 'insufficient') {
      return paymentRequired(
        `You need ${result.needed} coins to do that, but you have ${result.have}.`,
        { needed: result.needed, have: result.have, reason },
      );
    }
    return badRequest(result.reason);
  }
  return json({
    ok: true,
    charged: result.charged,
    idempotent: OPEN_REASONS.has(reason) && !result.charged,
    balance: result.row.balance,
  });
}

export async function watchAd(ctx: RequestCtx): Promise<Response> {
  const auth = await requireAuth(ctx);
  // Simulated 80% fill rate — mirrors the Node server.
  if (Math.random() >= 0.8) {
    return json({
      ok: false,
      reason: 'ad_unavailable',
      message: 'Sorry for some reasons the Ad is not available',
    });
  }
  const row = await addCoins(ctx.supabase, auth.did, 10, 'ad_reward');
  return json({
    ok: true,
    rewardId: generateId('reward'),
    coins: 10,
    balance: row.balance,
    adsWatchedToday: row.ads_watched_today,
  });
}
