import { Link } from 'react-router-dom';

export default function Contact() {
  return (
    <div className="page">
      <div className="welcome-hero">
        <div className="welcome-logo">Contact Us</div>
        <p className="welcome-tagline">Get in touch with the Ghostline team</p>
      </div>

      <div className="content-section fade-up">
        <p>
          Have a question, a bug report, or a suggestion? We'd love to hear from you.
          Since we are a small team dedicated to privacy, please allow us a few days to respond.
        </p>

        <div className="card" style={{ marginTop: 30, padding: 20, textAlign: 'center' }}>
          <h3 style={{ marginBottom: 10 }}>Email Support</h3>
          <p className="muted" style={{ fontSize: 18, fontWeight: 700, color: 'var(--gold)' }}>
            support@ghostline.app
          </p>
        </div>

        <div className="card" style={{ marginTop: 20, padding: 20, textAlign: 'center' }}>
          <h3 style={{ marginBottom: 10 }}>Legal Inquiries</h3>
          <p className="muted" style={{ fontSize: 18, fontWeight: 700, color: 'var(--gold)' }}>
            legal@ghostline.app
          </p>
        </div>
      </div>

      <div style={{ marginTop: 60, textAlign: 'center' }}>
        <Link to="/" className="button">Back to Ghostline</Link>
      </div>
    </div>
  );
}
