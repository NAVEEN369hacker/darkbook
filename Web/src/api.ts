/**
 * Thin fetch wrapper. All endpoints are under `${API_BASE}/*.
 * The Vite dev server proxies these to http://localhost:3001.
 * In production, VITE_API_BASE is set to the Supabase Edge Function URL so
 * the same fetch() calls go to the Edge Function instead.
 */

import type { Session } from './storage';
import type {
  Post, Comment, Room, ReactionType,
  CoinBalance, ArenaTopic, ArenaPost, Poll,
  AdminDevice, AdminPostPayload, AdminCreatedUser, AdminAccount,
} from './types';
import type { DeviceInfo } from './device';

// Single source of truth for the API base.
// Dev:    ''           (Vite proxies `${API_BASE}/* to localhost:3001)
// Prod:   'https://<project>.supabase.co/functions/v1/api'
const API_BASE = (import.meta.env.VITE_API_BASE ?? '') + '/api';

export type Identity = {
  did: string;
  uid: string;
  handle?: string | null;
  displayName: string;
  colorHex: string;
  password: string;
  accessToken: string;
  expiresAt: string;
  ip?: string;
};

export type MeResponse = {
  did: string;
  uid: string;
  handle?: string | null;
  displayName: string;
  colorHex: string;
  expiresAt: string;
  serverNow: string;
  ip?: string;
  isAdmin?: boolean;
  device?: {
    did: string;
    ip: string;
    platform?: string;
    screen?: string;
    userAgent?: string;
    lastActiveAt?: string;
  } | null;
};

async function jsonFetch<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const res = await fetch(input, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message || `${res.status} ${res.statusText}`);
  }
  return (await res.json()) as T;
}

// ─── Auth-recovery plumbing ──────────────────────────────────────────
// If the server's in-memory token map is wiped (server restart, etc.) the
// stored bearer token becomes invalid and every authenticated call 401s.
// To avoid stranding the user, jsonFetchAuth intercepts 401s, re-logs in
// using the stored did + password, retries the request once, and emits a
// `ghostline:identity-rotated` event so the React tree can sync its
// Session state with the new token.

const AUTH_RECOVERY_KEY = 'ghostline.session.v1';

function loadStoredSession(): Session | null {
  try {
    const raw = localStorage.getItem(AUTH_RECOVERY_KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

function saveStoredSession(s: Session) {
  try {
    localStorage.setItem(AUTH_RECOVERY_KEY, JSON.stringify(s));
  } catch {
    /* noop */
  }
}

const _authEventTarget = new EventTarget();

export const authEvents = {
  onIdentityReplaced(cb: (id: Identity) => void): () => void {
    const handler = (e: Event) => cb((e as CustomEvent<Identity>).detail);
    _authEventTarget.addEventListener('identity', handler);
    return () => _authEventTarget.removeEventListener('identity', handler);
  },
};

function emitIdentityReplaced(id: Identity) {
  _authEventTarget.dispatchEvent(new CustomEvent('identity', { detail: id }));
}

async function attemptRelogin(): Promise<Identity | null> {
  const stored = loadStoredSession();
  if (!stored?.did || !stored?.password) return null;
  try {
    return await login(stored.did, stored.password);
  } catch {
    return null;
  }
}

function replaceAuthHeader(init: RequestInit | undefined, newToken: string): RequestInit {
  const headers = { ...(init?.headers as Record<string, string> | undefined) };
  // Override any pre-existing Authorization header.
  for (const k of Object.keys(headers)) {
    if (k.toLowerCase() === 'authorization') delete headers[k];
  }
  headers['Authorization'] = `Bearer ${newToken}`;
  return { ...init, headers };
}

async function jsonFetchAuth<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  let res = await fetch(input, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
  });

  if (res.status !== 401) {
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.message || `${res.status} ${res.statusText}`);
    }
    return (await res.json()) as T;
  }

  // 401 — try to silently re-login and retry once.
  const fresh = await attemptRelogin();
  if (!fresh) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message || `${res.status} ${res.statusText}`);
  }

  // Persist + notify React of the new identity.
  const next: Session = {
    did: fresh.did,
    uid: fresh.uid,
    handle: fresh.handle ?? null,
    password: fresh.password,
    accessToken: fresh.accessToken,
    expiresAt: fresh.expiresAt,
    displayName: fresh.displayName,
    colorHex: fresh.colorHex,
  };
  saveStoredSession(next);
  emitIdentityReplaced(fresh);

  // Retry the original request with the new token.
  res = await fetch(input, {
    ...replaceAuthHeader(init, fresh.accessToken),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message || `${res.status} ${res.statusText}`);
  }
  return (await res.json()) as T;
}

