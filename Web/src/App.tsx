import { useEffect, useState } from 'react';
import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import Welcome from './pages/Welcome';
import Feed from './pages/Feed';
import Login from './pages/Login';
import DMs from './pages/DMs';
import Notifications from './pages/Notifications';
import Vault from './pages/Vault';
import AccountCenter from './pages/AccountCenter';
import Profile from './pages/Profile';
import Arena from './pages/Arena';
import Admin from './pages/Admin';
import BottomNav from './components/BottomNav';
import { loadSession, saveSession, clearSession, Session } from './storage';
import { Identity, recognizeDevice, getUnreadDMCount, getUnreadNotifCount, authEvents, spendCoins } from './api';
import { getDeviceInfo } from './device';

/** Routes where the bottom nav should be visible.
 *  Vault is no longer in the nav — it's accessed via Account. */
const NAV_ROUTES = ['/', '/dms', '/notifications', '/arena', '/account'];

/** Map of path → coin-cost reason (for "open" charges). Idempotent per day. */
const COIN_GATE: Record<string, 'open_feed' | 'open_dms' | 'open_arena' | null> = {
  '/': 'open_feed',
  '/dms': 'open_dms',
  '/arena': 'open_arena',
  '/account': null,
  '/notifications': null,
  '/admin': null,            // admin is gate-allowed; admin check itself happens inside Admin.tsx
  '/vault': null,            // Vault is the source of coins — never gate it
};

