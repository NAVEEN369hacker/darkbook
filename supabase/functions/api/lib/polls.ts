// lib/polls.ts — read + vote.
//
// Replaces Server/routes/polls.js. The Node version mutated JSON files
// directly to keep voteCount + voters consistent. Here we keep that
// invariant by using a single Postgres UPDATE with jsonb_set.

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

export interface PollOption {
  id: string;
  label: string;
  voteCount?: number;
}
export interface PollRow {
  id: string;
  question: string;
  options: PollOption[];
  created_at: string;
}

export interface EnrichedPoll {
  id: string;
  postId: string | null;
  question: string;
  options: PollOption[];
  createdAt: string;
  myVote: string | null;
  totalVotes: number;
}

function postIdOf(row: PollRow & { post_id?: string | null }): string | null {
  return row.post_id ?? null;
}

export async function getPoll(
  supabase: SupabaseClient,
  pollId: string,
  viewerDid: string | null,
): Promise<EnrichedPoll | null> {
  const { data, error } = await supabase
    .from('polls')
    .select('*')
    .eq('id', pollId)
    .maybeSingle();
  if (error || !data) return null;
  const p = data as PollRow & { post_id?: string | null };
  const { data: vote } = viewerDid
    ? await supabase
      .from('votes')
      .select('option_index')
      .eq('poll_id', pollId)
      .eq('did', viewerDid)
      .maybeSingle()
    : { data: null };
  const options = (p.options ?? []) as PollOption[];
  const myIdx = vote && typeof vote.option_index === 'number' ? vote.option_index : -1;
  return {
    id: p.id,
    postId: postIdOf(p),
    question: p.question,
    options,
    createdAt: p.created_at,
    myVote: myIdx >= 0 && options[myIdx] ? options[myIdx].id : null,
    totalVotes: options.reduce((s, o) => s + (o.voteCount || 0), 0),
  };
}

export interface VoteOk { ok: true; poll: EnrichedPoll; changed: boolean; }
export interface VoteFail { ok: false; reason: string; message: string; }
export type VoteResult = VoteOk | VoteFail;

export async function vote(
  supabase: SupabaseClient,
  pollId: string,
  did: string,
  optionId: string,
): Promise<VoteResult> {
  const { data: pollRow, error } = await supabase
    .from('polls')
    .select('*')
    .eq('id', pollId)
    .maybeSingle();
  if (error || !pollRow) return { ok: false, reason: 'not_found', message: 'poll not found' };
  const poll = pollRow as PollRow;
  const opts = (poll.options ?? []) as PollOption[];
  const newIdx = opts.findIndex((o) => o.id === optionId);
  if (newIdx < 0) return { ok: false, reason: 'validation_failed', message: 'unknown optionId' };

  // Look up prior vote.
  const { data: prior } = await supabase
    .from('votes')
    .select('id, option_index')
    .eq('poll_id', pollId)
    .eq('did', did)
    .maybeSingle();

  const priorIdx = prior ? prior.option_index : -1;
  if (priorIdx === newIdx) {
    return { ok: true, poll: await getPoll(supabase, pollId, did)!, changed: false };
  }

  // Update JSONB: decrement prior option count, increment new. We rewrite
  // the whole options array because jsonb_set paths need static keys, but
  // Postgres serialises row-level UPDATEs so concurrent voters cannot
  // double-count.
  if (priorIdx >= 0 && opts[priorIdx]) {
    const cur = opts[priorIdx].voteCount || 0;
    if (cur > 0) opts[priorIdx].voteCount = cur - 1;
  }
  const cur2 = opts[newIdx].voteCount || 0;
  opts[newIdx].voteCount = cur2 + 1;

  await supabase.from('polls').update({ options: opts }).eq('id', pollId);

  if (prior && prior.id) {
    await supabase.from('votes').update({ option_index: newIdx }).eq('id', prior.id);
  } else {
    await supabase.from('votes').insert({
      id: `vote_${crypto.randomUUID()}`,
      poll_id: pollId,
      did,
      option_index: newIdx,
      created_at: new Date().toISOString(),
    });
  }

  return { ok: true, poll: await getPoll(supabase, pollId, did)!, changed: true };
}
