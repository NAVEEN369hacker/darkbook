/**
 * Arena — Instagram-Style Debate Stream with Per-Party Colors.
 *
 * Daily debate topics with multiple parties. Arguments are displayed as a
 * unified Instagram-style comment stream with distinct per-party color badges,
 * party-tinted text boxes, and nested reply threading.
 */

import { useEffect, useState, useCallback } from 'react';
import type { Session } from '../storage';
import type { ArenaTopic, ArenaPost, Party } from '../types';
import { listArenaTopics, getArenaTopic, postArenaArgument } from '../api';
import IdentityChip from '../components/IdentityChip';

type Props = {
  session: Session;
  onError: (msg: string) => void;
};

// Distinct Theme Colors for Parties (Blue, Coral, Green, Purple, Amber, Pink)
const PARTY_THEMES = [
  { badgeBg: 'rgba(255, 214, 10, 0.18)', badgeColor: '#FFD60A', border: 'rgba(255, 214, 10, 0.45)', cardBg: 'rgba(255, 214, 10, 0.06)' },
  { badgeBg: 'rgba(224, 122, 95, 0.2)', badgeColor: '#ff7b72', border: 'rgba(224, 122, 95, 0.45)', cardBg: 'rgba(224, 122, 95, 0.06)' },
  { badgeBg: 'rgba(46, 160, 67, 0.2)', badgeColor: '#3fb950', border: 'rgba(46, 160, 67, 0.45)', cardBg: 'rgba(46, 160, 67, 0.06)' },
  { badgeBg: 'rgba(131, 56, 236, 0.2)', badgeColor: '#a371f7', border: 'rgba(131, 56, 236, 0.45)', cardBg: 'rgba(131, 56, 236, 0.06)' },
  { badgeBg: 'rgba(245, 158, 11, 0.2)', badgeColor: '#d29922', border: 'rgba(245, 158, 11, 0.45)', cardBg: 'rgba(245, 158, 11, 0.06)' },
  { badgeBg: 'rgba(244, 63, 94, 0.2)', badgeColor: '#fb7185', border: 'rgba(244, 63, 94, 0.45)', cardBg: 'rgba(244, 63, 94, 0.06)' },
];

