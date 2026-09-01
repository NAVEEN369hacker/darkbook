# 01 — System Architecture

> **v2 identity model** — see [12-changelog.md](./12-changelog.md). Two IDs (DID + UID), daily UID rotation with full social-state purge, and E2E-encrypted DMs. This adds the `uid-rotator` worker and the `dm-store` (ciphertext-only) collection, and changes which collections have TTLs.

## 1. High-level diagram

```
                    ┌──────────────────────────────────────────────────────────┐
                    │                       Client Layer                       │
                    │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  │
                    │  │ Web (PWA)│  │ iOS App  │  │ Android  │  │ Admin    │  │
                    │  │ React+TS │  │ RN/Expo  │  │ RN/Expo  │  │ Console  │  │
                    │  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘  │
                    └───────┼─────────────┼─────────────┼─────────────┼────────┘
                            │ HTTPS (REST + GraphQL over /graphql)         WSS
                            │             WebSocket (Socket.IO)              │
                            ▼                                                 ▼
                    ┌──────────────────────────────────────────────────────────┐
                    │                  CloudFront + WAF                        │
                    │   (TLS 1.3, rate limit, geo-block, bot rules)            │
                    └────────────────────┬─────────────────────────────────────┘
                                         │
                                         ▼
                    ┌──────────────────────────────────────────────────────────┐
                    │       ALB  →  ECS Fargate (auto-scaling, multi-AZ)        │
                    │                                                          │
                    │   ┌─────────────┐  ┌─────────────┐  ┌─────────────┐     │
                    │   │  api (REST  │  │  realtime   │  │  graphql    │     │
                    │   │  + auth)    │  │  (Socket.IO)│  │  gateway    │     │
                    │   └──────┬──────┘  └──────┬──────┘  └──────┬──────┘     │
                    └──────────┼────────────────┼────────────────┼───────────┘
                               │                │                │
            ┌──────────────────┼────────────────┼────────────────┼─────────────┐
            │                  │     Internal VPC (private subnets)            │
            │                  ▼                ▼                ▼             │
            │      ┌────────────────────────────────────────────────────┐      │
            │      │         Sidecar: abuse-scorer, mod-filter          │      │
            │      └───────┬──────────────────────────────┬────────────┘      │
            │              │                              │                   │
            │              ▼                              ▼                   │
            │   ┌────────────────┐              ┌────────────────┐            │
            │   │ Redis (ElastiC)│              │   MongoDB      │            │
            │   │  rate limits,  │              │   Atlas        │            │
            │   │  hot feed,     │              │  primary+2 RS  │            │
            │   │  pubsub        │              └────────────────┘            │
            │   └────────────────┘                                              │
            │                                                                  │
            │   ┌────────────────┐              ┌────────────────┐            │
            │   │  S3 (media)    │              │ OpenSearch     │            │
            │   │  + CloudFront  │              │ (search index) │            │
            │   └────────────────┘              └────────────────┘            │
            │                                                                  │
            │   ┌────────────────┐              ┌────────────────┐            │
            │   │ NCMEC API /    │              │  PagerDuty /   │            │
            │   │ PhotoDNA hash  │              │  Slack on-call │            │
            │   └────────────────┘              └────────────────┘            │
            └──────────────────────────────────────────────────────────────────┘
                                         │
                                         ▼
                          ┌──────────────────────────────┐
                          │   Observability              │
                          │   OTel → Grafana Tempo/Loki  │
                          │   Prometheus + Alertmanager  │
                          └──────────────────────────────┘
```

## 2. Service boundaries

| Service | Purpose | Talks to |
|---|---|---|
| `api` | REST + GraphQL, identity, content CRUD, voting, reporting, feed | Mongo, Redis, S3, moderation, abuse-scorer |
| `realtime` | Socket.IO gateway, room subscriptions, presence (room-scoped only), push fan-out | Redis pubsub, api, FCM/APNs |
| `graphql` | Apollo Server (merged with REST for v1; full GraphQL in v2) | api (delegates), Mongo |
| `moderation` | Async worker: text filter, image hash match, AI classification | Mongo, S3, NCMEC |
| `abuse-scorer` | Stream processor: per-**DID** abuse score | Redis Streams, Mongo, api (writes shadow-bans) |
| `uid-rotator` | Scheduled job + event-driven: issues new UIDs at UTC 00:00, purges expired social state | Mongo, Redis |
| `dm-store` | Logical service inside `api` that stores only ciphertext for DM threads and messages; never has plaintext | Mongo |
| `admin` (frontend) | Internal-only React console for moderators | api (with staff JWT) |
| `web` | Public site, marketing, PWA | api, realtime, S3 (images) |
| `mobile` | iOS/Android via Expo | api, realtime, push |

