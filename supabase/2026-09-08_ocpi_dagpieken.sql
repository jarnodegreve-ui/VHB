-- Laadpalen-herwerking (08-09-2026): permanente dagpieken voor de historiek.
--
-- Probleem: de kwartier-snapshots (ocpi_power_snapshots) bewaarden maar 35
-- dagen, dus het piekvermogen van een maand was na vijf weken voorgoed weg,
-- precies het getal dat het Belgische capaciteitstarief per maand bepaalt.
-- Oplossing in twee lagen:
--   1. Deze tabel: één rij per Brusselse kalenderdag met de hoogste
--      kwartierpiek (kW), het tijdstip en het aantal ladende bussen op dat
--      moment. Klein (365 rijen/jaar), wordt nooit opgeruimd. De sync
--      (api/ocpi.ts, schrijfVermogensSnapshot) werkt hem per snapshot bij:
--      hoger = winnen, anders niets.
--   2. De ruwe snapshots blijven voortaan 400 dagen staan (was 35) zodat de
--      dagcurve van elke dag van het afgelopen jaar nog opvraagbaar is.
--
-- Idempotent: create if not exists + backfill met on conflict (max wint).
-- Rechten zoals ocpi_power_snapshots (2026-08-05/06): RLS aan, 0 policies,
-- anon niets, authenticated alleen select (RLS blokkeert alsnog),
-- service_role alles. De API leest/schrijft met de service-role.

begin;

create table if not exists public.ocpi_dagpieken (
  dag        date primary key,                 -- Brusselse kalenderdag
  piek_kw    numeric not null default 0 check (piek_kw >= 0),
  piek_ts    timestamptz,                       -- begin van het kwartier met de piek
  charging   integer not null default 0 check (charging >= 0),
  updated_at timestamptz not null default now()
);

alter table public.ocpi_dagpieken enable row level security;

revoke all on public.ocpi_dagpieken from anon;
revoke insert, update, delete, truncate, references, trigger
  on table public.ocpi_dagpieken from anon, authenticated;
grant select on public.ocpi_dagpieken to authenticated;
grant all on public.ocpi_dagpieken to service_role;

-- Backfill uit de snapshots die er nog zijn: per Brusselse dag het hoogste
-- slot (bij gelijke stand het vroegste). Herhaalbaar: een bestaande dag wordt
-- alleen overschreven als de snapshot hoger is.
insert into public.ocpi_dagpieken (dag, piek_kw, piek_ts, charging)
select distinct on (dag) dag, total_power_kw, ts, charging
from (
  select (ts at time zone 'Europe/Brussels')::date as dag, ts, total_power_kw, charging
  from public.ocpi_power_snapshots
) s
order by dag, total_power_kw desc, ts asc
on conflict (dag) do update
  set piek_kw = excluded.piek_kw,
      piek_ts = excluded.piek_ts,
      charging = excluded.charging,
      updated_at = now()
  where excluded.piek_kw > public.ocpi_dagpieken.piek_kw;

commit;

-- Controlequery (verwacht: rowsecurity = true, 0 policies, ≥ 1 rij per dag
-- sinds 2026-08-05):
--   select relrowsecurity from pg_class where oid = 'public.ocpi_dagpieken'::regclass;
--   select count(*) from pg_policies where tablename = 'ocpi_dagpieken';
--   select min(dag), max(dag), count(*) from public.ocpi_dagpieken;
