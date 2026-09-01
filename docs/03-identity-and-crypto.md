# 03 — Identity & Cryptography (v2)

> **v2 identity model** — see [12-changelog.md](./12-changelog.md). Every device has a permanent **Device ID (DID)** that the company uses. Every day the server issues a fresh **User ID (UID) + password** that the social layer uses. The UID and all its social state is purged at the next UTC midnight. DMs are end-to-end encrypted so the server cannot read them even when they exist.

This document specifies both identifiers, the cryptography, and the daily rotation protocol.

---

## 1. Two identifiers, two purposes

| Identifier | Issued by | Lifetime | Purpose | Visible? |
|---|---|---|---|---|
| **DID** (`did_<uuidv7>`) | server, at first install | one per device, forever (with reservation) | server-internal: rate limits, abuse score, legal process, NCMEC, repeat-infringer policy | **No** — never shown to user, never appears in any URL or social surface |
| **UID** (`uid_<uuidv7>`) | server, on login + daily at UTC 00:00 | 24h | social surface: posts, votes, comments, follows, DMs, in-app identity | **Yes** — the "username" of the day, shown in feeds, in DMs, in the profile chip |

The user **never** sees the DID. They see only their UID and a friendly display name ("Blue Panda"). If a staff member has to look them up by DID, the lookup requires a separate, audited admin path with a documented reason.

---

## 2. First install — DID issuance

### 2.1 Client generates device secret + keypair

```
// On the client (iOS Keychain, Android Keystore, or web IndexedDB)
deviceSecret  = randomBytes(32)                         // symmetric secret, never leaves device
keyPair       = ECDSA-P256.generateKey()                // signing keypair
publicKeySPKI = keyPair.publicKey.export("spki")
```

### 2.2 Client calls `POST /v1/auth/device/register`

Body:

```json
{
  "clientNonce": "8d3f...",
  "keyId": "k1",
  "publicKey": "-----BEGIN PUBLIC KEY-----\nMFkw...",
  "deviceSecretProof": "hex(HMAC-SHA256(deviceSecret, 'register-v1'))",
  "platform": "ios|android|web",
  "appVersion": "1.0.0",
  "deviceFingerprint": { /* coarse, see 02 §1 */ }
}
```

The proof lets the server verify the client knows the secret without the client sending the secret. The server stores `argon2id(deviceSecret)` as `deviceSecretHash`.

### 2.3 Server response

```json
{
  "did": "did_0190f4e2-7c8b-7d2a-9a1f-3e8b6a2c1d44",
  "reservedUntil": "2026-09-06T00:00:00Z",
  "uid": "uid_0190f4e2-aaaa-bbbb-cccc-3e8b6a2c1d44",
  "uidExpiresAt": "2026-08-08T00:00:00Z",
  "displayName": "Blue Panda",
  "colorHex": "#3F7CAC",
  "password": "K9p2-vRm4-xQc7",                         // 12-char human-typable; see §5
  "accessToken": "eyJ...",
  "refreshToken": "rt_...",
  "nextRotationAt": "2026-08-08T00:00:00Z"
}
```

The client persists:

* `deviceSecret`, `keyPair.privateKey` → Keychain / Keystore / IndexedDB (non-extractable)
* `did`, `uid`, `password` → same secure store
* `accessToken`, `refreshToken` → Keychain (mobile), `httpOnly` cookie (web)

> **The password is generated server-side and shipped to the client over TLS.** The client stores it in the secure store. The user never types it. The server stores only `argon2id(password)`.

---

## 3. Subsequent logins — UID issuance

After install, every login issues a **new UID + new password**, even within the same UTC day. This is what makes sessions feel "anonymous each time" — a logout/login cycle gets you a new handle.

```
POST /v1/auth/login
Headers:
  X-Ghost-Device-Proof: hex(HMAC-SHA256(deviceSecret, 'login-v1:' + nonce))
  X-Ghost-Nonce: ...
  X-Ghost-PublicKey: SPKI
Body: { "did": "did_..." }
```

Server verifies the proof against `deviceSecretHash`, looks up the device, and issues a new `uid` + `password` + tokens.

> **One DID → many UIDs over time.** Each login is a new identity on the social surface. The abuse score stays with the DID.

---

## 4. Daily rotation at UTC 00:00

### 4.1 The client drives the rotation (preferred)

The client wakes at `nextRotationAt` (a background task on mobile, a service-worker timer on web) and calls:

```
POST /v1/auth/rotate
Headers: Authorization: Bearer <current access token>
Body: {} (empty)
```

Server:

1. Verifies the token is for the current `uid` (not a stale one).
2. Marks the old `daily_identities` row as `rotating`.
3. Issues a new `uid`, `password`, tokens.
4. Returns the new pair.

### 4.2 Server-side fallback

If the client never calls (offline device, app uninstalled), the scheduled job at `00:00:05 UTC` does the same thing for any device whose `uid` has `rotatesAt <= now`. The next time that device logs in, it receives the **latest** UID, not the expired one.

### 4.3 What gets purged on rotation

A reaper job (`/v1/jobs/uid-purge`, runs every 5 min) hard-deletes for the expired UID:

