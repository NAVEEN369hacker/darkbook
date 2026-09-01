// lib/feed.ts — feed query, post creation, comments, reactions.
//
// Mirrors Server/routes/posts.js. The Node version enriched posts by
// reading other collections; here we do the same but with SQL joins
// + small post-query result rows.

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { generateId } from './identity.ts';
import { createNotification } from './notifications.ts';
import { spendCoins } from './coins.ts';

const FEED_WINDOW_MS = 25 * 60 * 60 * 1000;
const FEED_DEFAULT_LIMIT = 50;
const FEED_MAX_LIMIT = 100;
const MAX_TEXT = 500;

export interface PostRow {
  id: string;
  room_id: string;
  author_uid: string | null;
  author_did: string | null;
  author_handle: string | null;
  author_display_name: string | null;
  author_color_hex: string | null;
  content: string;
  photo_url: string | null;
  created_at: string;
  is_pinned: boolean | null;
  pinned_at: string | null;
  poll_id: string | null;
}

interface ReactionRow {
  id: string;
  target_type: 'post' | 'comment';
  target_id: string;
  author_uid: string;
  emoji: string;
  created_at: string;
}

export interface EnrichedPost {
  id: string;
  roomId: string;
  text: string;
  createdAt: string;
  likeCount: number;
  shakeCount: number;
  commentCount: number;
  myReaction: 'like' | 'shake' | null;
  author: { uid: string | null; handle: string | null; displayName: string; colorHex: string };
  photoUrl: string | null;
  isAdminPost: boolean;
  pinnedAt: string | null;
  pollId: string | null;
}

export interface EnrichedComment {
  id: string;
  text: string;
  createdAt: string;
  likeCount: number;
  shakeCount: number;
  myReaction: 'like' | 'shake' | null;
  author: { uid: string | null; handle: string | null; displayName: string; colorHex: string };
}

async function reactionsForPost(
  supabase: SupabaseClient,
  postId: string,
): Promise<ReactionRow[]> {
  const { data, error } = await supabase
    .from('reactions')
    .select('*')
    .eq('target_type', 'post')
    .eq('target_id', postId);
  if (error) {
    console.warn('[feed.reactionsForPost]', error.message);
    return [];
  }
  return (data ?? []) as ReactionRow[];
}

async function reactionsForComment(
  supabase: SupabaseClient,
  commentId: string,
): Promise<ReactionRow[]> {
  const { data, error } = await supabase
    .from('reactions')
    .select('*')
    .eq('target_type', 'comment')
    .eq('target_id', commentId);
  if (error) return [];
  return (data ?? []) as ReactionRow[];
}

function tally(rows: ReactionRow[], viewerUid: string | null) {
  let likeCount = 0;
  let shakeCount = 0;
  let myReaction: 'like' | 'shake' | null = null;
  for (const r of rows) {
    if (r.emoji === 'like') likeCount++;
    else if (r.emoji === 'shake') shakeCount++;
    if (viewerUid && r.author_uid === viewerUid) myReaction = r.emoji as 'like' | 'shake';
  }
  return { likeCount, shakeCount, myReaction };
}

async function commentCount(supabase: SupabaseClient, postId: string): Promise<number> {
  const { count, error } = await supabase
    .from('comments')
    .select('*', { count: 'exact', head: true })
    .eq('post_id', postId);
  if (error) return 0;
  return count ?? 0;
}

export async function enrichPost(
  supabase: SupabaseClient,
  post: PostRow,
  viewerDid: string | null,
  viewerUid: string | null,
): Promise<EnrichedPost> {
  const reactions = await reactionsForPost(supabase, post.id);
  let likeCount = 0;
  let shakeCount = 0;
  let myReaction: 'like' | 'shake' | null = null;
  for (const r of reactions) {
    if (r.emoji === 'like') likeCount++;
    else if (r.emoji === 'shake') shakeCount++;
    if (viewerUid && r.author_uid === viewerUid) myReaction = r.emoji as 'like' | 'shake';
  }
  const ccount = await commentCount(supabase, post.id);
  return {
    id: post.id,
    roomId: post.room_id,
    text: post.content,
    createdAt: post.created_at,
    likeCount,
    shakeCount,
    commentCount: ccount,
    myReaction,
    author: {
      uid: post.author_uid,
      handle: post.author_handle,
      displayName: post.author_display_name || 'Unknown',
      colorHex: post.author_color_hex || '#888',
    },
    photoUrl: post.photo_url,
    isAdminPost: !!post.is_pinned,
    pinnedAt: post.pinned_at,
    pollId: post.poll_id,
  };
}

