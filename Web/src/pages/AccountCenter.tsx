/**
 * AccountCenter — user profile and settings hub.
 * Identity card, live stats (incl. coin balance), Vault link, security info,
 * preferences, and (for admin devices) an Admin Tools shortcut.
 */

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Session } from '../storage';
import { getCoinBalance, me } from '../api';
import type { CoinBalance } from '../types';
import AccountSwitcher from '../components/AccountSwitcher';
import type { Identity } from '../api';

type Props = {
  session: Session;
  onLogout: () => void;
  onIdentity?: (id: Identity) => void;
  // Optional: a banner shown when the user was redirected here for lack of coins.
  blockedFrom?: string | null;
};

type SettingToggle = {
  id: string;
  label: string;
  description: string;
  value: boolean;
};

export default function AccountCenter({ session, onLogout, onIdentity, blockedFrom }: Props) {
  const navigate = useNavigate();
  const [balance, setBalance] = useState<CoinBalance | null>(null);
  const [isAdmin, setIsAdmin] = useState<boolean>(false);
  const [showDid, setShowDid] = useState(false);
  const [showConfirmLogout, setShowConfirmLogout] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [b, m] = await Promise.all([
          getCoinBalance(session),
          me(session),
        ]);
        setBalance(b);
        setIsAdmin(!!m.isAdmin);
      } catch {
        /* silent — balance will show as unknown */
      }
    })();
  }, [session]);

  const [settings, setSettings] = useState<SettingToggle[]>([
    { id: 'notif_dm',     label: 'DM Notifications',         description: 'Get alerted when someone messages you.', value: true },
    { id: 'notif_votes',  label: 'Reaction Notifications',   description: 'Get alerted when your posts are liked.', value: true },
    { id: 'ghost_mode',   label: 'Ghost Mode',               description: 'Browse without leaving view traces.', value: false },
    { id: 'dm_requests',  label: 'Allow DM Requests',        description: 'Let strangers send you message requests.', value: true },
    { id: 'auto_rotate',  label: 'Auto-Rotate Identity',     description: 'Automatically rotate when timer expires.', value: true },
  ]);

  const toggle = (id: string) => {
    setSettings((prev) =>
      prev.map((s) => (s.id === id ? { ...s, value: !s.value } : s))
    );
  };

  const stats = [
    { label: 'Coins', value: balance ? `🪙 ${balance.balance}` : '🪙 —' },
    { label: 'Posts', value: '—' },
    { label: 'Reactions', value: '—' },
    { label: 'Ads', value: balance ? `${balance.adsWatchedToday}` : '—' },
  ];

  return (
    <div className="page page-account">
      {/* Coin-blocked banner */}
      {blockedFrom && (
        <div className="card" style={{ borderColor: 'var(--danger)', background: 'rgba(255, 77, 77, 0.08)' }} id="blocked-from-banner">
          <h2 style={{ marginTop: 0, color: 'var(--danger)' }}>No coins to open {blockedFrom}</h2>
          <p className="muted" style={{ margin: 0 }}>
            You don't have enough Ghost Coins to enter this section right now.
            Visit your <strong>Vault</strong> below to watch an ad and earn 10 coins.
          </p>
        </div>
      )}

      {/* Identity card */}
      <div className="account-hero card">
        <div className="account-avatar" style={{ background: session.colorHex }}>
          <span style={{ fontSize: 32 }}>👻</span>
        </div>
        <div className="account-identity">
          <h2 style={{ margin: 0 }}>{session.displayName}</h2>
          {session.handle && (
            <span className="monospace" style={{ fontSize: 16, color: 'var(--gold)', fontWeight: 800 }}>
              @{session.handle}
            </span>
          )}
          <span className="muted" style={{ fontSize: 12 }}>
            Anonymous Identity · your handle stays the same all day, even across logout &amp; login
          </span>
          {isAdmin && onIdentity && (
            <div style={{ marginTop: 8 }}>
              <AccountSwitcher
                session={session}
                onIdentity={onIdentity}
                onError={(msg) => setToast(msg)}
              />
            </div>
          )}
        </div>

        <div className="account-stats">
          {stats.map((stat) => (
            <div key={stat.label} className="account-stat">
              <span className="account-stat-value">{stat.value}</span>
              <span className="account-stat-label">{stat.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Wallet — moved here from the bottom nav */}
      <div className="account-section">
        <h2 className="account-section-title">Wallet</h2>
        <div
          className="account-setting-row"
          style={{ cursor: 'pointer' }}
          onClick={() => navigate('/vault')}
          id="account-open-vault"
        >
          <div className="account-avatar" style={{ background: 'var(--gold)', width: 40, height: 40, boxShadow: 'none' }}>
            <span style={{ fontSize: 18 }}>🪙</span>
          </div>
          <div className="account-setting-info">
            <span className="account-setting-label">Vault</span>
            <span className="account-setting-desc">
              {balance
                ? `Balance: 🪙 ${balance.balance}. Watch ads to earn more.`
                : 'Loading balance…'}
            </span>
          </div>
          <span className="muted" style={{ fontSize: 20 }}>›</span>
        </div>
      </div>

      {/* Admin Tools (only for admin devices) */}
      {isAdmin && (
        <div className="account-section">
          <h2 className="account-section-title">Admin Tools</h2>
          <div
            className="account-setting-row"
            style={{ cursor: 'pointer', borderColor: 'var(--gold)' }}
            onClick={() => navigate('/admin')}
            id="account-open-admin"
          >
            <div className="account-avatar" style={{ background: 'var(--gradient-gold)', width: 40, height: 40, boxShadow: 'none' }}>
              <span style={{ fontSize: 18 }}>⚙️</span>
            </div>
            <div className="account-setting-info">
              <span className="account-setting-label">Admin Console</span>
              <span className="account-setting-desc">
                Create users, manage arena topics, post pinned announcements.
              </span>
            </div>
            <span className="muted" style={{ fontSize: 20 }}>›</span>
          </div>
        </div>
      )}

      {/* Device / security info */}
      <div className="account-section">
        <h2 className="account-section-title">Security</h2>
        <div className="account-info-row">
          <span className="account-info-label">Daily Handle</span>
          <span className="account-info-value monospace" style={{ color: 'var(--gold)', fontWeight: 700 }}>
            {session.handle ? `@${session.handle}` : '—'}
          </span>
        </div>
        <div className="account-info-row">
          <span className="account-info-label">Internal UID</span>
          <span className="account-info-value monospace">{session.uid.slice(0, 16)}…</span>
        </div>
        <div className="account-info-row">
          <span className="account-info-label">Device ID</span>
          <span className="account-info-value monospace">
            {showDid ? session.did : session.did.slice(0, 16) + '…'}
            <button
              className="link"
              style={{ marginLeft: 8, fontSize: 12 }}
              onClick={() => setShowDid((v) => !v)}
              id="toggle-did-btn"
            >
              {showDid ? 'hide' : 'show'}
            </button>
          </span>
        </div>
        <div className="account-info-row">
          <span className="account-info-label">Identity expires</span>
          <span className="account-info-value">
            {new Date(session.expiresAt).toLocaleString()}
          </span>
        </div>
      </div>

      {/* Settings toggles */}
      <div className="account-section">
        <h2 className="account-section-title">Preferences</h2>
        {settings.map((s) => (
          <div key={s.id} className="account-setting-row">
            <div className="account-setting-info">
              <span className="account-setting-label">{s.label}</span>
              <span className="account-setting-desc">{s.description}</span>
            </div>
            <button
              className={`toggle-btn ${s.value ? 'on' : 'off'}`}
              onClick={() => toggle(s.id)}
              aria-label={`Toggle ${s.label}`}
              id={`setting-${s.id}`}
            >
              <span className="toggle-knob" />
            </button>
          </div>
        ))}
      </div>

      {/* About */}
      <div className="account-section">
        <h2 className="account-section-title">About</h2>
        <div className="account-info-row">
          <span className="account-info-label">App</span>
          <span className="account-info-value">Ghostline</span>
        </div>
        <div className="account-info-row">
          <span className="account-info-label">Version</span>
          <span className="account-info-value">0.2.0 (coins · arena · admin)</span>
        </div>
      </div>

      {/* Logout */}
      <div className="account-section" style={{ paddingBottom: 8 }}>
        {!showConfirmLogout ? (
          <button
            className="button danger"
            onClick={() => setShowConfirmLogout(true)}
            id="logout-btn"
          >
            Log out
          </button>
        ) : (
          <div className="card" style={{ textAlign: 'center', padding: 20, gap: 12, display: 'flex', flexDirection: 'column' }}>
            <p style={{ margin: 0, fontWeight: 600 }}>Log out of Ghostline?</p>
            <p className="muted" style={{ margin: 0, fontSize: 13 }}>
              Your session will be cleared from this device.
            </p>
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                className="button ghost"
                style={{ flex: 1 }}
                onClick={() => setShowConfirmLogout(false)}
                id="cancel-logout-btn"
              >
                Cancel
              </button>
              <button
                className="button danger"
                style={{ flex: 1 }}
                onClick={onLogout}
                id="confirm-logout-btn"
              >
                Log out
              </button>
            </div>
          </div>
        )}
      </div>

      <div style={{ height: 32 }} />

      {toast && (
        <div className="toast" onClick={() => setToast(null)} role="alert">
          {toast}
        </div>
      )}
    </div>
  );
}