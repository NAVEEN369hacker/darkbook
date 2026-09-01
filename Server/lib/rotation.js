/**
 * Rotation tick — runs every 60s on the server.
 *
 * Responsibilities:
 *   1. Mark active UIDs whose expiresAt has passed as `rotated`.
 *   2. Purge social state (posts, reactions, comments, DMs) older than 25h.
 *   3. Reset coin balances for any device whose lastResetAt is before today
 *      UTC midnight (per-day coin budget).
 *   4. Drop expired Arena topics + their arguments at UTC midnight (same
 *      expiry as a daily identity).
 *
 * Storage is JSON files, so "delete" means rewriting the collection without
 * the expired rows.
 */

const { readAll, filter, writeAll } = require('./storage');
const { resetAllIfNewDay } = require('./coins');

const SOCIAL_TTL_MS = 25 * 60 * 60 * 1000; // 25 hours

function runRotationTick() {
  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  let rotated = 0;
  let purged = { posts: 0, reactions: 0, comments: 0 };
  const events = { coinsReset: 0, arenaTopicsDropped: 0, arenaPostsDropped: 0 };

  // --- 1. mark expired UIDs as rotated ---
  const expiredUids = filter('daily_identities', (row) => {
    if (row.status !== 'active') return false;
    return new Date(row.expiresAt).getTime() <= now;
  });
  for (const row of expiredUids) {
    const rows = readAll('daily_identities').map((r) =>
      r.uid === row.uid
        ? { ...r, status: 'rotated', rotatedAt: nowIso }
        : r,
    );
    writeAll('daily_identities', rows);
    rotated++;
  }

  // --- 2. purge old posts (cascade reactions/comments) ---
  const cutoff = now - SOCIAL_TTL_MS;
  const freshPosts = filter('posts', (p) => new Date(p.createdAt).getTime() >= cutoff);
  const purgedPostIds = new Set(
    filter('posts', (p) => new Date(p.createdAt).getTime() < cutoff).map((p) => p.id),
  );
  const purgedCommentIds = new Set();
  if (purgedPostIds.size > 0) {
    purged.posts = purgedPostIds.size;
    writeAll('posts', freshPosts);

    const freshComments = filter('comments', (c) => {
      if (purgedPostIds.has(c.postId)) {
        purgedCommentIds.add(c.id);
        return false;
      }
      return true;
    });
    purged.comments = readAll('comments').length - freshComments.length;
    writeAll('comments', freshComments);

    purged.reactions = purgeFor('reactions', (r) => {
      if (r.targetType === 'post' && purgedPostIds.has(r.targetId)) return false;
      if (r.targetType === 'comment' && purgedCommentIds.has(r.targetId)) return false;
      return true;
    });
  }

  // --- 3. reset daily coin balances ---
  try {
    const { reset } = resetAllIfNewDay(new Date(now));
    events.coinsReset = reset;
  } catch (err) {
    console.error('[rotation] coin reset failed:', err.message);
  }

  // --- 4. drop expired Arena topics + their arguments ---
  try {
    const topics = readAll('arena_topics');
    const expiredTopicIds = new Set(
      topics.filter((t) => new Date(t.expiresAt).getTime() <= now).map((t) => t.id),
    );
    if (expiredTopicIds.size > 0) {
      const freshTopics = topics.filter((t) => !expiredTopicIds.has(t.id));
      writeAll('arena_topics', freshTopics);
      events.arenaTopicsDropped = expiredTopicIds.size;

      const arenaPosts = readAll('arena_posts');
      const freshArenaPosts = arenaPosts.filter((p) => !expiredTopicIds.has(p.topicId));
      events.arenaPostsDropped = arenaPosts.length - freshArenaPosts.length;
      writeAll('arena_posts', freshArenaPosts);
    }
  } catch (err) {
    console.error('[rotation] arena expiry failed:', err.message);
  }

  return { rotated, purged, events };
}

function purgeFor(collection, keepPredicate) {
  const before = readAll(collection).length;
  const after = filter(collection, keepPredicate);
  writeAll(collection, after);
  return before - after.length;
}

module.exports = { runRotationTick };