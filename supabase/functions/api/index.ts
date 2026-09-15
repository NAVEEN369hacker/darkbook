// index.ts — single Supabase Edge Function for the entire Ghostline API.
//
// All /api/* routes are dispatched from here. One file, one deployment.
//
//   https://<project>.supabase.co/functions/v1/api/<route>
//
// Inside the function, pathname looks like "/api/feed" or "/api/posts/:id/react".

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

import { getRequiredEnv } from './_shared/env.ts';
import {
  corsPreflight,
  withCors,
  notFound,
  json,
  serverError,
} from './_shared/response.ts';
import type { RequestCtx, HttpHandler } from './_shared/types.ts';
import { getAuthContext } from './lib/auth.ts';

import * as auth from './routes/auth.ts';
import * as posts from './routes/posts.ts';
import * as dms from './routes/dms.ts';
import * as notifications from './routes/notifications.ts';
import * as profile from './routes/profile.ts';
import * as coins from './routes/coins.ts';
import * as arena from './routes/arena.ts';
import * as polls from './routes/polls.ts';
import * as admin from './routes/admin.ts';
import * as rooms from './routes/rooms.ts';

const SUPABASE_URL = getRequiredEnv('SUPABASE_URL');
const SERVICE_ROLE_KEY = getRequiredEnv('SUPABASE_SERVICE_ROLE_KEY');

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// ---------------------------------------------------------------------------
// Route table. Static paths come first; dynamic paths use `:name` placeholders
// that get extracted into a params object passed to the handler. We only need
// a handful of dynamic shapes (`:id`, `:handle`) so a regex match is fine.
// ---------------------------------------------------------------------------

interface Route {
  method: string;
  pattern: RegExp;
  paramNames: string[];
  handler: (ctx: RequestCtx, params: Record<string, string>) => Promise<Response>;
}

function pathToRegex(pattern: string): { regex: RegExp; names: string[] } {
  const names: string[] = [];
  const regexStr = pattern.replace(/:([A-Za-z_]+)/g, (_m, name: string) => {
    names.push(name);
    return '([^/]+)';
  });
  return { regex: new RegExp(`^${regexStr}$`), names };
}