## 3. Request lifecycle: a post

1. Client (web or mobile) signs request with the device private key (ECDSA over P-256).
2. `api` verifies signature against the registered device public key, checks the JWT's `uid` claim is current, and looks up the device in Redis.
3. `api` consults `abuse-scorer` keyed on the **DID** (not the UID) — if the device is shadow-banned, returns 200 with synthetic "queued" status and never stores. Bans live on the device, so a UID rotation cannot reset them.
4. Otherwise, the post is written to `posts` (Mongo) with `authorUid` and a denormalized `authorDid`.
5. `moderation` worker picks up the new post from a change stream; runs text + image classifiers.
6. If clean: `realtime` fans out to subscribers in the room via Socket.IO.
7. If flagged: status flips to `under_review`, and the author sees a "pending review" message.
8. Mongo TTL index on `posts.createdAt` (25h) guarantees the post is purged at the next UID rotation, even if the author is offline.

## 3b. UID rotation lifecycle

1. Cron fires at `00:00:00 UTC` (`uid-rotator` worker).
2. The worker iterates `daily_identities` where `rotatesAt <= now`.
3. For each expired UID: mark `status = "rotating"`, then issue a new UID row, then hard-delete `posts`, `votes`, `follows`, `dm_threads`, `dm_messages` for the expired UID.
4. Redis: `uid:active:{oldUid}` is deleted; `uid:byDid:{did}` is updated to the new UID.
5. WebSocket: server emits `uid.rotated` to any active socket whose token's UID just expired.
6. The whole batch is atomic per UID (transaction). A 5-min grace period covers clients in the middle of requests.
7. Audit log entry written per rotation: `{ did, oldUid, newUid, rotatedAt, source: "client"|"server" }`.

## 4. Tech rationale

* **MongoDB** — flexible content shape, decent ops, Atlas for managed. TTL indexes are native and cheap, which is critical for the 25h purge.
* **Redis** — atomic counters (rate limit), sorted sets (hot feed), pubsub (realtime fan-out), streams (abuse scoring). Keyed on DID for stability, on UID for in-app ephemerality.
* **Socket.IO** — mature, handles reconnect, fallbacks to long-poll. (We accept that raw WS would be leaner; Socket.IO's reconnect + room semantics save weeks.)
* **Express + Apollo** — REST for predictable ops and the auth handshake (which has a custom signed-header shape that doesn't fit GraphQL cleanly), GraphQL for the read-side fan-in (one round trip for a feed page).
* **Expo** — managed RN so we can ship without a Mac for Android dev; EAS Build for both stores.
* **AWS over GCP/Azure** — composes well with the team's existing infra; could run on GCP with minor swap.

## 5. Failure modes & degraded behavior

| Failure | Behavior |
|---|---|
| MongoDB unreachable | Read-only mode: feeds served from Redis cache; writes return 503 with retry-after |
| Redis unreachable | Rate limiter falls back to in-memory token bucket per pod; abuse score queries return 0 (fail-open, log loudly) |
| Realtime down | Clients fall back to long-poll `/feed/updates?since=...` |
| Moderation worker down | Posts enter "delayed moderation" — visible for 5 min, then audited retroactively |
| S3 down | Text-only posts still work; image posts are rejected with a friendly error |
| Push provider down | In-app inbox still works; user gets a banner "enable notifications" on next launch |

## 6. Capacity targets (v1)

* 100k DAU
* 50 RPS sustained, 500 RPS peak
* 95p read latency < 200ms, write latency < 400ms
* Storage: 60-day rolling content retention for media; text retained until deleted

## 7. Multi-region (v2)

Active-active in two regions (US-East, EU-West). Mongo global cluster. DynamoDB Global Tables for rate-limit counters. CRDTs for vote tallies (last-writer-wins with monotonic counter).