export async function recognizeDevice(deviceInfo: DeviceInfo): Promise<{
  recognized: boolean;
  did: string;
  ip: string;
  message: string;
}> {
  return jsonFetch(`${API_BASE}/auth/recognize`, {
    method: 'POST',
    body: JSON.stringify(deviceInfo),
  });
}

export async function register(
  deviceInfo?: DeviceInfo & { password?: string },
): Promise<Identity> {
  return jsonFetch<Identity>(`${API_BASE}/auth/register`, {
    method: 'POST',
    body: JSON.stringify(deviceInfo || {}),
  });
}

export async function login(
  did: string,
  password: string,
  fingerprint?: string,
): Promise<Identity> {
  return jsonFetch<Identity>(`${API_BASE}/auth/login`, {
    method: 'POST',
    body: JSON.stringify({ did, password, fingerprint }),
  });
}

export async function rotate(session: Session): Promise<Identity> {
  return jsonFetch<Identity>(`${API_BASE}/auth/rotate`, {
    method: 'POST',
    body: '{}',
    headers: { Authorization: `Bearer ${session.accessToken}` },
  });
}

export async function me(session: Session): Promise<MeResponse> {
  return jsonFetch<MeResponse>(`${API_BASE}/auth/me`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${session.accessToken}` },
  });
}

// --- rooms ---
export async function getRooms(): Promise<{ rooms: Room[] }> {
  return jsonFetch<{ rooms: Room[] }>(`${API_BASE}/rooms`,);
}

// --- feed / posts / votes / comments ---
export async function getFeed(roomId = 'random'): Promise<{ posts: Post[] }> {
  return jsonFetch<{ posts: Post[] }>(`${API_BASE}/feed?roomId=${encodeURIComponent(roomId)}`);
}

export async function createPost(
  session: Session,
  roomId: string,
  text: string,
  photo?: File,
): Promise<{ post: Post; balance: number }> {
  if (photo) {
    const fd = new FormData();
    fd.append('roomId', roomId);
    fd.append('text', text);
    fd.append('photo', photo, photo.name);
    const res = await fetch(`${API_BASE}/posts`, {
      method: 'POST',
      body: fd,
      headers: { Authorization: `Bearer ${session.accessToken}` },
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.message || `${res.status} ${res.statusText}`);
    }
    return res.json();
  }
  return jsonFetchAuth<{ post: Post; balance: number }>(`${API_BASE}/posts`, {
    method: 'POST',
    body: JSON.stringify({ roomId, text }),
    headers: { Authorization: `Bearer ${session.accessToken}` },
  });
}

export async function castPostReact(
  session: Session,
  postId: string,
  type: ReactionType,
): Promise<{ postId: string; likeCount: number; shakeCount: number; myReaction: ReactionType }> {
  return jsonFetchAuth<{ postId: string; likeCount: number; shakeCount: number; myReaction: ReactionType }>(
    `${API_BASE}/posts/${encodeURIComponent(postId)}/react`,
    {
      method: 'POST',
      body: JSON.stringify({ type }),
      headers: { Authorization: `Bearer ${session.accessToken}` },
    },
  );
}

export async function castCommentReact(
  session: Session,
  commentId: string,
  type: ReactionType,
): Promise<{ commentId: string; likeCount: number; shakeCount: number; myReaction: ReactionType }> {
  return jsonFetchAuth<{ commentId: string; likeCount: number; shakeCount: number; myReaction: ReactionType }>(
    `${API_BASE}/comments/${encodeURIComponent(commentId)}/react`,
    {
      method: 'POST',
      body: JSON.stringify({ type }),
      headers: { Authorization: `Bearer ${session.accessToken}` },
    },
  );
}

export async function getComments(
  postId: string,
): Promise<{ comments: Comment[] }> {
  return jsonFetch<{ comments: Comment[] }>(
    `${API_BASE}/posts/${encodeURIComponent(postId)}/comments`,
  );
}

export async function addComment(
  session: Session,
  postId: string,
  text: string,
): Promise<{ comment: Comment }> {
  return jsonFetchAuth<{ comment: Comment }>(
    `${API_BASE}/posts/${encodeURIComponent(postId)}/comments`,
    {
      method: 'POST',
      body: JSON.stringify({ text }),
      headers: { Authorization: `Bearer ${session.accessToken}` },
    },
  );
}

// ─── DMs ────────────────────────────────────────────────────

export type DMConversation = {
  partnerUid: string;
  partnerName: string;
  partnerHandle?: string | null;
  partnerColor: string;
  lastMessage: string;
  lastMessageAt: string;
  unread: number;
};

export type DMMessage = {
  id: string;
  fromUid: string;
  text: string;
  createdAt: string;
  read: boolean;
  readAt?: string | null;
};

export type DMThread = {
  partnerUid: string;
  partnerName: string;
  partnerHandle?: string | null;
  partnerColor: string;
  messages: DMMessage[];
};

export async function getConversations(session: Session): Promise<{ conversations: DMConversation[] }> {
  return jsonFetchAuth<{ conversations: DMConversation[] }>(`${API_BASE}/dms`, {
    headers: { Authorization: `Bearer ${session.accessToken}` },
  });
}

export async function getThread(session: Session, partnerHandle: string): Promise<DMThread> {
  const clean = partnerHandle.replace(/^@/, '');
  return jsonFetchAuth<DMThread>(`${API_BASE}/dms/by-handle/${encodeURIComponent(clean)}`, {
    headers: { Authorization: `Bearer ${session.accessToken}` },
  });
}

export async function sendDM(
  session: Session,
  partnerHandle: string,
  text: string,
): Promise<{ message: DMMessage; recipient?: { uid: string; handle: string | null; displayName: string; colorHex: string } }> {
  const clean = partnerHandle.replace(/^@/, '');
  return jsonFetchAuth<{ message: DMMessage; recipient?: { uid: string; handle: string | null; displayName: string; colorHex: string } }>(
    `${API_BASE}/dms/by-handle/${encodeURIComponent(clean)}`,
    {
      method: 'POST',
      body: JSON.stringify({ text }),
      headers: { Authorization: `Bearer ${session.accessToken}` },
    },
  );
}

export async function markDMRead(session: Session, partnerHandle: string): Promise<{ ok: boolean }> {
  const clean = partnerHandle.replace(/^@/, '');
  return jsonFetchAuth<{ ok: boolean }>(`${API_BASE}/dms/by-handle/${encodeURIComponent(clean)}/read`, {
    method: 'POST',
    body: '{}',
    headers: { Authorization: `Bearer ${session.accessToken}` },
  });
}

// ─── Profile (public, handle-based) ─────────────────────────

export type ProfilePost = {
  id: string;
  text: string;
  createdAt: string;
  likeCount: number;
  shakeCount: number;
  commentCount: number;
};

export type Profile = {
  profile: {
    uid: string;
    did?: string;
    handle: string | null;
    displayName: string;
    colorHex: string;
    expiresAt: string;
    followersCount?: number;
    followingCount?: number;
    isFollowing?: boolean;
  };
  stats: {
    postCount: number;
    lifetimeLikes: number;
    lifetimeShakes: number;
    lifetimeComments: number;
    commentCount: number;
    conversationCount: number;
    followersCount?: number;
    followingCount?: number;
  };
  posts: ProfilePost[];
};

export async function getProfile(handle: string, session?: Session | null): Promise<Profile> {
  const clean = handle.replace(/^@/, '');
  const headers: Record<string, string> = {};
  if (session?.accessToken) {
    headers['Authorization'] = `Bearer ${session.accessToken}`;
  }
  return jsonFetch<Profile>(`${API_BASE}/users/${encodeURIComponent(clean)}`, { headers });
}

// ─── Notifications ───────────────────────────────────────────

export type Notification = {
  id: string;
  type: 'upvote' | 'like' | 'shake' | 'comment' | 'dm' | 'system' | 'reward';
  actorUid: string | null;
  actorName: string | null;
  actorColor: string | null;
  text: string;
  createdAt: string;
  read: boolean;
};

export async function getNotifications(session: Session): Promise<{ notifications: Notification[] }> {
  return jsonFetchAuth<{ notifications: Notification[] }>(`${API_BASE}/notifications`, {
    headers: { Authorization: `Bearer ${session.accessToken}` },
  });
}

export async function getUnreadNotifCount(session: Session): Promise<{ count: number }> {
  return jsonFetchAuth<{ count: number }>(`${API_BASE}/notifications/unread-count`, {
    headers: { Authorization: `Bearer ${session.accessToken}` },
  });
}

export async function markNotifRead(session: Session, id: string): Promise<{ ok: boolean }> {
  return jsonFetchAuth<{ ok: boolean }>(`${API_BASE}/notifications/${encodeURIComponent(id)}/read`, {
    method: 'POST',
    body: '{}',
    headers: { Authorization: `Bearer ${session.accessToken}` },
  });
}

export async function markAllNotifsRead(session: Session): Promise<{ ok: boolean }> {
  return jsonFetchAuth<{ ok: boolean }>(`${API_BASE}/notifications/read-all`, {
    method: 'POST',
    body: '{}',
    headers: { Authorization: `Bearer ${session.accessToken}` },
  });
}

export async function getUnreadDMCount(session: Session): Promise<number> {
  const { conversations } = await getConversations(session);
  return conversations.reduce((sum, c) => sum + c.unread, 0);
}

// ─── Coins ─────────────────────────────────────────────────────────

export async function getCoinBalance(session: Session): Promise<CoinBalance> {
  return jsonFetchAuth<CoinBalance>(`${API_BASE}/coins/balance`, {
    headers: { Authorization: `Bearer ${session.accessToken}` },
  });
}

export type SpendResult =
  | { ok: true; charged: boolean; idempotent: boolean; balance: number }
  | { ok: false; error: string; message: string; needed?: number; have?: number; status: number };

export async function spendCoins(
  session: Session,
  reason: 'open_feed' | 'open_dms' | 'open_arena' | 'post_feed' | 'post_arena',
): Promise<SpendResult> {
  const res = await fetch(`${API_BASE}/coins/spend`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.accessToken}`,
    },
    body: JSON.stringify({ reason }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    return { ok: false, status: res.status, error: body.error || 'failed', message: body.message || `${res.status}` };
  }
  return { ok: true, ...body };
}

