# 09 — Infrastructure, DevOps, Security, Legal

> **v2 identity model** — see [12-changelog.md](./12-changelog.md). Social collections have 25h TTLs. The daily UID rotation runs as a scheduled job. Lawful access for DMs yields only ciphertext.

This is the operational backbone. It defines how the system is built, deployed, observed, and how it responds to legal process.

---

## 1. Hosting topology

| Layer | Service | Region |
|---|---|---|
| Edge | CloudFront + AWS WAF | global |
| Load balancer | ALB | us-east-1, eu-west-1 |
| API | ECS Fargate, 2–20 tasks, auto-scaling on CPU + RPS | both regions |
| Realtime | ECS Fargate, sticky sessions via Redis adapter | both regions |
| GraphQL | ECS Fargate, merges with API | both regions |
| Workers (moderation, abuse, cleanup) | ECS Fargate, scheduled + queue-driven | both regions |
| Mongo | Atlas M30 → M50, 3-node replica set per region, global cluster for v2 | multi |
| Redis | ElastiCache, 1 primary + 2 replicas per region | both |
| S3 | Standard → IA → Glacier lifecycle | global |
| OpenSearch | 2 nodes, t3.small.search for v1 | per region |
| Secrets | AWS Secrets Manager | per region |
| CI | GitHub Actions | n/a |
| CDN cache | CloudFront, no user-content cache, only static assets | global |
| Email (transactional) | SES, DKIM+SPF+DMARC | us-east-1 |
| Status page | statuspage.io (or self-hosted Better Uptime) | n/a |

## 2. Containerization

Each service has a multi-stage Dockerfile (Node 20 alpine). Final image ≤ 150 MB. Images are scanned by Trivy in CI; critical CVEs block the build.

```dockerfile
# services/api/Dockerfile
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM node:20-alpine AS run
WORKDIR /app
RUN addgroup -S app && adduser -S app -G app
COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules
USER app
EXPOSE 3000
CMD ["node", "dist/main.js"]
```

## 3. CI/CD (GitHub Actions)

Workflows:

* `ci.yml` — on every PR: lint, typecheck, unit tests, integration tests, Trivy scan, bundle size check
* `build.yml` — on merge to `main`: build images, push to ECR
* `deploy-staging.yml` — auto on main: ECS rolling deploy to staging
* `deploy-prod.yml` — manual approval: ECS rolling deploy to prod, with a 5-min bake and automatic rollback on SLO breach

Monorepo: Turborepo. Cache hit rate target ≥ 80%.

## 4. Configuration & secrets

* 12-factor: env vars only
* Secrets: AWS Secrets Manager; mounted as env via ECS task definition
* Configs per env: `config/staging.ts`, `config/prod.ts` (region, replica count, feature flags)
* **No** secrets in code, ever. Pre-commit hook (gitleaks) blocks.

## 5. Observability

* **Tracing**: OpenTelemetry SDK in every service; OTLP exporter to Grafana Tempo. Sampling 5% in prod, 100% for errors.
* **Metrics**: Prometheus format scraped by Agent; Grafana dashboards per service.
* **Logs**: structured JSON to stdout → Promtail → Loki. PII-safe: emails and tokens are auto-redacted by a redaction middleware.
* **Errors**: Sentry, with source maps uploaded on release.
* **Alerts** (Alertmanager → PagerDuty):
  * 5xx rate > 1% over 5 min
  * p99 latency > 1s over 5 min
  * Queue lag > 1000 over 5 min
  * Disk/Mongo replication lag > 30s
  * Any CSAM report fired → page on-call immediately

## 6. CSAM / NCMEC

* **Hashing**: every uploaded image is hashed with PDQ (open source) at upload time. The hash is compared against NCMEC's hash list API (when allowed) and our internal block list.
* **PhotoDNA**: in addition, for high-risk matches, we run Microsoft PhotoDNA (requires NCMEC membership).
* **Match → action**: instant block (user sees a generic error), `media.status = "blocked"`, identity flagged with a permanent record, NCMEC CyberTipline report filed within 1 hour.
* **No CSAM may be persisted**: matched media is purged from S3 immediately after hash extraction; the hash is the only record.
* **Reporting flow**: documented runbook; on-call has 24/7 coverage; legal counsel is in the rota.
* **Staff training**: required annually; completion tracked in HR system.

## 7. Legal compliance

### 7.1 GDPR (EU users)

* **Lawful basis**: legitimate interest (security, abuse prevention) + consent (analytics, push)
* **Data we hold (v2)**:
  * **DID** (`did_<uuidv7>`) — permanent per device, server-internal, never shown to user
  * **UIDs** — daily-issued, 25h TTL, expired UIDs and their social state are deleted
  * **Posts, votes, comments, follows** — TTL-purged at 25h
  * **DMs** — ciphertext only; the server has no plaintext and cannot produce it
  * **IP, UA, device metadata** — 14d rolling logs for security
