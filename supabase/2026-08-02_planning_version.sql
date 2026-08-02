-- planning_version: één rij met een teller die ophoogt zodra de planning of de
-- matrix wijzigt. Draaien in de Supabase SQL Editor.
--
-- Waarom: realtime.ts wil weten wanneer de planning verandert, maar `planning`
-- zelf in de publicatie zetten is te duur. Een heropbouw vervangt ~655 + 184
-- rijen in één transactie; Realtime verwerkt changes op één thread en doet per
-- abonnee een access-check per rij. Bij ~30 verbonden chauffeurs zijn dat
-- tienduizenden queries per import, met CHANNEL_ERROR en een gelijktijdige
-- refetch-storm als gevolg. Daarom staan planning en planning_matrix_rows
-- bewust NIET in supabase_realtime (zie 2026-08-02_realtime_publicatie.sql).
--
-- Deze tabel is het alternatief: één rij, één UPDATE per statement. Een
-- heropbouw doet vier data-statements (matrix delete+insert, planning
-- delete+insert), dus vier events in plaats van 1.678 — en de 400ms-debounce
-- in realtime.ts maakt daar één refetch per client van. De inhoud is een
-- teller: geen persoonsgegevens, niets dat afgeschermd hoeft.
--
-- Waarom een TRIGGER en niet een bump in de code: de planning wijzigt via
-- meerdere paden — de RPC's replace_planning en replace_planning_and_matrix,
-- maar ook movePlanningRows bij een goedgekeurde ruil, en handmatige
-- correcties. Een statement-trigger vangt ze allemaal, ook de paden die later
-- nog bijkomen. FOR EACH STATEMENT (niet FOR EACH ROW): anders zijn we terug
-- bij duizenden bumps per import.
--
-- Waarom BEFORE en niet AFTER: bij AFTER neemt een schrijver eerst zijn
-- planning-rijen en pas daarna de version-rij. Een import (die de version-rij
-- al bij zijn eerste statement pakt en tot commit vasthoudt) en een
-- gelijktijdige ruil-doorvoer nemen die twee locks dan in tegengestelde
-- volgorde — dat is een deadlock. Met BEFORE pakt élke transactie eerst de
-- version-rij en daarna pas de data, dus de volgorde is overal gelijk en er
-- valt niets te deadlocken. Wachten kan wel; dat is de bedoeling.
--
-- Idempotent.

begin;

create table if not exists public.planning_version (
  -- Precies één rij: de check dwingt id = true af, dus een tweede rij kan niet.
  id boolean primary key default true check (id),
  version bigint not null default 0,
  updated_at timestamptz not null default now()
);

insert into public.planning_version (id, version) values (true, 0)
on conflict (id) do nothing;

alter table public.planning_version enable row level security;

-- Iedereen die ingelogd is mag de teller lezen. Dat is nodig: Realtime doet de
-- access-check als de abonnee zelf, dus zonder SELECT-policy komt er geen
-- enkel event aan. Er staat niets in dat afscherming vraagt.
drop policy if exists planning_version_read_authenticated on public.planning_version;
create policy planning_version_read_authenticated
  on public.planning_version for select
  to authenticated
  using (true);

-- Schrijven gebeurt uitsluitend door de trigger (security definer); geen
-- INSERT/UPDATE/DELETE-policy, dus voor authenticated/anon is dat deny.
--
-- SELECT expliciet granten i.p.v. op de default privileges leunen: die worden
-- in 2026-08-02_anon_rechten_intrekken.sql aangepast, en zo maakt het niet uit
-- in welke volgorde de twee migraties draaien.
grant select on public.planning_version to authenticated;

-- Upsert i.p.v. een kale update: verdwijnt de rij ooit, dan zou een update 0
-- rijen raken en de teller stil nooit meer ophogen — kapot zonder foutmelding.
create or replace function public.bump_planning_version()
  returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
begin
  insert into public.planning_version (id, version, updated_at)
  values (true, 1, now())
  on conflict (id) do update
    set version = public.planning_version.version + 1,
        updated_at = now();
  return null; -- statement-level trigger: de returnwaarde wordt genegeerd
end;
$$;

-- De functie is niet direct aanroepbaar (returns trigger) en PostgREST exposet
-- hem niet, maar de default privileges geven anon/authenticated toch EXECUTE.
-- Gratis dicht.
revoke all on function public.bump_planning_version() from public, anon, authenticated;

drop trigger if exists planning_version_bump on public.planning;
create trigger planning_version_bump
  before insert or update or delete or truncate on public.planning
  for each statement execute function public.bump_planning_version();

drop trigger if exists planning_version_bump_matrix on public.planning_matrix_rows;
create trigger planning_version_bump_matrix
  before insert or update or delete or truncate on public.planning_matrix_rows
  for each statement execute function public.bump_planning_version();

-- In de publicatie, zodat de clients het event krijgen.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'planning_version'
  ) then
    alter publication supabase_realtime add table public.planning_version;
  end if;
end $$;

commit;

-- === Controle na het draaien ===
--
-- 1) De tabel bestaat met precies één rij, en zit in de publicatie.
--
-- select (select count(*) from public.planning_version) as rijen,
--        (select version from public.planning_version)  as stand,
--        exists (select 1 from pg_publication_tables
--                where pubname='supabase_realtime' and tablename='planning_version') as in_publicatie;
--
-- 2) De trigger telt per STATEMENT, niet per rij. Verwacht: +1, niet +N.
--    Dit blok rolt zichzelf terug.
--
-- begin;
--   select version from public.planning_version;                 -- vóór
--   update public.planning set loopnr = loopnr where date > '';  -- raakt alle rijen
--   select version from public.planning_version;                 -- +1
-- rollback;
