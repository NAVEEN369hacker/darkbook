// _shared/types.ts — shared request context, row shapes, and helpers.

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

export interface AuthContext {
  token: string;
  did: string;
  uid: string;
  isAdmin: boolean;
  issuedAt: string;
}

export interface RequestCtx {
  req: Request;
  url: URL;
  supabase: SupabaseClient;
  auth: AuthContext | null;
}

export type HttpHandler = (ctx: RequestCtx, params: Record<string, string>) => Promise<Response>;

// ----- Row shapes (snake_case as stored in Postgres) -----

export interface DeviceRow {
  did: string;
  password_hash: string;
  is_admin: boolean | null;
  ip: string | null;
  user_agent: string | null;
  fingerprint: string | null;
  platform: string | null;
  screen: string | null;
  created_at: string;
  last_active_at: string;
  created_by_admin_did: string | null;
}

export interface DailyIdentityRow {
  uid: string;
  did: string;
  handle: string;
  display_name: string | null;
  color_hex: string | null;
  status: 'active' | 'rotated';
  issued_at: string;
  expires_at: string | null;
  rotated_at: string | null;
}

export interface TokenRow {
  token: string;
  did: string;
  uid: string;
  issued_at: string;
}

export interface PostRow {
  id: string;
  room_id: string;
  author_uid: string | null;
  author_did: string | null;
  author_handle: string | null;
  author_display_name: string | null;
  author_color_hex: string | null;
  content: string;
  photo_url: string | null;
  created_at: string;
  is_pinned: boolean | null;
  pinned_at: string | null;
  poll_id: string | null;
}

export interface CommentRow {
  id: string;
  post_id: string;
  author_uid: string | null;
  author_did: string | null;
  author_handle: string | null;
  author_display_name: string | null;
  author_color_hex: string | null;
  content: string;
  created_at: string;
}

export interface ReactionRow {
  id: string;
  target_type: 'post' | 'comment';
  target_id: string;
  author_uid: string;
  emoji: string;
  created_at: string;
}

export interface DmRow {
  id: string;
  sender_uid: string;
  recipient_uid: string;
  sender_handle: string | null;
  recipient_handle: string | null;
  content: string;
  photo_url: string | null;
  is_read: boolean | null;
  created_at: string;
}

export interface NotificationRow {
  id: string;
  recipient_uid: string;
  type: string;
  title: string | null;
  body: string | null;
  link: string | null;
  is_read: boolean | null;
  created_at: string;
}

export interface CoinRow {
  did: string;
  balance: number;
  ads_watched_today: number;
  last_reset_at: string;
  spent_today: Record<string, number>;
  history: Array<Record<string, unknown>>;
}

export interface ArenaTopicRow {
  id: string;
  topic: string;
  description: string | null;
  category: string | null;
  side_a: string;
  side_b: string;
  expires_at: string | null;
  created_at: string;
}

export interface ArenaPostRow {
  id: string;
  topic_id: string;
  side: 'A' | 'B';
  author_uid: string | null;
  author_did: string | null;
  author_handle: string | null;
  author_display_name: string | null;
  author_color_hex: string | null;
  content: string;
  created_at: string;
}

export interface PollRow {
  id: string;
  question: string;
  options: Array<{ id: string; label: string; votes?: number }>;
  created_at: string;
}

export interface VoteRow {
  id: string;
  poll_id: string;
  did: string;
  option_index: number;
  created_at: string;
}

// camelCase response helpers (what the React client expects)

export function deviceToCamel(r: DeviceRow): Record<string, unknown> {
  return {
    did: r.did,
    passwordHash: r.password_hash,
    isAdmin: !!r.is_admin,
    ip: r.ip,
    userAgent: r.user_agent,
    fingerprint: r.fingerprint,
    platform: r.platform,
    screen: r.screen,
    createdAt: r.created_at,
    lastActiveAt: r.last_active_at,
    createdByAdminDid: r.created_by_admin_did,
  };
}

export function identityToCamel(r: DailyIdentityRow): Record<string, unknown> {
  return {
    uid: r.uid,
    did: r.did,
    handle: r.handle,
    displayName: r.display_name,
    colorHex: r.color_hex,
    status: r.status,
    issuedAt: r.issued_at,
    expiresAt: r.expires_at,
    rotatedAt: r.rotated_at,
  };
}
