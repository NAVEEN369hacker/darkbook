/**
 * Admin Console — admin-only tools.
 *
 * Tabs:
 *   Users     — list devices + create a brand-new user
 *   Arena     — list today's topics + create a new topic with parties
 *   Posts     — compose admin post (text + optional photo + optional poll + pin)
 *
 * All actions require an admin device (isAdmin=true). The server enforces this
 * via requireAdmin() — this client guards with a similar check on mount.
 */

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Session } from '../storage';
import { me } from '../api';
import {
  adminCreateUser, adminListDevices,
  adminCreatePost, adminPinPost, adminDeletePost,
  adminCreateArenaTopic,
  listArenaTopics,
} from '../api';
import type { AdminDevice, AdminCreatedUser, ArenaTopic, Post } from '../types';
import ImageUploader from '../components/ImageUploader';

type Props = {
  session: Session;
  onError: (msg: string) => void;
};

type Tab = 'users' | 'arena' | 'posts';

export default function Admin({ session, onError }: Props) {
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>('users');
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const m = await me(session);
        if (!m.isAdmin) {
          setIsAdmin(false);
          navigate('/account');
        } else {
          setIsAdmin(true);
        }
      } catch {
        setIsAdmin(false);
        navigate('/account');
      }
    })();
  }, [session, navigate]);

  if (isAdmin !== true) {
    return (
      <div className="page">
        <p className="muted">Checking admin status…</p>
      </div>
    );
  }

  return (
    <div className="page page-admin">
      <h1 style={{ margin: '0 0 4px' }}>⚙️ Admin Console</h1>
      <p className="muted" style={{ margin: '0 0 16px' }}>
        You are signed in as an admin device. Changes here go live immediately.
      </p>

      <div className="notif-tabs">
        <button
          className={`notif-tab ${tab === 'users' ? 'active' : ''}`}
          onClick={() => setTab('users')}
          id="admin-tab-users"
        >
          Users
        </button>
        <button
          className={`notif-tab ${tab === 'arena' ? 'active' : ''}`}
          onClick={() => setTab('arena')}
          id="admin-tab-arena"
        >
          Arena
        </button>
        <button
          className={`notif-tab ${tab === 'posts' ? 'active' : ''}`}
          onClick={() => setTab('posts')}
          id="admin-tab-posts"
        >
          Posts
        </button>
      </div>

      {tab === 'users' && <UsersTab session={session} onError={onError} />}
      {tab === 'arena' && <ArenaTab session={session} onError={onError} />}
      {tab === 'posts' && <PostsTab session={session} onError={onError} />}
    </div>
  );
}

