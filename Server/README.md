# Ghostline — Server (basic level)

A minimal Express server for **Ghostline**. Implements the two-identifier
identity model (permanent DID + daily-rotating UID) and the social layer
(posts, votes, comments, rooms, feed, daily purge of social state).

## Endpoints

| Endpoint | Purpose |
|---|---|
| `POST /api/auth/register` | First install — issues DID, UID, friendly handle, password, token |
| `POST /api/auth/login`    | Returning user — issues a **fresh UID + password** (every login) |
| `POST /api/auth/rotate`   | Daily rotation — client-driven at UTC midnight |
| `GET  /api/auth/me`       | Current identity (also exposes `serverNow` for clock sync) |
| `GET  /api/health`        | Liveness probe |
| `GET  /api/rooms`         | List of rooms (one room — "Random" — at MVP) |
| `POST /api/posts`         | Create a post (auth required) |
| `GET  /api/feed?roomId=…` | 25h-bounded, newest-first feed |
| `POST /api/posts/:id/vote` | Upvote / downvote / clear (auth required) |
| `GET  /api/posts/:id/comments` | Comments on a post (oldest first) |
| `POST /api/posts/:id/comments` | Add a comment (auth required) |
| `POST /api/_debug/force-rotate` | (only when `DEBUG=1`) rotate the current UID on demand |

## Storage

No database. JSON files in `Server/data/`:

- `devices.json` — one row per device, holds the bcrypt password hash
- `daily_identities.json` — one row per UID (25h TTL; 60s in `DEBUG_FAST`)
- `posts.json` — one row per post
- `votes.json` — one row per (did, postId); `value` is the current vote
- `comments.json` — one row per comment (flat — no nested replies at MVP)

Each file is rewritten on every write. That's fine for a basic prototype.

## How to run

```bash
cd Server
npm install
node server.js
# -> [ghostline] identity server listening on http://localhost:3001
```

### Test rotation in 60 seconds

```bash
DEBUG_FAST=1 node server.js
# -> [ghostline] DEBUG_FAST=1 — UIDs expire in 60s (for testing rotation)
```

### Test the daily purge of social state

Posts/votes/comments older than 25h are deleted by the same 60-second sweep
that handles UID rotation. To watch it work quickly:

1. Start the server with `DEBUG_FAST=1`.
2. Open the web client, post a message, comment on it.
3. Wait ~60s for the UID to expire; the post and its comment are now 60s old.
4. Edit `Server/data/posts.json` and set that post's `createdAt` to a
   timestamp 25h+ ago (or any time before `Date.now() - 25*60*60*1000`).
5. Within 60s, the next rotation tick will delete the post, its votes, and
   its comments, and the server will log:
   `[ghostline] purge tick: removed 1 post(s), N vote(s), N comment(s)`.

### Run the in-process debug force-rotate

```bash
DEBUG=1 node server.js
# then from the browser devtools:
fetch('/api/_debug/force-rotate', {
  method: 'POST',
  headers: { Authorization: `Bearer ${JSON.parse(localStorage['ghostline.session.v1']).accessToken}` }
}).then(r => r.json()).then(console.log)
```

## Files

```
Server/
├── package.json
├── server.js            (Express app, entry point, rotation + purge scheduler)
├── routes/
│   ├── auth.js          (register / login / rotate / me)
│   ├── rooms.js         (list rooms — single "Random" room at MVP)
│   └── posts.js         (feed / posts / votes / comments)
├── lib/
│   ├── identity.js      (DID/UID/password/name/token generation + bcrypt)
│   ├── storage.js       (JSON read/write)
│   └── rotation.js      (60s sweep: mark expired UIDs + purge old social state)
├── data/                (created on first run)
│   ├── devices.json
│   ├── daily_identities.json
│   ├── posts.json
│   ├── votes.json
│   └── comments.json
└── README.md
```

## What this build skips (per the spec, kept for later)

- ECDSA device keypair + signed-request headers
- Real `Authorization: Bearer <JWT>` — we use opaque bearer tokens
- DMs (and any E2E encryption — that's a v2 spec item)
- Multi-room UI (the API supports it; only one room exists today)
- Moderation, abuse scoring, shadow ban
- GraphQL — REST only
- Socket.IO realtime
- MongoDB TTL reapers (the rotation sweep does the same job, in JSON)
- Redis
- Multi-region active-active

The identity mechanic, the social layer, the feed, and the daily purge
are all spec-faithful.