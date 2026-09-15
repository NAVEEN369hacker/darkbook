# DEPLOYMENT.md

> **Read this first.** Everything you need to update the app — locally, in Git, on Supabase Edge Functions, and on Netlify — in one place. Written so a human or an AI agent can follow it without prior context.

---

## 1. What this repo is

**Ghostline** — an identity-first social app (rotating 24h UIDs, feed, DMs, polls, arena, coin economy, admin).

It has **three independent deploys** that talk to each other over HTTP:

| Piece | Lives in | Deploys to | Stack |
|---|---|---|---|
| **Frontend** | `Web/` | **Netlify** (static) | React + Vite + TypeScript |
| **Backend** | `supabase/functions/api/` | **Supabase Edge Function** | Deno + TypeScript (single function, routes everything under `/api/*`) |
| **Database** | `supabase/migrations/` | **Supabase Postgres** | SQL migrations |

Your laptop is **not** a server. Everything that runs in production runs in the cloud.

---

## 2. Repo layout (the truth — ignore old READMEs)

```
.
├── Web/                       # Frontend source (deploys to Netlify)
│   ├── src/
│   │   ├── api.ts             # ALL HTTP calls go through here
│   │   ├── pages/             # One file per route
│   │   └── components/
│   ├── netlify.toml           # Netlify build config
│   ├── package.json
│   └── vite.config.ts
│
├── supabase/                  # Backend + DB
│   ├── functions/
│   │   └── api/               # ★ THE EDGE FUNCTION (see §5)
│   │       ├── index.ts       # Entry point — routes every /api/* request
│   │       ├── routes/        # One file per resource (auth, posts, dms, ...)
│   │       ├── lib/           # Shared business logic (db helpers, crypto, etc.)
│   │       └── _shared/       # Shared utilities (env, parsing, response helpers)
│   ├── migrations/            # SQL files, applied in order by filename
│   ├── config.toml            # Supabase CLI project config (linked project)
│   └── .temp/                 # Auto-generated CLI cache — DO NOT EDIT, can gitignore
│
├── Server/                    # ⚠️ Node/Express LOCAL DEV SERVER ONLY
│   ├── server.js              # Runs on localhost:3001
│   ├── routes/                # Mirror of Edge Function routes, but Node
│   ├── lib/                   # Mirror of Edge Function lib, but Node
│   └── schema.sql             # Old Postgres schema (kept for reference)
│
├── docs/                      # Product spec — read 04-api-reference.md and 09-infra-devops-security-legal.md
├── .commandcode/              # Command Code IDE config (taste, settings)
└── DEPLOYMENT.md              # ← you are here
```

> **Old README note**: `README.md` still mentions `Server/supabase/functions/...`. That path is **wrong now**. The Edge Function lives at `supabase/functions/api/`. Always edit files there.

---

## 3. The three environments

| Env | URL pattern | Who uses it |
|---|---|---|
| **Local dev** | `http://localhost:5173` (Web) → `http://localhost:3001/api/...` (Node server) | You, on your laptop |
| **Production** | `https://<your-site>.netlify.app` → `https://<project-ref>.supabase.co/functions/v1/api/...` | Real users |

The frontend reads **one** env var to know which backend to call:

- `VITE_API_BASE` in `Web/.env` (local) or Netlify env (prod).
- Format: `https://...` **with no trailing `/api`** — the client appends `/api/...` itself.

---

## 4. Local development

### One-time setup

```bash
# Backend deps (Node local server)
cd Server && npm install && cd ..

# Frontend deps
cd Web && npm install && cd ..
```

### Run it (two terminals)

**Terminal 1 — backend (Node local server on :3001):**
```bash
cd Server
node server.js
```

**Terminal 2 — frontend (Vite on :5173):**
```bash
cd Web
npm run dev
```

Open `http://localhost:5173`. The frontend's Vite proxy auto-routes `/api/*` to `:3001`.

### Optional: run the Edge Function locally instead

Requires Docker (the CLI uses it to emulate Deno).

```bash
npx supabase functions serve api --env-file ./supabase/.env.local
# Then point Web/.env's VITE_API_BASE at http://localhost:54321/functions/v1
```

---

## 5. Updating the Edge Function (the most common task)

The Edge Function is a **single Deno + TypeScript** function that routes every `/api/*` path internally. To change backend behavior, edit files in `supabase/functions/api/`.

### Where to edit

| What you're changing | File |
|---|---|
| New endpoint / route | `supabase/functions/api/index.ts` (register) + new file in `routes/` |
| Business logic for a resource | `supabase/functions/api/lib/<resource>.ts` |
| Shared helper (env, parsing, response) | `supabase/functions/api/_shared/*.ts` |

### Deploy it

From the **repo root**:

```bash
npx supabase functions deploy api --project-ref <your-project-ref>
```

- `<your-project-ref>` is the part before `.supabase.co` in your project URL.
- The project is already linked (see `supabase/config.toml`), so `--project-ref` is optional if you're in the repo root.
- **Docker is not required for deploy** — only for `functions serve` (local emulation). The "WARNING: Docker is not running" message is harmless.

