-- Security-audit 07-09-2026, bevinding 2 (ernst midden): het presence-kanaal
-- `vhb-aanwezigheid` (wie van de staf is waar in het portaal) was een publiek
-- Realtime-topic. Iedereen met de publieke projectconfig, ook een chauffeur,
-- kon meeluisteren welke planner/admin op welk scherm zat, en zelf een
-- 'planner' nabootsen in die lijst. De client opent het kanaal nu met
-- private: true (src/lib/presence.ts); Realtime toetst dan élk bericht op
-- dit topic aan de policies op realtime.messages. Deze migratie geeft alleen
-- actieve staf (planner/admin) lees- en schrijfrecht op precies dit topic.
--
-- Volgorde: eerst deze migratie draaien, dan de frontend deployen. Andersom
-- faalt het abonnement even (best-effort: de lijst blijft dan leeg, niets
-- anders breekt).
--
-- Draaien in de Supabase SQL Editor. Idempotent (drop policy if exists +
-- create). Niet destructief: alleen policies op realtime.messages, geen
-- tabellen of data. De postgres_changes-kanalen (vhb-realtime) zijn niet
-- private en blijven ongewijzigd.

begin;

-- RLS op realtime.messages staat al aan (Supabase's eigen Realtime-migratie).
-- Géén 'alter table ... enable row level security' hier: de SQL-Editor-rol is
-- geen eigenaar van die tabel en krijgt dan 42501 (gebleken 07-09); policies
-- aanmaken mag wel.

drop policy if exists "vhb_aanwezigheid_staf_lezen" on realtime.messages;
create policy "vhb_aanwezigheid_staf_lezen"
  on realtime.messages for select
  to authenticated
  using (
    realtime.topic() = 'vhb-aanwezigheid'
    and extension = 'presence'
    and (select public.current_app_user_role()) in ('planner', 'admin')
  );

drop policy if exists "vhb_aanwezigheid_staf_schrijven" on realtime.messages;
create policy "vhb_aanwezigheid_staf_schrijven"
  on realtime.messages for insert
  to authenticated
  with check (
    realtime.topic() = 'vhb-aanwezigheid'
    and extension = 'presence'
    and (select public.current_app_user_role()) in ('planner', 'admin')
  );

commit;

-- Post-conditie (handmatig): als planner ingelogd toont het portaal de
-- aanwezige collega's; als chauffeur geeft een Realtime-abonnement op
-- 'vhb-aanwezigheid' met private: true een CHANNEL_ERROR.
