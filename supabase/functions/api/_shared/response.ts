// _shared/response.ts — HTTP response helpers with CORS.
//
// Every response we return goes through withCors() so the browser is
// happy both from the Netlify-hosted frontend and from direct curl.

const CORS_HEADERS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
  'access-control-allow-headers': 'authorization,content-type,x-supabase-api-version',
  'access-control-max-age': '86400',
};

export function corsPreflight(): Response {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export function withCors(res: Response): Response {
  const out = new Response(res.body, res);
  for (const [k, v] of Object.entries(CORS_HEADERS)) {
    if (!out.headers.has(k)) out.headers.set(k, v);
  }
  return out;
}

export function json(
  body: unknown,
  status = 200,
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...extraHeaders,
    },
  });
}

export function empty(status = 204): Response {
  return new Response(null, { status });
}

export function badRequest(message: string, extra: Record<string, unknown> = {}): Response {
  return json({ error: 'validation_failed', message, ...extra }, 422);
}

export function unauthorized(message = 'missing or invalid token'): Response {
  return json({ error: 'unauthenticated', message }, 401);
}

export function forbidden(message = 'forbidden'): Response {
  return json({ error: 'forbidden', message }, 403);
}

export function notFound(message = 'not_found'): Response {
  return json({ error: 'not_found', message }, 404);
}

export function paymentRequired(message: string, extra: Record<string, unknown> = {}): Response {
  return json({ error: 'insufficient_coins', message, ...extra }, 402);
}

export function conflict(message: string): Response {
  return json({ error: 'conflict', message }, 409);
}

export function serverError(err: unknown): Response {
  const message = err instanceof Error ? err.message : String(err);
  console.error('[server_error]', message);
  return json({ error: 'server_error', message }, 500);
}
