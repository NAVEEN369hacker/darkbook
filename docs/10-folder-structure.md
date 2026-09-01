# 10 — Folder Structure & Monorepo Conventions

The codebase is a **pnpm + Turborepo** monorepo. Strict package boundaries prevent accidental cross-imports.

---

## 1. Top-level layout

```
ghostline/
├── apps/
│   ├── web/                    # React + Vite + TS (PWA)
│   ├── mobile/                 # React Native + Expo + TS
│   └── admin/                  # Internal moderation console
├── services/
│   ├── api/                    # Express + TS REST/GraphQL
│   ├── realtime/               # Socket.IO
│   ├── moderation/             # Content + image classification worker
│   ├── abuse-scorer/           # Behavioral scoring worker
│   └── notifications/          # Push fan-out worker
├── packages/
│   ├── shared-types/           # Zod schemas + TS types
│   ├── crypto/                 # ECDSA sign/verify (web + node + RN)
│   ├── feed/                   # Pure ranking functions
│   ├── ui-tokens/              # Design tokens (colors, spacing, type)
│   ├── i18n/                   # i18next catalogs
│   └── testing/                # Shared mocks, factories
├── infra/
│   ├── terraform/              # AWS infra
│   ├── docker/                 # Dockerfiles (mostly generated)
│   └── helm/                   # (future)
├── config/
│   ├── eslint/
│   ├── tsconfig/
│   └── prettier/
├── docs/                       # ← all framework docs
├── scripts/                    # one-off ops scripts
├── .github/
│   └── workflows/
├── turbo.json
├── pnpm-workspace.yaml
├── package.json
└── README.md
```

## 2. Package boundaries

| Package | Allowed to import from |
|---|---|
| `apps/*` | `packages/*`, anything in their own app |
| `services/*` | `packages/*`, never other services directly (use HTTP) |
| `packages/shared-types` | nothing else (leaf) |
| `packages/crypto` | `shared-types` only |
| `packages/feed` | `shared-types` only |
| `packages/ui-tokens` | nothing |
| `packages/i18n` | `shared-types` only |
| `packages/testing` | anything (dev only) |

ESLint `no-restricted-imports` enforces these.

## 3. Service-internal layout (e.g., `services/api`)

```
services/api/
├── src/
│   ├── main.ts
│   ├── server.ts
│   ├── config/
│   │   └── env.ts               # zod-validated env
│   ├── routes/
│   │   ├── v1/
│   │   │   ├── auth.ts
│   │   │   ├── posts.ts
│   │   │   ├── votes.ts
│   │   │   ├── feed.ts
│   │   │   ├── rooms.ts
│   │   │   ├── media.ts
│   │   │   ├── reports.ts
│   │   │   ├── search.ts
│   │   │   ├── notifications.ts
│   │   │   └── appeals.ts
│   │   └── graphql.ts
│   ├── middleware/
│   │   ├── auth.ts              # JWT verify
│   │   ├── signature.ts         # ECDSA verify
│   │   ├── rate-limit.ts
│   │   ├── abuse-score.ts
│   │   ├── error-handler.ts
│   │   ├── request-id.ts
│   │   └── logger.ts
│   ├── domain/
│   │   ├── identities/
│   │   ├── posts/
│   │   ├── votes/
│   │   ├── rooms/
│   │   ├── reports/
│   │   └── appeals/
│   ├── infra/
│   │   ├── mongo.ts
│   │   ├── redis.ts
│   │   ├── s3.ts
│   │   ├── search.ts
│   │   └── opentelemetry.ts
│   ├── jobs/                    # background tasks (BullMQ)
│   └── utils/
├── test/
│   ├── integration/             # supertest
│   └── unit/
├── Dockerfile
├── package.json
├── tsconfig.json
└── README.md
```

## 4. Naming

* Files: `kebab-case.ts` (except `*.test.ts`, `*.spec.ts`, `index.ts`)
* Classes / types / interfaces: `PascalCase`
* Functions / variables: `camelCase`
* Constants: `UPPER_SNAKE_CASE`
* DB collections: `snake_case` plural (`identities`, `posts`, `votes`)
* Public IDs: `{type}_{uuidv7}` where type ∈ `p,c,r,m,u,a,n` (post, comment, room, media, user, appeal, notification)

## 5. Versioning & changelog

* Per-package semver, fixed across the monorepo via `pnpm -r publish` only at release time
* `CHANGELOG.md` per service, generated from conventional commits
* Mobile uses native semver (`1.4.2`) shown in app; API uses `/v1` path versioning

## 6. Local dev

```
# Prereqs: node 20, pnpm 9, docker, minikube or colima
pnpm install
pnpm dev                       # starts all services + apps via turbo
pnpm test
pnpm lint
pnpm typecheck
pnpm e2e:web
pnpm e2e:mobile                # requires simulators
```

A `docker-compose.yml` at the root provides Mongo, Redis, OpenSearch, and MailHog for local dev.

## 7. Feature flags

* `flagsmith` (self-hosted) for runtime flags
* Conventions: flag names `kebab-case`, scope `service` or `global`, default off in prod
* Every flag has a removal ticket linked in the description
