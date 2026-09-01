# 07 — Web Frontend (MERN — React side)

> **v2 identity model** — see [12-changelog.md](./12-changelog.md). The web client handles DID login, daily UID rotation, the DM UI (E2E decrypt in the browser), and the rotation banner. The DID is never visible in the UI.

The web client is a single-page React app served as a PWA. It is intentionally minimal: the mobile app is the primary surface. The web app exists for desktop, kiosks, and a "no-install" path.

---

## 1. Tech stack

| Concern | Choice | Reason |
|---|---|---|
| Framework | React 18 + TypeScript | Team familiarity, ecosystem |
| Build | Vite | Fast HMR, simple config |
| State | Redux Toolkit + RTK Query | Predictable, codegen from API |
| Routing | React Router 6 | Standard |
| Styling | TailwindCSS + CSS variables for tokens | Fast iteration, theming |
| UI primitives | Radix UI + shadcn/ui | Accessible, unstyled, composable |
| Animations | Framer Motion | Polished feel without overkill |
| Forms | React Hook Form + Zod | Type-safe |
| i18n | i18next | Standard |
| Analytics | PostHog (self-hosted) | Privacy-friendly |
| Errors | Sentry | |
| Realtime | Socket.IO client | |

## 2. Folder structure (apps/web)

```
apps/web/
├── public/
├── src/
│   ├── app/
│   │   ├── App.tsx
│   │   ├── routes.tsx
│   │   └── store.ts
│   ├── features/
│   │   ├── auth/             # register, sign-in (no password), key mgmt
│   │   ├── feed/             # Home, Room, post cards, infinite scroll
│   │   ├── composer/         # New post editor, image upload
│   │   ├── post-detail/      # Thread view, comments
│   │   ├── notifications/
│   │   ├── profile/          # My posts, settings, regenerate name
│   │   ├── rooms/            # Room list, room detail
│   │   ├── reports/
│   │   ├── onboarding/       # Privacy banner, name reveal
│   │   └── settings/         # Mutes, push, region
│   ├── components/           # Shared UI
│   │   ├── Avatar.tsx
│   │   ├── Button.tsx
│   │   ├── Card.tsx
│   │   ├── Modal.tsx
│   │   ├── Toast.tsx
│   │   ├── Composer.tsx
│   │   ├── Vote.tsx
│   │   ├── ReportSheet.tsx
│   │   ├── IdentityChip.tsx
│   │   └── Media.tsx
│   ├── lib/
│   │   ├── api/              # RTK Query API + baseQuery w/ signed headers
│   │   ├── crypto/           # WebCrypto wrapper
│   │   ├── storage/          # IndexedDB
│   │   ├── realtime/         # socket.io-client
│   │   └── analytics/
│   ├── styles/
│   └── main.tsx
└── index.html
```

## 3. Routes

| Path | Page | Auth |
|---|---|---|
| `/` | Onboarding (privacy banner → "Continue") | none |
| `/welcome` | Name reveal + first-room selection | required |
| `/home` | Home feed (Hot) | required |
| `/r/:slug` | Room feed (New / Hot / Top) | required |
| `/r/:slug/compose` | New post modal | required |
| `/p/:publicId` | Post detail + comments | required |
| `/p/:publicId/report` | Report flow | required |
| `/u/me` | My posts (today only) | required |
| `/u/me/settings` | Settings | required |
| `/notifications` | In-app inbox (today only) | required |
| `/dm` | DM thread list | required |
| `/dm/:threadId` | DM conversation | required |
| `/u/:uid` | Public "today" profile (read-only) | required |
| `/legal/privacy` | Static | none |
| `/legal/terms` | Static | none |
| `/about` | Static | none |

## 4. State shape (Redux)

```ts
type RootState = {
  auth: {
    status: "idle" | "registering" | "ready" | "expired" | "rotating";
    did: string | null;                              // <-- never displayed anywhere in UI
    uid: string | null;                              // today's handle
    displayName: string | null;
    colorHex: string | null;
    accessToken: string | null;
    refreshToken: string | null;
    accessTokenExpiresAt: string | null;
    uidExpiresAt: string | null;                    // next midnight UTC
    nextRotationAt: string | null;
  };
  feed: {
    byRoom: Record<string, { items: string[]; cursor: string | null; status: "idle"|"loading"|"error" }>;
  };
  composer: {
    draft: { roomId: string; body: string; mediaIds: string[] } | null;
    submitting: boolean;
  };
  notifications: {
    items: Notification[];
    unreadCount: number;
  };
  dm: {
    threads: DMThread[];
    messagesByThread: Record<string, DecryptedMessage[]>;
    keysByThread: Record<string, CryptoKey>;             // unwrapped K_thread, in memory only
  };
  rotation: {
    status: "idle" | "rotating" | "errored";
    lastRotatedAt: string | null;
    bannerDismissedAt: string | null;
  };
  mutes: {
    words: string[];
    rooms: string[];
    identities: string[];
  };
  ui: {
    theme: "system" | "light" | "dark";
    toasts: Toast[];
  };
};
```

