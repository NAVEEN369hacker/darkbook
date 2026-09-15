import { Link } from 'react-router-dom';

export default function Landing() {
  return (
    <div className="page">
      <div className="welcome-hero">
        <div className="welcome-logo">Ghostline</div>
        <p className="welcome-tagline">Anonymous. Daily. Yours.</p>
        <div style={{ marginTop: 30, display: 'flex', gap: 12, justifyContent: 'center' }}>
          <Link to="/login" className="button">Get Started</Link>
          <Link to="/discover" className="button" style={{ background: 'transparent', color: 'var(--gold)', border: '1px solid var(--gold)' }}>Explore Publicly</Link>
        </div>
      </div>

      <div className="content-section fade-up" style={{ marginTop: 80 }}>
        <h2 style={{ textAlign: 'center', marginBottom: 40 }}>The Social Network That Forgets</h2>
        <div style={{ display: 'grid', gap: 40 }}>
          <div className="card" style={{ padding: 30, display: 'flex', gap: 24, alignItems: 'center' }}>
            <div style={{ fontSize: 40 }}>🌙</div>
            <div>
              <h3 style={{ margin: '0 0 10px 0' }}>Daily Identity Rotation</h3>
              <p className="muted" style={{ margin: 0 }}>
                At UTC midnight, your handle and all your social history evaporate.
                Tomorrow, you start fresh. No legacy, no baggage, just the present moment.
              </p>
            </div>
          </div>

          <div className="card" style={{ padding: 30, display: 'flex', gap: 24, alignItems: 'center' }}>
            <div style={{ fontSize: 40 }}>🛡️</div>
            <div>
              <h3 style={{ margin: '0 0 10px 0' }}>True Anonymity</h3>
              <p className="muted" style={{ margin: 0 }}>
                No emails. No phone numbers. No real names.
                We use hardware-based device recognition to ensure safety without sacrificing your privacy.
              </p>
            </div>
          </div>

          <div className="card" style={{ padding: 30, display: 'flex', gap: 24, alignItems: 'center' }}>
            <div style={{ fontSize: 40 }}>🔐</div>
            <div>
              <h3 style={{ margin: '0 0 10px 0' }}>End-to-End Encryption</h3>
              <p className="muted" style={{ margin: 0 }}>
                Your direct messages are encrypted on your device.
                The server only sees ciphertext. Your private conversations stay private.
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="content-section fade-up" style={{ marginTop: 80, backgroundColor: 'var(--bg-elevated)', padding: 40, borderRadius: 24, textAlign: 'center' }}>
        <h2>Ready to leave the permanent record behind?</h2>
        <p className="muted" style={{ marginBottom: 30 }}>Join thousands of users embracing the beauty of the ephemeral.</p>
        <Link to="/login" className="button">Join Ghostline Now</Link>
      </div>

      <div style={{ marginTop: 80, textAlign: 'center' }}>
        <Link to="/about" className="muted" style={{ textDecoration: 'none', fontSize: 14 }}>Learn more about our philosophy →</Link>
      </div>
    </div>
  );
}