export default function App() {
  const [session, setSession] = useState<Session | null>(() => loadSession());
  const [toast, setToast] = useState<string | null>(null);
  const [unreadDMs, setUnreadDMs] = useState(0);
  const [unreadNotifs, setUnreadNotifs] = useState(0);
  const [blockedFrom, setBlockedFrom] = useState<string | null>(null);
  const navigate = useNavigate();
  const location = useLocation();

  // Report unique device identifier to the server on app launch.
  useEffect(() => {
    const deviceInfo = getDeviceInfo();
    recognizeDevice(deviceInfo)
      .then((res) => {
        console.log('[Ghostline] Device recognized by server:', res);
      })
      .catch((err) => {
        console.warn('[Ghostline] Device recognition failed:', err);
      });
  }, []);

  // Persist session whenever it changes.
  useEffect(() => {
    if (session) saveSession(session);
  }, [session]);

  // Poll real live unread counts for DMs & Notifications for the BottomNav badges
  useEffect(() => {
    if (!session) {
      setUnreadDMs(0);
      setUnreadNotifs(0);
      return;
    }

    const updateCounts = async () => {
      try {
        const [dmCount, notifRes] = await Promise.all([
          getUnreadDMCount(session),
          getUnreadNotifCount(session),
        ]);
        setUnreadDMs(dmCount);
        setUnreadNotifs(notifRes.count);
      } catch (err) {
        /* silent catch */
      }
    };

    updateCounts();
    const id = setInterval(updateCounts, 4000);
    return () => clearInterval(id);
  }, [session, location.pathname]);

  // Auto-dismiss toasts.
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(id);
  }, [toast]);

  // Listen for silent auto-relogin events.
  useEffect(() => {
    return authEvents.onIdentityReplaced((id) => {
      const next: Session = {
        did: id.did,
        uid: id.uid,
        handle: id.handle ?? null,
        password: id.password,
        accessToken: id.accessToken,
        expiresAt: id.expiresAt,
        displayName: id.displayName,
        colorHex: id.colorHex,
      };
      setSession(next);
    });
  }, []);

  // ─── Coin Gate ───────────────────────────────────────────────────────
  // On every navigation, if the target path has a gate reason, call
  // spendCoins. If the user is short on coins (status 402), redirect to
  // /account with the page name so the banner can explain.
  //
  // Per-day idempotency for open_* reasons lives server-side, so re-mounts
  // don't double-charge. The "charge only once per session per path" is
  // tracked here in a Set to avoid even the network round-trip.
  const [chargedThisSession, setChargedThisSession] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!session) return;
    const reason = COIN_GATE[location.pathname];
    if (!reason) return;
    if (chargedThisSession.has(`${session.uid}:${reason}`)) return;

    (async () => {
      const res = await spendCoins(session, reason);
      if (res.ok) {
        setChargedThisSession((s) => {
          const next = new Set(s);
          next.add(`${session.uid}:${reason}`);
          return next;
        });
        setBlockedFrom(null);
        return;
      }
      if (res.status === 402) {
        // Redirect to account with banner.
        const fromLabel =
          reason === 'open_feed' ? 'Feed'
          : reason === 'open_dms' ? 'DMs'
          : reason === 'open_arena' ? 'Arena'
          : 'this section';
        setBlockedFrom(fromLabel);
        navigate(`/account?from=${encodeURIComponent(reason)}`, { replace: true });
      } else {
        // Hard error — still navigate but don't show banner.
        setToast(res.message || 'Could not open this section.');
      }
    })();
  }, [location.pathname, session, chargedThisSession, navigate]);

  const onIdentity = (id: Identity) => {
    const next: Session = {
      did: id.did,
      uid: id.uid,
      handle: id.handle ?? null,
      password: id.password,
      accessToken: id.accessToken,
      expiresAt: id.expiresAt,
      displayName: id.displayName,
      colorHex: id.colorHex,
    };
    setSession(next);
  };

  const logout = () => {
    clearSession();
    setSession(null);
    setChargedThisSession(new Set());
    setBlockedFrom(null);
    navigate('/login');
  };

  const showError = (msg: string) => setToast(msg);

  const showNav = session !== null && NAV_ROUTES.includes(location.pathname);

  return (
    <div className="app">
      <div className={`app-content ${showNav ? 'has-bottom-nav' : ''}`}>
        <Routes>
          <Route
            path="/"
            element={
              session ? (
                <Feed
                  session={session}
                  onRotate={onIdentity}
                  onLogout={logout}
                  onError={showError}
                />
              ) : (
                <Login onIdentity={onIdentity} />
              )
            }
          />
          <Route
            path="/welcome"
            element={
              session ? (
                <Welcome session={session} onEnter={() => navigate('/')} />
              ) : (
                <Navigate to="/" replace />
              )
            }
          />
          <Route
            path="/login"
            element={
              session ? (
                <Navigate to="/" replace />
              ) : (
                <Login onIdentity={onIdentity} />
              )
            }
          />

          {/* Pages that all require a session */}
          <Route
            path="/dms"
            element={
              session ? (
                <DMs session={session} />
              ) : (
                <Navigate to="/login" replace />
              )
            }
          />
          <Route
            path="/notifications"
            element={
              session ? (
                <Notifications session={session} />
              ) : (
                <Navigate to="/login" replace />
              )
            }
          />
          <Route
            path="/vault"
            element={
              session ? (
                <Vault session={session} />
              ) : (
                <Navigate to="/login" replace />
              )
            }
          />
          <Route
            path="/account"
            element={
              session ? (
                <AccountCenter session={session} onLogout={logout} onIdentity={onIdentity} blockedFrom={blockedFrom} />
              ) : (
                <Navigate to="/login" replace />
              )
            }
          />
          <Route
            path="/arena"
            element={
              session ? (
                <Arena session={session} onError={showError} />
              ) : (
                <Navigate to="/login" replace />
              )
            }
          />
          <Route
            path="/admin"
            element={
              session ? (
                <Admin session={session} onError={showError} />
              ) : (
                <Navigate to="/login" replace />
              )
            }
          />

          {/* Public profile by handle — sub-page, no bottom nav */}
          <Route
            path="/u/:handle"
            element={
              session ? (
                <Profile session={session} onError={showError} />
              ) : (
                <Navigate to="/login" replace />
              )
            }
          />

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>

      {showNav && <BottomNav unreadDMs={unreadDMs} unreadNotifs={unreadNotifs} />}

      {toast && (
        <div className="toast" onClick={() => setToast(null)} role="alert">
          {toast}
        </div>
      )}
    </div>
  );
}