function UsersTab({ session, onError }: Props) {
  const [devices, setDevices] = useState<AdminDevice[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [colorHex, setColorHex] = useState('');
  const [created, setCreated] = useState<AdminCreatedUser | null>(null);

  const refresh = async () => {
    try {
      const res = await adminListDevices(session);
      setDevices(res.devices);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'failed to load devices');
    }
  };

  useEffect(() => { refresh(); /* eslint-disable-next-line */ }, []);

  const handleCreate = async () => {
    setCreating(true);
    setCreated(null);
    try {
      const res = await adminCreateUser(session, {
        displayName: displayName.trim() || undefined,
        colorHex: colorHex.trim() || undefined,
      });
      setCreated(res);
      setDisplayName('');
      setColorHex('');
      await refresh();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'failed to create user');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="admin-section">
      <h2>Create a new user</h2>
      <div className="card">
        <label className="field">
          <span className="muted">Display name (optional — animal+adjective pair if blank)</span>
          <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={40} />
        </label>
        <label className="field">
          <span className="muted">Color hex (optional, e.g. #2f81f7)</span>
          <input value={colorHex} onChange={(e) => setColorHex(e.target.value)} placeholder="#xxxxxx" maxLength={7} />
        </label>
        <button className="button" onClick={handleCreate} disabled={creating} id="admin-create-user-btn">
          {creating ? 'Creating…' : 'Create user'}
        </button>
      </div>

      {created && (
        <div className="card" style={{ borderColor: 'var(--gold)', background: 'var(--gold-soft)' }} id="admin-created-user-card">
          <h3 style={{ marginTop: 0, color: 'var(--gold)' }}>User created ✓</h3>
          <p className="muted" style={{ marginTop: 0 }}>
            Share these credentials with the new user. They will not be shown again.
          </p>
          <div className="account-info-row">
            <span className="account-info-label">Device ID</span>
            <span className="account-info-value monospace">{created.did}</span>
          </div>
          <div className="account-info-row">
            <span className="account-info-label">Handle</span>
            <span className="account-info-value monospace">@{created.handle}</span>
          </div>
          <div className="account-info-row">
            <span className="account-info-label">Display name</span>
            <span className="account-info-value">{created.displayName}</span>
          </div>
          <div className="account-info-row">
            <span className="account-info-label">Password</span>
            <span className="account-info-value monospace" style={{ color: 'var(--gold)', fontWeight: 700 }}>
              {created.password}
            </span>
          </div>
          <div className="account-info-row">
            <span className="account-info-label">Access token</span>
            <span className="account-info-value monospace" style={{ fontSize: 11, wordBreak: 'break-all' }}>
              {created.accessToken.slice(0, 24)}…
            </span>
          </div>
        </div>
      )}

      <h2 style={{ marginTop: 24 }}>All devices ({devices?.length ?? '…'})</h2>
      {devices === null && <p className="muted">Loading…</p>}
      {devices && devices.length === 0 && <p className="muted">No devices yet.</p>}
      {devices && devices.map((d) => (
        <div key={d.did} className="account-info-row" id={`admin-device-${d.did}`}>
          <span className="account-info-value">
            <strong>{d.displayName || d.did.slice(0, 16)}</strong>
            {d.handle && <span className="muted"> · @{d.handle}</span>}
          </span>
          <span className="account-info-label">
            {d.isAdmin && <span className="badge badge-admin" style={{ marginRight: 6 }}>Admin</span>}
            <span className="monospace" style={{ fontSize: 11 }}>{d.did.slice(0, 12)}…</span>
          </span>
        </div>
      ))}
    </div>
  );
}

function ArenaTab({ session, onError }: Props) {
  const [topics, setTopics] = useState<ArenaTopic[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const PRESET_COLORS = ['#FFD60A', '#FF7B72', '#3FB950', '#A371F7', '#D29922', '#FB7185'];
  const [parties, setParties] = useState<{ label: string; emoji: string; colorHex: string }[]>([
    { label: 'Yes', emoji: '✅', colorHex: '#3FB950' },
    { label: 'No', emoji: '❌', colorHex: '#FF7B72' },
  ]);

  const refresh = async () => {
    try {
      const res = await listArenaTopics();
      setTopics(res.topics);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'failed to load topics');
    }
  };

  useEffect(() => { refresh(); /* eslint-disable-next-line */ }, []);

  const handleCreate = async () => {
    if (!title.trim() || parties.length < 2 || parties.some((p) => !p.label.trim())) return;
    setCreating(true);
    try {
      await adminCreateArenaTopic(session, {
        title: title.trim(),
        description: description.trim() || undefined,
        parties: parties.filter((p) => p.label.trim()),
      });
      setTitle('');
      setDescription('');
      setParties([{ label: 'Yes', emoji: '✅', colorHex: '#3FB950' }, { label: 'No', emoji: '❌', colorHex: '#FF7B72' }]);
      await refresh();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'failed to create topic');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="admin-section">
      <h2>Create a new arena topic</h2>
      <div className="card">
        <label className="field">
          <span className="muted">Title</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} placeholder="Should social media ban anonymous accounts?" />
        </label>
        <label className="field">
          <span className="muted">Description (optional)</span>
          <input value={description} onChange={(e) => setDescription(e.target.value)} maxLength={1000} />
        </label>
        <div className="field">
          <span className="muted">Parties (2–6 with category color)</span>
          {parties.map((p, i) => (
            <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 6, alignItems: 'center' }}>
              <input
                type="color"
                style={{ width: 36, height: 36, padding: 2, cursor: 'pointer', borderRadius: 6, border: '1px solid var(--border)' }}
                value={p.colorHex || PRESET_COLORS[i % PRESET_COLORS.length]}
                onChange={(e) => {
                  const next = [...parties];
                  next[i] = { ...next[i], colorHex: e.target.value };
                  setParties(next);
                }}
                title="Category Color"
              />
              <input
                style={{ width: 50 }}
                value={p.emoji}
                onChange={(e) => {
                  const next = [...parties];
                  next[i] = { ...next[i], emoji: e.target.value };
                  setParties(next);
                }}
                maxLength={4}
                placeholder="⚖️"
              />
              <input
                style={{ flex: 1 }}
                value={p.label}
                onChange={(e) => {
                  const next = [...parties];
                  next[i] = { ...next[i], label: e.target.value };
                  setParties(next);
                }}
                placeholder={`Party ${i + 1} label`}
                maxLength={80}
              />
              {parties.length > 2 && (
                <button
                  type="button"
                  className="link"
                  onClick={() => setParties(parties.filter((_, j) => j !== i))}
                  id={`admin-remove-party-${i}`}
                >
                  Remove
                </button>
              )}
            </div>
          ))}
          {parties.length < 6 && (
            <button
              type="button"
              className="link"
              onClick={() => setParties([...parties, { label: '', emoji: '⚖️', colorHex: PRESET_COLORS[parties.length % PRESET_COLORS.length] }])}
              id="admin-add-party-btn"
            >
              + Add another party
            </button>
          )}
        </div>
        <button
          className="button"
          onClick={handleCreate}
          disabled={creating || !title.trim() || parties.length < 2 || parties.some((p) => !p.label.trim())}
          id="admin-create-topic-btn"
        >
          {creating ? 'Creating…' : 'Create topic'}
        </button>
      </div>

      <h2 style={{ marginTop: 24 }}>Active topics ({topics?.length ?? '…'})</h2>
      {topics === null && <p className="muted">Loading…</p>}
      {topics && topics.length === 0 && <p className="muted">No topics yet.</p>}
      {topics && topics.map((t) => (
        <div key={t.id} className="card" id={`admin-topic-${t.id}`}>
          <h3 style={{ marginTop: 0 }}>{t.title}</h3>
          {t.description && <p className="muted">{t.description}</p>}
          <div>
            {t.parties.map((p) => (
              <span key={p.id} className="arena-party-pill" style={{ marginRight: 6 }}>
                {p.emoji} {p.label}
              </span>
            ))}
          </div>
          <p className="muted" style={{ fontSize: 12, marginTop: 12, marginBottom: 0 }}>
            {Object.values(t.postsByParty || {}).reduce((a, b) => a + b, 0)} arguments · expires at UTC midnight
          </p>
        </div>
      ))}
    </div>
  );
}

