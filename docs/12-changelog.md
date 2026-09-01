# 12 — Changelog (framework spec)

This file documents every change to the Ghostline framework since v1. The current spec is **v2**, which introduces the **two-identifier identity model** (DID + UID), **daily social state purge**, and **end-to-end encrypted DMs**.

---

## v2 — 2026-08-07 — Two-ID identity model + E2E DMs

### Identity model changes

**v1 (rejected)** used a single anonymous identity per device. The server could tie all posts, votes, and DMs to one stable handle. Users accumulated social history indefinitely.

**v2 (current)** splits identity in two:

| Concept | v1 | v2 |
|---|---|---|
| Stable identifier per device | one UUID | **DID** (`did_<uuidv7>`), permanent per device, server-internal only |
| Social handle | the same UUID | **UID** (`uid_<uuidv7>`), server-issued, **rotates every 24h** |
| Authentication | signing key + UUID | signing key + DID + **daily password** |
| Social history lifetime | indefinite | **25h TTL** (purged at next UID rotation) |
| Follows | stable graph across days | wiped daily (same-day only) |
| DMs | plaintext stored, soft-deleted | **end-to-end encrypted**, server holds only ciphertext |

### Why this change

The user's brief was:

> "User gets a default ID … we and they cannot use it as their identification inside the app … server-side gives them a default user ID and password and this USER ID will change everyday. It will change/erase all things like chattings associated with the previous ID and in fact there will be erasing of following and followers too … default ID will remain same and one device can get only one default ID at a lifetime … no change. It can be of private IP related or MAC related anything … and there will be direct message boxes but as I said there will be no storing of these things."

Three concrete requirements drove the rewrite:

1. **A stable device ID for the company**, used only inside our systems, never shown to users.
2. **A daily-rotating user ID + password** that the user can see, that owns all posts/votes/comments/follows/DMs, and that wipes everything when it rotates.
3. **DMs exist but are not stored in any recoverable form on the server** — which means E2E encryption is mandatory, not optional.

### What changed in each document

| Doc | Change |
|---|---|
| [02-data-model.md](./02-data-model.md) | New `devices` (DID) and `daily_identities` (UID) collections. `identities` and `identities_keys` removed. New `follows`, `dm_threads`, `dm_messages`. TTL reapers on every social collection (25h). Redis keys refactored to use `did` for rate limits and `uid` for in-app state. |
| [03-identity-and-crypto.md](./03-identity-and-crypto.md) | Full rewrite. New register/login/rotate handshake. Daily rotation protocol with client-driven and server-fallback paths. Argon2id password hashing. DM key wrapping (ECDH + HKDF + AES-KW). New threat discussion. |
| [04-api-reference.md](./04-api-reference.md) | New auth endpoints (`/auth/device/register`, `/auth/login`, `/auth/rotate`). DMs section added (5 endpoints). Follows section added (5 endpoints). WebSocket `uid.rotated` event added. |
| [00-product-overview.md](./00-product-overview.md) | Goals updated. Privacy promise updated to mention the DID is invisible. |
| [01-system-architecture.md](./01-system-architecture.md) | New worker: `uid-rotator` (daily). DM service responsibilities moved out of API into a separate endpoint group (still in `api` for v1, but logically its own concern). |
| [05-moderation-and-abuse.md](./05-moderation-and-abuse.md) | All abuse scoring now keys on `did`, not `uid`. New "daily purge is not a free reset" defense: even though UIDs rotate, the abuse score on the device persists. |
| [06-feed-and-realtime.md](./06-feed-and-realtime.md) | "Top" sort now bounded to 25h. `feed/following` semantics clarified (always empty after rotation). |
| [07-web-frontend.md](./07-web-frontend.md) | Login screen added (returning users). Onboarding explains the "you are someone new tomorrow" model. New DM UI. New rotation banner in the top bar. |
| [08-mobile-app.md](./08-mobile-app.md) | Background task for daily rotation added. DM key store in Keychain. New "this message will disappear at midnight" UI affordance. |
| [09-infra-devops-security-legal.md](./09-infra-devops-security-legal.md) | New TTL reaper job. Updated legal-process disclosure: we now produce **ciphertext only** for DM preservation requests. Updated privacy policy text. |
| [11-roadmap.md](./11-roadmap.md) | v2 milestone includes the identity rework and DM ship. |

### Product consequences (be honest with users)

* **Followers reset every day.** This is a major UX departure from every other platform. The onboarding must explain it.
* **No content history.** A returning user sees an empty feed every morning. This is a feature, not a bug — but it means retention depends on *daily* habit, not accumulated history.
* **DMs are real but ephemeral.** Users can have private conversations. They just cannot keep them. We have to make the "this conversation will disappear at midnight" message visible in the DM UI.
* **Lawful access is honest.** We tell law enforcement in our transparency report: "We can produce ciphertext. We cannot produce plaintext. We do not have the keys."

### Backward compatibility

* No v1 data carries over. v1 had no real users, so this is a clean break.
* The mobile and web apps are forward-incompatible with the v1 server — they must be rebuilt against `/v1/auth/device/register` etc.
* If we ever need to support a v1 → v2 migration, the path is: deprecate v1, force clients to register as v2 devices. No data to migrate (v1 data is unusable anyway).

---

## v1 — initial framework

Documented the original single-UUID model. Superseded by v2 the same day. Kept for historical reference; no implementation should target v1.