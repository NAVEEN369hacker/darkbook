# 05 — Moderation, Abuse, Rate-Limiting

> **v2 identity model** — see [12-changelog.md](./12-changelog.md). All rate limits and abuse scores key on the **DID**, not the UID, so daily UID rotation does NOT reset a user's standing.

This document defines every algorithm and policy that protects the platform. It is intentionally explicit because the system must be both effective and auditable.

---

## 1. Layered defense philosophy

We assume any single layer will be bypassed. The system stacks:

1. **Friction at install** — DID issuance, device-keypair registration, HMAC device-secret proof, mandatory onboarding banner.
2. **One DID per device per lifetime** — bounded by 30-day reservation after last activity.
3. **Per-DID rate limits** — Redis counters keyed by `did`. Survive UID rotation.
4. **Per-UID write limits (additional)** — daily post/comment caps reset at midnight, but they are *additive to* the per-DID limits, never a replacement.
5. **Per-IP rate limits** — Redis counters keyed by `ipHash`.
6. **Cooldown for new devices** — first 24h, reduced rate.
7. **Behavioral abuse scoring (per DID)** — sliding 0..100.
8. **Content classification** — text toxicity, NSFW image classifier, PDQ/PhotoDNA image hash match.
9. **Vote weighting** — votes from high-rep identities count more.
10. **Brigade detection** — outlier vote velocity.
11. **Shadow ban** — author sees their post as live; everyone else does not. Lives on the DID.
12. **Hard ban** — return 200 to all actions; the **DID** is dead. UID rotation does not unban.
13. **CAPTCHA escalation** — when score crosses a threshold.
14. **User reports** — final manual review layer.
15. **Daily UID rotation is NOT a reset.** This is the v2 rule: rotation only changes the social handle, never the abuse score, never the device status.

---

## 2. Rate limits (v2 defaults — per DID unless noted)

| Bucket | Limit | Window |
|---|---|---|
| Posts per DID | 20 | 1h rolling |
| Comments per DID | 50 | 1h |
| Votes per DID | 200 | 1h |
| Reports per DID | 30 | 24h |
| Media uploads per DID | 30 | 24h |
| DM messages per DID | 60 | 1h |
| Posts per UID (additional cap, resets at midnight) | 5 | 24h |
| Votes per UID (additional cap, resets at midnight) | 50 | 24h |
| Posts per IP (anon+auth) | 60 | 1h |
| New DIDs per IP | 1 | lifetime (per device, 30d reservation) |
| New DIDs per `/24` | 30 | 24h |
| Reads per DID | 600 | 1m |
| WebSocket messages per DID | 60 | 1m |
| First 24h of a DID: 0.25× the per-DID limits | | |

The UID caps are deliberately generous (you can post 5× per day = 5× under one handle) so the daily rotation doesn't feel punitive for ordinary users. The DID caps are the hard anti-abuse floor.

All counters are sliding windows implemented in Redis with sorted sets:

```
ZADD rl:writes:{did} {ts_ms} {ts_ms}
ZREMRANGEBYSCORE rl:writes:{did} 0 {ts_ms - window}
ZCARD rl:writes:{did}
EXPIRE rl:writes:{did} {window_sec}
```

If `ZCARD > limit`, reject with 429.

---

## 3. Cooldown for new devices

For the first 24h after DID issuance:

For the first 24h after registration:

* `posts/day` cap = 5
* `votes/day` cap = 30
* Comments disabled for first 1h (anti-spam) — UI shows "to prevent spam, new accounts wait 1h before commenting"
* Image uploads disabled for first 24h
* Push notifications: throttled to 1 per hour total

This is the single biggest anti-spam lever we have, and it is invisible to honest users beyond a 1h wait on commenting.

---

## 4. Abuse score (0..100)

A sliding score per identity. Decays over time when behavior is good.

### Signals (and their delta)

| Signal | Δ |
|---|---|
| Reported by another identity, actioned as `removed` | +25 |
| Reported, actioned as `shadowed` | +12 |
| Reported, dismissed | -1 |
| Post removed by classifier (NSFW > 0.9) | +30 |
| Post removed for spam pattern (regex/AI) | +20 |
| IP shared with >3 identities posting identical content | +8 each |
| Vote on a post that gets actioned | +2 |
| Spam classifier (text) `> 0.7` | +5 |
| Self-delete within 60s of posting (low-quality spam pattern) | +3 |
| Daily active + posting | -1/day |
| Upvote received from a high-rep (>30 days, score<5) identity | -0.5 |
| Successful appeal (decision reversed) | -10 |
| Survives 7 days with no negative signal | -5 |

