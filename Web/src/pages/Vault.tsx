/**
 * Vault — Real coin economy page.
 *
 * - Loads live balance from /api/coins/balance
 * - "Watch ad for 10 coins" button calls /api/ads/reward
 *   - On {ok:true} → balance animates up, history updates
 *   - On {ok:false, reason:'ad_unavailable'} → inline "sorry" card, no credit
 * - History tab reads from the real balance.history
 *
 * Vault is reached via Account Center, not the bottom nav.
 */

import { useEffect, useState, useCallback } from 'react';
import type { Session } from '../storage';
import { getCoinBalance, watchAd } from '../api';
import type { CoinBalance } from '../types';

type Props = {
  session: Session;
  onBalanceChange?: (balance: CoinBalance) => void;
};

export default function Vault({ session, onBalanceChange }: Props) {
  const [balance, setBalance] = useState<CoinBalance | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'earn' | 'history'>('earn');
  const [adBusy, setAdBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [justEarned, setJustEarned] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    try {
      const b = await getCoinBalance(session);
      setBalance(b);
      onBalanceChange?.(b);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to load balance');
    } finally {
      setLoading(false);
    }
  }, [session, onBalanceChange]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handleWatchAd = async () => {
    if (adBusy) return;
    setAdBusy(true);
    setError(null);
    try {
      const res = await watchAd(session);
      if (res.ok) {
        setJustEarned(res.coins);
        setTimeout(() => setJustEarned(null), 1800);
      } else {
        setError(res.message || 'Sorry, the ad is not available right now.');
      }
      // Always refresh after a try — either credits came in or they didn't.
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'ad request failed');
    } finally {
      // small backoff so users don't spam the button
      setTimeout(() => setAdBusy(false), 1500);
    }
  };

  if (loading) {
    return (
      <div className="page page-vault">
        <p className="muted">Loading vault…</p>
      </div>
    );
  }

  if (!balance) {
    return (
      <div className="page page-vault">
        <div className="card">
          <p style={{ color: 'var(--danger)' }}>{error || 'Vault unavailable.'}</p>
        </div>
      </div>
    );
  }

  const coins = balance.balance;

  return (
    <div className="page page-vault">
      {/* Balance hero */}
      <div className="vault-hero">
        <div className="vault-coin-icon">🪙</div>
        <div className="vault-balance">
          {coins.toLocaleString()}
          {justEarned !== null && (
            <span className="vault-earned-pop">+{justEarned}</span>
          )}
        </div>
        <div className="vault-balance-label">Ghost Coins</div>
        <div className="vault-streak">
          <span>📺 {balance.adsWatchedToday} ad{balance.adsWatchedToday === 1 ? '' : 's'} watched today</span>
          <span className="muted" style={{ fontSize: 12, fontWeight: 400 }}>
            Coins reset at UTC midnight
          </span>
        </div>
      </div>

      {/* Tabs */}
      <div className="notif-tabs">
        <button
          className={`notif-tab ${activeTab === 'earn' ? 'active' : ''}`}
          onClick={() => setActiveTab('earn')}
          id="vault-tab-earn"
        >
          Earn Coins
        </button>
        <button
          className={`notif-tab ${activeTab === 'history' ? 'active' : ''}`}
          onClick={() => setActiveTab('history')}
          id="vault-tab-history"
        >
          History
        </button>
      </div>

      {activeTab === 'earn' && (
        <div className="vault-grid" style={{ gridTemplateColumns: '1fr' }}>
          <div className="vault-card">
            <div className="vault-card-icon">📺</div>
            <div className="vault-card-label">Watch a short ad</div>
            <div className="vault-card-desc">
              Earn <strong style={{ color: 'var(--gold)' }}>10 coins</strong> for each ad you watch.
              If no ad is available right now, you'll see a message — no coins are credited.
            </div>
            <div className="vault-card-footer">
              <span className="vault-cost">🪙 +10</span>
              <button
                className={`button vault-buy-btn ${justEarned !== null ? 'success' : ''}`}
                onClick={handleWatchAd}
                disabled={adBusy}
                id="vault-watch-ad"
              >
                {adBusy ? 'Loading…' : justEarned !== null ? `+${justEarned} ✓` : 'Watch ad'}
              </button>
            </div>
          </div>

          {/* Failure card — only shows when the most recent ad attempt failed */}
          {error && (
            <div className="vault-card vault-card-error" id="vault-ad-error">
              <div className="vault-card-icon">⚠️</div>
              <div className="vault-card-label">Ad not available</div>
              <div className="vault-card-desc">
                Sorry for some reasons the Ad is not available. No coins were credited.
                Try again in a moment.
              </div>
            </div>
          )}
        </div>
      )}

      {activeTab === 'history' && (
        <div className="vault-history">
          {balance.history.length === 0 && (
            <p className="muted" style={{ padding: '24px 0', textAlign: 'center' }}>
              No coin activity yet today.
            </p>
          )}
          {balance.history.map((tx, i) => {
            const icon =
              tx.reason === 'ad_reward' ? '📺'
              : tx.reason === 'open_feed' ? '🏠'
              : tx.reason === 'open_dms' ? '💬'
              : tx.reason === 'open_arena' ? '⚔️'
              : tx.reason === 'post_feed' ? '✍️'
              : tx.reason === 'post_arena' ? '🗣️'
              : '•';
            const label =
              tx.reason === 'ad_reward' ? 'Watched an ad'
              : tx.reason === 'open_feed' ? 'Opened Feed'
              : tx.reason === 'open_dms' ? 'Opened DMs'
              : tx.reason === 'open_arena' ? 'Opened Arena'
              : tx.reason === 'post_feed' ? 'Posted in Feed'
              : tx.reason === 'post_arena' ? 'Posted in Arena'
              : tx.reason;
            const time = relTime(tx.at);
            return (
              <div key={`${tx.at}-${i}`} className="vault-tx">
                <div className="vault-tx-icon">{icon}</div>
                <div className="vault-tx-info">
                  <span className="vault-tx-label">{label}</span>
                  <span className="vault-tx-time">{time}</span>
                </div>
                <span className={`vault-tx-amount ${tx.delta > 0 ? 'positive' : 'negative'}`}>
                  {tx.delta > 0 ? '+' : ''}{tx.delta} 🪙
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function relTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return new Date(iso).toLocaleString();
}