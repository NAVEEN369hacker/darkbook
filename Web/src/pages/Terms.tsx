import React from 'react';
import { Link } from 'react-router-dom';

export default function Terms() {
  return (
    <div className="page">
      <div className="welcome-hero">
        <div className="welcome-logo">Terms of Service</div>
        <p className="welcome-tagline">The rules of the Ghostline</p>
      </div>

      <div className="content-section fade-up">
        <p className="muted">Last Updated: September 15, 2026</p>

        <h2 style={{ marginTop: 30 }}>1. Acceptance of Terms</h2>
        <p>
          By accessing or using Ghostline, you agree to be bound by these Terms of Service.
          If you do not agree, please do not use the platform.
        </p>

        <h2 style={{ marginTop: 30 }}>2. Ephemeral Nature of Content</h2>
        <p>
          You acknowledge and agree that Ghostline is an ephemeral platform. All posts, comments,
          and social interactions are wiped daily at midnight UTC. Ghostline is not responsible
          for the loss of any content after this automatic purge.
        </p>

        <h2 style={{ marginTop: 30 }}>3. User Conduct</h2>
        <p>
          You agree NOT to use Ghostline for:
        </p>
        <ul className="muted" style={{ lineHeight: 1.8 }}>
          <li>Posting illegal content or promoting illegal acts.</li>
          <li>Harassment, hate speech, or targeted abuse.</li>
          <li>Mass spamming or automated bot interaction.</li>
          <li>Doxxing or sharing the private information of others.</li>
        </ul>

        <h2 style={{ marginTop: 30 }}>4. Moderation</h2>
        <p>
          Ghostline reserves the right to remove any content that violates our community standards.
          Bans are applied to the device identifier and are not reset by daily identity rotation.
        </p>

        <h2 style={{ marginTop: 30 }}>5. Limitation of Liability</h2>
        <p>
          Ghostline is provided "as is" without warranties of any kind. We are not liable for any
          damages arising from your use of the platform.
        </p>
      </div>

      <div style={{ marginTop: 60, textAlign: 'center' }}>
        <Link to="/" className="button">Back to Ghostline</Link>
      </div>
    </div>
  );
}