function getPartyTheme(parties: Party[], partyId: string) {
  const party = parties.find((p) => p.id === partyId);
  const index = parties.findIndex((p) => p.id === partyId);
  const fallback = PARTY_THEMES[(index >= 0 ? index : 0) % PARTY_THEMES.length];
  
  if (party && party.colorHex) {
    const hex = party.colorHex.replace(/^#/, '');
    const r = parseInt(hex.slice(0, 2), 16) || 255;
    const g = parseInt(hex.slice(2, 4), 16) || 214;
    const b = parseInt(hex.slice(4, 6), 16) || 10;
    return {
      badgeBg: `rgba(${r}, ${g}, ${b}, 0.2)`,
      badgeColor: party.colorHex,
      border: `rgba(${r}, ${g}, ${b}, 0.45)`,
      cardBg: `rgba(${r}, ${g}, ${b}, 0.06)`,
    };
  }
  return fallback;
}

function relTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

export default function Arena({ session, onError }: Props) {
  const [topics, setTopics] = useState<ArenaTopic[] | null>(null);
  const [selected, setSelected] = useState<ArenaTopic | null>(null);
  const [posts, setPosts] = useState<ArenaPost[] | null>(null);
  const [loadingTopic, setLoadingTopic] = useState(false);
  const [draft, setDraft] = useState('');
  const [selectedParty, setSelectedParty] = useState<string>('');
  const [activeFilterParty, setActiveFilterParty] = useState<string>('all');
  const [replyTargetId, setReplyTargetId] = useState<string | null>(null);
  const [replyPartyId, setReplyPartyId] = useState<string>('');
  const [replyDraft, setReplyDraft] = useState('');
  const [posting, setPosting] = useState(false);

  const refreshList = useCallback(async () => {
    try {
      const res = await listArenaTopics();
      setTopics(res.topics);
      if (selected) {
        const stillThere = res.topics.find((t) => t.id === selected.id);
        if (!stillThere) setSelected(null);
      }
    } catch (err) {
      onError(err instanceof Error ? err.message : 'failed to load arena');
    }
  }, [onError, selected]);

  useEffect(() => {
    refreshList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openTopic = async (topic: ArenaTopic) => {
    setSelected(topic);
    setPosts(null);
    setDraft('');
    setReplyTargetId(null);
    setReplyDraft('');
    setActiveFilterParty('all');
    setSelectedParty(topic.parties[0]?.id || '');
    setLoadingTopic(true);
    try {
      const res = await getArenaTopic(topic.id);
      setSelected(res.topic);
      setPosts(res.posts);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'failed to load topic');
    } finally {
      setLoadingTopic(false);
    }
  };

  const submitArgument = async (partyId: string, text: string, parentId?: string) => {
    if (!selected || !partyId || !text.trim() || posting) return;
    setPosting(true);
    try {
      const res = await postArenaArgument(session, selected.id, partyId, text.trim(), parentId);
      setPosts((prev) => [...(prev || []), res.post]);
      setSelected((s) =>
        s
          ? {
              ...s,
              postsByParty: {
                ...s.postsByParty,
                [partyId]: (s.postsByParty[partyId] || 0) + 1,
              },
            }
          : s,
      );
      if (parentId) {
        setReplyTargetId(null);
        setReplyDraft('');
      } else {
        setDraft('');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'failed to post argument';
      onError(msg);
    } finally {
      setPosting(false);
    }
  };

  if (topics === null) {
    return (
      <div className="page page-arena">
        <p className="muted">Loading arena…</p>
      </div>
    );
  }

  return (
    <div className="page page-arena">
      <h1 style={{ margin: '0 0 4px' }}>⚔️ Arena</h1>
      <p className="muted" style={{ margin: '0 0 16px' }}>
        Daily debates with distinct party colors. Topics refresh at UTC midnight.
      </p>

      {!selected && (
        <div className="arena-topics">
          {topics.length === 0 && (
            <div className="card">
              <p className="muted" style={{ margin: 0 }}>
                No active topics right now. Check back after the admin posts today's lineup.
              </p>
            </div>
          )}
          {topics.map((t) => (
            <button
              key={t.id}
              className="arena-topic-card"
              onClick={() => openTopic(t)}
              id={`arena-topic-${t.id}`}
            >
              <div className="arena-topic-title">{t.title}</div>
              <div className="arena-topic-meta">
                {t.parties.length} parties · {Object.values(t.postsByParty || {}).reduce((a, b) => a + b, 0)} arguments
              </div>
              <div className="arena-topic-parties">
                {t.parties.map((p) => {
                  const theme = getPartyTheme(t.parties, p.id);
                  return (
                    <span
                      key={p.id}
                      className="arena-party-pill"
                      style={{
                        background: theme.badgeBg,
                        color: theme.badgeColor,
                        border: `1px solid ${theme.border}`,
                      }}
                    >
                      <span>{p.emoji}</span> {p.label}
                    </span>
                  );
                })}
              </div>
            </button>
          ))}
        </div>
      )}

      {selected && (
        <div className="arena-detail">
          <button
            className="link"
            onClick={() => {
              setSelected(null);
              setPosts(null);
            }}
            id="arena-back-btn"
            style={{ marginBottom: 8 }}
          >
            ← Back to topics
          </button>

          <div className="card">
            <h2 style={{ marginTop: 0 }}>{selected.title}</h2>
            {selected.description && (
              <p className="muted" style={{ margin: '8px 0 0' }}>
                {selected.description}
              </p>
            )}
          </div>

          {/* Filter Bar: All or per-party */}
          <div className="arena-filter-bar">
            <button
              type="button"
              className={`arena-filter-pill ${activeFilterParty === 'all' ? 'active' : ''}`}
              onClick={() => setActiveFilterParty('all')}
            >
              All Arguments ({posts?.length || 0})
            </button>
            {selected.parties.map((party) => {
              const theme = getPartyTheme(selected.parties, party.id);
              const count = selected.postsByParty?.[party.id] || 0;
              const isSelected = activeFilterParty === party.id;
              return (
                <button
                  key={party.id}
                  type="button"
                  className={`arena-filter-pill ${isSelected ? 'active' : ''}`}
                  onClick={() => setActiveFilterParty(party.id)}
                  style={
                    isSelected
                      ? {
                          background: theme.badgeBg,
                          color: theme.badgeColor,
                          border: `1px solid ${theme.border}`,
                        }
                      : {}
                  }
                >
                  <span>{party.emoji}</span> {party.label} ({count})
                </button>
              );
            })}
          </div>

          {/* Instagram-Style Comment Stream */}
          <div className="arena-comment-stream">
            {loadingTopic && <p className="muted">Loading arguments…</p>}

            {posts && (
              <>
                {posts.filter(
                  (p) =>
                    !p.parentId &&
                    (activeFilterParty === 'all' || p.partyId === activeFilterParty),
                ).length === 0 && (
                  <p className="muted" style={{ fontSize: 13, padding: '12px 0' }}>
                    No arguments in this stream yet. Be the first to argue!
                  </p>
                )}

                {posts
                  .filter((p) => !p.parentId)
                  .filter((p) => activeFilterParty === 'all' || p.partyId === activeFilterParty)
                  .map((post) => {
                    const party = selected.parties.find((pt) => pt.id === post.partyId);
                    const theme = getPartyTheme(selected.parties, post.partyId);
                    const replies = posts.filter((r) => r.parentId === post.id);

                    return (
                      <div
                        key={post.id}
                        className="arena-comment-card"
                        style={{
                          background: theme.cardBg,
                          borderLeft: `3px solid ${theme.badgeColor}`,
                          borderColor: theme.border,
                        }}
                        id={`arena-post-${post.id}`}
                      >
                        <div className="arena-comment-header">
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <IdentityChip
                              displayName={post.author.displayName}
                              colorHex={post.author.colorHex}
                              handle={post.author.handle}
                              navigateToProfile={
                                !!post.author.handle && post.author.uid !== session.uid
                              }
                              id={`arena-post-${post.id}-author`}
                            />
                            {post.author.handle && (
                              <span className="muted monospace" style={{ fontSize: 11 }}>
                                @{post.author.handle}
                              </span>
                            )}
                            <span className="post-card-time">{relTime(post.createdAt)}</span>
                          </div>

                          {party && (
                            <span
                              className="arena-party-badge-pill"
                              style={{
                                background: theme.badgeBg,
                                color: theme.badgeColor,
                                border: `1px solid ${theme.border}`,
                              }}
                            >
                              <span>{party.emoji}</span> {party.label}
                            </span>
                          )}
                        </div>

                        <div className="arena-comment-text">{post.text}</div>

                        <div className="arena-comment-footer">
                          <button
                            type="button"
                            className="link-btn"
                            onClick={() => {
                              if (replyTargetId === post.id) {
                                setReplyTargetId(null);
                              } else {
                                setReplyTargetId(post.id);
                                setReplyPartyId(post.partyId || selected.parties[0]?.id || '');
                              }
                            }}
                          >
                            💬 Reply
                          </button>
                        </div>

                        {/* Inline Reply Composer */}
                        {replyTargetId === post.id && (
                          <div className="arena-reply-composer card">
                            <div style={{ marginBottom: 8 }}>
                              <span className="muted" style={{ fontSize: 11, display: 'block', marginBottom: 4 }}>Select reply category:</span>
                              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                                {selected.parties.map((pt) => {
                                  const ptTheme = getPartyTheme(selected.parties, pt.id);
                                  const isSel = (replyPartyId || post.partyId) === pt.id;
                                  return (
                                    <button
                                      key={pt.id}
                                      type="button"
                                      className="arena-party-pill"
                                      onClick={() => setReplyPartyId(pt.id)}
                                      style={{
                                        background: isSel ? ptTheme.badgeBg : 'transparent',
                                        color: isSel ? ptTheme.badgeColor : 'var(--text-muted)',
                                        border: `1px solid ${isSel ? ptTheme.border : 'var(--border)'}`,
                                        fontWeight: isSel ? 700 : 400,
                                        cursor: 'pointer',
                                        fontSize: 12,
                                        padding: '4px 10px',
                                      }}
                                    >
                                      <span>{pt.emoji}</span> {pt.label}
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                            <textarea
                              placeholder={`Reply to @${post.author.handle || post.author.displayName}…`}
                              value={replyDraft}
                              onChange={(e) => setReplyDraft(e.target.value)}
                              maxLength={1000}
                              rows={2}
                            />
                            <div className="composer-row">
                              <span className="muted">{replyDraft.length}/1000</span>
                              <div style={{ display: 'flex', gap: 8 }}>
                                <button
                                  type="button"
                                  className="button ghost"
                                  onClick={() => setReplyTargetId(null)}
                                >
                                  Cancel
                                </button>
                                <button
                                  type="button"
                                  className="button"
                                  disabled={posting || !replyDraft.trim()}
                                  onClick={() =>
                                    submitArgument(replyPartyId || post.partyId, replyDraft.trim(), post.id)
                                  }
                                >
                                  {posting ? 'Replying…' : 'Reply'}
                                </button>
                              </div>
                            </div>
                          </div>
                        )}

                        {/* Threaded Nested Replies */}
                        {replies.length > 0 && (
                          <div className="arena-replies-list">
                            {replies.map((reply) => {
                              const rParty = selected.parties.find((pt) => pt.id === reply.partyId);
                              const rTheme = getPartyTheme(selected.parties, reply.partyId);
                              return (
                                <div
                                  key={reply.id}
                                  className="arena-comment-card reply"
                                  style={{
                                    background: rTheme.cardBg,
                                    borderLeft: `3px solid ${rTheme.badgeColor}`,
                                    borderColor: rTheme.border,
                                  }}
                                  id={`arena-reply-${reply.id}`}
                                >
                                  <div className="arena-comment-header">
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                      <IdentityChip
                                        displayName={reply.author.displayName}
                                        colorHex={reply.author.colorHex}
                                        handle={reply.author.handle}
                                        navigateToProfile={
                                          !!reply.author.handle && reply.author.uid !== session.uid
                                        }
                                      />
                                      {reply.author.handle && (
                                        <span className="muted monospace" style={{ fontSize: 10 }}>
                                          @{reply.author.handle}
                                        </span>
                                      )}
                                      <span className="post-card-time">{relTime(reply.createdAt)}</span>
                                    </div>

                                    {rParty && (
                                      <span
                                        className="arena-party-badge-pill mini"
                                        style={{
                                          background: rTheme.badgeBg,
                                          color: rTheme.badgeColor,
                                          border: `1px solid ${rTheme.border}`,
                                        }}
                                      >
                                        <span>{rParty.emoji}</span> {rParty.label}
                                      </span>
                                    )}
                                  </div>
                                  <div className="arena-comment-text">{reply.text}</div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
              </>
            )}
          </div>

          {/* Main Argument Composer */}
          <div className="card arena-composer" style={{ marginTop: 24 }}>
            <h3 style={{ marginTop: 0 }}>Post a New Argument</h3>
            <p className="muted" style={{ fontSize: 13, margin: '0 0 10px' }}>
              Choose your side to assign your argument's party color, then write your case.
              Posting costs <strong style={{ color: 'var(--gold)' }}>10 coins</strong>.
            </p>
            <div className="arena-party-chooser">
              {selected.parties.map((p) => {
                const theme = getPartyTheme(selected.parties, p.id);
                const isSelected = selectedParty === p.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    className={`arena-party-pill selectable ${isSelected ? 'selected' : ''}`}
                    onClick={() => setSelectedParty(p.id)}
                    style={
                      isSelected
                        ? {
                            background: theme.badgeBg,
                            color: theme.badgeColor,
                            border: `2px solid ${theme.badgeColor}`,
                            boxShadow: `0 0 8px ${theme.badgeBg}`,
                          }
                        : {}
                    }
                    id={`arena-party-${p.id}`}
                  >
                    <span>{p.emoji}</span> {p.label}
                  </button>
                );
              })}
            </div>
            <textarea
              placeholder={`Write argument for ${selected.parties.find((p) => p.id === selectedParty)?.label || '…'}`}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              maxLength={1000}
              rows={3}
              id="arena-argument-input"
            />
            <div className="composer-row">
              <span className="muted">{draft.length}/1000</span>
              <button
                className="button"
                onClick={() => submitArgument(selectedParty, draft)}
                disabled={posting || !draft.trim() || !selectedParty}
                id="arena-argument-post-btn"
              >
                {posting ? 'Posting…' : 'Post Argument (10 🪙)'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}