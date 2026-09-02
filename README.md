# Ghostline

Identity-first social app: rotating 24h UIDs over a long-lived device DID, with a feed, DMs, polls, an arena (multi-side debates), coin economy, and an admin surface.

## Repo layout

```
Web/        React + Vite frontend. Deploys to Netlify.
Server/
  server.js           Node/Express local dev server (JSON file storage).
  routes/             Local route handlers.
  lib/                Local helpers.
  schema.sql          Postgres schema (source of truth for Supabase).
  supabase/
    config.toml       Supabase local config.
    functions/api/    Single Supabase Edge Function (Deno + TypeScript).
    migrations/       SQL migrations applied via `supabase db push`.
docs/        Product spec — read 04-api-reference.md and 09-infra-devops-security-legal.md.
```

## Architecture (production)

- **Frontend**: Netlify serves the React build. Env var `VITE_API_BASE` points to the Edge Function URL.
- **Backend**: One Supabase Edge Function at `Server/supabase/functions/api/index.ts` routes every `/api/*` path.
- **Database**: Supabase Postgres. The `tokens` table replaces the in-memory token Map. pg_cron replaces the `setInterval(60s)` rotation tick.
- **Photos**: Supabase Storage bucket `ghostline-media` (no local-disk fallback in the Edge Function).

## Local dev

```bash
# Terminal 1 — backend
cd Server
npm install
node server.js               # listens on :3001

# Terminal 2 — frontend
cd Web
npm install
npm run dev                  # http://localhost:5173, proxies /api -> :3001
```

## Deploy

1. **Apply the migration once** to your Supabase Postgres (via SQL editor or `supabase db push`).
2. **Deploy the Edge Function**: `supabase functions deploy api`.
3. **Push the repo to GitHub** and connect it to Netlify. Set the env var `VITE_API_BASE=https://<project>.supabase.co/functions/v1` in Netlify (no trailing `/api` — the client appends it).

The Node server in `Server/` is kept for local development only.

## Security

`Server/.env` is gitignored. Never commit service-role keys. Set `SUPABASE_SERVICE_ROLE_KEY` as a Supabase secret (`supabase secrets set ...`), not as a frontend env var.
