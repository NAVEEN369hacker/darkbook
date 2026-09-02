// lib/arena.ts — debate topics with multiple sides.
//
// The Node version (Server/routes/arena.js) stored parties + postsByParty
// inside arena_topics.json. Here we keep the parties[] as JSONB on the
// arena_topics row (caller passes it as part of the topic row at insert
// time) and track postsByParty via a JSONB column too. For the basic-level
// MVP we use a category column to hold the JSON shape; in production we'd
// add explicit JSONB columns. To stay narrow per user decision, we encode
// the multi-party metadata inside `category` as a JSON string. The shape
// is opaque to the rest of the schema.

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { generateId } from './identity.ts';
import { spendCoins } from './coins.ts';

const MAX_TEXT = 1000;

function nextMidnightUtcIso(): string {
  const now = new Date();
  return new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 1,
    0, 0, 0, 0,
  )).toISOString();
}

interface TopicMeta {
  parties: Array<{ id: string; label: string; emoji?: string; colorHex?: string }>;
  postsByParty: Record<string, number>;
}

function parseTopicCategory(raw: string | null): TopicMeta {
  if (!raw) return { parties: [], postsByParty: {} };
  try {
    const j = JSON.parse(raw);
    return {
      parties: Array.isArray(j.parties) ? j.parties : [],
      postsByParty: j.postsByParty && typeof j.postsByParty === 'object' ? j.postsByParty : {},
    };
  } catch {
    return { parties: [], postsByParty: {} };
  }
}

function serializeTopicCategory(meta: TopicMeta): string {
  return JSON.stringify(meta);
}

export async function listTopics(supabase: SupabaseClient): Promise<Array<Record<string, unknown>>> {
  const nowIso = new Date().toISOString();
  const { data, error } = await supabase
    .from('arena_topics')
    .select('*')
    .gt('expires_at', nowIso)
    .order('created_at', { ascending: false });
  if (error) {
    console.error('[arena.listTopics]', error.message);
    return [];
  }
  return ((data ?? []) as Array<Record<string, unknown>>).map((t) => {
    const meta = parseTopicCategory((t.category as string | null) ?? null);
    return {
      id: t.id,
      title: t.topic,
      description: t.description,
      parties: meta.parties,
      postsByParty: meta.postsByParty,
      createdByDid: null,
      createdAt: t.created_at,
      expiresAt: t.expires_at,
    };
  });
}

export type GetTopicResult = { topic: Record<string, unknown>; posts: Array<Record<string, unknown>> };

export async function getTopic(
  supabase: SupabaseClient,
  topicId: string,
): Promise<GetTopicResult | null> {
  const { data, error } = await supabase
    .from('arena_topics')
    .select('*')
    .eq('id', topicId)
    .maybeSingle();
  if (error || !data) return null;
  const t = data as Record<string, unknown>;
  const meta = parseTopicCategory((t.category as string | null) ?? null);

  const { data: postRows } = await supabase
    .from('arena_posts')
    .select('*')
    .eq('topic_id', topicId)
    .order('created_at', { ascending: true });
  const posts: Array<Record<string, unknown>> = [];
  for (const p of (postRows ?? []) as Array<Record<string, unknown>>) {
    const { data: author } = await supabase
      .from('daily_identities')
      .select('handle, display_name, color_hex')
      .eq('uid', p.author_uid as string)
      .maybeSingle();
    posts.push({
      id: p.id,
      topicId: p.topic_id,
      partyId: p.side,
      parentId: null,
      text: p.content,
      createdAt: p.created_at,
      author: {
        uid: p.author_uid,
        handle: author?.handle ?? null,
        displayName: author?.display_name ?? 'Unknown',
        colorHex: author?.color_hex ?? '#888',
      },
    });
  }
  return {
    topic: {
      id: t.id,
      title: t.topic,
      description: t.description,
      parties: meta.parties,
      postsByParty: meta.postsByParty,
      createdByDid: null,
      createdAt: t.created_at,
      expiresAt: t.expires_at,
    },
    posts,
  };
}

export interface CreateArgumentOk { ok: true; post: Record<string, unknown>; balance: number; }
export interface CreateArgumentFail { ok: false; reason: string; message: string; needed?: number; have?: number; }
export type CreateArgumentResult = CreateArgumentOk | CreateArgumentFail;