### Verify it deployed

```bash
# Should return 200 with some JSON (or 401 if the endpoint needs auth)
curl https://<project-ref>.supabase.co/functions/v1/api/health
```

Or check the Supabase dashboard: https://supabase.com/dashboard/project/<project-ref>/functions

---

## 6. Updating the database (SQL migrations)

### Create a new migration

```bash
npx supabase migration new <short_description>
# Creates: supabase/migrations/<timestamp>_<short_description>.sql
```

Edit the file. Use **forward-only** changes (no `DROP` of columns users depend on; use `ADD` + backfill + ignore).

### Apply it to production

**Option A — via Supabase dashboard (safest, one-off):**
1. Open https://supabase.com/dashboard/project/<project-ref>/sql/new
2. Paste the migration SQL.
3. Click Run.

**Option B — via CLI (after first linking):**
```bash
npx supabase db push --project-ref <project-ref>
```

> Always back up before destructive migrations. The dashboard has "Restore to point in time" under Database → Backups.

### Seed data / service-role permissions

If you change `tokens` table permissions, edit the `grants.sql` migration. The latest one is `supabase/migrations/20260101000001_grants.sql`.

---

## 7. Updating the frontend

### Edit

Everything is in `Web/src/`. Most common edits:

- **New page**: add file in `Web/src/pages/`, register route in `Web/src/App.tsx`.
- **API call change**: edit `Web/src/api.ts` (the single source for HTTP).
- **Style**: edit `Web/src/styles.css`.
- **Env var**: add to `Web/.env` locally, and to Netlify env in production (see §8).

### Test locally

```bash
cd Web && npm run dev
```

### Build (catch type errors before deploy)

```bash
cd Web && npm run build
```

### Deploy

Just push to GitHub — Netlify auto-deploys the `main` branch.

```bash
git push origin main
```

---

## 8. Netlify setup (one-time, then automatic)

1. Go to https://app.netlify.com → **Add new site** → **Import from Git** → pick `NAVEEN369hacker/darkbook`.
2. Build settings:
   - **Base directory**: `Web`
   - **Build command**: `npm run build`
   - **Publish directory**: `Web/dist`
3. **Environment variables** (Site settings → Environment):
   - `VITE_API_BASE` = `https://<project-ref>.supabase.co/functions/v1` (no trailing `/api`)

After this, every push to `main` triggers a Netlify deploy automatically.

---

## 9. Supabase CLI setup (one-time per machine)

```bash
# Install (if not already)
npm install -g supabase

# Login (opens browser)
npx supabase login

# Link this repo to your project (one-time)
npx supabase link --project-ref <your-project-ref>
```

Verify:
```bash
npx supabase status
```

You should see your project ref and API URL.

---

## 10. Secrets (API keys, service role)

**Never** put secrets in `Web/.env` that ship to the browser. Vite inlines anything prefixed with `VITE_` into the JS bundle.

| Secret | Where to set it |
|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | `npx supabase secrets set SUPABASE_SERVICE_ROLE_KEY=...` (server-side only, used inside the Edge Function) |
| `SUPABASE_URL` | Usually auto-available in Edge Functions as `Deno.env.get('SUPABASE_URL')` — don't override unless needed |
| Frontend anon key | `Web/.env` as `VITE_SUPABASE_ANON_KEY` (safe to expose) |
| `VITE_API_BASE` | `Web/.env` locally; Netlify env in prod |

To list current Supabase function secrets:
```bash
npx supabase secrets list --project-ref <project-ref>
```

---

## 11. End-to-end update checklist (the cookbook)

**Scenario: you changed a route handler in the Edge Function.**

```bash
# 1. Edit the file
code supabase/functions/api/lib/feed.ts

# 2. (Optional) test locally with the Node mirror
cd Server && node server.js          # in another terminal, check same route works there
cd ..

# 3. Deploy
npx supabase functions deploy api

# 4. Commit + push (so GitHub reflects deployed state)
git add supabase/functions/
git commit -m "Fix feed pagination in Edge Function"
git push origin main
```

**Scenario: you changed a frontend page.**

```bash
# 1. Edit
code Web/src/pages/Feed.tsx

# 2. Test
cd Web && npm run dev                # check at http://localhost:5173

# 3. Type-check + build
cd Web && npm run build

# 4. Deploy — just push, Netlify handles it
git add Web/src/pages/Feed.tsx
git commit -m "Improve Feed layout"
git push origin main
# → Netlify auto-builds and deploys in ~30s
```

**Scenario: you added a new DB column.**

```bash
# 1. Create migration
npx supabase migration new add_posts_pinned_at

# 2. Edit the file
code supabase/migrations/<timestamp>_add_posts_pinned_at.sql

# 3. Apply to prod (dashboard SQL editor is safest for one-offs)
#    Or: npx supabase db push

# 4. Update the Edge Function to read/write the new column
code supabase/functions/api/lib/posts.ts
npx supabase functions deploy api

# 5. Commit + push
git add supabase/
git commit -m "Add posts.pinned_at column"
git push origin main
```

