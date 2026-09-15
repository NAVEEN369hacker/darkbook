import { Link } from 'react-router-dom';

export default function Footer() {
  return (
    <footer style={{
      padding: '40px 20px',
      textAlign: 'center',
      borderTop: '1px solid var(--border-gold)',
      marginTop: '60px',
      backgroundColor: 'var(--bg-elevated)'
    }}>
      <div style={{ fontWeight: 700, color: 'var(--gold)', marginBottom: 20, fontSize: 18 }}>
        Ghostline
      </div>
      <div style={{
        display: 'flex',
        justifyContent: 'center',
        gap: '20px',
        flexWrap: 'wrap',
        marginBottom: 20
      }}>
        <Link to="/about" className="muted" style={{ textDecoration: 'none', fontSize: 14 }}>About</Link>
        <Link to="/blog" className="muted" style={{ textDecoration: 'none', fontSize: 14 }}>Blog</Link>
        <Link to="/privacy" className="muted" style={{ textDecoration: 'none', fontSize: 14 }}>Privacy</Link>
        <Link to="/terms" className="muted" style={{ textDecoration: 'none', fontSize: 14 }}>Terms</Link>
        <Link to="/contact" className="muted" style={{ textDecoration: 'none', fontSize: 14 }}>Contact</Link>
      </div>
      <div className="muted" style={{ fontSize: 12 }}>
        © 2026 Ghostline. Ephemeral by Design.
      </div>
    </footer>
  );
}
