// lib/coins.ts — coin balance, spend, and ad-reward helpers.
//
// The Node version of spendCoins() was synchronous + racy (it read/wrote
// data/coins.json without a lock). Here we delegate the spend to a Postgres
// RPC (`public.spend_coins_atomic`) defined in the migration, which uses
// SELECT ... FOR UPDATE in a transaction. Same return contract:
//   success -> { ok: true, row, charged }
//   failure -> { ok: false, reason, needed?, have? }

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import type { CoinRow } from '../_shared/types.ts';

export interface CoinSpendOk { ok: true; row: CoinRow; charged: boolean }
export interface CoinSpendFail { ok: false; reason: string; needed?: number; have?: number }
export type CoinResult = CoinSpendOk | CoinSpendFail;

export async function getBalance(
  supabase: SupabaseClient,
  did: string,
): Promise<CoinRow> {
  // Ensure row exists.
  await supabase.from('coins').upsert({ did }, { onConflict: 'did', ignoreDuplicates: true });
  const { data, error } = await supabase
    .from('coins')
    .select('*')
    .eq('did', did)
    .maybeSingle();
  if (error) throw new Error(`getBalance failed: ${error.message}`);
  return (data ?? {
    did,
    balance: 0,
    ads_watched_today: 0,
    last_reset_at: new Date().toISOString(),
    spent_today: {},
    history: [],
  }) as CoinRow;
}

export async function spendCoins(
  supabase: SupabaseClient,
  did: string,
  reason: string,
): Promise<CoinResult> {
  const { data, error } = await supabase.rpc('spend_coins_atomic', {
    p_did: did,
    p_reason: reason,
  });
  if (error) throw new Error(`spendCoins failed: ${error.message}`);
  const r = data as Record<string, unknown>;
  if (!r || r.ok !== true) {
    return {
      ok: false,
      reason: String(r?.reason ?? 'unknown'),
      needed: typeof r?.needed === 'number' ? r.needed : undefined,
      have: typeof r?.have === 'number' ? r.have : undefined,
    };
  }
  return { ok: true, row: r.row as CoinRow, charged: !!r.charged };
}

export async function addCoins(
  supabase: SupabaseClient,
  did: string,
  amount: number,
  reason: string,
): Promise<CoinRow> {
  // Ensure row exists first.
  await supabase.from('coins').upsert({ did }, { onConflict: 'did', ignoreDuplicates: true });
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from('coins')
    .select('*')
    .eq('did', did)
    .maybeSingle();
  if (error) throw new Error(`addCoins read failed: ${error.message}`);
  const prev = (data ?? { balance: 0, ads_watched_today: 0, spent_today: {}, history: [] }) as CoinRow;
  const history = Array.isArray(prev.history) ? prev.history : [];
  const newHistory = [
    ...history,
    { at: now, amount, reason },
  ].slice(-50);
  const { data: updated, error: uerr } = await supabase
    .from('coins')
    .update({
      balance: (prev.balance ?? 0) + amount,
      ads_watched_today: reason === 'ad_reward' ? (prev.ads_watched_today ?? 0) + 1 : (prev.ads_watched_today ?? 0),
      history: newHistory,
    })
    .eq('did', did)
    .select('*')
    .single();
  if (uerr) throw new Error(`addCoins write failed: ${uerr.message}`);
  return updated as CoinRow;
}