export async function listFeed(
  supabase: SupabaseClient,
  roomId: string,
  limit: number,
  viewerDid: string | null,
  viewerUid: string | null,
): Promise<EnrichedPost[]> {
  const cutoff = new Date(Date.now() - FEED_WINDOW_MS).toISOString();
  const { data, error } = await supabase
    .from('posts')
    .select('*')
    .eq('room_id', roomId)
    .gte('created_at', cutoff)
    .order('pinned_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) {
    console.error('[feed.listFeed]', error.message);
    return [];
  }
  const enriched: EnrichedPost[] = [];
  for (const r of (data ?? []) as PostRow[]) {
    enriched.push(await enrichPost(supabase, r, viewerDid, viewerUid));
  }
  return enriched;
}

export interface CreatePostInput {
  did: string;
  uid: string;
  roomId: string;
  text: string;
  photoUrl: string | null;
  isAdminPost?: boolean;
  pinnedAt?: string | null;
  pollId?: string | null;
}

export interface CreatePostResult {
  ok: true;
  post: PostRow;
  balance: number;
} | {
  ok: false;
  reason: 'insufficient';
  needed?: number;
  have?: number;
} | {
  ok: false;
  reason: string;
  message?: string;
}

export async function createPost(
  supabase: SupabaseClient,
  input: CreatePostInput,
): Promise<CreatePostResult> {
  if (input.roomId !== 'random') {
    return { ok: false, reason: 'validation_failed', message: 'unknown roomId' };
  }
  if (typeof input.text !== 'string' || !input.text.trim()) {
    return { ok: false, reason: 'validation_failed', message: 'text is required' };
  }
  if (input.text.length > MAX_TEXT) {
    return { ok: false, reason: 'validation_failed', message: `text must be ≤ ${MAX_TEXT} chars` };
  }

  if (!input.isAdminPost) {
    const spend = await spendCoins(supabase, input.did, 'post_feed');
    if (!spend.ok) {
      if (spend.reason === 'insufficient') {
        return { ok: false, reason: 'insufficient', needed: spend.needed, have: spend.have };
      }
      return { ok: false, reason: spend.reason };
    }
    return await insertPost(supabase, input, spend.row.balance);
  }
  // Admin posts skip the coin spend.
  return await insertPost(supabase, input, -1);
}

async function insertPost(
  supabase: SupabaseClient,
  input: CreatePostInput,
  balanceAfter: number,
): Promise<{ ok: true; post: PostRow; balance: number }> {
  // Pull author display info from the daily_identities row.
  const { data: ident } = await supabase
    .from('daily_identities')
    .select('handle, display_name, color_hex')
    .eq('uid', input.uid)
    .maybeSingle();
  const id = generateId('post');
  const row: PostRow = {
    id,
    room_id: input.roomId,
    author_uid: input.uid,
    author_did: input.did,
    author_handle: ident?.handle ?? null,
    author_display_name: ident?.display_name ?? null,
    author_color_hex: ident?.color_hex ?? null,
    content: input.text.trim(),
    photo_url: input.photoUrl,
    created_at: new Date().toISOString(),
    is_pinned: !!input.pinnedAt,
    pinned_at: input.pinnedAt ?? null,
    poll_id: input.pollId ?? null,
  };
  const { data: inserted, error } = await supabase
    .from('posts')
    .insert(row)
    .select('*')
    .single();
  if (error) {
    console.error('[feed.insertPost]', error.message);
    return { ok: true, post: row, balance: balanceAfter };
  }
  return { ok: true, post: (inserted ?? row) as PostRow, balance: balanceAfter };
}

export interface ReactionResult {
  likeCount: number;
  shakeCount: number;
  myReaction: 'like' | 'shake' | null;
}

