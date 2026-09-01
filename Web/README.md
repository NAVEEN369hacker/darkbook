# Ghostline — Web (basic level)

The minimal React + Vite + TypeScript client for **Ghostline**. Four pages:

1. **Onboarding (`/`)** — privacy banner → `Continue` registers a fresh device
2. **Welcome (`/welcome`)** — name reveal + "what happens at midnight" explainer
3. **Feed (`/`)** — identity chip, rotation banner, post composer, feed of
   posts with vote + comment, "Rotate now" / "Log out" controls
4. **Login (`/login`)** — DID + password entry for returning users (issue a
   fresh handle on every login — that's the spec)

## How to run

You need **two terminals** — the server and the web client.

```bash
# Terminal 1 — server
cd Server
npm install
node server.js          # http://localhost:3001
```

```bash
# Terminal 2 — web
cd Web
npm install
npm run dev             # http://localhost:5173
```

The Vite dev server proxies `/api/*` to `http://localhost:3001`, so the
frontend can use relative URLs.

### Try the rotation in 60 seconds

```bash
# In terminal 1, instead of `node server.js`, run:
DEBUG_FAST=1 node server.js
```

Now every UID expires 60 seconds after it's issued. Watch the banner at the
top of the feed count down — at zero, the handle changes automatically
and the new name + colour appear.

## What's in this build

- Identity model: register / login / rotate / me, with localStorage session
- A single "Random" room (the data model is room-aware, ready for more)
- Post composer with a 500-char limit and a live counter
- Feed: newest-first, 25h-bounded
- Per-post vote (up / down / clear) with optimistic UI and rollback on error
- Per-post comment thread (one level deep) with inline composer
- Live rotation banner — auto-rotates when the countdown hits zero
- Manual "Rotate now" button
- Logout (clears localStorage and sends you to `/login`)

## Files

```
Web/
├── package.json
├── vite.config.ts            (proxies /api to :3001)
├── tsconfig.json
├── tsconfig.node.json
├── index.html
└── src/
    ├── main.tsx               (React root + BrowserRouter)
    ├── App.tsx                (routing + session state + error toast)
    ├── api.ts                 (fetch wrapper for /api/*)
    ├── storage.ts             (localStorage session persistence)
    ├── styles.css             (minimal dark-mode styles)
    ├── types.ts               (Post / Comment / Room DTOs)
    ├── pages/
    │   ├── Onboarding.tsx
    │   ├── Welcome.tsx
    │   ├── Login.tsx
    │   └── Feed.tsx
    └── components/
        ├── RotationBanner.tsx (live countdown + auto-rotate on expiry)
        ├── IdentityChip.tsx   (handle + color dot, used in Welcome + Feed)
        └── PostCard.tsx       (one post + vote + comment thread)
```

## What's intentionally minimal

- No build pipeline beyond Vite
- No state library beyond `useState`
- No styling framework — hand-rolled CSS
- No ECDSA-signed requests (the server uses opaque bearer tokens)
- No DMs, no realtime (Socket.IO), no moderation
- No mobile app (React Native)

When you're ready to layer on more features, the next things to add are:

- Real DMs (and E2E crypto)
- Realtime fan-out via Socket.IO
- Multiple rooms + a room picker
- The mobile app
- A real GraphQL read-side