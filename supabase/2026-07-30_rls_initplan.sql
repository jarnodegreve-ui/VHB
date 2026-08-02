-- Supabase performance-advisor (auth_rls_initplan, 30-07-2026): acht policies
-- herevalueerden auth.uid()/auth.email()/auth.role()/current_app_user_role()
-- per RIJ. In (select ...) gewikkeld wordt de waarde één keer per query
-- bepaald (InitPlan) — zelfde semantiek, minder werk per rij.
-- Idempotent: drop if exists + create, definities verder ongewijzigd.

-- ritblaadje: lezen voor elke ingelogde gebruiker.
drop policy if exists "Authenticated can read ritblaadje" on public.ritblaadje;
create policy "Authenticated can read ritblaadje"
  on public.ritblaadje for select
  using ((select auth.role()) = 'authenticated');

-- users: zichzelf, of staf ziet iedereen.
drop policy if exists users_select_self_or_staff on public.users;
create policy users_select_self_or_staff
  on public.users for select
  to authenticated
  using (
    lower(email) = lower((select auth.email()))
    or (select current_app_user_role()) in ('planner', 'admin')
  );

-- subscriptions: tabel gedropt op 02-08-2026 (zie
-- 2026-08-02_drop_subscriptions.sql) — hij hoorde niet bij dit project. De
-- vier subs_*_own-policies zijn met de tabel meegegaan.
--
-- Het blok dat hier stond is BEWUST geschrapt en niet geguard: `drop policy
-- if exists` slikt een ontbrekende policy, maar niet een ontbrekende TABEL.
-- Wie dit bestand opnieuw draaide op een omgeving zonder die tabel, kreeg
-- `relation "public.subscriptions" does not exist` — en dan werden de zes
-- policies hieronder (leave, swaps, …) niet meer aangemaakt.

-- leave: betrokkene of staf.
drop policy if exists leave_read_involved_or_staff on public.leave;
create policy leave_read_involved_or_staff
  on public.leave for select
  to authenticated
  using (
    (select current_app_user_role()) in ('planner', 'admin')
    or exists (
      select 1 from public.users u
      where lower(u.email) = lower((select auth.email()))
        and u.id = leave.userid
    )
  );

-- swaps: aanvrager/doelchauffeur of staf.
drop policy if exists swaps_read_involved_or_staff on public.swaps;
create policy swaps_read_involved_or_staff
  on public.swaps for select
  to authenticated
  using (
    (select current_app_user_role()) in ('planner', 'admin')
    or exists (
      select 1 from public.users u
      where lower(u.email) = lower((select auth.email()))
        and (u.id = swaps.requesterid or u.id = swaps.targetdriverid)
    )
  );
