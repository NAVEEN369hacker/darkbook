/**
 * Notifications — activity feed page.
 * Upvotes, comments, mentions, DM requests, system alerts.
 * API-backed, live polling, real read status.
 *
 * Spec: opening this page auto-marks every notification as read, so the
 * user never has to tap a "Mark all read" button.
 */

import { useEffect, useState, useCallback } from 'react';
import type { Session } from '../storage';
import {
  getNotifications,
  markNotifRead,
  markAllNotifsRead,
  Notification,
} from '../api';

type Props = {
  session: Session;
};

const typeIcon: Record<string, string> = {
  upvote: '👍',
  like: '👍',
  shake: '🫨',
  comment: '💬',
  dm: '✉️',
  system: '⚙️',
  reward: '🪙',
};

const typeColor: Record<string, string> = {
  upvote: '#2f81f7',
  like: '#2f81f7',
  shake: '#f97316',
  comment: '#a78bfa',
  dm: '#34d399',
  system: '#8b949e',
  reward: '#fbbf24',
};

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return new Date(iso).toLocaleDateString();
}

export default function Notifications({ session }: Props) {
  const [notifs, setNotifs] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'unread'>('all');

  const fetchNotifs = useCallback(async () => {
    try {
      const res = await getNotifications(session);
      setNotifs(res.notifications);
    } catch (err) {
      console.warn('[Notifications] fetch failed:', err);
    } finally {
      setLoading(false);
    }
  }, [session]);

  // Open the page → fetch + auto-mark all read. The page-level auto-mark
  // replaces the old "Mark all read" button — the unread badge clears the
  // moment the user navigates to /notifications.
  useEffect(() => {
    let cancelled = false;
    const openAndMark = async () => {
      try {
        const res = await getNotifications(session);
        if (cancelled) return;
        setNotifs(res.notifications);
        const hasUnread = res.notifications.some((n) => !n.read);
        if (hasUnread) {
          try {
            await markAllNotifsRead(session);
            if (cancelled) return;
            setNotifs((prev) => prev.map((n) => ({ ...n, read: true })));
          } catch (err) {
            console.warn('[Notifications] auto-mark read failed:', err);
          }
        }
      } catch (err) {
        console.warn('[Notifications] fetch failed:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    openAndMark();
    // Continue polling so new activity shows up. The polling is read-only;
    // the next time the user opens this page, the open-and-mark handler
    // above will clear any newly-arrived unread items.
    const id = setInterval(fetchNotifs, 4000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [fetchNotifs, session]);

  const handleMarkRead = async (id: string) => {
    try {
      await markNotifRead(session, id);
      setNotifs((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
    } catch (err) {
      console.warn('[Notifications] mark read failed:', err);
    }
  };

  const unreadCount = notifs.filter((n) => !n.read).length;
  const visible = filter === 'unread' ? notifs.filter((n) => !n.read) : notifs;

  return (
    <div className="page page-notifications">
      <div className="page-header">
        <h1>
          Notifications
          {unreadCount > 0 && <span className="page-badge">{unreadCount}</span>}
        </h1>
      </div>

      {/* Filter tabs */}
      <div className="notif-tabs">
        <button
          className={`notif-tab ${filter === 'all' ? 'active' : ''}`}
          onClick={() => setFilter('all')}
          id="notif-tab-all"
        >
          All
        </button>
        <button
          className={`notif-tab ${filter === 'unread' ? 'active' : ''}`}
          onClick={() => setFilter('unread')}
          id="notif-tab-unread"
        >
          Unread {unreadCount > 0 && `(${unreadCount})`}
        </button>
      </div>

      {loading && <p className="muted" style={{ padding: '0 20px' }}>Loading notifications…</p>}

      {!loading && visible.length === 0 && (
        <div className="card" style={{ textAlign: 'center', padding: '48px 24px' }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>🔔</div>
          <p className="muted">You're all caught up!</p>
        </div>
      )}

      <div className="notif-list">
        {visible.map((notif) => (
          <button
            key={notif.id}
            className={`notif-row ${notif.read ? '' : 'unread'}`}
            onClick={() => handleMarkRead(notif.id)}
            id={`notif-${notif.id}`}
          >
            {/* Left icon */}
            <div
              className="notif-icon"
              style={{
                background: (typeColor[notif.type] || '#8b949e') + '22',
                color: typeColor[notif.type] || '#8b949e',
              }}
            >
              {notif.actorName && notif.actorColor ? (
                <div
                  className="identity-dot"
                  style={{ background: notif.actorColor, width: 36, height: 36 }}
                />
              ) : (
                <span style={{ fontSize: 18 }}>{typeIcon[notif.type] || '🔔'}</span>
              )}
            </div>

            {/* Content */}
            <div className="notif-content">
              <p className="notif-text">
                {notif.actorName && (
                  <strong style={{ color: notif.actorColor || '#e6edf3' }}>
                    {notif.actorName}{' '}
                  </strong>
                )}
                {notif.text}
              </p>
              <span className="notif-time">{timeAgo(notif.createdAt)}</span>
            </div>

            {/* Unread dot */}
            {!notif.read && <span className="notif-unread-dot" />}
          </button>
        ))}
      </div>
    </div>
  );
}
