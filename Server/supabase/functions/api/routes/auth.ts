// routes/auth.ts — register, login, rotate, me, recognize.
//
// All five handlers from Server/routes/auth.js, ported to the Edge Function.

import type { RequestCtx } from '../_shared/types.ts';
import { json, badRequest, unauthorized, notFound, withCors } from '../_shared/response.ts';
import { readJson, getClientIp, getUserAgent } from '../_shared/parse.ts';
import {
  generateDid,
  generateUid,
  generatePassword,
  hashPassword,
  verifyPassword,
  pickDisplayName,
  pickColor,
  generateHandle,
  ensureUniqueHandle,
  computeExpiresAt,
} from '../lib/identity.ts';
import {
  findActiveIdentityByDid,
  issueSession,
  deleteSession,
  takenActiveHandles,
  requireAuth,
  extractBearer,
} from '../lib/auth.ts';

const MAX_PASSWORD = 200;

async function findOrMatchDevice(
  supabase: import('https://esm.sh/@supabase/supabase-js@2').SupabaseClient,
  did: string | undefined,
  fingerprint: string | undefined,
): Promise<Record<string, unknown> | null> {
  if (did) {
    const { data } = await supabase.from('devices').select('*').eq('did', did).maybeSingle();
    if (data) return data as Record<string, unknown>;
  }
  if (fingerprint) {
    const { data } = await supabase.from('devices').select('*').eq('fingerprint', fingerprint).maybeSingle();
    if (data) return data as Record<string, unknown>;
  }
  return null;
}

export async function recognize(ctx: RequestCtx): Promise<Response> {
  const body = await readJson(ctx.req);
  const deviceId = (body.deviceId as string | undefined) ?? undefined;
  const fingerprint = (body.fingerprint as string | undefined) ?? undefined;
  const ip = getClientIp(ctx.req);
  const ua = getUserAgent(ctx.req);

  const target = deviceId || (fingerprint ? `did_dev_${fingerprint}` : null);
  const existing = await findOrMatchDevice(ctx.supabase, deviceId, fingerprint);

  if (existing) {
    await ctx.supabase
      .from('devices')
      .update({
        last_active_at: new Date().toISOString(),
        ip,
        user_agent: ua,
        fingerprint: fingerprint ?? existing.fingerprint ?? null,
      })
      .eq('did', existing.did as string);
    return json({
      recognized: true,
      did: existing.did,
      ip,
      lastActiveAt: new Date().toISOString(),
      message: 'Device recognized by server',
    });
  }
  return json({ recognized: false, did: target, ip, message: 'New device detected' });
}

export async function register(ctx: RequestCtx): Promise<Response> {
  const body = await readJson(ctx.req);
  const ip = getClientIp(ctx.req);
  const ua = getUserAgent(ctx.req);
  const deviceId = (body.deviceId as string | undefined) ?? generateDid();
  const fingerprint = (body.fingerprint as string | undefined) ?? null;
  const customPassword = (body.password as string | undefined) ?? null;
  const now = new Date().toISOString();

  const existing = await findOrMatchDevice(ctx.supabase, deviceId, fingerprint);
  const isFirst = !existing;
  const wantsCustom = typeof customPassword === 'string' && customPassword.trim().length > 0;
  const password = isFirst && wantsCustom ? customPassword.trim().slice(0, MAX_PASSWORD) : generatePassword();
  const passwordHash = await hashPassword(password);

  if (existing) {
    await ctx.supabase
      .from('devices')
      .update({
        password_hash: passwordHash,
        last_active_at: now,
        ip,
        user_agent: ua,
        fingerprint: fingerprint ?? existing.fingerprint ?? null,
      })
      .eq('did', existing.did as string);
  } else {
    await ctx.supabase.from('devices').insert({
      did: deviceId,
      password_hash: passwordHash,
      ip,
      user_agent: ua,
      fingerprint: fingerprint ?? 'unknown',
      platform: (body.platform as string | undefined) ?? 'unknown',
      screen: (body.screen as string | undefined) ?? 'unknown',
      created_at: now,
      last_active_at: now,
    });
  }

  const actualDid = existing ? (existing.did as string) : deviceId;

  let active = await findActiveIdentityByDid(ctx.supabase, actualDid);
  let uid: string;
  let displayName: string;
  let colorHex: string;
  let handle: string;
  let expiresAt: string;

  if (active) {
    uid = active.uid;
    displayName = active.display_name ?? '';
    colorHex = active.color_hex ?? '#888';
    handle = active.handle;
    expiresAt = active.expires_at;
  } else {
    uid = generateUid();
    displayName = pickDisplayName(uid);
    colorHex = pickColor(uid);
    const taken = await takenActiveHandles(ctx.supabase);
    handle = ensureUniqueHandle(generateHandle(uid), taken);
    expiresAt = computeExpiresAt();
    await ctx.supabase.from('daily_identities').insert({
      uid,
      did: actualDid,
      handle,
      display_name: displayName,
      color_hex: colorHex,
      status: 'active',
      issued_at: now,
      expires_at: expiresAt,
    });
  }

  const accessToken = await issueSession(ctx.supabase, actualDid, uid);
  return json({
    did: actualDid,
    uid,
    handle,
    displayName,
    colorHex,
    password,
    accessToken,
    expiresAt,
    ip,
  }, 201);
}

