/**
 * Profile — public profile page for any active handle.
 * Shows identity, lifetime-in-day stats, followers/following, and a list of recent posts.
 */

import { useEffect, useState, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { Session } from '../storage';
import type { Post } from '../types';
import { getProfile, followUser, unfollowUser, type Profile as ProfileData } from '../api';
import IdentityChip from '../components/IdentityChip';
import PostCard from '../components/PostCard';

type Props = {
  session: Session;
  onError: (msg: string) => void;
};

function relTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

export default function Profile({ session, onError }: Props) {
  const { handle: rawHandle } = useParams<{ handle: string }>();
  const navigate = useNavigate();
  const handle = (rawHandle || '').replace(/^@/, '').toLowerCase();

  const [profileData, setProfileData] = useState<ProfileData | null>(null);
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  
  const [isFollowing, setIsFollowing] = useState(false);
  const [followersCount, setFollowersCount] = useState(0);
  const [followingCount, setFollowingCount] = useState(0);
  const [followBusy, setFollowBusy] = useState(false);

  const refresh = useCallback(async () => {
    if (!handle) return;
    setLoading(true);
    setNotFound(false);
    try {
      const data = await getProfile(handle, session);
      setProfileData(data);
      setIsFollowing(!!data.profile.isFollowing);
      setFollowersCount(data.profile.followersCount || data.stats.followersCount || 0);
      setFollowingCount(data.profile.followingCount || data.stats.followingCount || 0);

      const author = {
        uid: data.profile.uid,
        handle: data.profile.handle,
        displayName: data.profile.displayName,
        colorHex: data.profile.colorHex,
      };
      setPosts(
        data.posts.map((p) => ({
          id: p.id,
          roomId: 'random',
          text: p.text,
          createdAt: p.createdAt,
          likeCount: p.likeCount,
          shakeCount: p.shakeCount,
          commentCount: p.commentCount,
          myReaction: null,
          author,
        })),
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Profile failed';
      if (/not_found|404/i.test(msg)) setNotFound(true);
      else onError(msg);
    } finally {
      setLoading(false);
    }
  }, [handle, session, onError]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handleToggleFollow = async () => {
    if (!handle || followBusy) return;
    setFollowBusy(true);
    try {
      if (isFollowing) {
        const res = await unfollowUser(session, handle);
        setIsFollowing(false);
        setFollowersCount(res.followersCount);
      } else {
        const res = await followUser(session, handle);
        setIsFollowing(true);
        setFollowersCount(res.followersCount);
      }
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Follow action failed');
    } finally {
      setFollowBusy(false);
    }
  };

  if (loading && !profileData) {
    return (
      <div className="page page-profile">
        <div className="page-header">
          <button
            className="dm-back-btn"
            onClick={() => navigate(-1)}
            id="profile-back-btn"
            aria-label="Back"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6"/>
            </svg>
          </button>
          <h1 style={{ margin: 0 }}>Profile</h1>
        </div>
        <p className="muted" style={{ padding: '0 20px' }}>Loading…</p>
      </div>
    );
  }

  if (notFound || !profileData) {
    return (
      <div className="page page-profile">
        <div className="page-header">
          <button
            className="dm-back-btn"
            onClick={() => navigate(-1)}
            id="profile-back-btn"
            aria-label="Back"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6"/>
            </svg>
          </button>
          <h1 style={{ margin: 0 }}>Profile</h1>
        </div>
        <div className="card" style={{ margin: '0 20px', textAlign: 'center', padding: '48px 24px' }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>👻</div>
          <p className="muted">No active user with that handle today.</p>
          <p className="muted" style={{ fontSize: 12 }}>
            Handles expire at midnight UTC. Try again tomorrow — or ask them to share their current handle.
          </p>
        </div>
      </div>
    );
  }

  const { stats, profile: p } = profileData;
  const isMe = p.uid === session.uid;

  return (
    <div className="page page-profile">
      {/* Top bar */}
      <div className="page-header">
        <button
          className="dm-back-btn"
          onClick={() => navigate(-1)}
          id="profile-back-btn"
          aria-label="Back"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6"/>
          </svg>
        </button>
        <h1 style={{ margin: 0 }}>{p.displayName}</h1>
        <span style={{ width: 28 }} />
      </div>

      {/* Hero / identity */}
      <div className="profile-hero card">
        <div
          className="profile-avatar"
          style={{ background: p.colorHex }}
        >
          <span style={{ fontSize: 36 }}>👻</span>
        </div>
        <div className="profile-identity">
          <IdentityChip displayName={p.displayName} colorHex={p.colorHex} />
          {p.handle && (
            <span
              className="monospace"
              style={{
                marginTop: 8,
                fontSize: 20,
                color: 'var(--gold)',
                fontWeight: 700,
                letterSpacing: '0.5px',
              }}
              id="profile-handle"
            >
              @{p.handle}
            </span>
          )}
          <span className="muted" style={{ fontSize: 12 }}>
            Anonymous · {relTime(p.expiresAt || '')}
          </span>
        </div>

        {/* Action row */}
        <div className="profile-actions" style={{ gap: 8 }}>
          {!isMe ? (
            <>
              <button
                className={`button ${isFollowing ? 'ghost' : ''}`}
                style={{ width: 'auto', padding: '10px 18px' }}
                onClick={handleToggleFollow}
                disabled={followBusy}
                id="profile-follow-btn"
              >
                {followBusy ? '...' : isFollowing ? '✓ Following' : '+ Follow'}
              </button>
              <button
                className="button"
                style={{ width: 'auto', padding: '10px 18px' }}
                onClick={() => navigate(`/dms?to=${encodeURIComponent(p.handle || '')}`)}
                id="profile-message-btn"
              >
                ✉️ Message
              </button>
            </>
          ) : (
            <button
              className="button ghost"
              style={{ width: 'auto', padding: '10px 18px' }}
              onClick={() => navigate('/account')}
              id="profile-self-account-btn"
            >
              This is you
            </button>
          )}
        </div>
      </div>

      {/* Stats */}
      <div className="profile-stats card">
        <div className="profile-stat">
          <span className="profile-stat-value">{followersCount}</span>
          <span className="profile-stat-label">Followers</span>
        </div>
        <div className="profile-stat">
          <span className="profile-stat-value">{followingCount}</span>
          <span className="profile-stat-label">Following</span>
        </div>
        <div className="profile-stat">
          <span className="profile-stat-value">{stats.postCount}</span>
          <span className="profile-stat-label">Posts</span>
        </div>
        <div className="profile-stat">
          <span className="profile-stat-value">{stats.lifetimeLikes}</span>
          <span className="profile-stat-label">Likes</span>
        </div>
        <div className="profile-stat">
          <span className="profile-stat-value">{stats.conversationCount}</span>
          <span className="profile-stat-label">Chats</span>
        </div>
      </div>

      {/* Posts */}
      <div className="profile-section-title">Recent posts</div>
      {posts.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: '32px 24px' }}>
          <p className="muted">No posts yet today.</p>
        </div>
      ) : (
        posts.map((p) => (
          <PostCard
            key={p.id}
            post={p}
            session={session}
            onPostUpdated={(next) =>
              setPosts((prev) => prev.map((x) => (x.id === next.id ? next : x)))
            }
            onError={onError}
          />
        ))
      )}

      <div className="spacer" />
    </div>
  );
}