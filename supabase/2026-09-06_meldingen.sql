-- 2026-09-06 — Meldingencentrum + dashboardvoorkeuren (next-level 2).
--
-- 1) Tabel public.meldingen: élke push die de API verstuurt (verlofbeslissing,
--    ruilverzoek, nieuwe planning, update, document, vervaldatum, systeem)
--    wordt óók per gebruiker als rij bewaard — ook voor wie geen push-
--    abonnement heeft. De melding is de bron, push is het kanaal. De app
--    toont ze in /meldingen (bel in de topbar) en luistert via Realtime op
--    de eigen rijen. Retentie: de nachtcron (api/index.ts, RETENTION_
--    MELDING_DAYS, standaard 90) ruimt oudere rijen op.
-- 2) Kolom users.dashboardvoorkeuren (jsonb): verborgen tegels + volgorde
--    per gebruiker ("Dashboard aanpassen"). Alleen via de API (service-role)
--    geschreven, PATCH /api/me/voorkeuren.
--
-- Idempotent: veilig om opnieuw te draaien. De code faalt zonder deze
-- migratie zacht: GET /api/meldingen geeft dan een lege lijst (missing-table
-- = leeg), het bewaren van meldingen is best-effort en de voorkeuren-PATCH
-- meldt welke migratie mist. GET /api/health/schema signaleert de missende
-- kolommen (api/schemaProbes.ts).

begin;

-- === 1) meldingen ===
create table if not exists public.meldingen (
  id uuid primary key default gen_random_uuid(),
  -- users.id is text (zelfde conventie als planning_notes.driver_id,
  -- push_subscriptions.user_id). Geen FK: users worden via de API verwijderd
  -- en de cron ruimt verweesde rijen op leeftijd op.
  user_id text not null,
  titel text not null,
  tekst text,
  -- 'planning' | 'verlof' | 'ruil' | 'update' | 'omleiding' | 'document'
  -- | 'systeem' — de filterchips in de app; check-constraint bewust
  -- afwezig zodat een nieuwe soort geen migratie vraagt.
  soort text not null,
  -- Pad in de app om naartoe te gaan bij een tik (bv. 'mijn-dag',
  -- 'dienstruil', 'beheer/ziekte'); null = geen doel.
  doel text,
  created_at timestamptz not null default now(),
  gelezen_op timestamptz
);

-- Eigen meldingen, nieuwste eerst — dé query van GET /api/meldingen en van
-- de retentie (created_at).
create index if not exists meldingen_user_created_idx
  on public.meldingen (user_id, created_at desc);

-- RLS: alleen de eigen rijen leesbaar voor een ingelogde gebruiker (Realtime
-- past dit toe op INSERT/UPDATE-events; het filter user_id=eq.<id> in de
-- client is een extra zeef, geen beveiliging). Schrijven blijft aan de API
-- (service-role) — geen insert/update/delete-policies voor authenticated.
-- current_app_user_id() bestaat sinds 2026-09-05_users_authid.sql.
alter table public.meldingen enable row level security;

drop policy if exists meldingen_select_own on public.meldingen;
create policy meldingen_select_own
  on public.meldingen for select
  to authenticated
  using (user_id = (select public.current_app_user_id()));

-- Geen rechten voor anon (zelfde lijn als 2026-08-02_anon_rechten_intrekken).
revoke all on table public.meldingen from anon;
grant select on table public.meldingen to authenticated;

-- Realtime: de app abonneert zich op postgres_changes voor de eigen rijen.
-- DELETE-events dragen alleen de primary key (uuid) — geen persoonsgegevens
-- (zie de toelichting in 2026-08-02_realtime_publicatie.sql). Idempotent:
-- eerst kijken of de tabel al in de publicatie zit.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'meldingen'
  ) then
    execute 'alter publication supabase_realtime add table public.meldingen';
    raise notice 'tabel meldingen toegevoegd aan supabase_realtime';
  else
    raise notice 'tabel meldingen zit al in supabase_realtime';
  end if;
end $$;

-- === 2) users.dashboardvoorkeuren ===
-- jsonb { "verborgen": ["deze-maand"], "volgorde": ["vandaag", "volgende-dienst", …] }
-- (vorm bewaakt door shared/schemas/dashboardVoorkeuren.ts). Kleine letters:
-- de users-tabel is unquoted/lowercase (zie api/schemaProbes.ts).
alter table public.users add column if not exists dashboardvoorkeuren jsonb;

-- Post-conditie in de transactie: een halve toepassing rolt terug.
do $$
begin
  if to_regclass('public.meldingen') is null then
    raise exception 'post-conditie faalt: public.meldingen ontbreekt';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'users' and column_name = 'dashboardvoorkeuren'
  ) then
    raise exception 'post-conditie faalt: users.dashboardvoorkeuren ontbreekt';
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'meldingen'
  ) then
    raise exception 'post-conditie faalt: meldingen niet in supabase_realtime';
  end if;
end $$;

commit;

-- === Controle na het draaien ===
--
-- select count(*) from public.meldingen;                        -- 0 (nieuw)
-- select column_name from information_schema.columns
--   where table_name = 'users' and column_name = 'dashboardvoorkeuren';
-- select tablename from pg_publication_tables
--   where pubname = 'supabase_realtime' order by tablename;     -- incl. meldingen
-- In de app: /beheer/systeemstatus → schema-check groen; keur een verlof-
-- aanvraag goed → de bel van de chauffeur krijgt binnen een seconde een stip.
