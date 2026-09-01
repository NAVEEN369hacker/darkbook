/**
 * Migration script to transfer local JSON database records (Server/data/*.json)
 * into Supabase PostgreSQL tables.
 *
 * Usage:
 *   node Server/scripts/migrate-to-supabase.js
 */

const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { supabase } = require('../lib/db');

if (!supabase) {
  console.error('[migration] Error: SUPABASE_URL and SUPABASE_KEY must be set in Server/.env');
  process.exit(1);
}

const DATA_DIR = path.join(__dirname, '..', 'data');

function readJson(filename) {
  const filePath = path.join(DATA_DIR, filename);
  if (!fs.existsSync(filePath)) return [];
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return raw.trim() ? JSON.parse(raw) : [];
  } catch (err) {
    console.error(`[migration] Failed to read ${filename}:`, err.message);
    return [];
  }
}

async function migrate() {
  console.log('🚀 Starting Ghostline migration to Supabase PostgreSQL...\n');

  // 1. Devices
  const devices = readJson('devices.json');
  if (devices.length > 0) {
    const rows = devices.map(d => ({
      did: d.did,
      password_hash: d.passwordHash || '',
      is_admin: d.isAdmin || false,
      ip: d.ip || null,
      user_agent: d.userAgent || null,
      fingerprint: d.fingerprint || null,
      platform: d.platform || null,
      screen: d.screen || null,
      created_at: d.createdAt || new Date().toISOString(),
      last_active_at: d.lastActiveAt || new Date().toISOString(),
      created_by_admin_did: d.createdByAdminDid || null
    }));
    const { error } = await supabase.from('devices').upsert(rows, { onConflict: 'did' });
    if (error) console.error('❌ Error migrating devices:', error.message);
    else console.log(`✅ Migrated ${rows.length} devices.`);
  }

  // 2. Daily Identities
  const dailyIdentities = readJson('daily_identities.json');
  if (dailyIdentities.length > 0) {
    const rows = dailyIdentities.map(i => ({
      uid: i.uid,
      did: i.did,
      handle: i.handle,
      display_name: i.displayName || null,
      color_hex: i.colorHex || null,
      status: i.status || 'active',
      issued_at: i.issuedAt || new Date().toISOString(),
      expires_at: i.expiresAt || null,
      rotated_at: i.rotatedAt || null
    }));
    const { error } = await supabase.from('daily_identities').upsert(rows, { onConflict: 'uid' });
    if (error) console.error('❌ Error migrating daily_identities:', error.message);
    else console.log(`✅ Migrated ${rows.length} daily_identities.`);
  }

  // 3. Tokens
  const tokens = readJson('tokens.json');
  if (tokens.length > 0) {
    const rows = tokens.map(t => ({
      token: t.token,
      did: t.did,
      uid: t.uid || null,
      issued_at: t.issuedAt || new Date().toISOString()
    }));
    const { error } = await supabase.from('tokens').upsert(rows, { onConflict: 'token' });
    if (error) console.error('❌ Error migrating tokens:', error.message);
    else console.log(`✅ Migrated ${rows.length} tokens.`);
  }

  // 4. Polls
  const polls = readJson('polls.json');
  if (polls.length > 0) {
    const rows = polls.map(p => ({
      id: p.id,
      question: p.question,
      options: p.options || [],
      created_at: p.createdAt || new Date().toISOString()
    }));
    const { error } = await supabase.from('polls').upsert(rows, { onConflict: 'id' });
    if (error) console.error('❌ Error migrating polls:', error.message);
    else console.log(`✅ Migrated ${rows.length} polls.`);
  }

  // 5. Posts
  const posts = readJson('posts.json');
  if (posts.length > 0) {
    const rows = posts.map(p => ({
      id: p.id,
      room_id: p.roomId,
      author_uid: p.authorUid,
      author_handle: p.authorHandle || null,
      author_display_name: p.authorDisplayName || null,
      author_color_hex: p.authorColorHex || null,
      content: p.content,
      photo_url: p.photoUrl || null,
      created_at: p.createdAt || new Date().toISOString(),
      is_pinned: p.isPinned || false,
      pinned_at: p.pinnedAt || null,
      poll_id: p.pollId || null
    }));
    const { error } = await supabase.from('posts').upsert(rows, { onConflict: 'id' });
    if (error) console.error('❌ Error migrating posts:', error.message);
    else console.log(`✅ Migrated ${rows.length} posts.`);
  }

  // 6. Comments
  const comments = readJson('comments.json');
  if (comments.length > 0) {
    const rows = comments.map(c => ({
      id: c.id,
      post_id: c.postId,
      author_uid: c.authorUid,
      author_handle: c.authorHandle || null,
      author_display_name: c.authorDisplayName || null,
      author_color_hex: c.authorColorHex || null,
      content: c.content,
      created_at: c.createdAt || new Date().toISOString()
    }));
    const { error } = await supabase.from('comments').upsert(rows, { onConflict: 'id' });
    if (error) console.error('❌ Error migrating comments:', error.message);
    else console.log(`✅ Migrated ${rows.length} comments.`);
  }

  // 7. Reactions
  const reactions = readJson('reactions.json');
  if (reactions.length > 0) {
    const rows = reactions.map(r => ({
      id: r.id,
      target_type: r.targetType || 'post',
      target_id: r.targetId,
      author_uid: r.authorUid,
      emoji: r.emoji,
      created_at: r.createdAt || new Date().toISOString()
    }));
    const { error } = await supabase.from('reactions').upsert(rows, { onConflict: 'id' });
    if (error) console.error('❌ Error migrating reactions:', error.message);
    else console.log(`✅ Migrated ${rows.length} reactions.`);
  }

  // 8. DMs
  const dms = readJson('dms.json');
  if (dms.length > 0) {
    const rows = dms.map(m => ({
      id: m.id,
      sender_did: m.senderDid,
      recipient_did: m.recipientDid,
      sender_handle: m.senderHandle || null,
      recipient_handle: m.recipientHandle || null,
      content: m.content,
      photo_url: m.photoUrl || null,
      is_read: m.isRead || false,
      created_at: m.createdAt || new Date().toISOString()
    }));
    const { error } = await supabase.from('dms').upsert(rows, { onConflict: 'id' });
    if (error) console.error('❌ Error migrating dms:', error.message);
    else console.log(`✅ Migrated ${rows.length} DMs.`);
  }

  // 9. Notifications
  const notifications = readJson('notifications.json');
  if (notifications.length > 0) {
    const rows = notifications.map(n => ({
      id: n.id,
      recipient_did: n.recipientDid,
      type: n.type,
      title: n.title || null,
      body: n.body || null,
      link: n.link || null,
      is_read: n.isRead || false,
      created_at: n.createdAt || new Date().toISOString()
    }));
    const { error } = await supabase.from('notifications').upsert(rows, { onConflict: 'id' });
    if (error) console.error('❌ Error migrating notifications:', error.message);
    else console.log(`✅ Migrated ${rows.length} notifications.`);
  }

  // 10. Coins
  const coins = readJson('coins.json');
  if (coins.length > 0) {
    const rows = coins.map(c => ({
      did: c.did,
      balance: c.balance || 0,
      ads_watched_today: c.adsWatchedToday || 0,
      last_reset_at: c.lastResetAt || new Date().toISOString(),
      spent_today: c.spentToday || {},
      history: c.history || []
    }));
    const { error } = await supabase.from('coins').upsert(rows, { onConflict: 'did' });
    if (error) console.error('❌ Error migrating coins:', error.message);
    else console.log(`✅ Migrated ${rows.length} coins records.`);
  }

  // 11. Arena Topics
  const arenaTopics = readJson('arena_topics.json');
  if (arenaTopics.length > 0) {
    const rows = arenaTopics.map(t => ({
      id: t.id,
      topic: t.topic,
      description: t.description || null,
      category: t.category || null,
      side_a: t.sideA,
      side_b: t.sideB,
      expires_at: t.expiresAt || null,
      created_at: t.createdAt || new Date().toISOString()
    }));
    const { error } = await supabase.from('arena_topics').upsert(rows, { onConflict: 'id' });
    if (error) console.error('❌ Error migrating arena_topics:', error.message);
    else console.log(`✅ Migrated ${rows.length} arena_topics.`);
  }

  // 12. Arena Posts
  const arenaPosts = readJson('arena_posts.json');
  if (arenaPosts.length > 0) {
    const rows = arenaPosts.map(p => ({
      id: p.id,
      topic_id: p.topicId,
      side: p.side,
      author_uid: p.authorUid,
      author_handle: p.authorHandle || null,
      author_display_name: p.authorDisplayName || null,
      author_color_hex: p.authorColorHex || null,
      content: p.content,
      created_at: p.createdAt || new Date().toISOString()
    }));
    const { error } = await supabase.from('arena_posts').upsert(rows, { onConflict: 'id' });
    if (error) console.error('❌ Error migrating arena_posts:', error.message);
    else console.log(`✅ Migrated ${rows.length} arena_posts.`);
  }

  // 13. Votes
  const votes = readJson('votes.json');
  if (votes.length > 0) {
    const rows = votes.map(v => ({
      id: v.id,
      poll_id: v.pollId,
      did: v.did,
      option_index: v.optionIndex,
      created_at: v.createdAt || new Date().toISOString()
    }));
    const { error } = await supabase.from('votes').upsert(rows, { onConflict: 'id' });
    if (error) console.error('❌ Error migrating votes:', error.message);
    else console.log(`✅ Migrated ${rows.length} votes.`);
  }

  console.log('\n🎉 Supabase migration finished successfully!');
}

migrate().catch(err => {
  console.error('[migration] Fatal error during migration:', err);
});
