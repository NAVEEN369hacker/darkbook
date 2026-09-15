// _shared/parse.ts — parse JSON bodies, URL query, and multipart form data.
//
// The two endpoints that accept multipart are /api/posts and /api/admin/posts.
// Everywhere else we expect application/json.

export async function readJson(req: Request): Promise<Record<string, unknown>> {
  const ct = req.headers.get('content-type') ?? '';
  if (!ct.includes('application/json')) return {};
  try {
    const raw = await req.json();
    return typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export function readQuery(url: URL): URLSearchParams {
  return url.searchParams;
}

export interface ParsedForm {
  fields: Record<string, string>;
  files: Record<string, { bytes: Uint8Array; name: string; type: string }>;
}

export async function readMultipart(req: Request): Promise<ParsedForm> {
  const fd = await req.formData();
  const fields: Record<string, string> = {};
  const files: Record<string, { bytes: Uint8Array; name: string; type: string }> = {};
  for (const [key, value] of fd.entries()) {
    if (typeof value === 'string') {
      fields[key] = value;
    } else {
      const bytes = new Uint8Array(await value.arrayBuffer());
      files[key] = { bytes, name: value.name, type: value.type };
    }
  }
  return { fields, files };
}

export function getClientIp(req: Request): string {
  const xff = req.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim();
  const real = req.headers.get('x-real-ip');
  if (real) return real;
  return '127.0.0.1';
}

export function getUserAgent(req: Request): string {
  return req.headers.get('user-agent') ?? 'unknown';
}