export type WatchAdResult =
  | { ok: true; rewardId: string; coins: number; balance: number; adsWatchedToday: number }
  | { ok: false; reason: string; message: string };

export async function watchAd(session: Session): Promise<WatchAdResult> {
  return jsonFetchAuth<WatchAdResult>(`${API_BASE}/ads/reward`, {
    method: 'POST',
    body: '{}',
    headers: { Authorization: `Bearer ${session.accessToken}` },
  });
}

// ─── Profile & Follows ─────────────────────────────────────────────

export async function followUser(
  session: Session,
  handle: string,
): Promise<{ ok: boolean; isFollowing: boolean; followersCount: number }> {
  return jsonFetchAuth<{ ok: boolean; isFollowing: boolean; followersCount: number }>(
    `${API_BASE}/users/${encodeURIComponent(handle)}/follow`,
    {
      method: 'POST',
      body: '{}',
      headers: { Authorization: `Bearer ${session.accessToken}` },
    },
  );
}

export async function unfollowUser(
  session: Session,
  handle: string,
): Promise<{ ok: boolean; isFollowing: boolean; followersCount: number }> {
  return jsonFetchAuth<{ ok: boolean; isFollowing: boolean; followersCount: number }>(
    `${API_BASE}/users/${encodeURIComponent(handle)}/unfollow`,
    {
      method: 'POST',
      body: '{}',
      headers: { Authorization: `Bearer ${session.accessToken}` },
    },
  );
}

