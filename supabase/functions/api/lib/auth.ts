// lib/auth.ts — bearer-token resolution + session mint/delete.
//
// Replaces the in-memory `tokens` Map in Server/routes/auth.js with queries
// against the `tokens` table. Same contract:
//   - getAuthContext(req, supabase) reads Authorization: Bearer <token>,
//     looks up the tokens row + the device's is_admin, returns null if absent.
//   - requireAuth / requireAdmin throw Response objects on failure so route
//     handlers can `throw await requireAuth(ctx)` to bail.

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { unauthorized, forbidden, json } from '../_shared/response.ts';
import type { AuthContext, RequestCtx } from '../_shared/types.ts';
import { generateToken } from './identity.ts';

const BEARER_RE = /^Bearer\s+(.+)$/i;

export function extractBearer(req: Request): string | null {
  const auth = req.headers.get('authorization') ?? '';
  const m = auth.match(BEARER_RE);
  return m ? m[1].trim() : null;
}

export async function getAuthContext(
  req: Request,
  supabase: SupabaseClient,
): Promise<AuthContext | null> {
  const token = extractBearer(req);
  if (!token) return null;

  const { data: tk, error } = await supabase
    .from('tokens')
    .select('token, did, uid, issued_at')
    .eq('token', token)
    .maybeSingle();
  if (error || !tk) return null;

  const { data: dev } = await supabase
    .from('devices')
    .select('is_admin')
    .eq('did', tk.did)
    .maybeSingle();

  return {
    token,
    did: tk.did,
    uid: tk.uid,
    isAdmin: !!(dev && dev.is_admin),
    issuedAt: tk.issued_at,
  };
}

export async function requireAuth(ctx: RequestCtx): Promise<AuthContext> {
  if (!ctx.auth) throw await unauthorized();
  return ctx.auth;
}

export async function requireAdmin(ctx: RequestCtx): Promise<AuthContext> {
  const a = await requireAuth(ctx);
  if (!a.isAdmin) throw await forbidden('admin only');
  return a;
}

export async function issueSession(
  supabase: SupabaseClient,
  did: string,
  uid: string,
): Promise<string> {
  const token = generateToken();
  const { error } = await supabase.from('tokens').insert({
    token,
    did,
    uid,
    issued_at: new Date().toISOString(),
  });
  if (error) throw new Error(`issueSession failed: ${error.message}`);
  return token;
}

export async function deleteSession(supabase: SupabaseClient, token: string): Promise<void> {
  await supabase.from('tokens').delete().eq('token', token);
}

/**
 * Load all currently-taken handles (active daily identities only) so the
 * caller can mint a unique handle for a new UID.
 */
export async function takenActiveHandles(supabase: SupabaseClient): Promise<Set<string>> {
  const { data, error } = await supabase
    .from('daily_identities')
    .select('handle')
    .eq('status', 'active');
  if (error) {
    console.error('takenActiveHandles', error.message);
    return new Set();
  }
  return new Set((data ?? []).map((r: { handle: string }) => r.handle).filter(Boolean));
}

export type IdentityByDid = { uid: string; handle: string; display_name: string; color_hex: string; expires_at: string };

export async function findActiveIdentityByDid(
  supabase: SupabaseClient,
  did: string,
): Promise<IdentityByDid | null> {
  const nowIso = new Date().toISOString();
  const { data, error } = await supabase
    .from('daily_identities')
    .select('uid, handle, display_name, color_hex, expires_at, status')
    .eq('did', did)
    .eq('status', 'active')
    .gt('expires_at', nowIso)
    .order('issued_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  return data as { uid: string; handle: string; display_name: string; color_hex: string; expires_at: string };
}

export type IdentityByHandle = { uid: string; did: string; handle: string; display_name: string; color_hex: string };

export async function findActiveIdentityByHandle(
  supabase: SupabaseClient,
  handle: string,
): Promise<IdentityByHandle | null> {
  const clean = handle.replace(/^@/, '').trim().toLowerCase();
  if (!clean) return null;
  const { data, error } = await supabase
    .from('daily_identities')
    .select('uid, did, handle, display_name, color_hex, status')
    .eq('status', 'active')
    .ilike('handle', clean)
    .maybeSingle();
  if (error || !data) return null;
  return data as { uid: string; did: string; handle: string; display_name: string; color_hex: string };
}