function PostsTab({ session, onError }: Props) {
  const [text, setText] = useState('');
  const [photo, setPhoto] = useState<File | null>(null);
  const [pinned, setPinned] = useState(true);
  const [pollEnabled, setPollEnabled] = useState(false);
  const [pollQuestion, setPollQuestion] = useState('');
  const [pollOptions, setPollOptions] = useState<string[]>(['', '']);
  const [creating, setCreating] = useState(false);
  const [lastCreated, setLastCreated] = useState<Post | null>(null);

  const handleCreate = async () => {
    if (!text.trim() || creating) return;
    let poll: { question: string; options: { label: string }[] } | undefined;
    if (pollEnabled) {
      const cleanOptions = pollOptions.map((o) => o.trim()).filter(Boolean);
      if (!pollQuestion.trim() || cleanOptions.length < 2) {
        onError('Poll needs a question and at least 2 non-empty options.');
        return;
      }
      poll = { question: pollQuestion.trim(), options: cleanOptions.map((label) => ({ label })) };
    }

    setCreating(true);
    try {
      const res = await adminCreatePost(
        session,
        { text: text.trim(), pinned, poll },
        photo || undefined,
      );
      setLastCreated(res.post);
      setText('');
      setPhoto(null);
      setPollQuestion('');
      setPollOptions(['', '']);
      setPollEnabled(false);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'failed to create post');
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await adminDeletePost(session, id);
      setLastCreated(null);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'delete failed');
    }
  };

  return (
    <div className="admin-section">
      <h2>Compose admin post</h2>
      <div className="card">
        <textarea
          placeholder="Write an official announcement…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={500}
          rows={3}
          id="admin-post-text"
        />
        <ImageUploader onChange={setPhoto} disabled={creating} />

        <div className="account-setting-row" style={{ marginTop: 12, cursor: 'pointer' }} onClick={() => setPinned((v) => !v)}>
          <div className="account-setting-info">
            <span className="account-setting-label">📌 Pin to top of feed</span>
            <span className="account-setting-desc">Pinned posts always appear first.</span>
          </div>
          <button
            type="button"
            className={`toggle-btn ${pinned ? 'on' : 'off'}`}
            aria-label="Toggle pin"
            id="admin-pin-toggle"
          >
            <span className="toggle-knob" />
          </button>
        </div>

        <div className="account-setting-row" style={{ cursor: 'pointer' }} onClick={() => setPollEnabled((v) => !v)}>
          <div className="account-setting-info">
            <span className="account-setting-label">📊 Attach a poll</span>
            <span className="account-setting-desc">Users can vote. Only admins can create polls.</span>
          </div>
          <button
            type="button"
            className={`toggle-btn ${pollEnabled ? 'on' : 'off'}`}
            aria-label="Toggle poll"
            id="admin-poll-toggle"
          >
            <span className="toggle-knob" />
          </button>
        </div>

        {pollEnabled && (
          <div className="card" style={{ background: '#0d1117', borderStyle: 'dashed' }}>
            <label className="field">
              <span className="muted">Question</span>
              <input value={pollQuestion} onChange={(e) => setPollQuestion(e.target.value)} maxLength={200} id="admin-poll-question" />
            </label>
            {pollOptions.map((opt, i) => (
              <label key={i} className="field">
                <span className="muted">Option {i + 1}</span>
                <input
                  value={opt}
                  onChange={(e) => {
                    const next = [...pollOptions];
                    next[i] = e.target.value;
                    setPollOptions(next);
                  }}
                  maxLength={60}
                  id={`admin-poll-option-${i}`}
                />
              </label>
            ))}
            {pollOptions.length < 6 && (
              <button
                type="button"
                className="link"
                onClick={() => setPollOptions([...pollOptions, ''])}
                id="admin-add-poll-option"
              >
                + Add option
              </button>
            )}
          </div>
        )}

        <div className="composer-row">
          <span className="muted">{text.length}/500</span>
          <button
            className="button"
            onClick={handleCreate}
            disabled={creating || !text.trim()}
            id="admin-post-create-btn"
          >
            {creating ? 'Posting…' : 'Post'}
          </button>
        </div>
      </div>

      {lastCreated && (
        <div className="card" style={{ borderColor: 'var(--gold)' }} id="admin-last-post-card">
          <h3 style={{ marginTop: 0, color: 'var(--gold)' }}>Posted ✓</h3>
          <p className="muted" style={{ margin: '0 0 8px' }}>{lastCreated.text}</p>
          {lastCreated.photoUrl && (
            <div className="post-photo" style={{ marginTop: 8 }}>
              <img src={lastCreated.photoUrl} alt="" />
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            {!lastCreated.pinnedAt && (
              <button
                className="button ghost"
                onClick={async () => {
                  try { await adminPinPost(session, lastCreated.id); onError('Pinned ✓'); }
                  catch (e) { onError(e instanceof Error ? e.message : 'pin failed'); }
                }}
                id="admin-pin-last-btn"
              >
                📌 Pin
              </button>
            )}
            <button
              className="button danger"
              onClick={() => handleDelete(lastCreated.id)}
              id="admin-delete-last-btn"
            >
              🗑 Delete
            </button>
          </div>
        </div>
      )}
    </div>
  );
}