export async function reactToPost(
  supabase: SupabaseClient,
  did: string,
  uid: string,
  postId: string,
  type: 'like' | 'shake' | null,
): Promise<ReactionResult | null> {
  if (type !== null && type !== 'like' && type !== 'shake') {
    throw new Error('type must be like, shake, or null');
  }
  const { data: post } = await supabase
    .from('posts')
    .select('id, author_uid, content')
    .eq('id', postId)
    .maybeSingle();
  if (!post) return null;

  // Find existing reaction by this uid on this post.
  const { data: existing } = await supabase
    .from('reactions')
    .select('id, emoji')
    .eq('target_type', 'post')
    .eq('target_id', postId)
    .eq('author_uid', uid)
    .maybeSingle();

  const wasNew = !existing && type !== null;
  if (type === null) {
    if (existing) await supabase.from('reactions').delete().eq('id', existing.id);
  } else if (existing) {
    if (existing.emoji !== type) {
      await supabase.from('reactions').update({ emoji: type }).eq('id', existing.id);
    }
  } else {
    await supabase.from('reactions').insert({
      id: generateId('react'),
      target_type: 'post',
      target_id: postId,
      author_uid: uid,
      emoji: type,
      created_at: new Date().toISOString(),
    });
  }

  // Notify post author (but not self, not on remove).
  if (wasNew && post.author_uid && post.author_uid !== uid) {
    const { data: actor } = await supabase
      .from('daily_identities')
      .select('display_name, color_hex')
      .eq('uid', uid)
      .maybeSingle();
    await createNotification(supabase, {
      recipientUid: post.author_uid,
      type: type === 'shake' ? 'shake' : 'like',
      actorUid: uid,
      actorName: actor?.display_name ?? 'Someone',
      actorColor: actor?.color_hex ?? '#888',
      text: type === 'shake' ? 'shook your post.' : 'liked your post.',
    });
  }

  return await tallyPostReactions(supabase, postId, uid);
}

export async function reactToComment(
  supabase: SupabaseClient,
  did: string,
  uid: string,
  commentId: string,
  type: 'like' | 'shake' | null,
): Promise<ReactionResult | null> {
  if (type !== null && type !== 'like' && type !== 'shake') {
    throw new Error('type must be like, shake, or null');
  }
  const { data: comment } = await supabase
    .from('comments')
    .select('id, author_uid')
    .eq('id', commentId)
    .maybeSingle();
  if (!comment) return null;

  const { data: existing } = await supabase
    .from('reactions')
    .select('id, emoji')
    .eq('target_type', 'comment')
    .eq('target_id', commentId)
    .eq('author_uid', uid)
    .maybeSingle();

  const wasNew = !existing && type !== null;
  if (type === null) {
    if (existing) await supabase.from('reactions').delete().eq('id', existing.id);
  } else if (existing) {
    if (existing.emoji !== type) {
      await supabase.from('reactions').update({ emoji: type }).eq('id', existing.id);
    }
  } else {
    await supabase.from('reactions').insert({
      id: generateId('react'),
      target_type: 'comment',
      target_id: commentId,
      author_uid: uid,
      emoji: type,
      created_at: new Date().toISOString(),
    });
  }

  if (wasNew && comment.author_uid && comment.author_uid !== uid) {
    const { data: actor } = await supabase
      .from('daily_identities')
      .select('display_name, color_hex')
      .eq('uid', uid)
      .maybeSingle();
    await createNotification(supabase, {
      recipientUid: comment.author_uid,
      type: type === 'shake' ? 'shake' : 'like',
      actorUid: uid,
      actorName: actor?.display_name ?? 'Someone',
      actorColor: actor?.color_hex ?? '#888',
      text: type === 'shake' ? 'shook your comment.' : 'liked your comment.',
    });
  }

  return await tallyCommentReactions(supabase, commentId, uid);
}

async function tallyPostReactions(
  supabase: SupabaseClient,
  postId: string,
  viewerUid: string | null,
): Promise<ReactionResult> {
  const rows = await reactionsForPost(supabase, postId);
  let likeCount = 0;
  let shakeCount = 0;
  let myReaction: 'like' | 'shake' | null = null;
  for (const r of rows) {
    if (r.emoji === 'like') likeCount++;
    else if (r.emoji === 'shake') shakeCount++;
    if (viewerUid && r.author_uid === viewerUid) myReaction = r.emoji as 'like' | 'shake';
  }
  return { likeCount, shakeCount, myReaction };
}