// ─── Arena ──────────────────────────────────────────────────────────

export async function listArenaTopics(): Promise<{ topics: ArenaTopic[] }> {
  return jsonFetch<{ topics: ArenaTopic[] }>(`${API_BASE}/arena/topics`,);
}

export async function getArenaTopic(id: string): Promise<{ topic: ArenaTopic; posts: ArenaPost[] }> {
  return jsonFetch<{ topic: ArenaTopic; posts: ArenaPost[] }>(
    `${API_BASE}/arena/topics/${encodeURIComponent(id)}`,
  );
}

export async function postArenaArgument(
  session: Session,
  topicId: string,
  partyId: string,
  text: string,
  parentId?: string,
): Promise<{ post: ArenaPost; balance: number }> {
  return jsonFetchAuth<{ post: ArenaPost; balance: number }>(
    `${API_BASE}/arena/topics/${encodeURIComponent(topicId)}/posts`,
    {
      method: 'POST',
      body: JSON.stringify({ partyId, text, parentId }),
      headers: { Authorization: `Bearer ${session.accessToken}` },
    },
  );
}

// ─── Polls ──────────────────────────────────────────────────────────

export async function getPoll(id: string): Promise<{ poll: Poll }> {
  return jsonFetch<{ poll: Poll }>(`${API_BASE}/polls/${encodeURIComponent(id)}`);
}

