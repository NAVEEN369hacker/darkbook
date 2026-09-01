/**
 * Poll — inline poll UI rendered below an admin-authored post.
 * Renders options with vote counts and lets the authed user vote.
 */

import { useState } from 'react';
import type { Poll as PollType } from '../types';
import { votePoll } from '../api';
import type { Session } from '../storage';

type Props = {
  poll: PollType;
  session: Session;
  onError: (msg: string) => void;
};

export default function Poll({ poll, session, onError }: Props) {
  const [busy, setBusy] = useState(false);
  const [current, setCurrent] = useState<PollType>(poll);

  const handleVote = async (optionId: string) => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await votePoll(session, poll.id, optionId);
      setCurrent(res.poll);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'vote failed');
    } finally {
      setBusy(false);
    }
  };

  const total = current.totalVotes || current.options.reduce((s, o) => s + (o.voteCount || 0), 0) || 1;
  const myVote = current.myVote ?? null;

  return (
    <div className="poll" id={`poll-${poll.id}`}>
      <h4 className="poll-question">{current.question}</h4>
      <div className="poll-options">
        {current.options.map((opt) => {
          const pct = total > 0 ? Math.round(((opt.voteCount || 0) / total) * 100) : 0;
          const mine = myVote === opt.id;
          return (
            <button
              key={opt.id}
              type="button"
              className={`poll-option ${mine ? 'mine' : ''}`}
              onClick={() => handleVote(opt.id)}
              disabled={busy}
              id={`poll-${poll.id}-option-${opt.id}`}
            >
              <div className="poll-option-row">
                <span className="poll-option-label">
                  {mine && <span className="poll-option-check">✓</span>}
                  {opt.label}
                </span>
                <span className="poll-option-pct">{pct}%</span>
              </div>
              <div className="poll-bar-track">
                <div className="poll-bar-fill" style={{ width: `${pct}%` }} />
              </div>
            </button>
          );
        })}
      </div>
      <p className="poll-footer muted">
        {total === 1 && current.options.every((o) => o.voteCount === 0) ? 'No votes yet' : `${total} vote${total === 1 ? '' : 's'}`}
        {myVote && ' · your vote is highlighted'}
      </p>
    </div>
  );
}