---

## 12. Common gotchas

| Symptom | Cause | Fix |
|---|---|---|
| `npx supabase functions deploy` says "Docker is not running" | Docker daemon stopped | Ignore (it's a warning for `serve`, not `deploy`). Or start Docker. |
| `Entrypoint path does not exist - .../supabase/functions/api/index.ts` | Function files are in the wrong place | They MUST be at `supabase/functions/api/index.ts` — not under `Server/` or anywhere else. |
| Deploy succeeds but frontend gets 404 | Frontend's `VITE_API_BASE` is wrong | Should be `https://<ref>.supabase.co/functions/v1` — **no** trailing `/api`. |
| `JWT verification failed` errors in Edge Function logs | JWT verify is on but your client isn't sending a Supabase JWT | This app uses custom token check in code (`fc0f3cb` disabled JWT verify for the function). If you re-enable it, send `Authorization: Bearer <supabase-jwt>`. |
| `deno-bcrypt` Worker error in Edge Function logs | Using a module that uses Workers (unavailable in Edge Functions) | Already fixed — use `bcryptjs` (see commit `9460edb`). Don't reintroduce `deno-bcrypt`. |
| `bcryptjs` hash mismatch | Rounds differ between Node local server and Edge Function | Use the same `BCRYPT_ROUNDS` constant in both `Server/lib/auth.js` and `supabase/functions/api/lib/auth.ts`. |
| Frontend can't reach backend locally | Node server isn't running | Start `cd Server && node server.js` in a separate terminal. |
| TypeScript parse error in Edge Function | Using `interface X \| { ... } \| null` inline unions | The Deno parser rejects this. Use a named `type` alias. (See commit `999760f`.) |

---

## 13. Environment variable reference

### Web (frontend)

| Var | Example | Purpose |
|---|---|---|
| `VITE_API_BASE` | `http://localhost:3001` (local) or `https://<ref>.supabase.co/functions/v1` (prod) | Base URL for all API calls |
| `VITE_SUPABASE_ANON_KEY` | `eyJ...` | Supabase anon key (safe to ship to browser) |

### Supabase Edge Function secrets (server-side)

| Var | Purpose |
|---|---|
| `SUPABASE_URL` | Usually auto-injected by Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | Bypasses RLS — only inside the Edge Function |
| `SUPABASE_ANON_KEY` | Usually auto-injected |
| Any custom secret | Set with `npx supabase secrets set NAME=value` |

### Server (Node local dev — `.env` in `Server/`)

| Var | Purpose |
|---|---|
| `PORT` | Default `3001` |
| `JWT_SECRET` | Custom token signing secret |
| `BCRYPT_ROUNDS` | Default `10` |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Optional — only if Node server talks to Supabase |

---

## 14. Useful one-liners

```bash
# Deploy the Edge Function
npx supabase functions deploy api

# Watch live logs from the deployed function
npx supabase functions logs api --project-ref <ref>

# List all secrets
npx supabase secrets list --project-ref <ref>

# Set a secret
npx supabase secrets set MY_KEY=value --project-ref <ref>

# Open Supabase dashboard for this project
npx supabase dashboard --project-ref <ref>

# Tail Netlify deploys (if you have netlify-cli)
netlify watch

# Check git + remote state
git status && git log --oneline -5 && git remote -v
```

---

## 15. Decision tree: "I want to change X — where do I edit?"

```
What do you want to change?
│
├─ A page, button, style, or component on the website
│  └─ Edit Web/src/ → push to main → Netlify auto-deploys
│
├─ API behavior (e.g., feed pagination, auth flow)
│  └─ Edit supabase/functions/api/lib/ or routes/
│     → npx supabase functions deploy api
│     → commit + push to main
│
├─ DB schema (new column, new table, new index)
│  └─ Create a new file in supabase/migrations/
│     → apply via dashboard or `npx supabase db push`
│     → update Edge Function code to use it
│     → redeploy function
│
├─ Environment variable / secret
│  ├─ Frontend → Netlify UI
│  └─ Backend  → `npx supabase secrets set ...`
│
└─ Something in Server/ (Node local server)
   └─ Local dev only. Production runs on Supabase.
      Changes here do NOT auto-deploy anywhere.
      Mirror any logic change into supabase/functions/api/ too.
```

---

## 16. Emergency: rollback

**Frontend (Netlify):**
- Netlify dashboard → Deploys → click a previous successful deploy → **Publish deploy**.

**Edge Function:**
```bash
# Re-deploy the previous git version
git checkout HEAD~1 -- supabase/functions/api/
npx supabase functions deploy api
git checkout HEAD -- supabase/functions/api/
```

**Database:**
- Supabase dashboard → Database → Backups → **Restore to point in time**.
- ⚠️ This affects production data — use with care.

---

**Last updated:** by the move from `Server/supabase/functions/` → `supabase/functions/` (commit `a882cc8`).
