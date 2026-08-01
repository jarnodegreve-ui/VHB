-- current_app_user_role() naar SECURITY DEFINER — anders crasht élke policy
-- die hem gebruikt. Draaien in de Supabase SQL Editor.
--
-- Waarom: de functie staat op SECURITY INVOKER (prosecdef = false) en leest
-- public.users. De policy óp public.users (users_select_self_or_staff) roept
-- diezelfde functie aan → oneindige recursie. Live geverifieerd op 01-08-2026:
--
--   begin; set local role authenticated;
--   select count(*) from public.planning_matrix_rows;
--   → ERROR 54001: stack depth limit exceeded
--      CONTEXT: SQL function "current_app_user_role" statement 1 (×honderden)
--
-- Geraakt: users_*, leave_read_involved_or_staff, swaps_read_involved_or_staff,
-- chauffeur_ids_staff_only, planning_matrix_rows_staff_only,
-- planning_matrix_import_history_staff_only.
--
-- Gevolg vandaag: die policies autoriseren niets, ze crashen. Dat faalt dicht,
-- dus er lekt niets — maar de defense-in-depth-laag bestaat feitelijk niet, en
-- de realtime-abonnementen op leave/swaps/planning_matrix_rows leveren bij
-- geen enkele client events af. Het échte risico zit in de verleiding: wie de
-- crash ontdekt en "even" de users-policy openzet, laat alle staff-only-checks
-- stilzwijgend voor iedereen slagen.
--
-- Waarom DEFINER veilig is: de functie geeft uitsluitend de rol van de
-- áánroeper terug (match op auth.email()), neemt geen argumenten en kan dus
-- niet naar een andere gebruiker gestuurd worden. Ze wordt niet ruimer dan ze
-- al bedoeld was — ze werkt alleen eindelijk.
--
-- search_path gaat naar '' (was 'public'): bij SECURITY DEFINER is een
-- schrijfbaar schema in het pad een bekende escalatieroute. De body qualificeert
-- alles al (public.users, auth.email()); lower() komt uit pg_catalog, dat
-- altijd impliciet eerst doorzocht wordt.
--
-- Idempotent: create or replace, geen drop (policies hangen ervan af).

begin;

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
  limit 1
$function$;

-- EXECUTE stond op PUBLIC (proacl bevatte `=X/postgres` plus anon). Bij
-- SECURITY INVOKER was dat onschuldig; bij DEFINER geef je daarmee anon een
-- functie in handen die public.users leest mét RLS-bypass. Vandaag lekt dat
-- niets (anon heeft geen claims → auth.email() is NULL → NULL terug), maar dat
-- oppervlak hoeft er niet te zijn. create or replace behoudt de oude ACL, dus
-- expliciet herzetten.
revoke all on function public.current_app_user_role() from public, anon;
grant execute on function public.current_app_user_role() to authenticated, service_role;

commit;

-- === Controle na het draaien ===
--
-- LET OP bij het zelf verzinnen van controles: een onbestaand e-mailadres in
-- de claim geeft rol NULL → 0 rijen. Dat is exact wat je óók ziet als de fix
-- mislukt is. Elke controle hieronder heeft daarom een positieve assertie
-- (rol + zichtbare rijen) en haalt een écht adres uit de tabel.
--
-- 1) De functie staat op DEFINER met leeg search_path — verwacht:
--    prosecdef = true, proconfig = {search_path=""}
--
-- select proname, prosecdef, proconfig
-- from pg_proc p join pg_namespace n on n.oid = p.pronamespace
-- where n.nspname = 'public' and p.proname = 'current_app_user_role';
--
-- 2) Staf ziet de matrix — verwacht: rol = 'admin', staff_rijen > 0
--    (en géén 54001). Draai als één blok; het rolt zichzelf terug.
--
-- begin;
--   select set_config('request.jwt.claims',
--     (select json_build_object('email', email)::text
--      from public.users where role = 'admin' and isactive is not false
--      order by email limit 1), true);
--   set local role authenticated;
--   select public.current_app_user_role() as rol,
--          (select count(*) from public.planning_matrix_rows) as staff_rijen;
-- rollback;
--
-- 3) Een chauffeur ziet de matrix níét, maar wél zijn eigen users-rij —
--    verwacht: rol = 'chauffeur', staff_rijen = 0, zichtbare_gebruikers = 1.
--    Die laatste kolom is de kern: hij bewijst dat de policy werkt in plaats
--    van dat alles simpelweg dichtvalt.
--
-- begin;
--   select set_config('request.jwt.claims',
--     (select json_build_object('email', email)::text
--      from public.users where role = 'chauffeur' and isactive is not false
--      order by email limit 1), true);
--   set local role authenticated;
--   select public.current_app_user_role() as rol,
--          (select count(*) from public.planning_matrix_rows) as staff_rijen,
--          (select count(*) from public.users) as zichtbare_gebruikers;
-- rollback;
--
-- === Bewuste keuze die hierbij hoort ===
--
-- users_insert/update/delete_admin_only crashten tot nu toe en waren dus een
-- harde deny. Ná deze fix wérken ze: een admin kan public.users dan
-- rechtstreeks vanuit de browser schrijven met de anon-key + zijn JWT.
-- Gebruikersbeheer loopt in de app volledig via Express met de service-role,
-- dus dat client-pad is niet nodig. Wil je het dicht houden, dan is dit de
-- opruiming (aparte migratie, bewuste beslissing):
--
--   drop policy if exists users_insert_admin_only on public.users;
--   drop policy if exists users_update_admin_only on public.users;
--   drop policy if exists users_delete_admin_only on public.users;
