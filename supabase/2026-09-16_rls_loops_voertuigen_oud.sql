-- Controle-ronde 16-09-2026, bevinding 1 (ernst hoog): vier tabellen hadden
-- nog een SELECT-policy `using (true)` voor `authenticated` (én de bijhorende
-- grant), zodat élke ingelogde Auth-gebruiker ze via PostgREST (anon-key uit
-- de bundel + eigen JWT) rechtstreeks kon lezen, buiten de API om:
--
--   dienst_loops           (dienst_loops_read_authenticated)
--   service_loops          (service_loops_read_authenticated)
--   loop_vehicle_defaults  (loop_vehicle_defaults_read_authenticated)
--   vehicles_chargeye_oud  (vehicles_read_authenticated, meeverhuisd bij de
--                           hernoeming in 2026-09-13_techniek_voertuigen.sql)
--
-- Deze vier zijn losse productietabellen zonder migratie in de repo. Geen
-- enkel codepad leest ze: de client gebruikt geen supabase-js `.from()`, de
-- API (api/) en de solver (rostering/) verwijzen er nergens naar, en de
-- ChargEye-koppeling is in 2026-09-13 al overgenomen in
-- vehicles.chargeye_mix_id. Ze horen daarom in het patroon van elke nieuwere
-- tabel (vehicles, meldingen, user_expiries): RLS aan zonder policies en geen
-- rechten voor anon/authenticated; service_role omzeilt RLS als de API ze
-- ooit nodig heeft. Geen "actieve staf"-policy dus: een policy voor lezers
-- die niet bestaan is alleen maar oppervlak.
--
-- Draaien in de Supabase SQL Editor. Idempotent: drop policy if exists en
-- revoke zijn herhaalbaar; de tabellen worden alleen geraakt als ze bestaan
-- (op staging bestaan ze niet, dan is dit een no-op). Niet destructief: geen
-- tabellen, kolommen of data geraakt. Daarna:
--   node --env-file=.env.local scripts/beleid-drift.mjs --update
-- en supabase/beleid-snapshot.json mee committen (README › Beleidssnapshot).

begin;

do $$
declare
  t text;
begin
  foreach t in array array['dienst_loops', 'service_loops', 'loop_vehicle_defaults', 'vehicles_chargeye_oud']
  loop
    if to_regclass('public.' || t) is null then
      continue;
    end if;
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from anon, authenticated', t);
    execute format('grant all on table public.%I to service_role', t);
  end loop;

  -- De policies zelf (drop policy if exists faalt op een ontbrekende tabel,
  -- vandaar ook hier de bestaanscheck).
  if to_regclass('public.dienst_loops') is not null then
    execute 'drop policy if exists "dienst_loops_read_authenticated" on public.dienst_loops';
  end if;
  if to_regclass('public.service_loops') is not null then
    execute 'drop policy if exists "service_loops_read_authenticated" on public.service_loops';
  end if;
  if to_regclass('public.loop_vehicle_defaults') is not null then
    execute 'drop policy if exists "loop_vehicle_defaults_read_authenticated" on public.loop_vehicle_defaults';
  end if;
  if to_regclass('public.vehicles_chargeye_oud') is not null then
    execute 'drop policy if exists "vehicles_read_authenticated" on public.vehicles_chargeye_oud';
  end if;
end $$;

commit;

-- Controle ná het draaien:
--   select tablename, policyname from pg_policies
--   where schemaname = 'public'
--     and tablename in ('dienst_loops', 'service_loops', 'loop_vehicle_defaults', 'vehicles_chargeye_oud');
--   select table_name, grantee, privilege_type from information_schema.role_table_grants
--   where table_schema = 'public'
--     and table_name in ('dienst_loops', 'service_loops', 'loop_vehicle_defaults', 'vehicles_chargeye_oud')
--     and grantee in ('anon', 'authenticated');
-- Verwacht: beide leeg.
