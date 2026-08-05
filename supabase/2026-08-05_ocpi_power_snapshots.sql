-- Piekvermogen-bewaking: elke OCPI-sync (per 30 min) schrijft één rij met het
-- totale laadvermogen van dat moment. Voedt de dagcurve in het OCPI-dashboard
-- en maakt de kwartierpiek zichtbaar die in België het capaciteitstarief
-- bepaalt. Idempotent; alleen de service-role schrijft en leest (API-laag),
-- dus RLS aan met 0 policies = bewust deny-all voor iedereen behalve
-- service_role, zelfde patroon als client_errors.
--
-- LET OP (review 05-08): de API moet ts afronden op de 30-minuten-slotgrens,
-- anders vuurt de ON CONFLICT (ts)-upsert nooit en stapelen dubbele syncs
-- binnen één slot als losse rijen.

begin;

create table if not exists public.ocpi_power_snapshots (
  ts timestamptz primary key,
  total_power_kw numeric not null default 0 check (total_power_kw >= 0),
  charging integer not null default 0 check (charging >= 0)
);

alter table public.ocpi_power_snapshots enable row level security;

-- Conform de rechten-opruiming van 2026-08-02: anon niets, authenticated
-- alleen SELECT (RLS zonder policies blokkeert alsnog), service_role alles.
revoke all on public.ocpi_power_snapshots from anon;
grant select on public.ocpi_power_snapshots to authenticated;
grant all on public.ocpi_power_snapshots to service_role;

commit;

-- Controlequery (verwacht: rowsecurity = true, 0 policies, geen anon in relacl):
--   select relrowsecurity, relacl from pg_class where oid = 'public.ocpi_power_snapshots'::regclass;
--   select count(*) from pg_policies where tablename = 'ocpi_power_snapshots';
