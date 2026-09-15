# Ghostline — Supabase Capacity Estimates (per plan)

**Project:** Ghostline (identity-first social: rotating UIDs, feed, DMs, polls, arena, coin economy)
**Stack:** React (Netlify) + 1 Supabase Edge Function + Postgres + Storage (`ghostline-media`) + pg_cron
**Tables:** posts, comments, arena_posts, dms, notifications, tokens, plus polls/coins rooms
**Realtime:** Web/src/api.ts hits `/api/*` via the Edge Function; no direct Realtime channel subscriptions detected in frontend — Realtime usage = 0 unless added

---

## How the numbers were derived

- **MAU → DAU**: standard social-app ratio 10–20% (min/avg/max). DAU = MAU × 0.10–0.20 ÷ 30.
- **Concurrent users**: 1–2% of DAU (min/avg/max) — bursty social apps can spike to 5%.
- **Peak req/sec**: each active user makes ~1–5 requests/sec of UI churn (feed scroll, poll tick, DM send, arena update). Concurrent × 3 = rough req/sec load on the Edge Function.
- **Realtime connections**: with the current code (no `.subscribe()` on `channel()`) = effectively 0. If you add Postgres Changes or Broadcast later, cap at Supabase's 200 (Free) / 500 (Pro) concurrent per project by default.
- **Edge Function cold start** on Free plan can hit 1–3s on first hit; Pro gets faster cold starts but no SLA on either.

---

## Supabase FREE plan ($0/mo)

| Metric | Min | Avg | Max |
|---|---|---|---|
| MAU | 50,000 (hard cap) | 50,000 | 50,000 |
| DAU | 1,667 | 5,000 | 10,000 |
| Concurrent users | ~15 | ~75 | ~200 |
| Peak req/sec | ~45 | ~225 | ~600 (will choke) |
| Realtime connections | 0 (none used) | 0 | 200 (project limit) |
| DB size | <500 MB | ~250 MB | 500 MB (cap) |
| Egress | <1 GB/mo | ~3 GB/mo | 5 GB/mo |
| File storage | <100 MB | ~500 MB | 1 GB (cap) |

**Verdict for Ghostline on Free:**
- OK for MVP / friends-and-family testing under ~500 DAU.
- Single Edge Function + shared CPU + 500 MB RAM will start returning 5xx once concurrent > ~100 with feed queries (joins across posts/comments/users).
- **Pauses after 1 week inactivity** — fatal for a social app. You must log into the dashboard weekly or write a keep-alive ping (e.g., cron-job.org → your Edge Function).
- DMs and feed pagination are read-heavy → will burn through 5 GB egress fast if users load photos.

---

## Supabase PRO plan ($25/mo base + usage)

| Metric | Min | Avg | Max |
|---|---|---|---|
| MAU | 100,000 (base) | 100,000 | 100,000+ (scales with $$) |
| DAU | 3,333 | 10,000 | 20,000+ (scales) |
| Concurrent users | ~50 | ~200 | ~1,000 |
| Peak req/sec | ~150 | ~600 | ~3,000 |
| Realtime connections | 0 (none used) | 0 | 500 (project limit; raise via support) |
| DB size | ~1 GB | ~4 GB | 8 GB (then $0.125/GB) |
| Egress | ~5 GB/mo | ~80 GB/mo | 250 GB/mo (then $0.09/GB) |
| File storage | ~1 GB | ~50 GB | 100 GB (then $0.0213/GB) |

**Verdict for Ghostline on Pro:**
- Comfortable for **~10k DAU** with current Edge Function monolith.
- Will need splitting (auth/feed/dms into separate functions) past ~3k concurrent.
- pg_cron keeps running on Pro (it's part of the DB).
- Daily backups + 7-day log retention help when DMs/coins economy breaks.

---

## Ghostline-specific bottlenecks on this project

1. **Single Edge Function for all routes** (`/api/*`). Each request wakes the same cold instance. At >200 concurrent users, you'll see p99 latency spikes. Fix: split into `feed`, `dms`, `arena`, `auth` functions.
2. **Token rotation runs on pg_cron** (every 60s). Cheap but writes to `tokens` table — at high DAU this row count grows. Add a `DELETE WHERE rotated_at < now() - interval '7 days'` job.
3. **Photos in `ghostline-media` bucket, public.** Egress dominates cost. A single 2 MB photo viewed 1,000× = 2 GB. Pro 250 GB limit = ~125k photo views/mo.
4. **bcryptjs in Edge Function** — slower than native bcrypt. Adds ~80–150ms per `issueSession` call. Fine at low volume, hurts at peak.
5. **No Realtime yet.** The 200/500 connection caps are currently irrelevant. If you later add live arena debates or DM typing indicators, you'll need to plan for that.

---

## Recommendations

- **Now (Free):** Cap invites at ~500 DAU. Add a weekly keep-alive ping.
- **Upgrade trigger:** When you cross ~1,000 DAU OR see Edge Function 5xx in logs OR egress >3 GB/mo.
- **At Pro:** Add caching (Cloudflare in front of Edge Function for `/api/feed`), compress photos, add CDN. This single change can 4× your capacity.
- **Beyond 10k DAU:** Consider splitting Edge Functions, moving coins/arena writes to a queue, and adding a read replica for the feed.

---

*Estimates are conservative and assume simple read-heavy workloads. Numbers are not from Supabase SLA — they're reasoned engineering estimates based on stated plan limits and the project's actual code shape.*
