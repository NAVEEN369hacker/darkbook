# 02 — Data Model

> **Identity model (v2)** — see [12-changelog.md](./12-changelog.md). Two IDs now exist per device: a **Device ID (DID)** that the company uses and a **rotating User ID (UID)** that the social layer uses. UIDs rotate daily and **all** social state is wiped on rotation. DMs are end-to-end encrypted and never persisted.

All collections live in MongoDB Atlas. Naming: `snake_case`. Public IDs are UUIDv7 (time-sortable) unless noted. Every document carries `createdAt`, `updatedAt`, `_id`.

---

## 0. ID taxonomy (read this first)

There are now three distinct identifier types in the system. They are not interchangeable.

| ID | Format | Lives where | Lifetime | Visible to user? | Visible to other users? | Used for |
|---|---|---|---|---|---|---|
| **DID** — Device ID | `did_<uuidv7>` | `devices` collection | **Forever** (one per device, ever) | **No** | **No** | Server-internal only. The "stable handle" for rate-limiting, abuse scoring, legal process, NCMEC escalation. Bound to device-bound secrets, not to the social account. |
| **UID** — User ID | `uid_<uuidv7>` | `daily_identities` collection | **24h**, then deleted | Yes (current day) | Yes | The handle that posts, votes, comments, DMs, and appears on the social surface. The password rotates with it. |
| **publicId** — content IDs | `p_…`, `c_…`, `r_…`, `m_…` | various | varies | n/a | yes | Per-post, per-room, etc. (unchanged from v1.) |

**Critical rules**