export async function login(ctx: RequestCtx): Promise<Response> {
  const body = await readJson(ctx.req);
  const ip = getClientIp(ctx.req);
  const did = body.did as string | undefined;
  const password = body.password as string | undefined;
  const fingerprint = body.fingerprint as string | undefined;
  if (!did || !password) {
    return badRequest('did and password required');
  }
  const device = await findOrMatchDevice(ctx.supabase, did, fingerprint);
  if (!device) return unauthorized('unknown device');
  const ok = await verifyPassword(password, device.password_hash as string);
  if (!ok) return unauthorized('bad password');

  const now = new Date().toISOString();
  await ctx.supabase
    .from('devices')
    .update({ last_active_at: now, ip })
    .eq('did', device.did as string);

  let active = await findActiveIdentityByDid(ctx.supabase, device.did as string);
  let uid: string;
  let displayName: string;
  let colorHex: string;
  let handle: string;
  let expiresAt: string;

  if (active) {
    uid = active.uid;
    displayName = active.display_name ?? '';
    colorHex = active.color_hex ?? '#888';
    handle = active.handle;
    expiresAt = active.expires_at;
  } else {
    uid = generateUid();
    displayName = pickDisplayName(uid);
    colorHex = pickColor(uid);
    const taken = await takenActiveHandles(ctx.supabase);
    handle = ensureUniqueHandle(generateHandle(uid), taken);
    expiresAt = computeExpiresAt();
    await ctx.supabase.from('daily_identities').insert({
      uid,
      did: device.did as string,
      handle,
      display_name: displayName,
      color_hex: colorHex,
      status: 'active',
      issued_at: now,
      expires_at: expiresAt,
    });
  }

  const accessToken = await issueSession(ctx.supabase, device.did as string, uid);
  return json({
    did: device.did,
    uid,
    handle,
    displayName,
    colorHex,
    password,
    accessToken,
    expiresAt,
    ip,
  });
}

export async function rotate(ctx: RequestCtx): Promise<Response> {
  const auth = await requireAuth(ctx);
  const ip = getClientIp(ctx.req);

  // Defensive: if an active identity already exists, return it (idempotent).
  const existing = await findActiveIdentityByDid(ctx.supabase, auth.did);
  if (existing) {
    const token = await issueSession(ctx.supabase, auth.did, existing.uid);
    return json({
      did: auth.did,
      uid: existing.uid,
      handle: existing.handle,
      displayName: existing.display_name,
      colorHex: existing.color_hex,
      password: undefined,
      accessToken: token,
      expiresAt: existing.expires_at,
      ip,
      unchanged: true,
    });
  }

  // Mark old UID as rotated.
  await ctx.supabase
    .from('daily_identities')
    .update({ status: 'rotated', rotated_at: new Date().toISOString() })
    .eq('uid', auth.uid);

  // Mint a brand-new UID.
  const uid = generateUid();
  const newPassword = generatePassword();
  const newPasswordHash = await hashPassword(newPassword);
  const displayName = pickDisplayName(uid);
  const colorHex = pickColor(uid);
  const taken = await takenActiveHandles(ctx.supabase);
  const handle = ensureUniqueHandle(generateHandle(uid), taken);
  const expiresAt = computeExpiresAt();
  const now = new Date().toISOString();

  await ctx.supabase.from('daily_identities').insert({
    uid,
    did: auth.did,
    handle,
    display_name: displayName,
    color_hex: colorHex,
    status: 'active',
    issued_at: now,
    expires_at: expiresAt,
  });
  await ctx.supabase
    .from('devices')
    .update({ password_hash: newPasswordHash, last_active_at: now, ip })
    .eq('did', auth.did);

  // Rotate the bearer token.
  await deleteSession(ctx.supabase, auth.token);
  const token = await issueSession(ctx.supabase, auth.did, uid);

  return json({
    did: auth.did,
    uid,
    handle,
    displayName,
    colorHex,
    password: newPassword,
    accessToken: token,
    expiresAt,
    ip,
  });
}

export async function me(ctx: RequestCtx): Promise<Response> {
  const auth = await requireAuth(ctx);
  const ip = getClientIp(ctx.req);
  const { data: identity } = await ctx.supabase
    .from('daily_identities')
    .select('*')
    .eq('uid', auth.uid)
    .maybeSingle();
  if (!identity) return notFound('uid not found');
  const { data: device } = await ctx.supabase
    .from('devices')
    .select('*')
    .eq('did', auth.did)
    .maybeSingle();
  return json({
    did: auth.did,
    uid: auth.uid,
    handle: identity.handle ?? null,
    displayName: identity.display_name,
    colorHex: identity.color_hex,
    expiresAt: identity.expires_at,
    serverNow: new Date().toISOString(),
    ip,
    isAdmin: !!(device && device.is_admin),
    device: device ? {
      did: device.did,
      ip: device.ip ?? ip,
      platform: device.platform,
      screen: device.screen,
      userAgent: device.user_agent,
      lastActiveAt: device.last_active_at,
    } : null,
  });
}

export async function debugForceRotate(ctx: RequestCtx): Promise<Response> {
  if (Deno.env.get('DEBUG') !== '1') {
    return new Response('debug disabled', { status: 404 });
  }
  // Inject a fake auth using the body.did so the existing rotate handler runs.
  const body = await readJson(ctx.req);
  const did = body.did as string | undefined;
  if (!did) return badRequest('did required');
  const { data: tk } = await ctx.supabase
    .from('tokens')
    .select('*')
    .eq('did', did)
    .order('issued_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!tk) return notFound('no token for did');
  ctx.auth = {
    token: tk.token as string,
    did: tk.did as string,
    uid: tk.uid as string,
    isAdmin: false,
    issuedAt: tk.issued_at as string,
  };
  return await rotate(ctx);
}
