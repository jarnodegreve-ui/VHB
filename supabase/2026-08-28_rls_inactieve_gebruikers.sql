-- Controle-ronde 27-08-2026, bevinding 1 (ernst hoog): gedeactiveerde
-- gebruikers konden via PostgREST (anon-key uit de bundel + hun eigen JWT)
-- rechtstreeks blijven lezen. "Pauzeer gebruiker" zet alleen users.isactive
-- op false; het Supabase-Auth-account bleef gewoon inloggen, en geen enkele
-- policy keek naar isactive: de using (true)-leespolicies gaven élke
-- ingelogde Auth-gebruiker planning/diensten/omleidingen/updates/codes/
-- ritblad, en current_app_user_role() gaf een gepauzeerde planner/admin nog
-- zijn rol — dus álle users (telefoon, mail, budget), verlof incl. ziekte en
-- ruilen. De API-laag (authenticate → isActive-check, toestel-whitelist)
-- stond daar volledig buiten. Deze migratie sluit het DB-pad; de API bant
-- sinds dezelfde PR ook het Auth-account bij deactiveren (api/storage.ts).
--
-- Draaien in de Supabase SQL Editor (of via apply_migration). Idempotent:
-- create or replace + drop policy if exists — twee keer draaien is veilig.
-- Niet destructief: geen tabellen, kolommen of data geraakt; alleen twee
-- functies en SELECT-policies. Gedrag voor ACTIEVE gebruikers is ongewijzigd.

begin;

-- 1) Rolhelper: alleen een actief account heeft nog een rol. NULL voor een
--    gepauzeerd account → elke `in ('planner','admin')`-check faalt dicht.
--    Verder identiek aan 2026-08-01 (security definer, search_path '').
create or replace function public.current_app_user_role()
  returns text
  language sql
  stable
  security definer
  set search_path = ''
as $function$
  select role
  from public.users
  where lower(email) = lower(auth.email())
    and isactive
  limit 1
$function$;

revoke all on function public.current_app_user_role() from public, anon;
grant execute on function public.current_app_user_role() to authenticated, service_role;

-- 2) "Is de aanroeper een actief portaal-account?" — vervangt using (true).
--    Afgeleid van (1) i.p.v. een eigen users-lookup (SQL-review 28-08): role
--    is not null + check-constraint, dus "heeft een rol" == "bestaat én is
--    actief". Eén definer-functie om te auditen; geen tweede die uit de pas
--    kan lopen. Security definer zodat de policy op users niet recursief op
--    zichzelf slaat; geen argumenten, niet stuurbaar.
create or replace function public.is_active_app_user()
  returns boolean
  language sql
  stable
  security definer
  set search_path = ''
as $function$
  select public.current_app_user_role() is not null
$function$;

revoke all on function public.is_active_app_user() from public, anon;
grant execute on function public.is_active_app_user() to authenticated, service_role;

-- 3) De "elke ingelogde"-leespolicies: using (true) → actief account.
--    (select ...) = InitPlan-vorm, één evaluatie per query (advisor 30-07).
drop policy if exists "planning_read_authenticated" on public.planning;
create policy "planning_read_authenticated"
  on public.planning for select
  to authenticated
  using ((select public.is_active_app_user()));

drop policy if exists "diversions_read_authenticated" on public.diversions;
create policy "diversions_read_authenticated"
  on public.diversions for select
  to authenticated
  using ((select public.is_active_app_user()));

drop policy if exists "services_read_authenticated" on public.services;
create policy "services_read_authenticated"
  on public.services for select
  to authenticated
  using ((select public.is_active_app_user()));

drop policy if exists "updates_read_authenticated" on public.updates;
create policy "updates_read_authenticated"
  on public.updates for select
  to authenticated
  using ((select public.is_active_app_user()));

drop policy if exists "planning_codes_read_authenticated" on public.planning_codes;
create policy "planning_codes_read_authenticated"
  on public.planning_codes for select
  to authenticated
  using ((select public.is_active_app_user()));

-- Realtime-teller: de abonnee moet mogen lezen, anders komt er geen event —
-- dat blijft zo voor actieve accounts.
drop policy if exists planning_version_read_authenticated on public.planning_version;
create policy planning_version_read_authenticated
  on public.planning_version for select
  to authenticated
  using ((select public.is_active_app_user()));

drop policy if exists "Authenticated can read ritblaadje" on public.ritblaadje;
create policy "Authenticated can read ritblaadje"
  on public.ritblaadje for select
  to authenticated
  using ((select public.is_active_app_user()));

-- 4) Eigen-records-policies: ook het "eigen" been alleen voor een actief
--    account. De staf-tak is via (1) al dicht voor gepauzeerde staf.
drop policy if exists users_select_self_or_staff on public.users;
create policy users_select_self_or_staff
  on public.users for select
  to authenticated
  using (
    (lower(email) = lower((select auth.email())) and isactive)
    or (select public.current_app_user_role()) in ('planner', 'admin')
  );

drop policy if exists leave_read_involved_or_staff on public.leave;
create policy leave_read_involved_or_staff
  on public.leave for select
  to authenticated
  using (
    (select public.current_app_user_role()) in ('planner', 'admin')
    or exists (
      select 1 from public.users u
      where lower(u.email) = lower((select auth.email()))
        and u.isactive
        and u.id = leave.userid
    )
  );

drop policy if exists swaps_read_involved_or_staff on public.swaps;
create policy swaps_read_involved_or_staff
  on public.swaps for select
  to authenticated
  using (
    (select public.current_app_user_role()) in ('planner', 'admin')
    or exists (
      select 1 from public.users u
      where lower(u.email) = lower((select auth.email()))
        and u.isactive
        and (u.id = swaps.requesterid or u.id = swaps.targetdriverid)
    )
  );

commit;

-- Controle ná het draaien (simuleert een gepauzeerd en een actief account):
--   begin;
--   select set_config('request.jwt.claims', '{"role":"authenticated","email":"<mailadres>"}', true);
--   set local role authenticated;
--   select public.current_app_user_role(), public.is_active_app_user(),
--          (select count(*) from public.planning) as planning_rijen;
--   rollback;
-- Verwacht: gepauzeerd → (null, false, 0); actief → (rol, true, > 0).
