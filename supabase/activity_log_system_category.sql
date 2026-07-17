-- Migration: categorie 'system' toestaan in activity_log.
--
-- Waarom: de cron-heartbeat (logCronHeartbeat, api/storage.ts) en de
-- "back-up gedeeltelijk hersteld"-logregel schrijven met category='system',
-- maar de check-constraint kende die waarde nog niet. Elke cron-run
-- (OCPI-sync elke 2/5/15 min, back-up, foutmelding-digest) probeerde zo een
-- heartbeat te schrijven die faalde met 23514 (check_violation). De crons
-- zelf bleven werken (heartbeat is best-effort), maar het vulde de Postgres-
-- logs en liet het health-dashboard denken dat crons niet gedraaid hadden.
--
-- Run dit ZELF op Supabase. Idempotent: droppt de oude constraint als die
-- bestaat en zet 'm met de volledige lijst (nu incl. 'system') terug.

do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conname = 'activity_log_category_check'
  ) then
    alter table public.activity_log drop constraint activity_log_category_check;
  end if;
end $$;

alter table public.activity_log
  add constraint activity_log_category_check
  check (category in ('users','planning','planning_codes','services','diversions','updates','auth','leave','swaps','system'));