* `posts` (sets `removedReason: "uid_rotated"`, then TTL purges after 25h)
* `comments` (same)
* `votes` (deleted; tallies recomputed lazily)
* `follows` (both sides)
* `dm_threads` and `dm_messages` (ciphertext deleted; clients lose keys; see §8)
* `daily_identities` row itself
* Redis keys: `uid:active:*`, `uid:byDid:*`, `notify:{uid}*`, `dm:unread:{uid}:*`
* Notifications inbox for that UID

What is **not** purged:

* `devices` row (the DID is permanent)
* `abuse_score` (lives on the device)
* `audit_log` (staff actions, not user data)
* `daily_identities_history` only if a `legal_hold` is in place

### 4.4 Race conditions

* **User posts at 23:59:59**, rotation fires at 00:00:00. The post belongs to the old UID and is purged 25h later. The new UID has no record of it. Correct.
* **User posts at 00:00:00.500** (server clock). The new UID owns it. Correct.
* **Two clients for the same device race a rotation**: server uses a Redis `SETNX` lock on `rotate:lock:{did}` with 10s TTL. Loser gets 409 with a `retry_after_ms`. Both clients converge to the new UID on retry.
* **Rotation while a request is in-flight**: the request's JWT `uid` claim is checked against the current `uid:active:{uid}` Redis key. If rotated, the request 401s with `code: "uid_rotated"`. The client discards the response and retries with the new token.

---

## 5. Password format and rotation

* **Format**: 12 chars from a 36-symbol alphabet (no `0/O/1/l/I` confusion), 4-group dash-separated like `K9p2-vRm4-xQc7`. ~62 bits of entropy.
* **Server stores** `argon2id(password, memory=64MB, time=3, parallelism=4)`. Verification is intentionally slow.
* **Why a server-generated password instead of a client-derived one?**: keeps the server stateless on credential derivation and lets the user "re-roll" by logging out and back in. The user never sees or types the password.
* **Why the password changes daily along with the UID?**: the password is bound to a UID. If a UID is leaked (e.g., screenshot), it's only good for 24h. Daily rotation invalidates the leak.
* **Brute force**: with 62 bits, online brute force is infeasible. We further rate-limit `/auth/login` per IP (5/min) and per DID (10/h). After 10 failed logins, a 1h cooldown on the DID.
* **What if the password leaks to a third party?**: they can act as you for ≤24h, but they would also need the device's private signing key (in Keychain) to authenticate requests. The password is necessary but not sufficient. See §9.

---

## 6. Device lifecycle

### 6.1 One DID per device per lifetime

