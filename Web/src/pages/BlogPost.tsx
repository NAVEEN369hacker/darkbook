import { useParams, Link } from 'react-router-dom';
import { BLOG_POSTS } from '../data/blog';

export default function BlogPost() {
  const { id } = useParams();
  const post = BLOG_POSTS.find(p => p.id === id);

  if (!post) {
    return (
      <div className="page">
        <div className="welcome-hero">
          <div className="welcome-logo">Post Not Found</div>
        </div>
        <div style={{ textAlign: 'center', marginTop: 40 }}>
          <Link to="/blog" className="button">Back to Blog</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="welcome-hero">
        <div className="welcome-logo">{post.title}</div>
        <p className="welcome-tagline">{post.date}</p>
      </div>

      <div className="content-section fade-up" style={{ lineHeight: 1.8, fontSize: 17 }}>
        <div dangerouslySetInnerHTML={{ __html: post.content }} />
      </div>

      <div style={{ marginTop: 60, textAlign: 'center', display: 'flex', gap: 12, justifyContent: 'center' }}>
        <Link to="/blog" className="button">Back to Blog</Link>
        <Link to="/" className="button">Back to Ghostline</Link>
      </div>
    </div>
  );
}
