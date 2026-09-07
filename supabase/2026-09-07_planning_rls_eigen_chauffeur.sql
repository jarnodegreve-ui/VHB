-- Security-audit 07-09-2026, bevinding 6 (ernst midden): de leespolicy op
-- public.planning liet élk actief account álle planningrijen lezen. Via
-- PostgREST (anon-key uit de bundel + eigen JWT) kon een chauffeur zo de
-- volledige planning van alle collega's ophalen (busnr, loopnr, tijden), en
-- dat ook met een niet-goedgekeurd of ingetrokken toestel: de toestel-
-- whitelist zit in de Express-laag, niet in de database. De API begrenst
-- /api/planning voor chauffeurs al op eigen rijen; deze migratie trekt de
-- databasekant gelijk. Het brede maandbord (/api/month-planning) loopt via
-- de service-role en blijft ongewijzigd.
--
-- Realtime: de client luistert niet op planning zelf maar op
-- planning_version (src/lib/realtime.ts), dus de smallere policy raakt geen
-- abonnement.
--
-- Draaien in de Supabase SQL Editor. Idempotent (drop policy if exists +
-- create). Niet destructief: alleen één SELECT-policy vervangen. Gedrag voor
-- planner/admin is ongewijzigd; een chauffeur ziet via de database nog enkel
-- zijn eigen rijen. Vereist current_app_user_id() (2026-09-05_users_authid).

begin;

drop policy if exists "planning_read_authenticated" on public.planning;
create policy "planning_read_authenticated"
  on public.planning for select
  to authenticated
  using (
    -- (select ...) = InitPlan-vorm: één evaluatie per query, niet per rij.
    (select public.current_app_user_role()) in ('planner', 'admin')
    or "driverId" = (select public.current_app_user_id())
  );

commit;

-- Post-conditie (handmatig): als chauffeur ingelogd hoort
--   select count(*) from public.planning where "driverId" <> '<eigen id>'
-- 0 te geven; als planner de volledige telling.