* `devices.did` is reserved for the device for 30 days after `lastActiveAt`.
* During reservation, no new install from the same device can mint a different DID. (We use a coarse device fingerprint + private-IP/MAC-derived hint to detect "same device, fresh install". The hint is best-effort; see [05 §13](./05-moderation-and-abuse.md#13-reinstall-and-multi-account-defense).)
* After 30 days of inactivity, the DID may be reissued on next install. The old `devices` row is tombstoned with `releasedAt`, and any remaining social history has already TTL-purged.

### 6.2 Lost device

There is no recovery. The user reinstalls the app on a new device, gets a new DID, and starts fresh. The old DID is held in `devices` but cannot be authenticated against (the `deviceSecret` is gone with the device). The old device's social state (UIDs, posts, DMs) has been wiped or TTL-purged already.

### 6.3 Key rotation

Same as v1: a new keypair can be registered against an existing DID via `POST /v1/auth/device/rotate-key`. The DID itself does not change.

### 6.4 Transferring to a new device

There is no transfer. New device = new DID. The user must accept that social history does not follow them.

> This is the user's only real complaint with the system, and it's the price. We make it explicit in onboarding.

---

## 7. Authenticated request shape

All authenticated requests are signed with the **device's ECDSA private key** and include the **current UID** in the JWT.

```
POST /v1/posts
Headers:
  Authorization: Bearer <accessToken>                  // JWT contains { did, uid, exp }
  X-Ghost-KeyId: k1
  X-Ghost-Timestamp: 2026-08-07T23:59:59Z
  X-Ghost-Nonce: 9a7c...
  X-Ghost-Signature: MEUCIQDx...
  Content-Type: application/json

Body: { "roomId": "...", "body": "..." }
```

**Signature input** (canonical, sorted keys, no whitespace):

```
METHOD\n
PATH\n
TIMESTAMP\n
NONCE\n
SHA256(BODY)
```

**Server validation order**:

1. JWT valid, not in `jwt:revoked:*`.
2. `uid` claim exists in `uid:active:{uid}` (Redis). If not → `uid_rotated` error.
3. `did` claim matches `daily_identities[uid].did`.
4. Timestamp within ±5 min of server clock.
5. `Nonce` not in `nonce:{did}:{nonce}` (10 min TTL).
6. ECDSA signature verifies against `devices[did].publicKey`.
7. Apply per-DID rate limits and abuse-score checks.

This is intentionally redundant. Defense in depth.

---

## 8. End-to-end encrypted DMs

### 8.1 Threat model

The server **must not** be able to read DM contents, even when compelled. Compelled disclosure should yield nothing but ciphertext blobs that the company cannot decrypt.

### 8.2 Key derivation

Per thread, the **initiating client** generates a fresh 256-bit AES key `K_thread` and derives a per-device keypair from a DH agreement with the recipient's device public key:

```
sharedSecret = ECDH(ephemeralPrivKey, recipientDevicePubKey)
wrapKey     = HKDF-SHA256(sharedSecret, salt=threadId, info="dm-wrap-v1", L=32)
wrappedK    = AES-256-GCM-encrypt(wrapKey, K_thread, AAD=threadId)
```

The server stores only the **wrapped** `K_thread` along with each `dm_messages.ciphertext`. It cannot unwrap.

### 8.3 Message send

```
Client →
  1. msgKey = HKDF(K_thread, salt=msgId, info="msg-v1", L=32)
  2. ct, nonce = AES-256-GCM-encrypt(msgKey, plaintext)
  3. Send { threadId, ciphertext: ct, nonce, messageId } to server
Server stores row, fans out via realtime.
```

The server sees `{ threadId, senderUid, ciphertext, nonce, createdAt }`. Nothing else.

### 8.4 Message receive

Recipient client looks up `K_thread` in its local keychain (it was wrapped to its device pubkey at thread creation), unwraps, decrypts.

### 8.5 On UID rotation

* Old UID's copy of `K_thread` is deleted from the keychain along with the rest of the old UID's local state.
* Server-side ciphertext is purged at TTL.
* Thread row is deleted.
* **Both parties' DM history evaporates**, exactly like the rest of the social surface.

### 8.6 What we do NOT defend against

* A compromised device can read DMs (the keys are there). This is fundamental to E2E.
* A screenshot of a DM (mobile). Anti-screenshot measures apply (see [08 §10](./08-mobile-app.md#10-anti-screenshot)).
* The recipient can always leak the content. This is a property of all E2E systems.

### 8.7 Why this is honest

* We **cannot** comply with a court order to disclose DM plaintext. We will say so in the privacy policy and in the transparency report.
* We **can** comply with a court order to disclose ciphertext, but we will note that this is meaningless without the keys.
* Staff have **zero** access to plaintext DMs. No console, no log, no admin tool. The only way to see DM plaintext is to compromise a participant's device.

---

## 9. What the password protects

The password alone **cannot** authenticate a request. Every authenticated request also requires the device's ECDSA private key. So the password's role is:

1. **Resumability**: the client can re-authenticate after the access token expires without needing the Keychain to re-prompt biometric.
2. **Server login endpoint**: `POST /auth/login` requires both `did` and the password-derived proof. Without the device key, this only gives a new UID, not the ability to sign.
3. **Defense if the device key leaks**: if the keychain is compromised but the password isn't, the attacker has a 24h window from the last login (the password is needed to refresh). If both leak, the user must reinstall (which is what the attacker would want anyway).

---

## 10. Reference: `packages/crypto` API (v2)

```ts
// device registration
const setup = await registerDevice({
  generateKeyPair: () => ECDSA_P256.generate(),
  signProof: (secret, label) => HMAC_SHA256(secret, label),
  storeSecret: (secret) => keychain.set("deviceSecret", secret),
  storeKey: (kp) => keychain.set("deviceKey", kp)
});
// setup = { did, uid, password, tokens, ... }

// login
const session = await loginDevice({ did, deviceSecret });

// daily rotation
const rotated = await rotateSession({ currentAccessToken });

// signed request
const signed = await signRequest({
  method, path, body, timestamp, nonce,
  privateKey: storedKey
});

// DM encryption
const encrypted = await dmEncrypt({
  threadId, plaintext, recipientDevicePubKey
});
```

Same package compiles to web (WebCrypto), Node (`node:crypto`), and React Native (`react-native-quick-crypto` + `expo-crypto`).

---

## 11. Threat discussion (updated)

| Attack | Defense |
|---|---|
| Reinstall to get a fresh DID | Device fingerprint + private-IP-derived hint + 30-day reservation. Best-effort. Combined with abuse score (lives on DID, not UID), a banned user can't escape by reinstalling. |
| Screenshot the UID | UID rotates daily; the screenshot is only valid for ≤24h. |
| Steal the password | Password is in Keychain/Keystore (`ThisDeviceOnly`). Also useless without the device signing key. |
| Steal the device | User reinstalls on a new device, gets a new DID. Old DID is unrecoverable. |
| Brute force the password | 62 bits + per-IP and per-DID rate limits + 1h cooldown after 10 failures. |
| Sign for a different UID | Signature verification uses the `did`-bound public key; the `uid` claim is in the JWT, which the server signs. |
| Replay | ±5 min timestamp + nonce store. |
| Server breach leaks DMs | Server only ever has ciphertext + wrapped keys. |
| Server breach leaks PII | There is no PII to leak. |
| Server compelled to disclose DMs | We can produce ciphertext only. We cannot produce plaintext. We will say this. |
| Quantum future | Plan v2.1: dual-issue ML-DSA alongside ECDSA. |