### State transitions

| Score | State | Effect |
|---|---|---|
| 0–19 | active | normal |
| 20–49 | cooldown | 4h cooldown after every 3rd post |
| 50–79 | shadow | all new posts hidden; author sees them as live |
| 80–100 | hard banned | API returns 200 to all writes; identity frozen |

Score is recomputed by `abuse-scorer` on a 60s tick + on event ingest.

---

## 5. Shadow ban

* `status = "shadow"` on `identities` (Redis-cached, Mongo-persisted).
* All write endpoints detect the status and, instead of inserting, return 200 with a synthetic publicId and `status: "queued"`. The author sees a normal confirmation. Nothing is stored. The author can see their own "posts" only by listing them via `GET /me/posts`, which is a no-op for shadowed authors (returns empty), so they may eventually notice.
* Read APIs never serve shadowed posts to anyone.
* Crucially, **reactions to shadowed posts never count** — protects against brigading-via-bait.

This is the only effective way to handle trolls without giving them feedback that they're being punished.

---

## 6. Weighted voting

A naive upvote is too easy to game. We weight each vote by the voter's reputation:

```
weight(voter) = clamp(0.1, 1.0, reputation(voter))
reputation(voter) = 1 / (1 + exp((abuseScore - 30) / 8))   // sigmoid around 30
                  × min(1, daysSinceCreation / 14)         // ramp over 2 weeks
                  × (1 - 0.5 * isVpn)                      // soft signal
```

Server stores raw vote count but exposes a `weightedScore` field. The hot feed uses weightedScore; the chronological feed shows raw counts. This makes brigading expensive: you need many *new* (low-rep) votes to move a post, and new identities have low post counts.

## 7. Content classification

### Text

* **Toxicity** (Perspective API or open-source Detoxify). `> 0.85` → flag.
* **Spam score** (custom logistic regression on hand-labeled data). Features: link count, ALL-CAPS ratio, emoji density, repetition score, hash of body against a known-spam corpus. `> 0.8` → flag.
* **Self-harm / suicide ideation** classifier. `> 0.7` → flag + show user a "resources" interstitial; do not auto-remove, but offer help.
* **PII detection** (regex + Presidio). Detect phone, email, SSN-like, IBAN-like patterns. If found, warn the user before posting and offer a "redact" tool.

### Images

* **NSFW** (YOLOv8 fine-tuned + classifier). `> 0.9` → block at upload.
* **PDQ perceptual hash** computed on upload. If distance < 25 to a known CSAM hash in PhotoDNA → block + report to NCMEC.
* **EXIF strip** on all uploads at the worker level.
* **Face detection** — count faces, store aggregate. (No face recognition — just a count for "are there people in this image", used for moderation prioritization, not identification.)

### Cross-modal

* If text + image together trigger a rule (e.g., text asks for CP and image matches), escalate to a high-priority queue.

## 8. CAPTCHA escalation

When `abuseScore > 30` OR when a new identity posts its 3rd item in an hour, the client receives a `403 captcha_required` with a `captchaToken: "hcaptcha://..."`. The client must complete a CAPTCHA (hCaptcha) and call `POST /captcha/verify { token }` before continuing. Server stores the hCaptcha verification result for 1h.

Web uses the hCaptcha widget. Mobile uses the native hCaptcha SDK.

## 9. Brigading detection

For any post, compute:

```
burstiness = max(votes_in_60s_window) over the first hour
baseline   = median votes/min for posts in this room over last 24h
isBrigaded = burstiness > 10 * baseline
```

If `isBrigaded`:

* votes from accounts created in the last 24h are excluded from the visible score for 6h.
* a "trending" badge is suppressed.
* the post is added to a "review for organic merit" queue.

## 10. Report handling

### Triage workflow

