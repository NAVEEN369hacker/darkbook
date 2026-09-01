/**
 * Login — Smart Auto Device Recognition + Authentication.
 *
 * Automatically detects and displays the physical Device ID on load:
 * - If device exists in DB: prompts for password verification.
 * - If device is new: lets the user set a password and registers the device.
 */

import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { login, register, recognizeDevice, Identity } from '../api';
import { getDeviceInfo, getOrCreateDeviceIdAsync, DeviceInfo } from '../device';

type Props = {
  onIdentity: (id: Identity) => void;
};

export default function Login({ onIdentity }: Props) {
  const navigate = useNavigate();
  const [deviceInfo, setDeviceInfo] = useState<DeviceInfo | null>(null);
  const [serverDid, setServerDid] = useState<string>('');
  const [checking, setChecking] = useState(true);
  const [recognized, setRecognized] = useState<boolean>(false);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        await getOrCreateDeviceIdAsync();
      } catch {
        /* noop */
      }
      const info = getDeviceInfo();
      setDeviceInfo(info);

      recognizeDevice(info)
        .then((res) => {
          setRecognized(res.recognized);
          if (res.did) setServerDid(res.did);
        })
        .catch((err) => {
          console.warn('Device recognition error:', err);
          setRecognized(false);
        })
        .finally(() => {
          setChecking(false);
        });
    })();
  }, []);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy || !deviceInfo) return;

    if (recognized && !password.trim()) {
      setError('Password is required to log in.');
      return;
    }

    setBusy(true);
    setError(null);

    try {
      const targetDid = serverDid || deviceInfo.deviceId;
      if (recognized) {
        // Returning device: verify password & login
        const id = await login(targetDid, password.trim(), deviceInfo.fingerprint);
        onIdentity(id);
        navigate('/');
      } else {
        // New device: register device with user-chosen or generated password
        const id = await register({
          ...deviceInfo,
          password: password.trim() || undefined,
        });
        onIdentity(id);
        navigate('/welcome');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page">
      <div className="welcome-hero">
        <div className="welcome-logo">Ghostline</div>
        <p className="welcome-tagline">Anonymous. Daily. Yours.</p>
      </div>

      <h1 style={{ fontSize: 24, marginTop: 24 }}>{recognized ? 'Welcome back' : 'Register Device'}</h1>
      <p className="muted">
        {recognized
          ? 'Your device was recognized automatically. Enter your password to continue.'
          : 'This device is new to Ghostline. Set a password for this device to complete registration.'}
      </p>

      <form onSubmit={onSubmit} className="card fade-up">
        {checking ? (
          <p className="muted">Recognizing device hardware…</p>
        ) : (
          <>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
                background: 'var(--bg-elevated)',
                border: '1px solid var(--border-gold)',
                borderRadius: 12,
                padding: '12px 16px',
                marginBottom: 18,
              }}
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span className="muted" style={{ fontSize: 11, letterSpacing: '0.8px', fontWeight: 700, color: 'var(--gold)' }}>
                  RECOGNIZED DEVICE ID
                </span>
                <span style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 13, color: 'var(--gold)' }}>
                  {deviceInfo?.deviceId}
                </span>
              </div>
              <span
                style={{
                  fontSize: 12,
                  fontWeight: 700,
                  padding: '5px 12px',
                  borderRadius: 999,
                  background: 'var(--gold-soft)',
                  color: 'var(--gold)',
                  border: '1px solid var(--gold)',
                  whiteSpace: 'nowrap',
                }}
              >
                {recognized ? '● Registered' : '○ New Device'}
              </span>
            </div>

            <label className="field">
              <span className="muted">
                {recognized ? 'Device Password' : 'Set Password (Optional)'}
              </span>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={recognized ? 'Enter your password' : 'Create a password (or leave blank)'}
                autoComplete="off"
                spellCheck={false}
              />
            </label>

            <button className="button" type="submit" disabled={busy}>
              {busy ? 'One moment…' : recognized ? 'Verify & Sign In' : 'Register Device'}
            </button>

            {error && (
              <p className="muted" style={{ marginTop: 12, color: 'var(--danger)' }}>
                {error}
              </p>
            )}
          </>
        )}
      </form>

      <p className="muted" style={{ marginTop: 16 }}>
        Device identity is permanent to this physical hardware. Your public handle
        changes daily at midnight UTC, but stays the same all day — even if you
        log out and log back in.
      </p>
    </div>
  );
}