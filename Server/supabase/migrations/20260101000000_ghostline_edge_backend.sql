-- ==========================================
-- Ghostline Edge Backend Migration
-- ==========================================
-- Align FK columns with what the JS code actually writes (uid strings),
-- add author_did to social collections, define atomic coin spend RPC,
-- the maintenance tick (replaces the setInterval in server.js),
-- and schedule it via pg_cron (every minute).
--
-- Narrow scope: no doc-03 tables (legal_holds, daily_identities_history,
-- audit_log, E2E DM shape, etc). Only what the current Node handlers need.

BEGIN;

-- ----------------------------------------------------------------------
-- 1. Column renames
--    notifications.recipient_did  -> recipient_uid
--    dms.sender_did               -> sender_uid
--    dms.recipient_did            -> recipient_uid
-- ----------------------------------------------------------------------
ALTER TABLE public.notifications RENAME COLUMN recipient_did TO recipient_uid;
ALTER TABLE public.dms          RENAME COLUMN sender_did    TO sender_uid;
ALTER TABLE public.dms          RENAME COLUMN recipient_did TO recipient_uid;

-- ----------------------------------------------------------------------
-- 2. author_did columns (the JS code writes both uid AND did to these
--    collections; schema only had author_uid / uid).
-- ----------------------------------------------------------------------
ALTER TABLE public.posts       ADD COLUMN IF NOT EXISTS author_did TEXT;
ALTER TABLE public.comments    ADD COLUMN IF NOT EXISTS author_did TEXT;
ALTER TABLE public.arena_posts ADD COLUMN IF NOT EXISTS author_did TEXT;

-- ----------------------------------------------------------------------
-- 3. Indexes
-- ----------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_posts_author_did        ON public.posts (author_did);
CREATE INDEX IF NOT EXISTS idx_comments_author_did     ON public.comments (author_did);
CREATE INDEX IF NOT EXISTS idx_arena_posts_author_did  ON public.arena_posts (author_did);
CREATE INDEX IF NOT EXISTS idx_dms_sender_uid          ON public.dms (sender_uid);
CREATE INDEX IF NOT EXISTS idx_dms_recipient_uid       ON public.dms (recipient_uid);
CREATE INDEX IF NOT EXISTS idx_notifications_recipient_uid
  ON public.notifications (recipient_uid, created_at DESC);

-- ----------------------------------------------------------------------
-- 4. Atomic coin spend RPC
--    Called from the Edge Function lib/coins.ts.
--    Mirrors the contract from Server/lib/coins.js:spendCoins:
--      success -> {ok:true,  row, charged}
--      failure -> {ok:false, reason, needed?, have?}
-- ----------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.spend_coins_atomic(p_did TEXT, p_reason TEXT)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_cost INT;
  v_row  public.coins%ROWTYPE;
BEGIN
  v_cost := CASE p_reason
    WHEN 'open_feed'  THEN 1
    WHEN 'post_feed'  THEN 10
    WHEN 'post_arena' THEN 10
    ELSE NULL
  END;
  IF v_cost IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'unknown_reason');
  END IF;

  -- Ensure row exists.
  INSERT INTO public.coins (did) VALUES (p_did) ON CONFLICT (did) DO NOTHING;
  SELECT * INTO v_row FROM public.coins WHERE did = p_did FOR UPDATE;

  -- Idempotency for OPEN_REASONS (mirrors lib/coins.js OPEN_REASONS set).
  IF p_reason = 'open_feed'
     AND v_row.spent_today ? 'open_feed'
     AND (v_row.spent_today->>'open_feed')::int > 0
  THEN
    RETURN jsonb_build_object('ok', true, 'charged', false, 'row', to_jsonb(v_row));
  END IF;

  IF v_row.balance < v_cost THEN
    RETURN jsonb_build_object(
      'ok', false, 'reason', 'insufficient',
      'needed', v_cost, 'have', v_row.balance
    );
  END IF;

  UPDATE public.coins
     SET balance     = balance - v_cost,
         spent_today = spent_today || jsonb_build_object(
                          p_reason,
                          COALESCE((spent_today->>p_reason)::int, 0) + 1
                        ),
         history     = (
           SELECT COALESCE(jsonb_agg(elem), '[]'::jsonb)
           FROM (
             SELECT elem
             FROM jsonb_array_elements(COALESCE(v_row.history, '[]'::jsonb)) elem
             ORDER BY (elem->>'at')
             DESC LIMIT 49
           ) recent
         ) || jsonb_build_array(jsonb_build_object(
             'at', to_jsonb(clock_timestamp()),
             'amount', (-v_cost)::int,
             'reason', to_jsonb(p_reason)
           ))
   WHERE did = p_did
   RETURNING * INTO v_row;

  RETURN jsonb_build_object('ok', true, 'charged', true, 'row', to_jsonb(v_row));
