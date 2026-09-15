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
import About from './pages/About';
import Privacy from './pages/Privacy';
import Terms from './pages/Terms';
import Contact from './pages/Contact';
import Blog from './pages/Blog';
import BlogPost from './pages/BlogPost';
import Landing from './pages/Landing';
import Discover from './pages/Discover';
import BottomNav from './components/BottomNav';
import Footer from './components/Footer';
import { loadSession, saveSession, clearSession, Session } from './storage';
import { Identity, recognizeDevice, getUnreadDMCount, getUnreadNotifCount, authEvents } from './api';
import { getDeviceInfo } from './device';

/** Routes where the bottom nav should be visible.
 *  Vault is no longer in the nav — it's accessed via Account. */
const NAV_ROUTES = ['/', '/dms', '/notifications', '/arena', '/account'];

export default function App() {
  const [session, setSession] = useState<Session | null>(() => loadSession());
  const [toast, setToast] = useState<string | null>(null);
  const [unreadDMs, setUnreadDMs] = useState(0);
  const [unreadNotifs, setUnreadNotifs] = useState(0);
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
                <Landing />
              )
            }
          />
          <Route path="/discover" element={<Discover />} />
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
          <Route path="/about" element={<About />} />
          <Route path="/privacy" element={<Privacy />} />
          <Route path="/terms" element={<Terms />} />
          <Route path="/contact" element={<Contact />} />
          <Route path="/blog" element={<Blog />} />
          <Route path="/blog/:id" element={<BlogPost />} />
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
                <AccountCenter session={session} onLogout={logout} onIdentity={onIdentity} />
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

      {!showNav && <Footer />}

      {toast && (
        <div className="toast" onClick={() => setToast(null)} role="alert">
          {toast}
        </div>
      )}
    </div>
  );
}