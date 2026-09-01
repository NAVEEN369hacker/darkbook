import { Session } from '../storage';
import IdentityChip from '../components/IdentityChip';

type Props = {
  session: Session;
  onEnter: () => void;
};

export default function Welcome({ session, onEnter }: Props) {
  return (
    <div className="page">
      <div className="welcome-hero">
        <div className="welcome-logo">Ghostline</div>
        <p className="welcome-tagline">Anonymous. Daily. Yours.</p>
      </div>

      <div className="card fade-up">
        <p className="muted" style={{ marginTop: 0 }}>Welcome,</p>
        <IdentityChip
          displayName={session.displayName}
          colorHex={session.colorHex}
          size="large"
        />
        {session.handle && (
          <p
            className="monospace"
            style={{
              marginTop: 14,
              fontSize: 22,
              color: 'var(--gold)',
              fontWeight: 800,
              letterSpacing: '0.5px',
            }}
          >
            @{session.handle}
          </p>
        )}
      </div>

      <div className="card fade-up" style={{ animationDelay: '80ms' }}>
        <h2>Your daily identifier</h2>
        <p className="muted">
          Your <strong style={{ color: 'var(--gold)' }}>@{session.handle}</strong> handle stays
          the same for the entire UTC day. Logging out and logging back in
          returns the same handle — only when the timer hits zero at midnight
          does it rotate to a brand new name and colour.
        </p>
        <p className="muted">
          One device, one daily identifier. Tomorrow you'll get a new name, a
          new colour, and an empty history.
        </p>
      </div>

      <div className="card fade-up" style={{ animationDelay: '160ms' }}>
        <h2>Reactions</h2>
        <p className="muted">
          Show appreciation with <strong>👍 Like</strong>, or go bigger with
          <strong> 🫨 Shake</strong> — clicking Shake physically shakes the
          post on your screen (and on everyone else's).
        </p>
      </div>

      <button className="button fade-up" style={{ animationDelay: '240ms' }} onClick={onEnter}>Enter the feed</button>
    </div>
  );
}