export async function votePoll(
  session: Session,
  id: string,
  optionId: string,
): Promise<{ poll: Poll; changed: boolean }> {
  return jsonFetchAuth<{ poll: Poll; changed: boolean }>(
    `${API_BASE}/polls/${encodeURIComponent(id)}/vote`,
    {
      method: 'POST',
      body: JSON.stringify({ optionId }),
      headers: { Authorization: `Bearer ${session.accessToken}` },
    },
  );
}

// ─── Admin ──────────────────────────────────────────────────────────

export async function adminCreateUser(
  session: Session,
  payload: { displayName?: string; colorHex?: string } = {},
): Promise<AdminCreatedUser> {
  return jsonFetchAuth<AdminCreatedUser>(`${API_BASE}/admin/users`, {
    method: 'POST',
    body: JSON.stringify(payload),
    headers: { Authorization: `Bearer ${session.accessToken}` },
  });
}

export async function adminListDevices(session: Session): Promise<{ devices: AdminDevice[] }> {
  return jsonFetchAuth<{ devices: AdminDevice[] }>(`${API_BASE}/admin/devices`, {
    headers: { Authorization: `Bearer ${session.accessToken}` },
  });
}

export async function adminCreatePost(
  session: Session,
  payload: AdminPostPayload,
  photo?: File,
): Promise<{ post: Post }> {
  if (photo) {
    const fd = new FormData();
    fd.append('text', payload.text);
    if (payload.pinned) fd.append('pinned', 'true');
    if (payload.poll) fd.append('poll', JSON.stringify(payload.poll));
    fd.append('photo', photo, photo.name);
    const res = await fetch(`${API_BASE}/admin/posts`, {
      method: 'POST',
      body: fd,
      headers: { Authorization: `Bearer ${session.accessToken}` },
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.message || `${res.status} ${res.statusText}`);
    }
    return res.json();
  }
  return jsonFetchAuth<{ post: Post }>(`${API_BASE}/admin/posts`, {
    method: 'POST',
    body: JSON.stringify(payload),
    headers: { Authorization: `Bearer ${session.accessToken}` },
  });
}

export async function adminPinPost(session: Session, postId: string): Promise<{ ok: boolean }> {
  return jsonFetchAuth<{ ok: boolean }>(
    `${API_BASE}/admin/posts/${encodeURIComponent(postId)}/pin`,
    {
      method: 'POST',
      body: '{}',
      headers: { Authorization: `Bearer ${session.accessToken}` },
    },
  );
}

export async function adminDeletePost(session: Session, postId: string): Promise<{ ok: boolean }> {
  return jsonFetchAuth<{ ok: boolean }>(
    `${API_BASE}/admin/posts/${encodeURIComponent(postId)}`,
    {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${session.accessToken}` },
    },
  );
}

export async function adminCreateArenaTopic(
  session: Session,
  payload: { title: string; description?: string; parties: { label: string; emoji?: string }[] },
): Promise<{ topic: ArenaTopic }> {
  return jsonFetchAuth<{ topic: ArenaTopic }>(`${API_BASE}/admin/arena/topics`, {
    method: 'POST',
    body: JSON.stringify(payload),
    headers: { Authorization: `Bearer ${session.accessToken}` },
  });
}

export async function adminListAccounts(session: Session): Promise<{ accounts: AdminAccount[] }> {
  return jsonFetchAuth<{ accounts: AdminAccount[] }>(`${API_BASE}/admin/accounts`, {
    headers: { Authorization: `Bearer ${session.accessToken}` },
  });
}

export async function adminSwitchAccount(session: Session, targetUid: string): Promise<Identity> {
  return jsonFetchAuth<Identity>(`${API_BASE}/admin/switch-account`, {
    method: 'POST',
    body: JSON.stringify({ uid: targetUid }),
    headers: { Authorization: `Bearer ${session.accessToken}` },
  });
}

