-- Consolidate duplicate camelCase/lowercase columns on public.users.
--
-- Background: the table has both "employeeId"/employeeid, "lastLogin"/lastlogin,
-- "activeSessions"/activesessions, "isActive"/isactive. The app's code writes
-- to the lowercase columns via toDatabaseUser(); the camelCase ones are legacy
-- from an earlier schema and hold stale data for some rows.
--
-- This migration:
--   1. Backfills lowercase text columns from camelCase when lowercase is NULL.
--   2. Drops the camelCase columns.
--
-- Run once in the Supabase SQL editor. It is idempotent: re-running is a no-op
-- because IF EXISTS guards the DROP and the UPDATE narrows to NULL rows only.

-- 1. Backfill text columns (only if lowercase is NULL — never overwrite good data).
UPDATE public.users
   SET employeeid = "employeeId"
 WHERE employeeid IS NULL
   AND "employeeId" IS NOT NULL;

UPDATE public.users
   SET lastlogin = "lastLogin"
 WHERE lastlogin IS NULL
   AND "lastLogin" IS NOT NULL;

-- activeSessions + isActive are NOT NULL with defaults (0, true), so the
-- lowercase column always has a value. The camelCase columns on those are
-- legacy-only — nothing to backfill.

-- 2. Drop the legacy camelCase columns.
ALTER TABLE public.users DROP COLUMN IF EXISTS "employeeId";
ALTER TABLE public.users DROP COLUMN IF EXISTS "lastLogin";
ALTER TABLE public.users DROP COLUMN IF EXISTS "activeSessions";
ALTER TABLE public.users DROP COLUMN IF EXISTS "isActive";