const ROUTES: Route[] = [
  // ---- public ----
  { method: 'GET',  pattern: pathToRegex('/api/health').regex, paramNames: pathToRegex('/api/health').names, handler: health },
  { method: 'GET',  pattern: pathToRegex('/api/rooms').regex, paramNames: pathToRegex('/api/rooms').names, handler: (c) => rooms.list(c) },

  // ---- auth ----
  { method: 'POST', pattern: pathToRegex('/api/auth/recognize').regex, paramNames: pathToRegex('/api/auth/recognize').names, handler: (c) => auth.recognize(c) },
  { method: 'POST', pattern: pathToRegex('/api/auth/register').regex, paramNames: pathToRegex('/api/auth/register').names, handler: (c) => auth.register(c) },
  { method: 'POST', pattern: pathToRegex('/api/auth/login').regex, paramNames: pathToRegex('/api/auth/login').names, handler: (c) => auth.login(c) },
  { method: 'POST', pattern: pathToRegex('/api/auth/rotate').regex, paramNames: pathToRegex('/api/auth/rotate').names, handler: (c) => auth.rotate(c) },
  { method: 'GET',  pattern: pathToRegex('/api/auth/me').regex, paramNames: pathToRegex('/api/auth/me').names, handler: (c) => auth.me(c) },
  { method: 'POST', pattern: pathToRegex('/api/_debug/force-rotate').regex, paramNames: pathToRegex('/api/_debug/force-rotate').names, handler: (c) => auth.debugForceRotate(c) },

  // ---- posts ----
  { method: 'POST', pattern: pathToRegex('/api/posts').regex, paramNames: pathToRegex('/api/posts').names, handler: (c) => posts.create(c) },
  { method: 'GET',  pattern: pathToRegex('/api/feed').regex, paramNames: pathToRegex('/api/feed').names, handler: (c) => posts.feed(c) },
  { method: 'POST', pattern: pathToRegex('/api/posts/:id/react').regex, paramNames: pathToRegex('/api/posts/:id/react').names, handler: (c, p) => posts.react(c, p.id) },
  { method: 'POST', pattern: pathToRegex('/api/comments/:id/react').regex, paramNames: pathToRegex('/api/comments/:id/react').names, handler: (c, p) => posts.reactComment(c, p.id) },
  { method: 'GET',  pattern: pathToRegex('/api/posts/:id/comments').regex, paramNames: pathToRegex('/api/posts/:id/comments').names, handler: (c, p) => posts.comments(c, p.id) },
  { method: 'POST', pattern: pathToRegex('/api/posts/:id/comments').regex, paramNames: pathToRegex('/api/posts/:id/comments').names, handler: (c, p) => posts.createCommentRoute(c, p.id) },

  // ---- DMs ----
  { method: 'GET',  pattern: pathToRegex('/api/dms').regex, paramNames: pathToRegex('/api/dms').names, handler: (c) => dms.list(c) },
  { method: 'GET',  pattern: pathToRegex('/api/dms/by-handle/:handle').regex, paramNames: pathToRegex('/api/dms/by-handle/:handle').names, handler: (c, p) => dms.thread(c, p.handle) },
  { method: 'POST', pattern: pathToRegex('/api/dms/by-handle/:handle').regex, paramNames: pathToRegex('/api/dms/by-handle/:handle').names, handler: (c, p) => dms.send(c, p.handle) },
  { method: 'POST', pattern: pathToRegex('/api/dms/by-handle/:handle/read').regex, paramNames: pathToRegex('/api/dms/by-handle/:handle/read').names, handler: (c, p) => dms.markRead(c, p.handle) },

  // ---- profile ----
  { method: 'GET',    pattern: pathToRegex('/api/users/:handle').regex, paramNames: pathToRegex('/api/users/:handle').names, handler: (c, p) => profile.profile(c, p.handle) },
  { method: 'POST',   pattern: pathToRegex('/api/users/:handle/follow').regex, paramNames: pathToRegex('/api/users/:handle/follow').names, handler: (c, p) => profile.follow(c, p.handle) },
  { method: 'POST',   pattern: pathToRegex('/api/users/:handle/unfollow').regex, paramNames: pathToRegex('/api/users/:handle/unfollow').names, handler: (c, p) => profile.unfollow(c, p.handle) },
  { method: 'DELETE', pattern: pathToRegex('/api/users/:handle/follow').regex, paramNames: pathToRegex('/api/users/:handle/follow').names, handler: (c, p) => profile.unfollow(c, p.handle) },

  // ---- notifications ----
  { method: 'GET',  pattern: pathToRegex('/api/notifications').regex, paramNames: pathToRegex('/api/notifications').names, handler: (c) => notifications.list(c) },
  { method: 'GET',  pattern: pathToRegex('/api/notifications/unread-count').regex, paramNames: pathToRegex('/api/notifications/unread-count').names, handler: (c) => notifications.unread(c) },
  { method: 'POST', pattern: pathToRegex('/api/notifications/read-all').regex, paramNames: pathToRegex('/api/notifications/read-all').names, handler: (c) => notifications.markAll(c) },
  { method: 'POST', pattern: pathToRegex('/api/notifications/:id/read').regex, paramNames: pathToRegex('/api/notifications/:id/read').names, handler: (c, p) => notifications.markOne(c, p.id) },

  // ---- coins ----
  { method: 'GET',  pattern: pathToRegex('/api/coins/balance').regex, paramNames: pathToRegex('/api/coins/balance').names, handler: (c) => coins.balance(c) },
  { method: 'POST', pattern: pathToRegex('/api/coins/spend').regex, paramNames: pathToRegex('/api/coins/spend').names, handler: (c) => coins.spend(c) },
  { method: 'POST', pattern: pathToRegex('/api/ads/reward').regex, paramNames: pathToRegex('/api/ads/reward').names, handler: (c) => coins.watchAd(c) },

  // ---- arena ----
  { method: 'GET',  pattern: pathToRegex('/api/arena/topics').regex, paramNames: pathToRegex('/api/arena/topics').names, handler: (c) => arena.list(c) },
  { method: 'GET',  pattern: pathToRegex('/api/arena/topics/:id').regex, paramNames: pathToRegex('/api/arena/topics/:id').names, handler: (c, p) => arena.detail(c, p.id) },
  { method: 'POST', pattern: pathToRegex('/api/arena/topics/:id/posts').regex, paramNames: pathToRegex('/api/arena/topics/:id/posts').names, handler: (c, p) => arena.create(c, p.id) },

  // ---- polls ----
  { method: 'GET',  pattern: pathToRegex('/api/polls/:id').regex, paramNames: pathToRegex('/api/polls/:id').names, handler: (c, p) => polls.detail(c, p.id) },
  { method: 'POST', pattern: pathToRegex('/api/polls/:id/vote').regex, paramNames: pathToRegex('/api/polls/:id/vote').names, handler: (c, p) => polls.castVote(c, p.id) },

  // ---- admin ----
  { method: 'POST', pattern: pathToRegex('/api/admin/users').regex, paramNames: pathToRegex('/api/admin/users').names, handler: (c) => admin.users(c) },
  { method: 'GET',  pattern: pathToRegex('/api/admin/devices').regex, paramNames: pathToRegex('/api/admin/devices').names, handler: (c) => admin.devices(c) },
  { method: 'GET',  pattern: pathToRegex('/api/admin/accounts').regex, paramNames: pathToRegex('/api/admin/accounts').names, handler: (c) => admin.accounts(c) },
  { method: 'POST', pattern: pathToRegex('/api/admin/switch-account').regex, paramNames: pathToRegex('/api/admin/switch-account').names, handler: (c) => admin.switchAccountRoute(c) },
  { method: 'POST', pattern: pathToRegex('/api/admin/arena/topics').regex, paramNames: pathToRegex('/api/admin/arena/topics').names, handler: (c) => admin.adminArenaTopic(c) },
  { method: 'POST', pattern: pathToRegex('/api/admin/posts').regex, paramNames: pathToRegex('/api/admin/posts').names, handler: (c) => admin.adminCreatePost(c) },
  { method: 'POST', pattern: pathToRegex('/api/admin/posts/:id/pin').regex, paramNames: pathToRegex('/api/admin/posts/:id/pin').names, handler: (c, p) => admin.adminPin(c, p.id) },
  { method: 'DELETE', pattern: pathToRegex('/api/admin/posts/:id').regex, paramNames: pathToRegex('/api/admin/posts/:id').names, handler: (c, p) => admin.adminDelete(c, p.id) },
];

function health(_ctx: RequestCtx): Promise<Response> {
  return Promise.resolve(json({ ok: true, serverNow: new Date().toISOString() }));
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return corsPreflight();

  try {
    const url = new URL(req.url);
    const pathname = url.pathname.replace(/\/$/, '') || '/';

    const authCtx = await getAuthContext(req, supabase);
    const ctx: RequestCtx = { req, url, supabase, auth: authCtx };

    for (const r of ROUTES) {
      if (r.method !== req.method) continue;
      const m = pathname.match(r.pattern);
      if (!m) continue;
      const params: Record<string, string> = {};
      for (let i = 0; i < r.paramNames.length; i++) {
        params[r.paramNames[i]] = decodeURIComponent(m[i + 1]);
      }
      return withCors(await r.handler(ctx, params));
    }

    // Allow /api prefix-only to be a no-op rather than 404 (helps debugging).
    if (pathname === '/api') {
      return withCors(json({ ok: true, message: 'Ghostline API. See /api/health.' }));
    }

    return withCors(notFound(`no route for ${req.method} ${pathname}`));
  } catch (e) {
    if (e instanceof Response) return withCors(e);
    return withCors(serverError(e));
  }
});