async function tallyCommentReactions(
  supabase: SupabaseClient,
  commentId: string,
  viewerUid: string | null,
): Promise<ReactionResult> {
  const rows = await reactionsForComment(supabase, commentId);
  let likeCount = 0;
  let shakeCount = 0;
  let myReaction: 'like' | 'shake' | null = null;
  for (const r of rows) {
    if (r.emoji === 'like') likeCount++;
    else if (r.emoji === 'shake') shakeCount++;
    if (viewerUid && r.author_uid === viewerUid) myReaction = r.emoji as 'like' | 'shake';
  }
  return { likeCount, shakeCount, myReaction };
}

export async function listComments(
  supabase: SupabaseClient,
  postId: string,
  viewerUid: string | null,
): Promise<EnrichedComment[]> {
  const { data, error } = await supabase
    .from('comments')
    .select('*')
    .eq('post_id', postId)
    .order('created_at', { ascending: true });
  if (error) {
    console.error('[feed.listComments]', error.message);
    return [];
  }
  const out: EnrichedComment[] = [];
  for (const c of (data ?? []) as Array<{
    id: string;
    content: string;
    created_at: string;
    author_uid: string | null;
    author_handle: string | null;
    author_display_name: string | null;
    author_color_hex: string | null;
  }>) {
    const t = await tallyCommentReactions(supabase, c.id, viewerUid);
    out.push({
      id: c.id,
      text: c.content,
      createdAt: c.created_at,
      likeCount: t.likeCount,
      shakeCount: t.shakeCount,
      myReaction: t.myReaction,
      author: {
        uid: c.author_uid,
        handle: c.author_handle,
        displayName: c.author_display_name || 'Unknown',
        colorHex: c.author_color_hex || '#888',
      },
    });
  }
  return out;
}

export interface CreateCommentResult {
  ok: true;
  comment: EnrichedComment;
} | { ok: false; reason: string; message?: string }

export async function createComment(
  supabase: SupabaseClient,
  postId: string,
  did: string,
  uid: string,
  text: string,
): Promise<CreateCommentResult> {
  const { data: post } = await supabase
    .from('posts')
    .select('id, author_uid')
    .eq('id', postId)
    .maybeSingle();
  if (!post) return { ok: false, reason: 'not_found', message: 'post not found' };
  if (typeof text !== 'string' || !text.trim()) {
    return { ok: false, reason: 'validation_failed', message: 'text is required' };
  }
  if (text.length > MAX_TEXT) {
    return { ok: false, reason: 'validation_failed', message: `text must be ≤ ${MAX_TEXT} chars` };
  }
  const { data: ident } = await supabase
    .from('daily_identities')
    .select('handle, display_name, color_hex')
    .eq('uid', uid)
    .maybeSingle();
  const id = generateId('cmt');
  const row = {
    id,
    post_id: postId,
    author_uid: uid,
    author_did: did,
    author_handle: ident?.handle ?? null,
    author_display_name: ident?.display_name ?? null,
    author_color_hex: ident?.color_hex ?? null,
    content: text.trim(),
    created_at: new Date().toISOString(),
  };
  const { error } = await supabase.from('comments').insert(row);
  if (error) {
    console.error('[feed.createComment]', error.message);
    return { ok: false, reason: 'server_error', message: error.message };
  }
  if (post.author_uid && post.author_uid !== uid) {
    await createNotification(supabase, {
      recipientUid: post.author_uid,
      type: 'comment',
      actorUid: uid,
      actorName: ident?.display_name ?? 'Someone',
      actorColor: ident?.color_hex ?? '#888',
      text: `commented: "${text.trim().slice(0, 60)}${text.trim().length > 60 ? '…' : ''}"`,
    });
  }
  return {
    ok: true,
    comment: {
      id,
      text: text.trim(),
      createdAt: row.created_at,
      likeCount: 0,
      shakeCount: 0,
      myReaction: null,
      author: {
        uid,
        handle: ident?.handle ?? null,
        displayName: ident?.display_name ?? 'Unknown',
        colorHex: ident?.color_hex ?? '#888',
      },
    },
  };
}
