/**
 * PostCard — one post with Like / Shake reactions, comment toggle,
 * and an inline comment thread + composer.
 *
 * Optimistic UI: reaction clicks update local counts/myReaction immediately.
 * If the server rejects, we roll back and surface a toast.
 *
 * Shake is a "bigger" reaction than Like: clicking it triggers a CSS
 * animation on the card so the whole post shakes on the screen.
 */

import { useEffect, useRef, useState } from 'react';
import type { Post, Comment, ReactionType } from '../types';
import { castPostReact, castCommentReact, getComments, addComment } from '../api';
import type { Session } from '../storage';
import IdentityChip from './IdentityChip';
import Poll from './Poll';

type Props = {
  post: Post;
  session: Session;
  onPostUpdated: (post: Post) => void;
  onError: (msg: string) => void;
};

function relTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

function nextReaction(current: ReactionType, target: 'like' | 'shake'): ReactionType {
  if (target === 'like') return current === 'like' ? null : 'like';
  return current === 'shake' ? null : 'shake';
}

export default function PostCard({ post, session, onPostUpdated, onError }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [comments, setComments] = useState<Comment[] | null>(null);
  const [loadingComments, setLoadingComments] = useState(false);
  const [draft, setDraft] = useState('');
  const [posting, setPosting] = useState(false);
  const [reacting, setReacting] = useState(false);

  // Shake animation: a one-shot CSS class toggle on the card root.
  const cardRef = useRef<HTMLDivElement | null>(null);
  const shakeShake = () => {
    const el = cardRef.current;
    if (!el) return;
    el.classList.remove('ghostline-shake');
    // Force reflow so the animation can replay if the user spams shake.
    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
    el.offsetWidth;
    el.classList.add('ghostline-shake');
  };

  const react = async (target: 'like' | 'shake') => {
    if (reacting) return;
    setReacting(true);
    const prev = post.myReaction;
    const next = nextReaction(prev, target);
    const prevLike = post.likeCount;
    const prevShake = post.shakeCount;

    // Optimistic delta
    let dLike = 0;
    let dShake = 0;
    if (prev === 'like') dLike -= 1;
    if (prev === 'shake') dShake -= 1;
    if (next === 'like') dLike += 1;
    if (next === 'shake') dShake += 1;

    onPostUpdated({
      ...post,
      myReaction: next,
      likeCount: Math.max(0, prevLike + dLike),
      shakeCount: Math.max(0, prevShake + dShake),
    });

    // Trigger the shake animation regardless of state change — that's the
    // whole point of Shake: you click it and the card physically moves.
    if (target === 'shake') shakeShake();

    try {
      const res = await castPostReact(session, post.id, next);
      onPostUpdated({
        ...post,
        myReaction: res.myReaction,
        likeCount: res.likeCount,
        shakeCount: res.shakeCount,
      });
    } catch (err) {
      onPostUpdated({ ...post, myReaction: prev, likeCount: prevLike, shakeCount: prevShake });
      onError(err instanceof Error ? err.message : 'reaction failed');
    } finally {
      setReacting(false);
    }
  };

  const commentReact = async (commentId: string, target: 'like' | 'shake') => {
    setComments((prevList) => {
      if (!prevList) return prevList;
      return prevList.map((c) => {
        if (c.id !== commentId) return c;
        let dLike = 0;
        let dShake = 0;
        if (c.myReaction === 'like') dLike -= 1;
        if (c.myReaction === 'shake') dShake -= 1;
        const next = nextReaction(c.myReaction, target);
        if (next === 'like') dLike += 1;
        if (next === 'shake') dShake += 1;
        return {
          ...c,
          myReaction: next,
          likeCount: Math.max(0, c.likeCount + dLike),
          shakeCount: Math.max(0, c.shakeCount + dShake),
        };
      });
    });

    // Shake animation on the comment row when shake is clicked
    if (target === 'shake') {
      const el = document.getElementById(`comment-${commentId}`);
      if (el) {
        el.classList.remove('ghostline-shake');
        // eslint-disable-next-line @typescript-eslint/no-unused-expressions
        el.offsetWidth;
        el.classList.add('ghostline-shake');
      }
    }

    const prev = comments?.find((c) => c.id === commentId);
    if (!prev) return;
    try {
      const res = await castCommentReact(session, commentId, nextReaction(prev.myReaction, target));
      setComments((prevList) =>
        prevList
          ? prevList.map((c) =>
              c.id === commentId
                ? { ...c, myReaction: res.myReaction, likeCount: res.likeCount, shakeCount: res.shakeCount }
                : c,
            )
          : prevList,
      );
    } catch (err) {
      // Rollback
      setComments((prevList) =>
        prevList
          ? prevList.map((c) => (c.id === commentId ? { ...c, myReaction: prev.myReaction, likeCount: prev.likeCount, shakeCount: prev.shakeCount } : c))
          : prevList,
      );
      onError(err instanceof Error ? err.message : 'reaction failed');
    }
  };

  const toggleComments = async () => {
    if (expanded) {
      setExpanded(false);
      return;
    }
    setExpanded(true);
    if (comments === null) {
      setLoadingComments(true);
      try {
        const res = await getComments(post.id);
        setComments(res.comments);
      } catch (err) {
        onError(err instanceof Error ? err.message : 'comments failed');
      } finally {
        setLoadingComments(false);
      }
    }
  };

  const submitComment = async () => {
    const text = draft.trim();
    if (!text || posting) return;
    setPosting(true);
    try {
      const res = await addComment(session, post.id, text);
      // The server now returns the comment with author enriched so this
      // append is safe (no undefined `c.author`).
      setComments((prev) => [...(prev || []), res.comment]);
      onPostUpdated({ ...post, commentCount: post.commentCount + 1 });
      setDraft('');
    } catch (err) {
      onError(err instanceof Error ? err.message : 'comment failed');
    } finally {
      setPosting(false);
    }
  };

  // Strip a possible lingering shake class when the post changes identity
  useEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    const onEnd = () => el.classList.remove('ghostline-shake');
    el.addEventListener('animationend', onEnd);
    return () => el.removeEventListener('animationend', onEnd);
  }, [post.id]);

  return (
    <div className="card post-card" ref={cardRef}>
      <div className="post-card-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <IdentityChip
            displayName={post.author.displayName}
            colorHex={post.author.colorHex}
            handle={post.author.handle}
            navigateToProfile={!!post.author.handle && post.author.uid !== session.uid}
            id={`post-${post.id}-author`}
          />
          {post.author.handle && (
            <span className="muted monospace" style={{ fontSize: 11 }}>
              @{post.author.handle}
            </span>
          )}
        </div>
        <span className="post-card-time">{relTime(post.createdAt)}</span>
      </div>

      <div className="post-card-body">{post.text}</div>

      {post.photoUrl && (
        <div className="post-photo">
          <img src={post.photoUrl} alt="" loading="lazy" />
        </div>
      )}

      {post.isAdminPost && (
        <div className="post-badges">
          <span className="badge badge-admin" id={`post-${post.id}-admin-badge`}>
            ⚙️ Admin
          </span>
          {post.pinnedAt && (
            <span className="badge badge-pinned" id={`post-${post.id}-pin-badge`}>
              📌 Pinned
            </span>
          )}
        </div>
      )}

      {post.poll && (
        <Poll poll={post.poll} session={session} onError={onError} />
      )}

      <div className="post-card-footer">
        <button
          className={`react-btn react-like ${post.myReaction === 'like' ? 'active' : ''}`}
          onClick={() => react('like')}
          aria-label="Like"
          aria-pressed={post.myReaction === 'like'}
          disabled={reacting}
          id={`post-${post.id}-like`}
        >
          <span className="react-icon" aria-hidden>👍</span>
          <span className="react-count">{post.likeCount || 0}</span>
        </button>
        <button
          className={`react-btn react-shake ${post.myReaction === 'shake' ? 'active' : ''}`}
          onClick={() => react('shake')}
          aria-label="Shake"
          aria-pressed={post.myReaction === 'shake'}
          disabled={reacting}
          id={`post-${post.id}-shake`}
        >
          <span className="react-icon" aria-hidden>🫨</span>
          <span className="react-count">{post.shakeCount || 0}</span>
        </button>
        <button className="link" onClick={toggleComments} id={`post-${post.id}-comments-toggle`}>
          {expanded ? 'Hide' : '💬'} {post.commentCount > 0 ? post.commentCount : 'Comment'}
        </button>
      </div>

      {expanded && (
        <div className="comment-thread">
          {loadingComments && <p className="muted">Loading…</p>}
          {comments && comments.length === 0 && (
            <p className="muted">No comments yet.</p>
          )}
          {comments && comments.map((c) => (
            <div key={c.id} className="comment" id={`comment-${c.id}`}>
              <div className="comment-header">
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                  <IdentityChip
                    displayName={c.author.displayName}
                    colorHex={c.author.colorHex}
                    handle={c.author.handle}
                    navigateToProfile={!!c.author.handle && c.author.uid !== session.uid}
                    id={`comment-${c.id}-author`}
                  />
                  {c.author.handle && (
                    <span className="muted monospace" style={{ fontSize: 10 }}>
                      @{c.author.handle}
                    </span>
                  )}
                </div>
                <span className="post-card-time">{relTime(c.createdAt)}</span>
              </div>
              <div className="comment-body">{c.text}</div>
              <div className="comment-reactions">
                <button
                  className={`react-btn react-mini react-like ${c.myReaction === 'like' ? 'active' : ''}`}
                  onClick={() => commentReact(c.id, 'like')}
                  aria-label="Like comment"
                  aria-pressed={c.myReaction === 'like'}
                  id={`comment-${c.id}-like`}
                >
                  <span className="react-icon" aria-hidden>👍</span>
                  <span className="react-count">{c.likeCount || 0}</span>
                </button>
                <button
                  className={`react-btn react-mini react-shake ${c.myReaction === 'shake' ? 'active' : ''}`}
                  onClick={() => commentReact(c.id, 'shake')}
                  aria-label="Shake comment"
                  aria-pressed={c.myReaction === 'shake'}
                  id={`comment-${c.id}-shake`}
                >
                  <span className="react-icon" aria-hidden>🫨</span>
                  <span className="react-count">{c.shakeCount || 0}</span>
                </button>
              </div>
            </div>
          ))}

          <div className="comment-composer">
            <textarea
              placeholder="Reply…"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              maxLength={500}
              rows={2}
              id={`post-${post.id}-comment-input`}
            />
            <button
              className="button"
              onClick={submitComment}
              disabled={posting || !draft.trim()}
              id={`post-${post.id}-comment-post`}
            >
              {posting ? 'Posting…' : 'Post'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}