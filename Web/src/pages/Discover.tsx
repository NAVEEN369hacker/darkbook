import React from 'react';
import { Link } from 'react-router-dom';

// Mock data for public discovery.
// In a real app, this would be a call to a public API endpoint.
const FEATURED_POSTS = [
  {
    id: '1',
    handle: 'MidnightOwl',
    content: 'The beauty of an ephemeral world is that you can be whoever you want today, and someone entirely different tomorrow.',
    votes: 142,
    time: '2h ago'
  },
  {
    id: '2',
    handle: 'GhostWriter',
    content: 'Why do we cling to digital archives? Let your thoughts flow and fade like a real conversation.',
    votes: 89,
    time: '5h ago'
  },
  {
    id: '3',
    handle: 'NeonDream',
    content: 'Found a way to organize my thoughts using only 24-hour cycles. It is incredibly liberating.',
    votes: 210,
    time: '8h ago'
  },
  {
    id: '4',
    handle: 'SilentEcho',
    content: 'Privacy isn't about having something to hide, it is about having something to protect.',
    votes: 305,
    time: '12h ago'
  },
];

export default function Discover() {
  return (
    <div className="page">
      <div className="welcome-hero">
        <div className="welcome-logo">Public Discovery</div>
        <p className="welcome-tagline">Explore the latest sparks from the Ghostline</p>
      </div>

      <div className="content-section fade-up" style={{ display: 'grid', gap: 20, marginTop: 40 }}>
        <p className="muted" style={{ textAlign: 'center', marginBottom: 20 }}>
          A read-only glimpse into the ephemeral conversations happening right now.
        </p>

        {FEATURED_POSTS.map(post => (
          <div key={post.id} className="card" style={{ padding: 20, borderLeft: '4px solid var(--gold)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <span style={{ fontWeight: 700, color: 'var(--gold)' }}>@{post.handle}</span>
              <span className="muted" style={{ fontSize: 12 }}>{post.time}</span>
            </div>
            <p style={{ fontSize: 17, lineHeight: 1.6, margin: 0 }}>{post.content}</p>
            <div style={{ marginTop: 15, display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 14 }}>▲ {post.votes}</span>
            </div>
          </div>
        ))}
      </div>

      <div style={{ marginTop: 60, textAlign: 'center' }}>
        <Link to="/login" className="button">Join the Conversation</Link>
      </div>
    </div>
  );
}
