# 06 — Feed, Ranking, Realtime

> **v2 identity model** — see [12-changelog.md](./12-changelog.md). Posts TTL-purge at 25h. "Top" sort is bounded to the last day. The "Following" feed is empty between days.

The feed is the product. This document specifies how posts are ordered, paginated, cached, and pushed to clients in real time.

---

## 1. Feed surfaces

| Surface | Default sort | Cursor | Notes |
|---|---|---|---|
| Home | Hot | ≤24h (TTL bound) | Cross-room mix, weighted by room velocity |
| Room | User-selected: New / Hot / Top | ≤24h | Per-room; Top is bounded to 25h |
| Profile (self) | New | ≤24h | "Today's posts" only |
| Following | New | ≤24h | Empty after UID rotation |
| Notifications | New | ≤24h | Reply/mention/follow (current UID only) |
| Search | BM25 | ≤24h | Full-text only; searches live posts |
| DM thread | New (client-decrypted) | n/a | Server delivers ciphertext; client decrypts |

Every feed is bounded to ≤24h because that's the lifetime of any post. There is no "all-time" view in v2. The user **never** sees a "for you" feed. Chronological + hot only, with the explicit understanding that the dataset is "today's".

## 2. Pagination

* Cursor format (opaque, base64-JSON): `{ lastCreatedAt, lastId }` for New; `{ lastScore, lastId, lastCreatedAt }` for Hot/Top.
* Page size: 25 by default, 50 max.
* Stable: identical reads return the same order unless the underlying set changes.

## 3. Ranking

### 3.1 Chronological ("New")

Pure MongoDB query:

```js
db.posts.find({
  roomId, status: "live",
  createdAt: { $lt: lastCreatedAt }
}).sort({ createdAt: -1, _id: -1 }).limit(25)
```

Backed by the index `{ roomId: 1, status: 1, createdAt: -1 }`.

### 3.2 Hot

Combines score, velocity, and a time decay.

```ts
function hotScore(post: Post, now = Date.now()): number {
  const ageHours = (now - +new Date(post.createdAt)) / 3.6e6;
  const order    = Math.log10(Math.max(Math.abs(post.weightedScore), 1));
  const sign     = post.weightedScore > 0 ? 1 : -1;
  // Hacker News style with weighted score; tuned so a post peaks at ~6h
  return sign * order + (post.createdAtMs / 45000);
}
```

Where `weightedScore` comes from the moderator-adjusted sum of weighted votes (see [05 §6](./05-moderation-and-abuse.md#6-weighted-voting)).

### 3.3 Top (all-time)

`weightedScore` with no decay, but excludes posts younger than 6h to give them a chance to gather votes first.

### 3.4 Anti-gaming tweaks

* Any post whose `reportCount >= 3` and `abuseScore > 0.5` is excluded from Hot/Top until reviewed.
* Any post whose author has `abuseScore > 50` is excluded from Hot/Top regardless of vote count.
* Brigaded posts (§09) get their new-vote contribution suppressed.

## 4. Feed assembly algorithm (server)

```ts
async function getFeed(opts: {
  userDid: string;              // for abuse filtering — keyed on device, not uid
  userUid: string;              // for "what have I voted on" hydration
  roomId?: string;              // if absent, "home"
  sort: "new" | "hot" | "top";
  cursor?: string;
  limit: number;
}): Promise<{ items: Post[]; nextCursor: string | null }> {
  const userAbuse = await redis.get(`abuse:score:${opts.userDid}`);

  // TTL bound: posts older than 25h never appear in any feed
  const minCreatedAt = new Date(Date.now() - 25 * 3600 * 1000);

  // 1. Hot path: try Redis sorted set first
  if (opts.sort === "hot") {
    const cached = await fetchFromRedisHotFeed(opts);
    if (cached) return cached;
  }

  // 2. Mongo path
  const items = await fetchFromMongo({ ...opts, minCreatedAt, userAbuse });

  // 3. Backfill Redis
  if (opts.sort === "hot" && items.length) {
    await backfillRedisHotFeed(opts, items);
  }

  // 4. Re-rank client-visible items through personalization-free
  //    filter (anti-gaming). Already done in Mongo path; reapply for
  //    Redis-cached items in case abuse score changed.
  return finalize(items, opts);
}
```

## 5. Redis hot-feed cache

For each room, a sorted set `feed:hot:{roomId}` keyed on `hotScore` with `member = publicId`. Updated by a change stream worker:

* On post insert: ZADD with current score.
* On vote applied: ZADD with new score.
* On post removed: ZREM.
* On post older than 72h: ZREM (the worker runs a 5-min sweep).

Reads from this set are O(log N + pageSize) and serve the vast majority of Home/Room traffic without touching Mongo.

## 6. Realtime fan-out

### Subscription model

A client subscribes to a room (`subscribe.room`). The realtime service maintains a Redis-backed map of `roomId → Set<socketId>`.

### Event flow

```
post.create
   │
   ▼  (api writes to Mongo, publishes to Redis)
redis PUBLISH room:{roomId} { type: "post.new", post: {...} }
   │
   ▼
realtime service receives → looks up sockets subscribed to roomId
   │
   ▼
socket.emit("post.new", payload) to each
```

### Optimistic UI

Clients optimistically render their own posts and votes, then reconcile with the server event. If the server event disagrees (e.g., the post was shadowed in the meantime), the client shows a soft "this post was hidden by moderators" toast and removes it from the local list.

### Conflict resolution

For vote tallies we use **last-writer-wins per voter** (idempotent on `(voter, target)`) plus a server-side recompute every 30s for the visible counter. We never trust the client to compute totals.

## 7. Notifications

* **In-app inbox**: persisted in Mongo `notifications` collection (omitted from data model in [02](./02-data-model.md) for brevity — see `notifications` schema: `{ _id, uuid, type, refId, createdAt, readAt }`).
* **Push**: only for replies to your posts, mentions, and a daily room digest (opt-in).
* **Throttling**: at most 1 push per 5 min per identity, and a max of 5 pushes/day to a single user.

### Delivery logic

```
on new comment on post P:
  if P.authorUuid != commenter.uuid:
    inApp(author=P.author, type="reply", ref=P.publicId)
    if pushSubscribed(P.author) and canPush(P.author):
      sendPush(P.author, ...)
```

## 8. Long-poll fallback

When WS is unavailable (proxy issues, captive portals), the client polls `GET /feed/updates?since={lastEventId}`. Server returns events newer than that ID (max 100) from an in-memory ring buffer. The server retains the last 1000 events per room for 10 min.

## 9. Cold start (new room)

If a room has < 50 posts in the last 24h, the hot feed falls back to "new" sort — there isn't enough signal to rank.

## 10. Personalization (v2 only)

When we ship v2, the only personalization we will add is **per-user mute filters**:

* Mute a word
* Mute a room
* Mute an identity (the user can paste any `uuid` they want to ignore)

We will **not** ship engagement-maximizing ranking. This is a product principle, not a technical one.
