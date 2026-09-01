/**
 * Feed — the home screen after registration/login.
 *
 * Rotation banner, identity chip, photo+text composer, feed of PostCards,
 * automatic identity rotation when time expires, and Coin enforcement on
 * the post action (handled by the server — the client just surfaces a
 * "Not enough coins" toast and routes to the Vault).
 */

import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Session } from '../storage';
import type { Post } from '../types';
import { createPost, getFeed, rotate as apiRotate } from '../api';
import RotationBanner from '../components/RotationBanner';
import IdentityChip from '../components/IdentityChip';
import PostCard from '../components/PostCard';
import ImageUploader from '../components/ImageUploader';
import AccountSwitcher from '../components/AccountSwitcher';

type Props = {
  session: Session;
  onRotate: (id: import('../api').Identity) => void;
  onLogout: () => void;
  onError: (msg: string) => void;
};

export default function Feed({ session, onRotate, onError }: Props) {
  const navigate = useNavigate();
  const [posts, setPosts] = useState<Post[]>([]);
  const [loadingFeed, setLoadingFeed] = useState(true);
  const [draft, setDraft] = useState('');
  const [posting, setPosting] = useState(false);
  const [photo, setPhoto] = useState<File | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await getFeed('random');
      setPosts(res.posts);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'feed failed');
    } finally {
      setLoadingFeed(false);
    }
  }, [onError]);

  useEffect(() => {
    refresh();
  }, [refresh, session.uid]);

  const submitPost = async () => {
    const text = draft.trim();
    if (!text || posting) return;
    setPosting(true);
    try {
      const res = await createPost(session, 'random', text, photo || undefined);
      setPosts((prev) => [res.post, ...prev]);
      setDraft('');
      setPhoto(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'post failed';
      if (msg.includes('insufficient_coins') || msg.includes('Vault')) {
        navigate('/account?from=post_feed');
        return;
      }
      onError(msg);
    } finally {
      setPosting(false);
    }
  };

  const updatePost = (next: Post) => {
    setPosts((prev) => prev.map((p) => (p.id === next.id ? next : p)));
  };

  const handleBannerExpire = useCallback(async () => {
    try {
      const id = await apiRotate(session);
      onRotate(id);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'rotate failed');
    }
  }, [session, onRotate, onError]);

  return (
    <div className="page page-feed">
      <RotationBanner expiresAt={session.expiresAt} onExpire={handleBannerExpire} />

      <div className="feed-header">
        <div className="card identity-summary">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, flexWrap: 'wrap' }}>
            <IdentityChip
              displayName={session.displayName}
              colorHex={session.colorHex}
              handle={session.handle}
              navigateToProfile={!!session.handle}
              id="feed-self-chip"
            />
            {session.handle && (
              <span className="muted monospace" style={{ fontSize: 12 }}>
                @{session.handle}
              </span>
            )}
            <AccountSwitcher session={session} onIdentity={onRotate} onError={onError} compact />
          </div>
          <span className="muted" style={{ fontSize: 11, background: '#1f293d', padding: '4px 8px', borderRadius: 4 }}>
            Device: {session.did.slice(0, 12)}…
          </span>
        </div>

        <div className="spacer" />

        <div className="card composer">
          <textarea
            placeholder="Say something to today's Random room…"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            maxLength={500}
            rows={3}
          />
          <ImageUploader onChange={setPhoto} disabled={posting} />
          <div className="composer-row">
            <span className="muted">{draft.length}/500</span>
            <button
              className="button"
              onClick={submitPost}
              disabled={posting || !draft.trim()}
              id="feed-post-btn"
            >
              {posting ? 'Posting…' : 'Post'}
            </button>
          </div>
        </div>

        <div className="spacer" />

        {loadingFeed && <p className="muted">Loading feed…</p>}
        {!loadingFeed && posts.length === 0 && (
          <div className="card">
            <p className="muted">
              Nothing in the Random room today. Be the first to post.
            </p>
          </div>
        )}

        {posts.map((p) => (
          <PostCard
            key={p.id}
            post={p}
            session={session}
            onPostUpdated={updatePost}
            onError={onError}
          />
        ))}

        <div className="spacer" />
      </div>
    </div>
  );
}