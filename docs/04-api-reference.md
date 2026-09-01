# 04 — API Reference (v2)

> **v2 identity model** — see [12-changelog.md](./12-changelog.md). This reference is updated for the DID/UID/password model. Every authenticated request is signed with the **device's** ECDSA key and includes the **current UID** in the JWT.

All endpoints are versioned under `/v1`. All requests/responses JSON. All authenticated endpoints require the headers in [03 §7](./03-identity-and-crypto.md#7-authenticated-request-shape).

**Base URL**: `https://api.ghostline.app/v1`
**GraphQL**: `https://api.ghostline.app/graphql`
**WebSocket**: `wss://realtime.ghostline.app`

---

## 1. Conventions

* `publicId` strings: `did_…`, `uid_…`, `p_…`, `c_…`, `r_…`, `m_…`, `t_…` (DM thread).
* Errors follow JSON:API `errors` shape.
* `X-Ghost-Uid` is **not** a header — the UID lives inside the JWT and is bound to the signing key.

| Code | Status | Meaning |
|---|---|---|
| `unauthenticated` | 401 | Missing or invalid JWT |
| `signature_invalid` | 401 | ECDSA signature failed verification |
| `uid_rotated` | 401 | Your UID is no longer current; refresh and retry |
| `replay_detected` | 409 | Nonce already used |
| `rate_limited` | 429 | Bucket exhausted |
| `shadowed` | 200 | Request "succeeded" but content is hidden from author and others |
| `cooldown` | 403 | New device, must wait |
| `device_banned` | 403 | Device is hard-banned |
| `not_found` | 404 | Resource gone (TTL-purged, deleted, or UID rotated) |
| `validation_failed` | 422 | Body failed schema |
| `server_error` | 500 | Unhandled — retry with backoff |

---

## 2. Auth — device + UID lifecycle

### `POST /auth/device/register`

First install. The client generates a device secret and a signing key, then registers.

**Body**

```json
{
  "clientNonce": "string",
  "keyId": "k1",
  "publicKey": "SPKI PEM",
  "deviceSecretProof": "hex(HMAC-SHA256(deviceSecret, 'register-v1'))",
  "platform": "ios|android|web",
  "appVersion": "1.0.0",
  "deviceFingerprint": { "osVersion": "...", "locale": "...", "screen": "...", "tzOffsetMin": 0 }
}
```

**Response 201**

```json
{
  "did": "did_0190f4e2-...",
  "reservedUntil": "2026-09-06T00:00:00Z",
  "uid": "uid_0190f4e2-aaaa-bbbb-cccc-3e8b6a2c1d44",
  "uidExpiresAt": "2026-08-08T00:00:00Z",
  "displayName": "Blue Panda",
  "colorHex": "#3F7CAC",
  "password": "K9p2-vRm4-xQc7",
  "accessToken": "eyJ...",
  "refreshToken": "rt_...",
  "nextRotationAt": "2026-08-08T00:00:00Z"
}
```

### `POST /auth/login`

Returning user. Issues a new UID + password.

**Headers**

```
X-Ghost-Device-Proof: hex(HMAC-SHA256(deviceSecret, 'login-v1:' + nonce))
X-Ghost-Nonce: 9a7c...
X-Ghost-PublicKey: SPKI
X-Ghost-Timestamp: ...
X-Ghost-Signature: ...                              // signs (METHOD\nPATH\nTS\nNONCE\nsha256(""))
```

**Body**: `{ "did": "did_..." }`

**Response 200**: same shape as register.

> The user does not type the password. It is delivered to the client over TLS at register/login. The client never sends the password back to the server in subsequent requests — only the device secret HMAC proof at login.

### `POST /auth/rotate`

Called by the client at `nextRotationAt`, or by the server at UTC 00:00 if the client is offline.

**Headers**: signed with current access token.

**Response 200**: new `uid`, new `password`, new tokens. Old `uid` is now in `rotating` state and will be purged within 5 min.

### `POST /auth/refresh`

Standard refresh token rotation.

**Body**: `{ "refreshToken": "rt_..." }`

**Response 200**: new access token (UID unchanged — refresh is for the *current* UID's session only).

### `POST /auth/device/rotate-key`

Allows the current device key to authorize a new public key. The DID does not change.

**Body**: `{ "newKeyId": "k2", "newPublicKey": "..." }`
**Headers**: signed with the *current* key.

**Response 200**: tokens (refreshed, same `did` and `uid`).

### `POST /auth/revoke`

Server-side kill switch. Revokes all access and refresh tokens for the current UID.

**Headers**: signed.

**Response 204**.

### `GET /auth/me`

Returns the current identity.

**Response 200**

```json
{
  "did": "did_...",
  "uid": "uid_...",
  "displayName": "Blue Panda",
  "colorHex": "#3F7CAC",
  "status": "active",
  "abuseScore": 4,
  "uidExpiresAt": "2026-08-08T00:00:00Z",
  "nextRotationAt": "2026-08-08T00:00:00Z",
  "postCount": 12,
  "createdAt": "2026-08-07T..."
}
```

### `POST /auth/display-name/regenerate`

Once per UID (≈ once per day), the user can roll a new name. Cosmetic only.

**Response 200**

```json
{
  "displayName": "Quiet Otter",
  "colorHex": "#7A9CC6",
  "nextAvailableAt": "2026-08-08T00:00:00Z"
}
```

---

## 3. Posts & comments

Identical surface to v1, except every author reference is `uid` (not `uuid`) and `did` is denormalized for moderation.

### `POST /posts`

**Body**

```json
{
  "roomId": "r_mental_health",
  "body": "string (1..4000)",
  "mediaIds": ["m_..."],
  "parentPostId": null,
  "clientPostId": "c_..."
}
```

**Response 201**

```json
{
  "publicId": "p_0190f4e2-...",
  "status": "live",
  "uidExpiresAt": "2026-08-08T00:00:00Z",
  "createdAt": "2026-08-07T09:14:23Z"
}
```

* TTL: 25h. After your UID rotates, this post is gone.

### `GET /posts/{publicId}`

**Response 200**

```json
{
  "publicId": "p_...",
  "author": {
    "uid": "uid_...",
    "displayName": "Blue Panda",
    "colorHex": "#3F7CAC",
    "uidIssuedAt": "2026-08-07T00:00:00Z"
  },
  "roomId": "r_mental_health",
  "parentPostId": null,
  "body": "...",
  "media": [ { "publicId": "m_...", "url": "https://cdn...", "blurhash": "LKO...", "width": 1170, "height": 2532 } ],
  "upvotes": 14, "downvotes": 1, "score": 13,
  "commentCount": 3, "reportCount": 0,
  "myVote": 1,
  "status": "live",
  "createdAt": "...", "editedAt": null,
  "uidExpiresAt": "2026-08-08T00:00:00Z"
}
```

The `uidIssuedAt` is shown next to the author name as "Blue Panda · 2h · today" — making it obvious to other users that this handle is ephemeral.

### `PATCH /posts/{publicId}`

Within 10 min of creation (and before your UID rotates).

### `DELETE /posts/{publicId}`

Soft-deletes; TTL purges within 25h.

### `GET /posts/{publicId}/comments`

Cursor-paginated.

---

## 4. Voting

### `POST /votes`

**Body**

```json
{ "targetType": "post", "targetId": "p_...", "value": 1 }
```

* `value`: `1`, `-1`, or `0` (clear).
* Idempotent on `(voterUid, target)`.
* After UID rotation, your prior votes are gone and the tallies reflect that.

**Response 200**: `{ "score": 14, "upvotes": 15, "downvotes": 1, "myVote": 1 }`

---

## 5. Follows (v2 — new)

### `POST /follows`

**Body**: `{ "followeeUid": "uid_..." }`

* Both UIDs must be currently valid (not rotated).
* One follow per `(followerUid, followeeUid)` pair per day.
* At the next UID rotation, both the follow and the follower count disappear.

**Response 201**: `{ "ok": true, "expiresAt": "2026-08-08T00:00:00Z" }`

### `DELETE /follows/{followeeUid}`

### `GET /follows/me/following?cursor=...`

Returns the list of UIDs you currently follow. Empty after rotation.

### `GET /follows/me/followers?cursor=...`

Returns the UIDs that follow you. Empty after rotation.

### `GET /users/{uid}/follow-stats`

Public read: `{ "followingCount": 12, "followersCount": 4 }`.

> **Critical product note**: you cannot follow a person across days, because the person does not exist across days. The follow feature exists for *same-day* signal only (e.g., "I want to see what Blue Panda posts today"). It is explicitly not a long-term social graph.

---

## 6. DMs (v2 — new, E2E encrypted)

### `POST /dm/threads`

**Body**

```json
{
  "recipientUid": "uid_...",
  "wrappedKeys": [
    { "recipientDid": "did_...", "wrappedKey": "base64(AES-GCM(K_thread))" }
  ],
  "initialCiphertext": "base64(...optional...)"
}
```

The client computes `K_thread` (32 random bytes), wraps it to the recipient's device public key (ECDH + HKDF + AES-KW), and uploads only the wrapped material. The server stores `K_thread` only in wrapped form.

**Response 201**

```json
{
  "threadId": "t_...",
  "createdAt": "..."
}
```

> At thread creation, the client also wraps `K_thread` to **itself** and stores the self-wrapped key in its own keychain. That way the same device on the same DID can read the thread on a fresh login.

### `GET /dm/threads?cursor=...`

**Response 200**

```json
{
  "items": [
    {
      "threadId": "t_...",
      "participantUids": ["uid_...", "uid_..."],
      "lastMessageAt": "...",
      "ciphertextCount": 12,
      "unreadCount": 3
    }
  ],
  "nextCursor": "..."
}
```

The server has **no** ability to compute `unreadCount` from message content. It tracks it as an opaque counter incremented on each message and decremented on `POST /dm/threads/{threadId}/read`.

### `GET /dm/threads/{threadId}/messages?cursor=...`

**Response 200**

```json
{
  "items": [
    {
      "messageId": "m_...",
      "senderUid": "uid_...",
      "ciphertext": "base64(...)",
      "nonce": "base64(...)",
      "createdAt": "..."
    }
  ]
}
```

The client unwraps `K_thread` from its local keychain and decrypts. The server never sees plaintext.

### `POST /dm/threads/{threadId}/messages`

**Body**

```json
{
  "clientMessageId": "m_...",
  "ciphertext": "base64(...)",
  "nonce": "base64(...)"
}
```

**Response 201**: `{ "messageId": "m_...", "createdAt": "..." }`

* Rate limit: 60 messages / hour / UID.
* Maximum 4000 characters plaintext (client-side enforced).
* No server-side content check other than byte-length and spam scoring on ciphertext length patterns (e.g., 1000 messages/minute from one device).

### `POST /dm/threads/{threadId}/read`

**Body**: `{ "lastReadMessageId": "m_..." }`

### `DELETE /dm/threads/{threadId}`

Either participant can delete the thread. Server purges immediately (no soft delete — by design). Local keychain copy is deleted by the client.

### `GET /dm/keys/me`

**Response 200**

```json
{
  "threadKeys": [
    { "threadId": "t_...", "selfWrappedKey": "base64(...)" }
  ]
}
```

Used by the client to recover `K_thread` after a fresh login (when the in-memory copy is gone). The self-wrapped key is re-stored in the keychain.

### What the server **cannot** do

* Cannot read message contents (only ciphertext).
* Cannot unwrap `K_thread` (only the recipient device can, with its private key).
* Cannot produce plaintext under any legal process.
* Can produce: thread IDs, participant UIDs/DIDs, timestamps, ciphertext blobs, message counts.

---

## 7. Feed

### `GET /feed/room/{roomId}?sort=hot|new|top&cursor=...&limit=25`

Unchanged from v1. Note: because posts TTL-purge, the "top" sort only includes posts < 25h old.

### `GET /feed/home`

Cross-room mix. Unchanged.

### `GET /feed/updates?since={iso}`

Long-poll fallback.

### `GET /feed/following`

Posts from UIDs you currently follow. **Empty after UID rotation** (your follow list is wiped, and their posts are wiped too).

---

## 8. Rooms

Unchanged from v1.

---

## 9. Media

Unchanged. TTL 25h.

---

## 10. Reports

Unchanged. `reporterUid` is the current UID; denormalized `reporterDid` for correlation.

---

## 11. Search

`GET /search?q=...&type=post|room` — full-text. No user search. TTL bound (only searches live posts).

---

## 12. Notifications

`GET /notifications?cursor=...` — sources: reply, mention, follow, room mod action. Wiped at UID rotation.

`POST /devices/push-token` — `{ "token": "fcm/apns", "platform": "ios|android|web" }`. Push tokens are device-bound (not UID-bound) so they survive rotation.

---

## 13. GraphQL

Most reads are also exposed via GraphQL. Example with the new model:

```graphql
query Thread($id: ID!, $cursor: String) {
  dmThread(id: $id) {
    id
    participantUids
    lastMessageAt
    ciphertextCount
    messages(cursor: $cursor, limit: 25) {
      items {
        id
        senderUid
        ciphertext
        nonce
        createdAt
      }
    }
  }
}
```

**Decryption happens on the client**, not in GraphQL resolvers. The server has nothing to resolve to plaintext.

---

## 14. WebSocket protocol

`wss://realtime.ghostline.app/socket.io/?token=<accessToken>`

**Client → Server**

```json
{ "op": "subscribe.room", "roomId": "r_mental_health" }
{ "op": "subscribe.post", "postId": "p_..." }
{ "op": "subscribe.dm", "threadId": "t_..." }
{ "op": "subscribe.heartbeat" }
```

**Server → Client**

```json
{ "op": "post.new",       "roomId": "...", "post": { ... } }
{ "op": "post.updated",   "postId": "...", "patch": { "score": 14, "commentCount": 4 } }
{ "op": "post.removed",   "postId": "...", "reason": "uid_rotated" }
{ "op": "comment.new",    "postId": "...", "comment": { ... } }
{ "op": "vote.applied",   "postId": "...", "score": 14 }
{ "op": "dm.message",     "threadId": "t_...", "message": { "messageId": "m_...", "senderUid": "uid_...", "ciphertext": "...", "nonce": "..." } }
{ "op": "dm.thread.removed", "threadId": "t_...", "reason": "uid_rotated" }
{ "op": "uid.rotated",    "newUid": "uid_..." }                            // server-initiated rotation
{ "op": "notification",   "notification": { ... } }
{ "op": "pong" }
```

The `uid.rotated` event is the server telling the client "I rotated your UID for you (you were offline at midnight). Update your local state."

---

## 15. Rate limit headers (all endpoints)

```
X-RateLimit-Limit: 20                  // per-DID
X-RateLimit-Remaining: 14
X-RateLimit-Reset: 1700000000
Retry-After: 30
```

Per-DID, not per-UID. A banned UID cannot escape by waiting for midnight.

---

## 16. Pagination

Same as v1. Cursors are opaque. The maximum lifetime of any cursor is 25h, after which the underlying posts are gone.

---

## 17. Versioning

* Breaking changes: bump `/v2`, run both for 6 months.
* Additive changes: stay on `/v1`.