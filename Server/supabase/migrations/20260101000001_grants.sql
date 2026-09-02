-- 20260101000001_grants.sql
-- Grant service_role full DML on every Ghostline table. The migration that
-- created the tables was run by `postgres` (the dashboard role), so the
-- tables are owned by `postgres` and `service_role` has no implicit rights.
-- service_role has BYPASSRLS, but DML still requires explicit GRANTs.
--
-- Idempotent — safe to re-run.

GRANT USAGE ON SCHEMA public TO service_role, anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO service_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO service_role;

-- Make sure future tables get the same grants automatically.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO service_role;