1. **Auto-decide** if the report is the 3rd+ report on this post and the classifier already flagged it → action = `removed`, `decidedBy: "auto"`.
2. Otherwise → enqueue for human review, priority based on reason (`csam`/`self_harm` = P0, `violence` = P1, others = P2).
3. Mod sees: post body, attached media, classifier scores, **number** of reports (but not reporters' identities), prior actions against the author (count only, not specifics).

### SLAs

| Priority | Decision time p95 |
|---|---|
| P0 (CSAM, imminent harm) | 5 min |
| P1 (violence, harassment) | 30 min |
| P2 (spam, other) | 4h |

### Outcomes

* `removed` — post hidden
* `shadowed` — author sees it, no one else does
* `banned` — identity hard-banned
* `no_action` — post stays, no consequences for the author

Every action is written to `audit_log` and attributed to a `staffId`, never to a user identity.

> **In v2, "ban the identity" means ban the DID.** The UID rotates; the ban does not.

## 11. Appeal

Authors of removed posts see:

> "This post was removed for [reason]. You can appeal once."

`POST /appeals` with body `{ postId, message }`. Appeals go to a separate queue and cannot be decided by the same mod who removed the post.

## 12. Pseudonymity within rooms (v2)

A v2 feature: in restricted rooms (e.g., survivors of abuse), a user can present a "room pseudonym" — a stable display name that is *scoped* to a single room. The mapping is server-side and ephemeral (rotated weekly). The author still has a single `uuid`, but the room only sees the pseudonym, breaking cross-room correlation attempts by lurkers.

## 13. Audit + transparency

* Quarterly **transparency report** (public): counts of posts removed, identities banned, appeals upheld, NCMEC reports filed. No individual case details.
* Every moderation action is logged immutably.
* Staff training: 2x/year, including a "shadow your own account" exercise where a staff member uses the app from a fresh device to feel the friction firsthand.

## 14. Daily UID rotation is NOT an abuse reset (v2 critical)

A naive reading of "UID rotates daily" is that an abuser can just wait until midnight and start fresh. **The system is designed to make this ineffective.**

### 14.1 What stays with the DID

| State | Lives on | Survives UID rotation? |
|---|---|---|
| Ban / shadow-ban | DID | **Yes** |
| Abuse score | DID | **Yes** |
| Repeat-infringer count | DID | **Yes** |
| Device fingerprint hash | DID | **Yes** |
| Public key | DID | **Yes** (until rotated) |
| Display name history | DID | Cleared on rotation but flagged internally if a display name is *re-used* by a banned device |
| Cooldown for new device | DID (24h from first install) | **Yes** |

### 14.2 What changes with the UID

| State | Lives on | Behavior on rotation |
|---|---|---|
| Posts | UID | Purged at TTL |
| Comments | UID | Purged at TTL |
| Votes | UID | Purged; tallies recompute |
| Follows (out) | UID | Purged |
| Follows (in) | UID | Purged |
| DM threads / messages | UID | Purged (ciphertext deleted; client loses keys) |
| Notifications | UID | Cleared from inbox |
| Posts/day cap | UID | Resets (this is the *only* reset) |

### 14.3 Net effect

A shadow-banned user rotating their UID sees a new handle but **all their posts are still hidden, all their reports are still flagged automatically, and all rate limits are still in effect**. If anything, rotation makes the user's situation more confusing — they post and the posts don't appear, but they don't know why.

A user who was one strike away from a ban and tries to "wait it out" discovers that the strike count is also on the DID, so waiting does nothing.

### 14.4 The one reset that does happen

A new UID lifts the **posts/day per-UID** cap (5/day). This is fine because (a) the per-DID cap (20/h) is the actual hard limit, and (b) the per-UID cap exists to encourage breadth of engagement, not as anti-abuse. Abusers don't post 5/day clean posts — they post 500/day junk.

### 14.5 Defending the edge

Two residual attack windows remain:

1. **Reinstall to get a fresh DID.** Mitigated by the 30-day DID reservation and the device fingerprint hash. After 30 days of inactivity, a reinstall gets the same DID; we keep the device score.
2. **Run multiple devices.** Mitigated by per-IP rate limits and pattern detection (e.g., N devices posting identical content from the same `/24` jumps their collective score).

## 15. Pseudonymity within rooms (v3+ candidate)

With the v2 model, room-scoped pseudonyms are unnecessary — your UID already rotates every day, so cross-room correlation is already broken. This section is preserved for the v3+ roadmap.