## 5. Every screen, every button

### 5.1 Onboarding `/`

**Header**: Ghostline logo
**Body**:
* "You are anonymous here" hero
* Plain-language copy (see [00 §7](./00-product-overview.md#7-privacy-promise-in-app-copy))
* Accordion: "What we store" → "What we don't"
* Buttons:
  * `Continue` (primary, full-width) — registers identity
  * `Read the privacy policy` (text link)
  * `How anonymity works` (text link → modal)
* Footer: `v1.0.0`

### 5.2 Welcome `/welcome`

Shown once after registration.

* "Hi, **Blue Panda**" (in their generated color)
* "Pick a room to start" — list of recommended rooms (3–5)
* Buttons:
  * `Enter Mental Health` (room card, primary)
  * `Enter Tech` (room card)
  * `Enter Random` (room card)
  * `See all rooms` (text link → `/r`)
  * `Change my name` (ghost button → triggers `/auth/display-name/regenerate`)

### 5.3 Home `/home`

* Top bar: Hamburger menu (left), "Home" (center), Notifications bell (right) with unread badge
* Sort tabs: `Hot` | `New` (segmented control)
* Pull-to-refresh
* Infinite scroll with cursor
* Each post card:
  * IdentityChip: dot in user color + display name + "· 2h" (relative time)
  * Body text (truncate at 6 lines, "show more")
  * Media (1, 2, or 3+ grid; click → lightbox)
  * Action row:
    * ▲ upvotes
    * 💬 comment count
    * Share (copy link)
    * ⋯ menu (Report, Mute author, Copy link, Open original)
  * If status is `under_review` (author's own view): "This post is being reviewed" badge
* Floating action button (bottom-right, only on home): `+ New Post` → opens composer modal pre-set to most recent room
* Empty state: illustration + "Be the first to post" CTA

### 5.4 Room `/r/:slug`

* Header: room icon + name + description + "Subscribe" button
* Sub-tabs: `New` | `Hot` | `Top`
* Same card list as home
* `+ New Post` in header (right) opens composer in-room

### 5.5 Composer (modal)

* Title: "New post in {room name}"
* Textarea (4–8 rows, auto-grow, char counter 0/4000)
* PII detection: if a phone or email pattern is detected → inline warning ("This may identify you. Redact? [Redact] [Post anyway]")
* Media row: `+` button → opens file picker → upload flow
* Buttons:
  * `Post` (primary, disabled if body empty or > 4000)
  * `Cancel` (closes modal, saves draft locally)
  * Room selector (chip dropdown)
* Cooldown state: "New accounts wait {N}s before posting" with countdown

### 5.6 Post detail `/p/:publicId`

* Hero post (full body, no truncation)
* Comments thread (paginated, top-level only in v1; nested is v2)
* Reply box at bottom (`Reply` button → inline composer)
* If author: `Edit` (within 10 min) / `Delete` (with confirm)
* If not author: `⋯` → Report / Mute

### 5.7 Profile `/u/me`

* IdentityChip large
* Stats: posts count, account age
* Tabs: `Posts` | `Comments` | `Media` (v2)
* Settings link

### 5.8 Settings

Sections:

* **Account** (display name + `Regenerate name` button; "What we know about you" — collapsible showing technical fields only, no PII)
* **Notifications** — toggles per category
* **Mutes** — word / room / identity inputs with chips
* **Privacy** — link to policy
* **About** — version, build hash
* **Danger zone** — `Delete this identity` (irreversible, soft-confirms by typing the displayed name)

### 5.9 Notifications

* List, newest first
* Tap → navigates to the target post
* Swipe-left → Mark read
* Empty state: "Nothing yet"

## 6. Component contracts

### `<IdentityChip uid displayName colorHex uidIssuedAt />`

Renders the anonymized author handle. No profile link. The `uidIssuedAt` is shown as a small "since HH:MM" tooltip so other users see the handle is ephemeral. Always renders the display name + color dot, **never** the UID or DID.

### `<RotationBanner uidExpiresAt />`

A persistent but dismissable banner at the top of every authenticated screen:

> "Today's handle is **Blue Panda**. In {HH:MM:SS} your handle changes and today's posts, follows, and DMs disappear. [Got it]"

Becomes more attention-grabbing as the countdown approaches zero (color shifts from yellow → red, slide-down animation). At T-5min, a modal-style overlay appears. At T-0, the client calls `POST /auth/rotate`, the UI updates the handle + color, and a "You're now Quiet Otter" toast appears.

### `<DMList />` and `<DMThread threadId />`

* `DMList` reads `GET /dm/threads` and renders `{participantUids, lastMessageAt, ciphertextCount, unreadCount}`. Click → `/dm/:threadId`.
* `DMThread` reads `GET /dm/threads/:id/messages`, decrypts each message with `K_thread` (loaded from IndexedDB or recovered via `GET /dm/keys/me`), and renders plaintext in a chat-style view.
* A persistent header reads: "This conversation disappears at midnight UTC. ({HH:MM:SS})"
* `<DMComposer />` encrypts the typed message with `K_thread` and posts ciphertext via `POST /dm/threads/:id/messages`. The plaintext never leaves the client.
* Sender client also displays their own encrypted-but-decrypted message (local re-decrypt for display).

### `<Vote targetId initialUp initialDown initialMyValue onChange />`

* Calls `POST /votes` on click
* Optimistic update
* Disabled if not signed in
* Keyboard: `ArrowUp` / `ArrowDown` when focused

### `<Composer roomId onSubmit onCancel />`

* Manages its own draft state
* Calls `media/upload-url`, then PUT to S3, then `media/finalize`
* Submits to `POST /posts`

### `<ReportSheet targetType targetId onClose />`

* Lists reasons with icons
* Optional note field
* Submit calls `POST /reports`
* Success → "Thanks. Reports are anonymous" toast → close

## 7. Signed-request library (web)

```ts
// lib/api/baseQuery.ts
const baseQuery: BaseQueryFn = async (args, api) => {
  const { auth, crypto } = api.getState() as RootState;
  const { method, url, body } = args;
  const ts = new Date().toISOString();
  const nonce = randomBytes(16).toString("hex");
  const bodyStr = body ? JSON.stringify(body) : "";
  const bodyHash = sha256Hex(bodyStr);
  const canonical = [method.toUpperCase(), url, ts, nonce, bodyHash].join("\n");
  const signature = await crypto.sign(canonical);

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Ghost-Timestamp": ts,
    "X-Ghost-Nonce": nonce,
    "X-Ghost-Signature": signature,
  };
  if (auth.accessToken) headers["Authorization"] = `Bearer ${auth.accessToken}`;

  const res = await fetch(API_BASE + url, { method, headers, body: bodyStr || undefined });
  if (res.status === 401) await api.dispatch(refresh());
  return { data: await res.json() };
};
```

## 8. Accessibility

* All interactive elements have visible focus states
* Color is never the sole signal (e.g., score change uses arrows + color)
* ARIA roles on dialogs, menus, lists
* Reduced-motion media query disables non-essential animation
* Screen reader labels for the upvote/downvote buttons ("Upvote, currently 14")

## 9. PWA

* `manifest.json` with name, icons, theme color
* Service worker:
  * Precache app shell
  * Runtime cache for room metadata and avatars (24h)
  * Never cache user-specific responses (`/me`, `/feed/*`) — always network
* Install prompt: surfaces after the user posts for the 2nd time

## 10. Performance budget

* Initial JS ≤ 180 KB gzipped
* LCP ≤ 1.5s on 4G
* TTI ≤ 2.5s
* Image lazy-loading + `loading="lazy"` + responsive `srcset`

## 11. Internationalization

* All strings via `i18next`
* v1 ships: `en`, `es`, `pt-BR`, `de`, `fr`, `ja`
* Detection: `navigator.language` → user override in settings

## 12. Testing

* **Unit**: Vitest. Per-component, per-slice
* **Integration**: MSW for API mocks. Test signed-request flow.
* **E2E**: Playwright. Onboarding → post → vote → comment → delete.
* **Visual regression**: Chromatic for the 3 main screens
* **A11y**: axe-core in CI

## 13. Admin Console (`apps/admin`)

A separate, internal-only React app, accessed only via SSO + hardware key. Lives at `admin.ghostline.app`.

Screens:
* **Queue** — sorted by priority, P0 highlighted red
* **Item detail** — post body, media, classifier scores, prior actions against this identity (count only), `Remove` / `Shadow` / `Ban` / `No action` buttons (with required reason)
* **Appeals** — list of appeals with original context
* **Search** — by `publicId`, `uuid`, or text
* **Legal** — see legal holds & fulfill requests
* **Audit log** — paginated, filterable, immutable
* **Staff** — manage roles, scopes

Hard rules:
* Cannot reveal reporter identity to staff
* Cannot reveal IP/UA to non-legal staff
* Every action requires a reason
* P0 items wake the on-call