* **Data subject rights**:
  * **Access**: user can request all data associated with their **DID** — we provide a JSON export of the DID record, all currently-live posts under their active UID, and any held data under a `legal_holds` row.
  * **Erasure**: user can request erasure; we hard-delete all currently-live posts under their active UID, all `daily_identities` rows for their DID, all social state, and any retained logs. The **DID itself is tombstoned** (held in a deletion table with only the deletion date and original DID value, for fraud prevention). This tombstone is held for 7 years.
  * **Portability**: JSON export as above
  * **Object / restrict**: handled in the moderation appeals process
  * **DM access requests**: we cannot comply. We will respond explaining that DM contents are end-to-end encrypted and we hold no plaintext. We will provide ciphertext if ordered to, with a statement that it cannot be decrypted by us.
* **DPA**: in place with all sub-processors (AWS, Sentry, PostHog)
* **DPO**: appointed; contact on privacy page

### 7.2 COPPA (US, under 13)

* Anonymous devices make age verification hard. We **do not knowingly allow under-13**.
  * Onboarding self-declares: "I'm 13 or older"
  * Restricted rooms enforce 18+ (declared at registration, lightly honored — anonymous systems can't truly verify age)
  * If we learn a user is under 13, we delete their DID and tombstone the record
* **Personal information**: we collect none. COPPA's safe-harbor for "support for internal operations" applies to our IP/UA logs.

### 7.3 Section 230 (US)

* We are a platform, not a publisher. We moderate in good faith. Our takedown SLA and transparency report document this.

### 7.4 DSA (EU)

* Trusted flagger program: NGOs and government bodies can apply for trusted status. Their reports get P0 priority.
* Transparency report quarterly: counts of actions, response times, by reason.
* Risk assessment filed annually.
* **Article 7(1) retention**: under DSA, providers of interpersonal communication services must align retention with the strictest necessary purpose. Our 25h TTL is a defensive answer to this — we keep the minimum possible.

### 7.5 DMCA

* `legal@ghostline.app` for takedown notices
* Counter-notice process; 10–14 day restoration window
* Repeat infringer policy: DID banned on 3rd valid notice (the user can rotate their UID; the DID ban holds)

### 7.6 Lawful access

* Process: law enforcement submits a preservation request or court order to `legal@ghostline.app`
* Counsel reviews; if valid, fulfills from `legal_holds` table
* For preservation: we freeze matching records for 90 days (renewable)
* For production: we disclose only the data described in the order (typically DID ↔ posts ↔ IP for a date range)
* **DM production orders**: we will produce ciphertext only. We will not represent that we can decrypt it. We will state this clearly in the production response.
* **We will not** voluntarily disclose data without a valid legal process; we publish the criteria on `/legal/process`
* We **will** publish aggregate statistics about government requests in the transparency report

## 8. Security

### 8.1 App-layer

* WAF rules: rate limit, geo-fencing (allowlist of countries we operate in; v1 US + EU), bot rules, known-bad UA blocking
* Input validation via Zod schemas on every endpoint
* Output encoding: React handles this; API responses never include HTML
* SQL/NoSQL injection: parameterized Mongo queries only; `$where` is forbidden by lint rule
* SSRF: outbound HTTP is allowlisted; S3 / push providers hard-coded
* CORS: only `app.ghostline.app` and `admin.ghostline.app`
* CSRF: not applicable to signed-headers (custom header cannot be set cross-origin)

### 8.2 Cryptography

* TLS 1.3 only, HSTS preload, OCSP stapling
* Mobile apps pin the leaf cert (rotated quarterly)
* At rest: Mongo encrypted with KMS; S3 SSE-KMS; EBS encrypted
* Backups encrypted, retained 30 days, restored only into isolated VPC

### 8.3 Internal access

* Zero standing access. Just-in-time via SSO + hardware key + ticket
* All staff actions logged
* Quarterly access reviews

### 8.4 Penetration testing

* Annual third-party pentest
* Bug bounty via HackerOne (v1 scope: web + API; mobile added in v2)
* Critical: 24h fix SLA; high: 7d; medium: 30d

## 9. Disaster recovery

* RPO: 15 min (PIT backups of Mongo every 15 min, S3 versioning)
* RTO: 1h (runbook tested quarterly)
* Game-day exercise: 1x per quarter, all engineers participate

## 10. Cost model (rough, 100k DAU)

* Compute (Fargate): ~$2k/mo
* Mongo M30: ~$900/mo
* Redis: ~$400/mo
* S3 + CF: ~$500/mo
* Push, email, misc: ~$200/mo
* Moderation (human reviewers for ~2k items/day at 30s each, blended $30/hr loaded): ~$15k/mo at v1 scale
* **Total**: ~$20k/mo → $0.20/user/mo

## 11. SLAs (public)

* Availability: 99.9% monthly
* Read latency p95: < 300ms
* Write latency p95: < 600ms
* Moderation P0 response: < 5 min p95
