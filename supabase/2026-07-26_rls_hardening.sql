-- RLS-hardening n.a.v. controle-ronde 2026-07-26 (bevindingen 1, 2, 32).
-- Idempotent; plakken/draaien in de SQL Editor of via migratie-tooling.
--
-- Context: de server praat met de service-role (bypast RLS). De browser-client
-- doet nergens directe tabel-queries (geverifieerd: 0× supabase.from() in src/)
-- maar heeft wél een authenticated-JWT, dus permissieve policies zijn puur
-- aanvalsoppervlak. Realtime (postgres_changes) levert alleen rijen af die de
-- abonnee mag SELECT-en — leave/swaps krijgen daarom een gescopeerde select
-- i.p.v. using(true), zodat de juiste gebruikers hun refresh-signaal houden.

begin;

-- === Bevinding 1: privilege-escalatie via users-update ===
-- De oude policy "users_update_self_or_admin" liet een chauffeur zijn eigen
-- rij updaten zonder kolombeperking — inclusief role='admin'. Zelf-update
-- vanuit de client wordt nergens gebruikt (alle schrijfacties lopen via de
-- API met service-role), dus update wordt admin-only.
drop policy if exists "users_update_self_or_admin" on public.users;
drop policy if exists "users_update_admin_only" on public.users;
create policy "users_update_admin_only"
on public.users
for update
to authenticated
using (public.current_app_user_role() = 'admin')
with check (public.current_app_user_role() = 'admin');

-- === Bevinding 2: leave/swaps voor iedereen leesbaar (using true) ===
-- Chauffeurs konden alle verlofredenen/ziekte en ruil-toelichtingen van
-- collega's rechtstreeks via PostgREST lezen. Nieuwe scope spiegelt de
-- API-regels: eigen records (of als aangezochte collega bij een ruil),
-- planner/admin zien alles.
drop policy if exists "leave_read_authenticated" on public.leave;
drop policy if exists "leave_read_involved_or_staff" on public.leave;
create policy "leave_read_involved_or_staff"
on public.leave
for select
to authenticated
using (
  public.current_app_user_role() in ('planner', 'admin')
  or exists (
    select 1 from public.users u
    where lower(u.email) = lower(auth.email())
      and u.id::text = leave.userid::text
  )
);

drop policy if exists "swaps_read_authenticated" on public.swaps;
drop policy if exists "swaps_read_involved_or_staff" on public.swaps;
create policy "swaps_read_involved_or_staff"
on public.swaps
for select
to authenticated
using (
  public.current_app_user_role() in ('planner', 'admin')
  or exists (
    select 1 from public.users u
    where lower(u.email) = lower(auth.email())
      and (
        u.id::text = swaps.requesterid::text
        or u.id::text = swaps.targetdriverid::text
      )
  )
);

-- === Bevinding 32: search_path vastzetten op de gedeelde functies ===
-- (Supabase-advisor "function_search_path_mutable".)
alter function public.current_app_user_role() set search_path = public;
alter function public.set_updated_at() set search_path = public;

commit;
