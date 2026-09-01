/**
 * Profile routes — public profile lookup by handle + follow/unfollow functionality.
 *
 * Endpoints:
 *   GET    /api/users/:handle
 *   POST   /api/users/:handle/follow
 *   POST   /api/users/:handle/unfollow
 *   DELETE /api/users/:handle/follow
 */

const { filter, find, insert, update, readAll } = require('../lib/storage');
const tokens = require('./auth').tokens;
const { createNotification } = require('./notifications');

function authedSession(req) {
  const auth = req.headers.authorization || '';
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (!m) return null;
  return tokens.get(m[1]) || null;
}

function findActiveByHandle(handle) {
  const clean = (handle || '').replace(/^@/, '').trim().toLowerCase();
  if (!clean) return null;
  return find('daily_identities', (r) =>
    r.status === 'active' &&
    typeof r.handle === 'string' &&
    r.handle.toLowerCase() === clean,
  );
}

// ============================================================
// GET /api/users/:handle — public profile + stats + follow status
// ============================================================
function handleGetProfile(req, res) {
  const targetIdentity = findActiveByHandle(req.params.handle);
  if (!targetIdentity) {
    return res.status(404).json({ error: 'not_found', message: 'no active user with that handle' });
  }

  const uid = targetIdentity.uid;
  const targetDid = targetIdentity.did;
  const callerSession = authedSession(req);
  const callerDid = callerSession ? callerSession.did : null;

  // Posts authored by this uid in the social window (25h)
  const FEED_WINDOW_MS = 25 * 60 * 60 * 1000;
  const cutoff = Date.now() - FEED_WINDOW_MS;
  const allPosts = filter('posts', (p) => p.uid === uid && new Date(p.createdAt).getTime() >= cutoff);
  const posts = allPosts
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .map((p) => {
      const reactions = filter('reactions', (r) => r.targetType === 'post' && r.targetId === p.id);
      let likes = 0;
      let shakes = 0;
      for (const r of reactions) {
        if (r.type === 'like') likes++;
        else if (r.type === 'shake') shakes++;
      }
      const comments = filter('comments', (c) => c.postId === p.id);
      return {
        id: p.id,
        text: p.text,
        createdAt: p.createdAt,
        likeCount: likes,
        shakeCount: shakes,
        commentCount: comments.length,
      };
    });

  // Aggregates
  const lifetimeLikes = posts.reduce((s, p) => s + p.likeCount, 0);
  const lifetimeShakes = posts.reduce((s, p) => s + p.shakeCount, 0);
  const lifetimeComments = posts.reduce((s, p) => s + p.commentCount, 0);
  const myComments = filter('comments', (c) => c.uid === uid);

  const myDms = filter('dms', (m) => m.fromUid === uid || m.toUid === uid);
  const counterparties = new Set();
  for (const m of myDms) {
    counterparties.add(m.fromUid === uid ? m.toUid : m.fromUid);
  }

  // Follow statistics
  const followersList = filter('follows', (f) => f.followingDid === targetDid);
  const followingList = filter('follows', (f) => f.followerDid === targetDid);
  const isFollowing = callerDid ? followersList.some((f) => f.followerDid === callerDid) : false;

  res.json({
    profile: {
      uid,
      did: targetDid,
      handle: targetIdentity.handle,
      displayName: targetIdentity.displayName,
      colorHex: targetIdentity.colorHex,
      expiresAt: targetIdentity.expiresAt,
      followersCount: followersList.length,
      followingCount: followingList.length,
      isFollowing,
    },
    stats: {
      postCount: posts.length,
      lifetimeLikes,
      lifetimeShakes,
      lifetimeComments,
      commentCount: myComments.length,
      conversationCount: counterparties.size,
      followersCount: followersList.length,
      followingCount: followingList.length,
    },
    posts,
  });
}

// ============================================================
// POST /api/users/:handle/follow — follow target user
// ============================================================
function handleFollowUser(req, res) {
  const callerSession = authedSession(req);
  if (!callerSession || !callerSession.did) {
    return res.status(401).json({ error: 'unauthorized', message: 'login required' });
  }

  const targetIdentity = findActiveByHandle(req.params.handle);
  if (!targetIdentity) {
    return res.status(404).json({ error: 'not_found', message: 'user not found' });
  }

  if (targetIdentity.did === callerSession.did) {
    return res.status(400).json({ error: 'bad_request', message: 'cannot follow yourself' });
  }

  const existing = find(
    'follows',
    (f) => f.followerDid === callerSession.did && f.followingDid === targetIdentity.did,
  );

  if (!existing) {
    insert('follows', {
      id: `flw_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      followerDid: callerSession.did,
      followingDid: targetIdentity.did,
      createdAt: new Date().toISOString(),
    });

    // Send notification
    try {
      createNotification(targetIdentity.did, {
        type: 'follow',
        title: 'New Follower',
        body: `@${targetIdentity.handle} gained a new follower!`,
        link: `/users/${targetIdentity.handle}`,
      });
    } catch {
      // notification soft-fail ignore
    }
  }

  const followers = filter('follows', (f) => f.followingDid === targetIdentity.did);
  res.json({ ok: true, isFollowing: true, followersCount: followers.length });
}

// ============================================================
// DELETE or POST /api/users/:handle/unfollow — unfollow target user
// ============================================================
function handleUnfollowUser(req, res) {
  const callerSession = authedSession(req);
  if (!callerSession || !callerSession.did) {
    return res.status(401).json({ error: 'unauthorized', message: 'login required' });
  }

  const targetIdentity = findActiveByHandle(req.params.handle);
  if (!targetIdentity) {
    return res.status(404).json({ error: 'not_found', message: 'user not found' });
  }

  const allFollows = readAll('follows');
  const filtered = allFollows.filter(
    (f) => !(f.followerDid === callerSession.did && f.followingDid === targetIdentity.did),
  );
  
  const { writeAll } = require('../lib/storage');
  writeAll('follows', filtered);

  const remainingFollowers = filtered.filter((f) => f.followingDid === targetIdentity.did);
  res.json({ ok: true, isFollowing: false, followersCount: remainingFollowers.length });
}

module.exports = { handleGetProfile, handleFollowUser, handleUnfollowUser };