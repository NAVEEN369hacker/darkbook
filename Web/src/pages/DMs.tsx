/**
 * DMs — real direct messages, fetched from /api/dms/by-handle/:handle.
 * All DM routing is handle-based; uid is internal-only. Polls for new
 * messages every 5 s while the page is open.
 */

import { useEffect, useState, useRef, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import type { Session } from '../storage';
import type { DMConversation, DMThread } from '../api';
import {
  getConversations,
  getThread,
  sendDM,
  markDMRead,
} from '../api';

type Props = {
  session: Session;
};

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return new Date(iso).toLocaleDateString();
}

export default function DMs({ session }: Props) {
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const toFromQuery = (params.get('to') || '').replace(/^@/, '');

  const [conversations, setConversations] = useState<DMConversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Chat state
  const [thread, setThread] = useState<DMThread | null>(null);
  const [chatLoading, setChatLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);

  // New DM state — keyed by handle, the user-facing identifier.
  const [composing, setComposing] = useState(false);
  const [newHandle, setNewHandle] = useState(toFromQuery);
  const [newText, setNewText] = useState('');

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // If the URL carries ?to=handle (e.g. arrived from a profile page's
  // Message button), drop into the composer pre-filled with that handle.
  useEffect(() => {
    if (toFromQuery) {
      setComposing(true);
      setNewHandle(toFromQuery);
    }
  }, [toFromQuery]);

  // ── conversation list ──────────────────────────────────────
  const fetchConversations = useCallback(async () => {
    try {
      const data = await getConversations(session);
      setConversations(data.conversations);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load DMs');
    } finally {
      setLoading(false);
    }
  }, [session]);

  useEffect(() => {
    fetchConversations();
    const id = setInterval(fetchConversations, 5000);
    return () => clearInterval(id);
  }, [fetchConversations]);

  // ── thread polling by handle ───────────────────────────────
  const fetchThread = useCallback(async (partnerHandle: string) => {
    try {
      const data = await getThread(session, partnerHandle);
      setThread(data);
    } catch (e) {
      /* ignore silent poll errors */
    }
  }, [session]);

  useEffect(() => {
    if (!thread) {
      if (pollRef.current) clearInterval(pollRef.current);
      return;
    }
    const handleForPoll = thread.partnerHandle || thread.partnerUid;
    pollRef.current = setInterval(() => fetchThread(handleForPoll), 5000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [thread, fetchThread]);

  // Scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [thread?.messages]);

  // ── open conversation by handle ────────────────────────────
  const openConversation = async (partnerHandle: string) => {
    setChatLoading(true);
    setThread(null);
    try {
      await markDMRead(session, partnerHandle);
      const data = await getThread(session, partnerHandle);
      setThread(data);
      // Refresh conversation list so unread count clears
      fetchConversations();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to open conversation');
    } finally {
      setChatLoading(false);
    }
  };

  // ── send message in open thread (by handle) ────────────────
  const sendMessage = async () => {
    const text = message.trim();
    if (!text || sending || !thread) return;
    const target = thread.partnerHandle || thread.partnerUid;
    if (!target) return;
    setSending(true);
    try {
      const { message: newMsg } = await sendDM(session, target, text);
      setThread((prev) =>
        prev ? { ...prev, messages: [...prev.messages, newMsg] } : prev,
      );
      setMessage('');
      fetchConversations();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Send failed');
    } finally {
      setSending(false);
    }
  };

  // ── send first DM (new conversation by handle) ─────────────
  const sendNewDM = async () => {
    const handle = newHandle.trim().replace(/^@/, '');
    const text = newText.trim();
    if (!handle || !text) return;
    setSending(true);
    try {
      await sendDM(session, handle, text);
      setComposing(false);
      setNewHandle('');
      setNewText('');
      await fetchConversations();
      await openConversation(handle);
    } catch (e) {
      setError(e instanceof Error ? e.message : e instanceof Error && e.message.includes('no active user') ? 'No active user with that handle today.' : 'Send failed');
    } finally {
      setSending(false);
    }
  };

  // ── Chat view ──────────────────────────────────────────────
  if (chatLoading) {
    return (
      <div className="page page-dms">
        <p className="muted" style={{ padding: 20 }}>Loading conversation…</p>
      </div>
    );
  }

  if (thread) {
    return (
      <div className="page page-dms">
        <div className="dm-chat-header">
          <button className="dm-back-btn" onClick={() => setThread(null)} id="dm-back-btn">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6"/>
            </svg>
          </button>
          <div className="dm-chat-identity">
            <div
              className="identity-dot"
              style={{ background: thread.partnerColor, width: 36, height: 36 }}
            />
            <div>
              <div className="dm-chat-name">{thread.partnerName}</div>
              <div className="dm-chat-status" style={{ fontSize: 11 }}>
                {thread.partnerHandle ? (
                  <span className="monospace">@{thread.partnerHandle}</span>
                ) : (
                  <span className="muted">no handle</span>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="dm-messages" id="dm-messages">
          {thread.messages.length === 0 && (
            <p className="muted" style={{ textAlign: 'center', marginTop: 32 }}>
              No messages yet. Say hello! 👋
            </p>
          )}
          {thread.messages.map((msg) => {
            const mine = msg.fromUid === session.uid;
            return (
              <div key={msg.id} className={`dm-message ${mine ? 'mine' : 'theirs'}`}>
                {!mine && (
                  <div
                    className="identity-dot"
                    style={{ background: thread.partnerColor, width: 28, height: 28, flexShrink: 0 }}
                  />
                )}
                <div className="dm-bubble">
                  <span>{msg.text}</span>
                  <span className="dm-msg-time">
                    <span>{timeAgo(msg.createdAt)}</span>
                    {mine && (
                      <span
                        className={`dm-read-tick ${msg.read ? 'seen' : 'sent'}`}
                        title={msg.read ? `Seen ${msg.readAt ? timeAgo(msg.readAt) : ''}` : 'Sent'}
                      >
                        {msg.read ? '✓✓' : '✓'}
                      </span>
                    )}
                  </span>
                </div>
              </div>
            );
          })}
          <div ref={messagesEndRef} />
        </div>

        <div className="dm-composer">
          <input
            className="dm-input"
            placeholder="Message anonymously…"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && sendMessage()}
            id="dm-message-input"
            maxLength={1000}
          />
          <button
            className="dm-send-btn"
            onClick={sendMessage}
            disabled={!message.trim() || sending}
            id="dm-send-btn"
          >
            {sending ? (
              <span style={{ fontSize: 14 }}>…</span>
            ) : (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="22" y1="2" x2="11" y2="13"/>
                <polygon points="22 2 15 22 11 13 2 9 22 2"/>
              </svg>
            )}
          </button>
        </div>

        {error && (
          <div className="toast" style={{ bottom: 80 }}>{error}</div>
        )}
      </div>
    );
  }

  // ── New DM composer overlay ────────────────────────────────
  if (composing) {
    return (
      <div className="page page-dms">
        <div className="dm-chat-header">
          <button className="dm-back-btn" onClick={() => setComposing(false)}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6"/>
            </svg>
          </button>
          <div className="dm-chat-name">New Message</div>
        </div>
        <div style={{ padding: '20px' }}>
          <div className="field">
            <label className="muted" style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: 1 }}>
              Recipient Handle
            </label>
            <input
              className="dm-input"
              style={{ borderRadius: 8 }}
              placeholder="@blue_panda_42"
              value={newHandle}
              onChange={(e) => setNewHandle(e.target.value)}
              id="new-dm-handle-input"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
            />
            <span className="muted" style={{ fontSize: 11 }}>
              Enter the recipient's public handle (e.g. <span className="monospace">@blue_panda_42</span>).
              It stays the same for the entire day, even if they log out and back in.
            </span>
          </div>
          <div className="field" style={{ marginTop: 16 }}>
            <label className="muted" style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: 1 }}>
              Message
            </label>
            <textarea
              className="dm-input"
              style={{ borderRadius: 8, minHeight: 100, resize: 'vertical' }}
              placeholder="What do you want to say?"
              value={newText}
              onChange={(e) => setNewText(e.target.value)}
              id="new-dm-text-input"
            />
          </div>
          <button
            className="button"
            style={{ marginTop: 8 }}
            onClick={sendNewDM}
            disabled={!newHandle.trim() || !newText.trim() || sending}
            id="new-dm-send-btn"
          >
            {sending ? 'Sending…' : 'Send Message'}
          </button>
          {error && <p style={{ color: 'var(--danger)', marginTop: 12, fontSize: 13 }}>{error}</p>}
        </div>
      </div>
    );
  }

  // ── Conversation list ──────────────────────────────────────
  return (
    <div className="page page-dms">
      <div className="page-header">
        <h1>Messages</h1>
        <button
          className="icon-btn"
          title="New message"
          onClick={() => setComposing(true)}
          id="dm-new-btn"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19"/>
            <line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
        </button>
      </div>

      {loading && <p className="muted" style={{ padding: '0 20px' }}>Loading…</p>}
      {!loading && conversations.length === 0 && (
        <div className="card" style={{ margin: '0 20px', textAlign: 'center', padding: '48px 24px' }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>💬</div>
          <p className="muted">No messages yet.</p>
          <p className="muted" style={{ fontSize: 12 }}>
            Tap <strong>+</strong> to start a conversation using someone's handle.
          </p>
        </div>
      )}

      <div className="dm-list">
        {conversations.map((conv) => (
          <button
            key={conv.partnerUid}
            className={`dm-row ${conv.unread > 0 ? 'has-unread' : ''}`}
            onClick={() => openConversation(conv.partnerHandle || conv.partnerUid)}
            id={`dm-row-${(conv.partnerHandle || conv.partnerUid).slice(-8)}`}
          >
            <div className="dm-avatar-wrap">
              <div
                className="identity-dot"
                style={{ background: conv.partnerColor, width: 48, height: 48 }}
              />
            </div>
            <div className="dm-info">
              <div className="dm-top-row">
                <span className="dm-name">
                  {conv.partnerName}
                  {conv.partnerHandle && (
                    <span className="muted monospace" style={{ fontSize: 11, marginLeft: 6 }}>
                      @{conv.partnerHandle}
                    </span>
                  )}
                </span>
                <span className="dm-time">{timeAgo(conv.lastMessageAt)}</span>
              </div>
              <div className="dm-preview-row">
                <span className="dm-preview">{conv.lastMessage}</span>
                {conv.unread > 0 && (
                  <span className="dm-unread-badge">{conv.unread}</span>
                )}
              </div>
            </div>
          </button>
        ))}
      </div>

      {/* Your identity */}
      <div className="dm-your-identity">
        <div className="card" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div
            className="identity-dot"
            style={{ background: session.colorHex, width: 40, height: 40 }}
          />
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontWeight: 600 }}>{session.displayName}</div>
            {session.handle ? (
              <div className="muted monospace" style={{ fontSize: 12 }}>
                @{session.handle}
              </div>
            ) : (
              <div className="muted monospace" style={{ fontSize: 11 }}>
                UID: {session.uid.slice(0, 16)}…
              </div>
            )}
          </div>
        </div>
      </div>

      {error && <div className="toast">{error}</div>}
    </div>
  );
}