END;
$$;

-- ----------------------------------------------------------------------
-- 5. Maintenance tick — replaces Server/lib/rotation.js + setInterval
--    in Server/server.js. Combines:
--      (a) mark expired active UIDs as rotated
--      (b) purge posts >25h + dependent reactions/comments
--      (c) reset daily coin balances
--      (d) drop expired arena topics + their posts
-- ----------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.run_rotation_tick()
RETURNS TABLE (
  rotated                BIGINT,
  purged_posts           BIGINT,
  purged_reactions       BIGINT,
  purged_comments        BIGINT,
  coins_reset            BIGINT,
  arena_topics_dropped   BIGINT,
  arena_posts_dropped    BIGINT
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_now      TIMESTAMPTZ := clock_timestamp();
  v_cutoff   TIMESTAMPTZ := v_now - INTERVAL '25 hours';
  v_midnight TIMESTAMPTZ := date_trunc('day', v_now AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
BEGIN
  -- (a) mark expired active UIDs as rotated
  WITH expired AS (
    UPDATE public.daily_identities
       SET status = 'rotated', rotated_at = v_now
     WHERE status = 'active'
       AND expires_at IS NOT NULL
       AND expires_at <= v_now
     RETURNING uid
  )
  SELECT count(*) INTO rotated FROM expired;

  -- (b) purge posts >25h and their dependent reactions + comments.
  --     CTEs compute counts in the SAME statement so deletion
  --     never happens before we capture row counts.
  WITH dead_posts AS (
    SELECT id FROM public.posts WHERE created_at < v_cutoff
  ),
  dead_post_reactions AS (
    DELETE FROM public.reactions r
     USING dead_posts p
     WHERE r.target_type = 'post' AND r.target_id = p.id
     RETURNING r.id
  ),
  dead_comments AS (
    DELETE FROM public.comments c
     USING dead_posts p
     WHERE c.post_id = p.id
     RETURNING c.id
  ),
  dead_comment_reactions AS (
    DELETE FROM public.reactions r
     USING dead_comments c
     WHERE r.target_type = 'comment' AND r.target_id = c.id
     RETURNING r.id
  )
  SELECT
    (SELECT count(*) FROM dead_posts),
    (SELECT count(*) FROM dead_post_reactions)
      + (SELECT count(*) FROM dead_comment_reactions),
    (SELECT count(*) FROM dead_comments)
    INTO purged_posts, purged_reactions, purged_comments;

  -- Delete the dead posts last (the CTEs above already cleaned
  -- reactions + comments referencing them).
  DELETE FROM public.posts p
   USING (SELECT id FROM public.posts WHERE created_at < v_cutoff) expired
   WHERE p.id = expired.id;

  -- (c) reset daily coin balances (rows whose last_reset_at is before
  --     today's UTC midnight).
  UPDATE public.coins
     SET balance = 0,
         ads_watched_today = 0,
         spent_today = '{}'::jsonb,
         last_reset_at = v_now
   WHERE last_reset_at < v_midnight;
  GET DIAGNOSTICS coins_reset = ROW_COUNT;

  -- (d) drop expired arena topics and their dependent arena posts.
  WITH dead_topics AS (
    SELECT id FROM public.arena_topics
     WHERE expires_at IS NOT NULL AND expires_at <= v_now
  ),
  dead_arena_posts AS (
    DELETE FROM public.arena_posts p
     USING dead_topics t
     WHERE p.topic_id = t.id
     RETURNING p.id
  )
  SELECT
    (SELECT count(*) FROM dead_topics),
    (SELECT count(*) FROM dead_arena_posts)
    INTO arena_topics_dropped, arena_posts_dropped;

  DELETE FROM public.arena_topics t
   USING (
     SELECT id FROM public.arena_topics
      WHERE expires_at IS NOT NULL AND expires_at <= v_now
   ) expired
   WHERE t.id = expired.id;

  RETURN NEXT;
END;
$$;

-- ----------------------------------------------------------------------
-- 6. pg_cron — schedule the maintenance every minute.
--    This replaces the 60s setInterval in Server/server.js.
-- ----------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pg_cron;

SELECT cron.unschedule('ghostline-maintenance-1m')
  WHERE EXISTS (
    SELECT 1 FROM cron.job WHERE jobname = 'ghostline-maintenance-1m'
  );

SELECT cron.schedule(
  'ghostline-maintenance-1m',
  '* * * * *',
  $cmd$SELECT public.run_rotation_tick();$cmd$
);

COMMIT;
