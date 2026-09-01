import { useState } from 'react';
import { register, Identity } from '../api';
import { getDeviceInfo } from '../device';

type Props = {
  onIdentity: (id: Identity) => void;
  onDone: () => void;
};

export default function Onboarding({ onIdentity, onDone }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onContinue = async () => {
    setBusy(true);
    setError(null);
    try {
      const deviceInfo = getDeviceInfo();
      const id = await register(deviceInfo);
      onIdentity(id);
      onDone();
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : 'Registration failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page">
      <h1>Ghostline</h1>
      <p className="muted">You are anonymous here.</p>

      <div className="card">
        <h2>How this works</h2>
        <p className="muted">
          We don't ask for your name, email, or phone number. When you tap
          continue we'll give you a friendly handle like "Blue Panda" — that's
          who you are today.
        </p>
        <p className="muted">
          At midnight UTC your handle changes and everything you did under it
          is gone. Tomorrow you're someone new.
        </p>
        <p className="muted">
          We assign each device an internal identifier we use to keep the
          platform safe. We never show it to you or to other people.
        </p>
      </div>

      <button className="button" disabled={busy} onClick={onContinue}>
        {busy ? 'One moment…' : 'Continue'}
      </button>
      {error && <p className="muted" style={{ marginTop: 12, color: 'var(--danger)' }}>{error}</p>}

      <p className="muted" style={{ marginTop: 24, textAlign: 'center' }}>
        v0.1.0 — basic level prototype
      </p>
    </div>
  );
}
