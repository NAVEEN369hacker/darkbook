import { Link } from 'react-router-dom';
import { BLOG_POSTS } from '../data/blog';

export default function Blog() {
  return (
    <div className="page">
      <div className="welcome-hero">
        <div className="welcome-logo">Ghostline Insights</div>
        <p className="welcome-tagline">Thoughts on Privacy, Anonymity, and the Ephemeral Web</p>
      </div>

      <div className="content-section fade-up" style={{ display: 'grid', gap: 24, marginTop: 40 }}>
        {BLOG_POSTS.map(post => (
          <div key={post.id} className="card" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span className="muted" style={{ fontSize: 12 }}>{post.date}</span>
            </div>
            <h3 style={{ margin: 0 }}>{post.title}</h3>
            <p className="muted" style={{ margin: 0 }}>{post.excerpt}</p>
            <Link to={`/blog/${post.id}`} className="button" style={{ width: 'fit-content', marginTop: 8 }}>
              Read More
            </Link>
          </div>
        ))}
      </div>

      <div style={{ marginTop: 60, textAlign: 'center' }}>
        <Link to="/" className="button">Back to Ghostline</Link>
      </div>
    </div>
  );
}
