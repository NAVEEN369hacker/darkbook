// _shared/env.ts — required/optional environment accessors.
//
// In Supabase Edge Functions these are set via:
//   supabase secrets set SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=...
//   (or automatically: SUPABASE_URL + SUPABASE_ANON_KEY are injected;
//    we additionally expect SUPABASE_SERVICE_ROLE_KEY to be set.)

export function getRequiredEnv(name: string): string {
  const v = Deno.env.get(name);
  if (!v || v.length === 0) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return v;
}

export function getOptionalEnv(name: string, fallback: string): string {
  const v = Deno.env.get(name);
  return v && v.length > 0 ? v : fallback;
}
