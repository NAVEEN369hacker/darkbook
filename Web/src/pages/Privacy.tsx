import React from 'react';
import { Link } from 'react-router-dom';

export default function Privacy() {
  return (
    <div className="page">
      <div className="welcome-hero">
        <div className="welcome-logo">Privacy Policy</div>
        <p className="welcome-tagline">Your anonymity is our priority</p>
      </div>

      <div className="content-section fade-up">
        <p className="muted">Last Updated: September 15, 2026</p>

        <h2 style={{ marginTop: 30 }}>1. Information We Do Not Collect</h2>
        <p>
          Ghostline is built on the principle of anonymity. We <strong>do not</strong> collect:
        </p>
        <ul className="muted" style={{ lineHeight: 1.8 }}>
          <li>Real names, email addresses, or phone numbers.</li>
          <li>Contact lists from your device.</li>
          <li>Persistent social identity across days.</li>
        </ul>

        <h2 style={{ marginTop: 30 }}>2. Hardware-Based Identification</h2>
        <p>
          To prevent mass abuse, spam, and illegal activities, Ghostline assigns each device a permanent
          internal identifier (Device ID). This identifier is used exclusively for:
        </p>
        <ul className="muted" style={{ lineHeight: 1.8 }}>
          <li>Maintaining ban states and abuse scores.</li>
          <li>Complying with lawful legal process.</li>
        </ul>
        <p className="muted">
          This Device ID is never shown to you or any other user on the platform.
        </p>

        <h2 style={{ marginTop: 30 }}>3. Ephemeral Data</h2>
        <p>
          All social content—including posts, comments, reactions, and follows—is automatically
          deleted from our servers every day at midnight UTC.
        </p>

        <h2 style={{ marginTop: 30 }}>4. End-to-End Encryption</h2>
        <p>
          Direct Messages (DMs) are end-to-end encrypted. This means only the sender and receiver
          can read the messages. Ghostline holds only the ciphertext and cannot produce plaintext
          under any circumstances.
        </p>

        <h2 style={{ marginTop: 30 }}>5. Google AdSense and Cookies</h2>
        <p>
          We use Google AdSense to serve advertisements on our site. Google, as a third-party vendor,
          uses cookies to serve ads on our site.
        </p>
        <p>
          Google's use of advertising cookies enables it and its partners to serve ads to our users
          based on their visit to our site and/or other sites on the Internet.
        </p>
        <p className="muted">
          You may opt out of personalized advertising by visiting <a href="https://www.google.com/settings/ads" target="_blank" rel="noreferrer">Google Ads Settings</a>.
        </p>

        <h2 style={{ marginTop: 30 }}>6. Data Retention</h2>
        <p>
          Technical metadata (such as IP addresses) is temporarily logged for security and abuse
          prevention. These logs are automatically deleted after 14 days.
        </p>
      </div>

      <div style={{ marginTop: 60, textAlign: 'center' }}>
        <Link to="/" className="button">Back to Ghostline</Link>
      </div>
    </div>
  );
}
