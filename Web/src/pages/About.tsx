import React from 'react';
import { Link } from 'react-router-dom';

export default function About() {
  return (
    <div className="page">
      <div className="welcome-hero">
        <div className="welcome-logo">About Ghostline</div>
        <p className="welcome-tagline">Redefining Digital Privacy and Anonymity</p>
      </div>

      <div className="content-section fade-up">
        <h2>Our Vision</h2>
        <p>
          Ghostline is a hyper-anonymous social platform designed for those who value their privacy
          above all else. In an era of permanent digital footprints and invasive tracking, Ghostline
          offers a sanctuary where you can express yourself, connect with others, and share ideas
          without the fear of a permanent record.
        </p>
      </div>

      <div className="content-section fade-up" style={{ marginTop: 40 }}>
        <h2>The Ghostline Philosophy</h2>
        <p>
          We believe that not every thought needs to be archived forever. Most of our daily
          interactions are ephemeral—conversations that happen in the moment and then fade away.
          Ghostline brings this natural human experience to the digital world.
        </p>
        <div className="card" style={{ marginTop: 20, padding: 20, borderLeft: '4px solid var(--gold)' }}>
          <strong>Daily Rotation:</strong> Every UTC midnight, your handle and all your social history
          evaporate. Tomorrow, you start fresh. No followers, no history, no baggage.
        </div>
      </div>

      <div className="content-section fade-up" style={{ marginTop: 40 }}>
        <h2>Privacy by Design</h2>
        <p>
          Unlike traditional social networks, Ghostline doesn't ask for your email, phone number,
          or real name. We use hardware-based device recognition to prevent abuse while maintaining
          your absolute anonymity.
        </p>
        <ul className="muted" style={{ lineHeight: 1.8, marginTop: 10 }}>
          <li><strong>No PII:</strong> We never collect personally identifiable information.</li>
          <li><strong>E2E Encryption:</strong> Your direct messages are end-to-end encrypted.</li>
          <li><strong>Ephemeral State:</strong> Your social graph is wiped daily.</li>
        </ul>
      </div>

      <div style={{ marginTop: 60, textAlign: 'center' }}>
        <Link to="/" className="button">Back to Ghostline</Link>
      </div>
    </div>
  );
}
