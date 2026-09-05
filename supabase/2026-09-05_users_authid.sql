-- 2026-09-05 — Sessie-identiteit op de Supabase Auth-uid i.p.v. het e-mailadres
-- (controle-ronde 05-09, security nr. 7).
--
-- Tot nu toe koppelde de API én de RLS-laag een JWT aan een portaalprofiel
-- via het e-mailadres. Wie zijn Auth-e-mail kon wijzigen naar dat van een
-- collega, kon zo in diens profiel terechtkomen. Vanaf nu:
--   1) users.authid = de Auth-uid waaraan het profiel gekoppeld is;
--   2) bestaande profielen worden éénmalig gekoppeld op e-mail (backfill);
--   3) RLS-helpers kijken eerst naar authid; e-mail blijft alleen de
--      terugval voor een profiel dat nog nooit gekoppeld is (authid is null).
-- De API doet hetzelfde en koppelt bij de eerste aanmelding (api/middleware.ts).
-- Idempotent: veilig om opnieuw te draaien.

begin;

-- 1) Kolom + unieke index (één profiel per Auth-account).
alter table public.users add column if not exists authid uuid;
create unique index if not exists users_authid_key on public.users (authid) where authid is not null;

-- 2) Backfill: koppel op e-mail, alleen waar nog niets gekoppeld is en het
--    e-mailadres eenduidig bij één Auth-account hoort.
update public.users u
set authid = a.id
from auth.users a
where u.authid is null
  and u.email is not null
  and lower(a.email) = lower(u.email)
  and not exists (
    select 1 from auth.users b
    where lower(b.email) = lower(u.email) and b.id <> a.id
  );

-- 3) Rolhelper: uid eerst, e-mail alleen als terugval voor een ongekoppeld
--    profiel. Verder identiek aan 2026-08-28 (security definer, search_path '',
--    alleen een actief account heeft een rol).
create or replace function public.current_app_user_role()
  returns text
  language sql
  stable
  security definer
  set search_path = ''
as $function$
  select role
  from public.users
  where isactive
    and (
      authid = (select auth.uid())
      or (authid is null and lower(email) = lower((select auth.email())))
    )
  -- Gekoppelde rij (authid gezet) wint van de e-mail-terugval — zelfde
  -- volgorde als api/middleware.ts (SQL-review 05-09).
  order by authid is null
  limit 1
$function$;

revoke all on function public.current_app_user_role() from public, anon;
grant execute on function public.current_app_user_role() to authenticated, service_role;

-- is_active_app_user() is afgeleid van current_app_user_role() (2026-08-28)
-- en hoeft dus niet aangepast te worden.

-- 3b) Eigen users.id van de aanroeper — dezelfde regel, voor de
--     "betrokken"-policies op leave en swaps (die joinden op e-mail).
create or replace function public.current_app_user_id()
  returns text
  language sql
  stable
  security definer
  set search_path = ''
as $function$
  select id
  from public.users
  where isactive
    and (
      authid = (select auth.uid())
      or (authid is null and lower(email) = lower((select auth.email())))
    )
  -- Gekoppelde rij (authid gezet) wint van de e-mail-terugval — zelfde
  -- volgorde als api/middleware.ts (SQL-review 05-09).
  order by authid is null
  limit 1
$function$;

revoke all on function public.current_app_user_id() from public, anon;
grant execute on function public.current_app_user_id() to authenticated, service_role;

-- 4) Eigen-rij-policy op users: zelfde regel.
drop policy if exists users_select_self_or_staff on public.users;
create policy users_select_self_or_staff
  on public.users for select
  to authenticated
  using (
    (
      isactive
      and (
        authid = (select auth.uid())
        or (authid is null and lower(email) = lower((select auth.email())))
      )
    )
    or (select public.current_app_user_role()) in ('planner', 'admin')
  );

-- 5) Betrokkenheid op verlof en dienstruil: via de eigen id i.p.v. een
--    e-mail-join (2026-08-28 deed hetzelfde met e-mail).
drop policy if exists leave_read_involved_or_staff on public.leave;
create policy leave_read_involved_or_staff
  on public.leave for select
  to authenticated
  using (
    (select public.current_app_user_role()) in ('planner', 'admin')
    or leave.userid::text = (select public.current_app_user_id())::text
  );

drop policy if exists swaps_read_involved_or_staff on public.swaps;
create policy swaps_read_involved_or_staff
  on public.swaps for select
  to authenticated
  using (
    (select public.current_app_user_role()) in ('planner', 'admin')
    or swaps.requesterid::text = (select public.current_app_user_id())::text
    or swaps.targetdriverid::text = (select public.current_app_user_id())::text
  );

commit;
