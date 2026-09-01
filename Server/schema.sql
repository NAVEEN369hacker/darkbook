-- ==========================================
-- Ghostline Database Schema for Supabase / PostgreSQL
-- ==========================================
-- This file mirrors the production schema AFTER applying
-- supabase/migrations/20260101000000_ghostline_edge_backend.sql .
-- Fresh installs should match this state.

-- 1. Devices (Long-lived hardware / account identities)
CREATE TABLE IF NOT EXISTS devices (
    did TEXT PRIMARY KEY,
    password_hash TEXT NOT NULL,
    is_admin BOOLEAN DEFAULT FALSE,
    ip TEXT,
    user_agent TEXT,
    fingerprint TEXT,
    platform TEXT,
    screen TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    last_active_at TIMESTAMPTZ DEFAULT NOW(),
    created_by_admin_did TEXT
);

-- 2. Daily Identities (24-hour rotating UIDs)
CREATE TABLE IF NOT EXISTS daily_identities (
    uid TEXT PRIMARY KEY,
    did TEXT REFERENCES devices(did) ON DELETE CASCADE,
    handle TEXT NOT NULL,
    display_name TEXT,
    color_hex TEXT,
    status TEXT DEFAULT 'active', -- 'active' or 'rotated'
    issued_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ,
    rotated_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_daily_identities_did_expires ON daily_identities(did, expires_at);
CREATE INDEX IF NOT EXISTS idx_daily_identities_status_handle ON daily_identities(status, handle);

-- 3. Social Relationships (Follows / Followers)
CREATE TABLE IF NOT EXISTS follows (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    follower_did TEXT NOT NULL REFERENCES devices(did) ON DELETE CASCADE,
    following_did TEXT NOT NULL REFERENCES devices(did) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT unique_follower_following UNIQUE(follower_did, following_did)
);

CREATE INDEX IF NOT EXISTS idx_follows_follower ON follows(follower_did);
CREATE INDEX IF NOT EXISTS idx_follows_following ON follows(following_did);

-- 3. Tokens (Session tokens)
CREATE TABLE IF NOT EXISTS tokens (
    token TEXT PRIMARY KEY,
    did TEXT REFERENCES devices(did) ON DELETE CASCADE,
    uid TEXT REFERENCES daily_identities(uid) ON DELETE SET NULL,
    issued_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. Posts
CREATE TABLE IF NOT EXISTS posts (
    id TEXT PRIMARY KEY,
    room_id TEXT NOT NULL,
    author_uid TEXT,
    author_did TEXT,
    author_handle TEXT,
    author_display_name TEXT,
    author_color_hex TEXT,
    content TEXT NOT NULL,
    photo_url TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    is_pinned BOOLEAN DEFAULT FALSE,
    pinned_at TIMESTAMPTZ,
    poll_id TEXT
);

CREATE INDEX IF NOT EXISTS idx_posts_room_created ON posts(room_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_author_uid ON posts(author_uid);
CREATE INDEX IF NOT EXISTS idx_posts_author_did ON posts(author_did);

-- 5. Comments
CREATE TABLE IF NOT EXISTS comments (
    id TEXT PRIMARY KEY,
    post_id TEXT REFERENCES posts(id) ON DELETE CASCADE,
    author_uid TEXT,
    author_did TEXT,
    author_handle TEXT,
    author_display_name TEXT,
    author_color_hex TEXT,
    content TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_comments_post_created ON comments(post_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_comments_author_did ON comments(author_did);

-- 6. Reactions (Likes/Emojis)
CREATE TABLE IF NOT EXISTS reactions (
    id TEXT PRIMARY KEY,
    target_type TEXT NOT NULL, -- 'post' or 'comment'
    target_id TEXT NOT NULL,
    author_uid TEXT NOT NULL,
    emoji TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reactions_target ON reactions(target_type, target_id);

-- 7. Direct Messages (DMs)
CREATE TABLE IF NOT EXISTS dms (
    id TEXT PRIMARY KEY,
    sender_uid TEXT NOT NULL,
    recipient_uid TEXT NOT NULL,
    sender_handle TEXT,
    recipient_handle TEXT,
    content TEXT NOT NULL,
    photo_url TEXT,
    is_read BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dms_conversation ON dms(sender_uid, recipient_uid, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_dms_handles ON dms(sender_handle, recipient_handle);
CREATE INDEX IF NOT EXISTS idx_dms_sender_uid ON dms(sender_uid);
CREATE INDEX IF NOT EXISTS idx_dms_recipient_uid ON dms(recipient_uid);

-- 8. Notifications
CREATE TABLE IF NOT EXISTS notifications (
    id TEXT PRIMARY KEY,
    recipient_uid TEXT NOT NULL,
    type TEXT NOT NULL, -- 'dm', 'comment', 'reaction', 'follow'
    title TEXT,
    body TEXT,
    link TEXT,
    is_read BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notifications_recipient ON notifications(recipient_uid, created_at DESC);

-- 9. Coins (Gamification & Economy)
CREATE TABLE IF NOT EXISTS coins (
    did TEXT PRIMARY KEY REFERENCES devices(did) ON DELETE CASCADE,
    balance INTEGER DEFAULT 0,
    ads_watched_today INTEGER DEFAULT 0,
    last_reset_at TIMESTAMPTZ DEFAULT NOW(),
    spent_today JSONB DEFAULT '{}'::jsonb,
    history JSONB DEFAULT '[]'::jsonb
);

-- 10. Arena Topics
CREATE TABLE IF NOT EXISTS arena_topics (
    id TEXT PRIMARY KEY,
    topic TEXT NOT NULL,
    description TEXT,
    category TEXT,
    side_a TEXT NOT NULL,
    side_b TEXT NOT NULL,
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 11. Arena Posts
CREATE TABLE IF NOT EXISTS arena_posts (
    id TEXT PRIMARY KEY,
    topic_id TEXT REFERENCES arena_topics(id) ON DELETE CASCADE,
    side TEXT NOT NULL, -- 'A' or 'B'
    author_uid TEXT,
    author_did TEXT,
    author_handle TEXT,
    author_display_name TEXT,
    author_color_hex TEXT,
    content TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_arena_posts_topic ON arena_posts(topic_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_arena_posts_author_did ON arena_posts(author_did);

-- 12. Polls
CREATE TABLE IF NOT EXISTS polls (
    id TEXT PRIMARY KEY,
    question TEXT NOT NULL,
    options JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 13. Votes
CREATE TABLE IF NOT EXISTS votes (
    id TEXT PRIMARY KEY,
    poll_id TEXT REFERENCES polls(id) ON DELETE CASCADE,
    did TEXT NOT NULL,
    option_index INTEGER NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT unique_vote_per_did UNIQUE(poll_id, did)
);