export async function createArgument(
  supabase: SupabaseClient,
  topicId: string,
  did: string,
  uid: string,
  partyId: string,
  text: string,
): Promise<CreateArgumentResult> {
  const { data: t, error } = await supabase
    .from('arena_topics')
    .select('*')
    .eq('id', topicId)
    .maybeSingle();
  if (error || !t) return { ok: false, reason: 'not_found', message: 'topic not found' };
  if (new Date(t.expires_at as string).getTime() <= Date.now()) {
    return { ok: false, reason: 'topic_expired', message: 'topic has expired' };
  }
  if (!partyId || typeof partyId !== 'string') {
    return { ok: false, reason: 'validation_failed', message: 'partyId required' };
  }
  const meta = parseTopicCategory((t.category as string | null) ?? null);
  if (!meta.parties.find((p) => p.id === partyId)) {
    return { ok: false, reason: 'validation_failed', message: 'unknown partyId' };
  }
  if (typeof text !== 'string' || !text.trim()) {
    return { ok: false, reason: 'validation_failed', message: 'text is required' };
  }
  if (text.length > MAX_TEXT) {
    return { ok: false, reason: 'validation_failed', message: `text must be ≤ ${MAX_TEXT} chars` };
  }

  const spend = await spendCoins(supabase, did, 'post_arena');
  if (!spend.ok) {
    if (spend.reason === 'insufficient') {
      return { ok: false, reason: 'insufficient', message: 'insufficient coins', needed: spend.needed, have: spend.have };
    }
    return { ok: false, reason: spend.reason, message: spend.reason };
  }

  const { data: ident } = await supabase
    .from('daily_identities')
    .select('handle, display_name, color_hex')
    .eq('uid', uid)
    .maybeSingle();

  const id = generateId('arena_post');
  const now = new Date().toISOString();
  const { error: insErr } = await supabase.from('arena_posts').insert({
    id,
    topic_id: topicId,
    side: partyId,
    author_uid: uid,
    author_did: did,
    author_handle: ident?.handle ?? null,
    author_display_name: ident?.display_name ?? null,
    author_color_hex: ident?.color_hex ?? null,
    content: text.trim(),
    created_at: now,
  });
  if (insErr) {
    console.error('[arena.createArgument.insert]', insErr.message);
    return { ok: false, reason: 'server_error', message: insErr.message };
  }

  // Bump postsByParty and write back to category JSON.
  meta.postsByParty[partyId] = (meta.postsByParty[partyId] ?? 0) + 1;
  await supabase
    .from('arena_topics')
    .update({ category: serializeTopicCategory(meta) })
    .eq('id', topicId);

  return {
    ok: true,
    post: {
      id,
      topicId,
      partyId,
      parentId: null,
      text: text.trim(),
      createdAt: now,
      author: {
        uid,
        handle: ident?.handle ?? null,
        displayName: ident?.display_name ?? 'Unknown',
        colorHex: ident?.color_hex ?? '#888',
      },
    },
    balance: spend.row.balance,
  };
}

const DEFAULT_PARTY_COLORS = ['#FFD60A', '#FF7B72', '#3FB950', '#A371F7', '#D29922', '#FB7185'];

export interface CreateTopicInput {
  title: string;
  description?: string;
  parties: Array<{ label: string; emoji?: string; colorHex?: string }>;
}

export interface CreateTopicOk { ok: true; topic: Record<string, unknown>; }
export interface CreateTopicFail { ok: false; reason: string; message: string; }
export type CreateTopicResult = CreateTopicOk | CreateTopicFail;

export async function createTopic(
  supabase: SupabaseClient,
  adminDid: string,
  input: CreateTopicInput,
): Promise<CreateTopicResult> {
  if (typeof input.title !== 'string' || !input.title.trim()) {
    return { ok: false, reason: 'validation_failed', message: 'title required' };
  }
  if (!Array.isArray(input.parties) || input.parties.length < 2 || input.parties.length > 6) {
    return { ok: false, reason: 'validation_failed', message: 'parties must be an array of 2-6 entries' };
  }
  const builtParties = input.parties
    .map((p, i) => ({
      id: `p${i + 1}`,
      label: typeof p.label === 'string' ? p.label.trim().slice(0, 80) : '',
      emoji: typeof p.emoji === 'string' && p.emoji.trim() ? p.emoji.trim().slice(0, 4) : '⚖️',
      colorHex: typeof p.colorHex === 'string' && p.colorHex.trim()
        ? p.colorHex.trim()
        : DEFAULT_PARTY_COLORS[i % DEFAULT_PARTY_COLORS.length],
    }))
    .filter((p) => p.label);
  if (builtParties.length < 2) {
    return { ok: false, reason: 'validation_failed', message: 'at least 2 parties with non-empty labels' };
  }

  const id = generateId('topic');
  const now = new Date().toISOString();
  const expiresAt = nextMidnightUtcIso();
  const meta: TopicMeta = {
    parties: builtParties,
    postsByParty: builtParties.reduce<Record<string, number>>((acc, p) => {
      acc[p.id] = 0;
      return acc;
    }, {}),
  };
  const { error } = await supabase.from('arena_topics').insert({
    id,
    topic: input.title.trim().slice(0, 200),
    description: typeof input.description === 'string' ? input.description.trim().slice(0, 1000) : '',
    side_a: builtParties[0].label,
    side_b: builtParties[1].label,
    expires_at: expiresAt,
    created_at: now,
    category: serializeTopicCategory(meta),
  });
  if (error) {
    console.error('[arena.createTopic]', error.message);
    return { ok: false, reason: 'server_error', message: error.message };
  }
  return {
    ok: true,
    topic: {
      id,
      title: input.title.trim().slice(0, 200),
      description: typeof input.description === 'string' ? input.description.trim().slice(0, 1000) : '',
      parties: builtParties,
      postsByParty: meta.postsByParty,
      createdByDid: adminDid,
      createdAt: now,
      expiresAt,
    },
  };
}