1. A user **never** sees the DID. It is server-internal.
2. A user **always** sees the current day's UID (displayed like a username).
3. The UID is bound to the DID — server maps UID → DID for the day only.
4. At UTC midnight, a new UID is issued, the old one is **deleted**, and **all** social state associated with the old UID is **purged** (posts, comments, votes, follows, follows-from, in-app DMs — yes, the entire social history of that UID evaporates). The user logs in tomorrow and is socially a stranger.
5. **One DID per device per lifetime.** Even after app deletion, the DID is reserved for that device for 30 days. After 30 days of inactivity the DID may be reused. (See [03 §6](./03-identity-and-crypto.md#6-device-lifecycle).)
6. DMs are end-to-end encrypted with a key the **client** generates and the **server never sees**. The server stores only opaque ciphertext. When the UID rotates, the DM history is **gone** from the server — there is no plaintext, no ciphertext, no nothing.

This model gives you two opposite guarantees in one system:

* **For the company / regulators:** a stable DID means we can fight abuse, hold bad actors accountable, and answer lawful process for the life of a device.
* **For the user:** their social identity is fresh every 24 hours, so they can never be stalked, doxxed, or profiled across days via the social surface.

---

## 1. `devices` — stable device records (server-internal)

```ts
{
  _id: ObjectId,
  did: "did_0190f4e2-7c8b-7d2a-9a1f-3e8b6a2c1d44",   // public, but never shown to user
  deviceSecretHash: "argon2id$...",                    // Argon2id of the device secret (see 03 §2)
  publicKey: "-----BEGIN PUBLIC KEY-----\n...",        // P-256, bound at first install
  keyId: "k1",
  deviceFingerprint: {
    // coarse, non-identifying — used for DID binding & abuse correlation only
    platform: "ios"|"android"|"web",
    appVersion: "1.0.0",
    osVersion: "17.4",
    locale: "en-US",
    tzOffsetMin: 0,
    screen: "1170x2532",
    modelHash: "blake3(...)"                           // hash of coarse model + form-factor
  },
  abuseScore: 0,                                       // 0..100, sliding
  status: "active"|"shadow_banned"|"hard_banned"|"cooldown",
  cooldownUntil: null|Date,
  uidRotationCount: 0,                                 // total daily rotations since install
  firstSeenAt: Date,
  lastActiveAt: Date,
  reservedUntil: Date,                                 // DID is reserved until this date (30d after last active)
  flagsHash: "a91c..."                                 // PDQ/PhotoDNA of uploaded media
}
```

**Indexes**

```
{ did: 1 } unique
{ deviceSecretHash: 1 } unique
{ publicKey: 1 }
{ firstSeenAt: -1 }
{ abuseScore: -1, status: 1 }
{ lastActiveAt: -1 }
{ reservedUntil: 1 }                                    // reaper: free unused DIDs
```

The `devices` row is **immutable** in `did` and `deviceSecretHash`. The `publicKey` can be rotated but the `did` cannot.

---

## 2. `daily_identities` — today's social identity

```ts
{
  _id: ObjectId,
  uid: "uid_0190f4e2-7c8b-7d2a-9a1f-3e8b6a2c1d44",  // public, the "username" of the day
  did: "did_0190f4e2-...",                             // FK -> devices.did
  displayName: "Blue Panda",                           // regenerated daily
  colorHex: "#3F7CAC",
  passwordHash: "argon2id$...",                        // server-side hash; client holds the plaintext
  passwordExpiresAt: ISODate("2026-08-08T00:00:00Z"),  // next UTC midnight
  issuedAt: ISODate("2026-08-07T00:00:00Z"),
  rotatesAt: ISODate("2026-08-08T00:00:00Z"),
  postCount: 0,
  commentCount: 0,
  voteCount: 0,
  status: "active"|"shadowed"|"banned",                // ban state inherited from device
  metadata: {
    userAgent: "Ghostline/1.0.0 (iOS 17.4)",
    ipHash: "sha256(ip + daily_salt)"                  // auto-purged at rotation
  },
  createdAt: Date
}
```

**Indexes**

```
{ uid: 1 } unique
{ did: 1, rotatesAt: -1 }                              // "what UID does this device have right now"
{ rotatesAt: 1 }                                       // TTL-like for the reaper job
{ status: 1, rotatesAt: 1 }
```

**Lifecycle**

* A new `daily_identities` row is issued on install and at every UTC midnight.
* At `rotatesAt`, a scheduled job (and an event-driven fallback) does:
  1. Mark the row as `expired`.
  2. Run a hard delete of all `posts`, `comments`, `votes`, `follows`, `followers`, `dm_messages` rows where `uid == this.uid`.
  3. Delete the row itself.
* The client receives the new UID and password on its next login (see API §2.4).

---

## 3. `daily_identities_history` — for legal holds only

```ts
{
  _id: ObjectId,
  uid: "uid_...",
  did: "did_...",
  issuedAt: Date,
  rotatedAt: Date,
  // No content fields. Just the existence record.
  legalHold: true,
  legalHoldRef: "case-2026-...",
  createdAt: Date
}
```

A tombstones table. **Only** filled when a `legal_holds` row prevents purge. Without a hold, nothing is kept — not even the existence of yesterday's UID.

Indexes: `{ uid: 1 }`, `{ did: 1, issuedAt: -1 }`, `{ legalHold: 1, createdAt: 1 }`. Retention: 7 years if on hold, else 0.

---

## 4. `posts`

Unchanged from v1 except `authorUid` (replaces `authorUuid`):

```ts
{
  _id: ObjectId,
  publicId: "p_0190f4e2-...",
  authorUid: "uid_0190f4e2-...",          // <-- references daily_identities.uid, NOT devices.did
  authorDid: "did_0190f4e2-...",          // <-- denormalized for abuse scoring only
  roomId: "r_mental_health",
  parentPostId: null | "p_...",
  body: "...",
  mediaIds: ["m_..."],
  status: "live"|"under_review"|"removed"|"shadow",
  removedReason: null|"spam"|"csam"|"tos"|"user_deleted"|"uid_rotated"|"auto",
  upvotes: 0, downvotes: 0, score: 0,
  commentCount: 0, reportCount: 0,
  createdAt: Date, editedAt: null, deletedAt: null,
  lang: "en",
  nsfwScore: 0.02, toxicityScore: 0.05
}
```

**Indexes** (note the change — feeds are now scoped to a UID's lifetime):

```
{ publicId: 1 } unique
{ roomId: 1, status: 1, createdAt: -1 }                // room feed
{ authorUid: 1, createdAt: -1 }                         // "my posts today"
{ authorDid: 1, createdAt: -1 }                         // abuse scoring
{ parentPostId: 1, createdAt: 1 }
{ status: 1, createdAt: -1 }
{ score: -1, createdAt: -1 }
{ "mediaIds": 1 }
{ createdAt: 1 }                                         // <-- TTL reaper: purge posts older than 25h
```

**TTL / retention**

* Mongo TTL index on `createdAt` with `expireAfterSeconds: 90000` (25h). Posts auto-purge 1h after the UID they belong to would have rotated. This is the daily-rotation guarantee: nothing social survives 25 hours.
* `legal_holds` (see §10) prevent purge.
* `status: "removed"` and `deletedAt != null` are soft-kept until TTL.

---

## 5. `votes`

```ts
{
  _id: ObjectId,
  voterUid: "uid_...",
  voterDid: "did_...",
  targetType: "post"|"comment",
  targetId: "p_...",
  value: 1|-1,
  createdAt: Date
}
```

**Indexes**

```
{ voterUid: 1, targetType: 1, targetId: 1 } unique      // one vote per (today's UID, target)
{ targetType: 1, targetId: 1 }
{ createdAt: 1 }                                         // TTL reaper
```

---

## 6. `rooms`

Unchanged from v1. Public rooms; restricted rooms add `minAge`.

---

## 7. `follows` — ephemeral follows, wiped daily

```ts
{
  _id: ObjectId,
  followerUid: "uid_...",                                // today's UID of the follower
  followerDid: "did_...",                                // for abuse correlation
  followeeUid: "uid_...",                                // the UID being followed (also today)
  followeeDid: "did_...",
  createdAt: Date
}
```

**Indexes**

```
{ followerUid: 1, followeeUid: 1 } unique                // one follow per pair per day
{ followeeUid: 1 }                                       // follower count
{ createdAt: 1 }                                         // TTL reaper
```

**Why this is hard by design**

Because both UIDs change every day, you cannot follow a *person* across days. You follow a *handle that exists today*. Tomorrow that handle is gone. This is the explicit product decision: no persistent social graph.

> Concretely: if Alice follows Bob, and Bob's UID rotates at midnight, Alice's follow and Bob's follower list both vanish. When Bob logs in tomorrow he has zero followers again.

---

## 8. `dm_threads` and `dm_messages` — E2E encrypted, zero-server-knowledge

### 8.1 `dm_threads`

```ts
{
  _id: ObjectId,
  threadId: "t_0190f4e2-...",                             // public, opaque
  participantUids: ["uid_...", "uid_..."],                // both must be CURRENT uids
  participantDids: ["did_...", "did_..."],                // denormalized
  createdAt: Date,
  lastMessageAt: Date,
  // No message bodies, no plaintext, no counts. The server has nothing useful.
  ciphertextCount: 12,                                    // just a count, for client-side unread UI
  createdByDid: "did_..."                                 // for rate-limiting
}
```

Indexes: `{ threadId: 1 } unique`, `{ participantUids: 1 }`, `{ participantDids: 1, lastMessageAt: -1 }`, `{ createdAt: 1 }` (TTL).

### 8.2 `dm_messages`

```ts
{
  _id: ObjectId,
  messageId: "m_0190f4e2-...",
  threadId: "t_...",
  senderUid: "uid_...",
  senderDid: "did_...",
  // The server stores ONLY ciphertext. No key, no plaintext, no metadata beyond sender + time.
  ciphertext: "base64(aes-256-gcm-ciphertext)",
  nonce: "base64(12 random bytes)",
  keyId: "k_t_<threadId>",                                // which ephemeral key wrapped this
  createdAt: Date
}
```

Indexes: `{ messageId: 1 } unique`, `{ threadId: 1, createdAt: -1 }`, `{ createdAt: 1 }` (TTL).

**The contract**

* The client generates an **ephemeral symmetric key per thread** (AES-256-GCM, 256-bit).
* The key is wrapped to each participant's *device* public key (P-256 ECDH → HKDF → AES key-wrap) and stored only in the client's local keychain.
* The server **never** sees the symmetric key. It cannot decrypt a single byte.
* On UID rotation, both clients delete their local copy of the symmetric key. The thread row is purged. The ciphertext is gone forever — even a court order cannot recover plaintext because we do not have it.
* A `legal_holds` row can preserve the **ciphertext** but it is useless to the company without the keys.

> **What staff can see about a DM**: thread participants (UIDs and DIDs), timestamps, ciphertext byte count, sender UID/DID. **Never** the plaintext, the key, or the message content. The honest answer to "what did they say" is: "we do not know, and we could not tell you if we did."

---

## 9. `reports`

Unchanged from v1 except reporter is now a UID (`reporterUid`) with denormalized `reporterDid`.

---

## 10. `media`

Unchanged from v1. **TTL**: 25h, matching the UID rotation. With a `legal_hold`, the media and its PDQ hash survive.

---

## 11. `audit_log` (staff only)

Unchanged. Every moderation action written here is attributed to a `staffId` and is **not** subject to UID rotation (the staff identity is the company's, not the user's).

---

## 12. `legal_holds` — preservation orders

```ts
{
  _id: ObjectId,
  scopeType: "did"|"uid"|"post"|"ip",
  scopeValue: "did_...",
  reason: "lawful preservation order",
  orderRef: "case-2026-...",
  setBy: "staff_id_123",
  setAt: Date,
  expiresAt: Date
}
```

Indexes: `{ scopeType: 1, scopeValue: 1 }`, `{ expiresAt: 1 }` (TTL).

When a hold exists, the TTL reaper skips matching posts, votes, follows, and DMs. **It still cannot recover DM plaintext** — only ciphertext survives.

---

## 13. Redis key shapes

| Key | Type | Purpose | TTL |
|---|---|---|---|
| `did:active:{did}` | string | "is this DID currently active?" | 24h sliding |
| `uid:active:{uid}` | string | "is this UID currently valid?" | until `rotatesAt` |
| `uid:byDid:{did}` | string | current UID for a device | until rotate |
| `rl:writes:{did}:{bucket}` | sorted set | per-device write rate | 60s |
| `rl:ip:{ip}:{bucket}` | sorted set | per-IP rate | 60s |
| `abuse:score:{did}` | string | current abuse score (lives on device, not uid) | none |
| `feed:hot:{roomId}` | sorted set | pre-ranked hot feed | 1h rolling |
| `notify:{uid}` | list | in-app inbox | until rotate |
| `jwt:revoked:{jti}` | string | revoked tokens | until exp |
| `dm:unread:{uid}:{threadId}` | string | unread counter | until rotate |
| `name:used:{name}` | string | name uniqueness for the day | 24h |

Note the change: **rate limits and abuse scores key on `did`, not `uid`**. This is what makes daily rotation safe from an abuse perspective — a banned user cannot escape their ban by waiting for midnight, because the ban lives on the device.

---

## 14. Capacity planning (revised)

* Posts/day is unchanged. But each device now creates ~5 follow rows, ~10 DMs, and 1 thread per conversation.
* TTL reapers run every 5 min and can purge up to ~10% of the working set per cycle. Mongo handles this; we use a dedicated worker to avoid backpressure.
* The `dm_messages` collection is hot-write. For 100k DAU × 10 DMs/day = 1M DM rows/day, all TTL-purged in 25h. We use a separate collection so the TTL reaper doesn't fight the post reaper.
* 25h retention × 100k DAU × 5 posts/day = ~12.5M live posts at any time. Mongo M50 handles this; the hot working set fits in cache after a warm-up.
