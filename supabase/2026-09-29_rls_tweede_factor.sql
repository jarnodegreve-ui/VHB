-- 2026-09-29, controle-ronde security, nummer 7: twee-stapsverificatie geldt
-- alleen in de Express-API, niet op de database.
--
-- DOEL
--   De API eist voor planner en admin een sessie op niveau aal2
--   (api/middleware.ts, MFA_STAF=aan). De leespolicies in de database keken
--   alleen naar rol en isactive. Wie enkel het wachtwoord van een planner of
--   admin had, kon met de publieke anon key uit de bundel rechtstreeks via
--   PostgREST lezen: alle rijen van users, leave (ook ziekte), swaps,
--   planning, planning_matrix_rows en planning_matrix_import_history, zonder
--   ooit de code van de authenticator in te voeren.
--
-- WAT HET RAAKT
--   Deel A (laag risico): 26 tabellen die de browser nooit rechtstreeks leest
--     of volgt. SELECT voor authenticated wordt ingetrokken en de 8
--     leespolicies op die tabellen verdwijnen. Daarna: RLS aan, geen policies,
--     geen rechten voor anon of authenticated; alleen de API (service_role)
--     komt er nog bij. Zelfde patroon als mail_log, user_presence en
--     2026-09-16_rls_loops_voertuigen_oud.sql.
--   Deel B: de twee Realtime-tabellen met een staf-tak (leave, swaps). De
--     staf-tak eist voortaan aal2, maar alleen voor een account met een
--     bevestigde tweede factor. De eigen-rijen-tak blijft letterlijk gelijk.
--     Nieuw: de hulpfunctie public.current_app_user_mfa_ok().
--   Geen tabellen, kolommen of data gewijzigd. service_role wordt niet
--   aangeraakt. De Realtime-publicatie blijft zoals ze is.
--
-- WAT ER NIET VERANDERT
--   diversions, updates, planning_version en meldingen houden hun grant en
--   hun policy. Ze hebben geen staf-tak: elk actief account leest daar
--   hetzelfde (meldingen: alleen de eigen rijen), dus een tweede factor
--   schermt er niets extra af.
--
-- WAT DIT NIET DEKT (eerlijk)
--   1. De toestel-whitelist blijft alleen in de API. Een chauffeur op een niet
--      goedgekeurd of ingetrokken toestel leest via PostgREST nog altijd zijn
--      eigen verlof, zijn eigen ruilen, zijn eigen meldingen, de omleidingen
--      en de updates. Zijn eigen planning en de dienstenlijst niet meer (deel A).
--   2. Staf ZONDER bevestigde factor leest leave en swaps zoals voorheen. De
--      database kent MFA_STAF niet. Zie de telquery onderaan.
--   3. Het aanwezigheidskanaal (policies op realtime.messages) eist geen
--      aal2: de client sluit aan vóór het codescherm, een strengere policy
--      zou de lijst "wie is er nu" breken zolang de client niet mee wijzigt.
--
-- BEWIJS DAT DE BROWSER DE TABELLEN VAN DEEL A NIET LEEST
--   Gezocht in src/, shared/, public/ en index.html op commit 3926fee:
--     Z1  grep -rnE "\.from\(" zonder Array/Object/Buffer/Uint8Array.from
--           1 treffer: src/lib/realtime.ts:74, tabel planning_version
--     Z2  grep -rnE "postgres_changes" en de tabelnamen erachter
--           6 tabellen, alle in src/lib/realtime.ts: leave, meldingen, swaps,
--           diversions, updates, planning_version
--     Z3  grep -rnE "\.rpc\("                                0 treffers
--     Z4  grep -rnE "\.storage\b" (zonder navigator.storage) 0 treffers
--     Z5  grep -rnE "(rest|realtime|storage|functions|graphql)/v1"
--           alleen testbestanden, en daar alleen ondertekende PDF-links
--           (object/sign), die lopen niet via de rol van de gebruiker
--     Z6  grep -rnE "supabase\.(schema|functions|graphql)"   0 treffers
--     Z7  per tabel: (from\(|table:) gevolgd door de tabelnaam, buiten tests
--           0 treffers voor elk van de 26 tabellen hieronder
--     Z8  git log -G "supabase[!?]?\.from\(" -- src
--           1 commit in de hele historie (a45b7aa, planning_version); er is
--           dus ook geen oude bundel in omloop die een tabel rechtstreeks las
--   De andere importeurs van src/lib/supabase.ts gebruiken alleen
--   supabase.auth. De API leest met de service_role (api/db.ts), de
--   RLS-hulpfuncties zijn security definer en lezen users als eigenaar.
--
-- VOLGORDE
--   1. Eerst staging (vhb-portaal-staging). Dan de schermen nalopen, zie het
--      PR-rapport: live-updates van verlof, dienstruil, omleidingen, updates,
--      meldingen en planning, als chauffeur en als staf met en zonder 2FA.
--   2. Dan productie.
--   3. Meteen daarna, vóór 06:00 de volgende ochtend:
--        node --env-file=.env.local scripts/beleid-drift.mjs
--      Verwacht "Geen drift": supabase/beleid-snapshot.json in dezelfde PR
--      beschrijft al de stand ná deze migratie. Meldt het script toch drift,
--      draai het dan met --update en commit het bestand.
--   4. De PR pas mergen nadat productie gedraaid is. Andersom is de
--      nachtelijke drift-check rood.
--
-- WANNEER
--   Op een rustig moment, niet tijdens een planning-import: de migratie
--   vraagt kort een exclusief slot op tien tabellen (de acht met een policy
--   uit deel A, plus leave en swaps). Ze duurt zelf minder dan een seconde.
--
-- VEREIST
--   PostgreSQL 17 of hoger (het recht MAINTAIN in de post-conditie van deel
--   A). Op een oudere versie faalt die post-conditie en rolt alles terug.
--   Staging en productie draaien op 17.
--
-- IDEMPOTENT
--   revoke, drop policy if exists, create or replace en drop + create van de
--   twee policies zijn herhaalbaar. Eén transactie: faalt een voorwaarde of
--   een post-conditie, dan rolt alles terug en is er niets gewijzigd.

begin;

-- drop policy en create policy vragen kort een exclusief slot op de tabel.
-- Staat er een lange query voor, dan wacht deze migratie, en achter haar
-- wacht elke lezer van die tabel (ook de API). Na 5 seconden geven we het
-- op: de transactie rolt terug, er is niets gewijzigd, opnieuw draaien mag.
set local lock_timeout = '5s';

-- === Voorwaarden ===========================================================
-- De hulpfuncties uit 2026-09-05_users_authid.sql moeten er staan, en de
-- SQL-Editor-rol moet auth.mfa_factors kunnen lezen: de nieuwe functie draait
-- als haar eigenaar.
do $$
begin
  if to_regprocedure('public.current_app_user_role()') is null
     or to_regprocedure('public.current_app_user_id()') is null then
    raise exception 'voorwaarde faalt: current_app_user_role() of current_app_user_id() ontbreekt (draai eerst 2026-09-05_users_authid.sql)';
  end if;
  if to_regclass('auth.mfa_factors') is null then
    raise exception 'voorwaarde faalt: auth.mfa_factors bestaat niet in dit project';
  end if;
  if not pg_catalog.has_table_privilege(current_user, 'auth.mfa_factors', 'select') then
    raise exception 'voorwaarde faalt: rol % mag auth.mfa_factors niet lezen, de hulpfunctie zou bij elke lezing falen', current_user;
  end if;
  if to_regclass('public.leave') is null or to_regclass('public.swaps') is null then
    raise exception 'voorwaarde faalt: public.leave of public.swaps ontbreekt';
  end if;
end
$$;

-- === DEEL A: tabellen die de browser niet leest of volgt ====================
-- Bewijs per tabel: zoekopdracht Z7 in de kop, nul treffers. Een tabel die in
-- deze omgeving niet bestaat (chauffeur_ids staat alleen op productie) wordt
-- overgeslagen.
do $$
declare
  t text;
begin
  foreach t in array array[
    -- met een leespolicy die hieronder verdwijnt
    'users',                           -- users_select_self_or_staff
    'planning',                        -- planning_read_authenticated
    'planning_matrix_rows',            -- planning_matrix_rows_staff_only
    'planning_matrix_import_history',  -- planning_matrix_import_history_staff_only
    'chauffeur_ids',                   -- chauffeur_ids_staff_only
    'planning_codes',                  -- planning_codes_read_authenticated
    'services',                        -- services_read_authenticated
    'ritblaadje',                      -- "Authenticated can read ritblaadje"
    -- zonder policy: RLS hield ze al dicht, de grant was een los eindje
    'activity_log',
    'app_settings',
    'client_errors',
    'coverage_expectations',
    'ocpi_cdrs',
    'ocpi_connectors',
    'ocpi_dagpieken',
    'ocpi_evses',
    'ocpi_locations',
    'ocpi_power_snapshots',
    'ocpi_registration',
    'ocpi_sessions',
    'planning_notes',
    'push_subscriptions',
    'update_reads',
    'user_devices',
    'user_documents',
    'user_expiries'
  ]
  loop
    if to_regclass('public.' || t) is null then
      raise notice 'deel A: tabel % bestaat niet in deze omgeving, overgeslagen', t;
      continue;
    end if;
    -- RLS staat op productie overal al aan (beleid-snapshot.json). Alleen
    -- aanzetten waar het uit staat: alter table vraagt een exclusief slot.
    if not exists (
      select 1 from pg_catalog.pg_tables
      where schemaname = 'public' and tablename = t and rowsecurity
    ) then
      execute format('alter table public.%I enable row level security', t);
      raise notice 'deel A: RLS aangezet op %', t;
    end if;
    execute format('revoke all on table public.%I from anon, authenticated', t);
  end loop;
end
$$;

-- De leespolicies zelf. drop policy if exists faalt op een ontbrekende tabel,
-- vandaar de bestaanscheck per tabel.
-- Volgorde: planning_matrix_rows VÓÓR planning, zoals de import
-- (replace_planning_and_matrix_periode) ze neemt. Omgekeerd kunnen de
-- migratie en een lopende import op elkaars slot wachten (SQL-review 29-09).
do $$
begin
  if to_regclass('public.users') is not null then
    execute 'drop policy if exists users_select_self_or_staff on public.users';
  end if;
  if to_regclass('public.planning_matrix_rows') is not null then
    execute 'drop policy if exists planning_matrix_rows_staff_only on public.planning_matrix_rows';
  end if;
  if to_regclass('public.planning') is not null then
    execute 'drop policy if exists "planning_read_authenticated" on public.planning';
  end if;
  if to_regclass('public.planning_matrix_import_history') is not null then
    execute 'drop policy if exists planning_matrix_import_history_staff_only on public.planning_matrix_import_history';
  end if;
  if to_regclass('public.chauffeur_ids') is not null then
    execute 'drop policy if exists chauffeur_ids_staff_only on public.chauffeur_ids';
  end if;
  if to_regclass('public.planning_codes') is not null then
    execute 'drop policy if exists "planning_codes_read_authenticated" on public.planning_codes';
  end if;
  if to_regclass('public.services') is not null then
    execute 'drop policy if exists "services_read_authenticated" on public.services';
  end if;
  if to_regclass('public.ritblaadje') is not null then
    execute 'drop policy if exists "Authenticated can read ritblaadje" on public.ritblaadje';
  end if;
end
$$;

-- === DEEL B: tabellen die Realtime volgt, staf-tak met tweede factor ========
-- "Voldoet deze sessie aan de tweede factor?" Waar als de sessie op aal2
-- staat, of als het account geen bevestigde factor heeft. Wie geen
-- authenticator instelde heeft vandaag ook geen tweede stap en verliest dus
-- niets. Wie er wel een heeft, moet de code ingevoerd hebben.
--
-- Security definer omdat een policy met de rechten van de aanroeper draait en
-- authenticated auth.mfa_factors niet mag lezen. De functie lekt niets: geen
-- argumenten, dus niet te richten op een ander account, en het antwoord is
-- één boolean over de eigen sessie. Het geheim van de factor wordt nooit
-- geselecteerd. Een bevestigde factor verwijderen kan alleen vanuit een
-- aal2-sessie (Supabase Auth), dus wie enkel het wachtwoord heeft kan de
-- factor niet wegnemen om hier langs te komen.
--
-- Bewust geen commentaar binnen de functietekst: op productie staan de
-- bestaande hulpfuncties zonder hun commentaarregels (zie
-- beleid-snapshot.json), en de drift-check vergelijkt die tekst letterlijk.
-- Zonder commentaar is de tekst in elk geval dezelfde.
create or replace function public.current_app_user_mfa_ok()
  returns boolean
  language sql
  stable
  security definer
  set search_path = ''
as $function$
  select
    coalesce((select auth.jwt()) ->> 'aal', 'aal1') = 'aal2'
    or not exists (
      select 1
      from auth.mfa_factors f
      where f.user_id = (select auth.uid())
        and f.status = 'verified'
    )
$function$;

comment on function public.current_app_user_mfa_ok() is
  'RLS-hulp: waar als de sessie aal2 is of het account geen bevestigde tweede factor heeft. Zegt alleen iets over de aanroeper zelf.';

revoke all on function public.current_app_user_mfa_ok() from public, anon;
grant execute on function public.current_app_user_mfa_ok() to authenticated, service_role;

-- Verlof. De tweede tak (eigen rijen) is letterlijk die van 2026-09-05.
drop policy if exists leave_read_involved_or_staff on public.leave;
create policy leave_read_involved_or_staff
  on public.leave for select
  to authenticated
  using (
    (
      (select public.current_app_user_role()) in ('planner', 'admin')
      and (select public.current_app_user_mfa_ok())
    )
    or leave.userid::text = (select public.current_app_user_id())::text
  );

-- Dienstruil. De eigen-rijen-takken zijn letterlijk die van 2026-09-05.
drop policy if exists swaps_read_involved_or_staff on public.swaps;
create policy swaps_read_involved_or_staff
  on public.swaps for select
  to authenticated
  using (
    (
      (select public.current_app_user_role()) in ('planner', 'admin')
      and (select public.current_app_user_mfa_ok())
    )
    or swaps.requesterid::text = (select public.current_app_user_id())::text
    or swaps.targetdriverid::text = (select public.current_app_user_id())::text
  );

-- === Post-condities, binnen de transactie ===================================
do $$
declare
  t text;
  n int;
  ok boolean;
begin
  -- Deel A: geen enkel recht meer voor anon of authenticated, ook niet via
  -- PUBLIC (has_table_privilege telt dat mee), en de API komt er nog bij.
  foreach t in array array[
    'users', 'planning', 'planning_matrix_rows', 'planning_matrix_import_history',
    'chauffeur_ids', 'planning_codes', 'services', 'ritblaadje',
    'activity_log', 'app_settings', 'client_errors', 'coverage_expectations',
    'ocpi_cdrs', 'ocpi_connectors', 'ocpi_dagpieken', 'ocpi_evses', 'ocpi_locations',
    'ocpi_power_snapshots', 'ocpi_registration', 'ocpi_sessions',
    'planning_notes', 'push_subscriptions', 'update_reads',
    'user_devices', 'user_documents', 'user_expiries'
  ]
  loop
    if to_regclass('public.' || t) is null then
      continue;
    end if;
    -- Een lijst rechten betekent "minstens één ervan": geen enkel recht mag overblijven.
    if pg_catalog.has_table_privilege('authenticated', 'public.' || quote_ident(t), 'select, insert, update, delete, truncate, references, trigger, maintain')
       or pg_catalog.has_table_privilege('anon', 'public.' || quote_ident(t), 'select, insert, update, delete, truncate, references, trigger, maintain') then
      raise exception 'post-conditie faalt: anon of authenticated heeft nog een recht op public.% (grant van een andere rol of aan PUBLIC?)', t;
    end if;
    if not pg_catalog.has_table_privilege('service_role', 'public.' || quote_ident(t), 'select') then
      raise exception 'post-conditie faalt: service_role kan public.% niet lezen, de API zou breken', t;
    end if;
    if not exists (
      select 1 from pg_catalog.pg_tables
      where schemaname = 'public' and tablename = t and rowsecurity
    ) then
      raise exception 'post-conditie faalt: RLS staat uit op public.%', t;
    end if;
    select count(*) into n from pg_catalog.pg_policies where schemaname = 'public' and tablename = t;
    if n > 0 then
      raise notice 'let op: public.% heeft nog % policy(s) met een onbekende naam; zonder grant zijn ze zonder effect', t, n;
    end if;
  end loop;

  -- Realtime mag niets kwijt zijn: de zes gevolgde tabellen houden hun
  -- SELECT en een leespolicy, anders komt er geen enkel event meer aan.
  foreach t in array array['leave', 'swaps', 'diversions', 'updates', 'meldingen', 'planning_version']
  loop
    if to_regclass('public.' || t) is null then
      raise exception 'post-conditie faalt: Realtime-tabel public.% ontbreekt', t;
    end if;
    if not pg_catalog.has_table_privilege('authenticated', 'public.' || quote_ident(t), 'select') then
      raise exception 'post-conditie faalt: authenticated mist SELECT op public.%, live-updates zouden stilvallen', t;
    end if;
    if not exists (
      select 1 from pg_catalog.pg_policies
      where schemaname = 'public' and tablename = t and cmd = 'SELECT'
    ) then
      raise exception 'post-conditie faalt: public.% heeft geen leespolicy meer', t;
    end if;
  end loop;

  -- De nieuwe functie: niet voor anon, wel voor authenticated, en ze werkt
  -- (leest auth.mfa_factors als eigenaar). Zonder sessie is er geen factor,
  -- dus waar.
  if pg_catalog.has_function_privilege('anon', 'public.current_app_user_mfa_ok()', 'execute') then
    raise exception 'post-conditie faalt: anon mag current_app_user_mfa_ok() uitvoeren';
  end if;
  if not pg_catalog.has_function_privilege('authenticated', 'public.current_app_user_mfa_ok()', 'execute') then
    raise exception 'post-conditie faalt: authenticated mag current_app_user_mfa_ok() niet uitvoeren, de policies zouden falen';
  end if;
  select public.current_app_user_mfa_ok() into ok;
  if ok is null then
    raise exception 'post-conditie faalt: current_app_user_mfa_ok() gaf geen antwoord';
  end if;

  -- De twee policies dragen de nieuwe voorwaarde.
  select count(*) into n
  from pg_catalog.pg_policies
  where schemaname = 'public'
    and policyname in ('leave_read_involved_or_staff', 'swaps_read_involved_or_staff')
    and qual like '%current_app_user_mfa_ok%';
  if n <> 2 then
    raise exception 'post-conditie faalt: % van 2 policies eisen de tweede factor', n;
  end if;
end
$$;

-- === Ziet de eigenaar van elke hulpfunctie haar tabel? (SQL-review 29-09) ===
-- De functionele proef hieronder zoekt zelf een staflid met een bevestigde
-- factor. Ziet de rol die deze migratie draait auth.mfa_factors door RLS
-- leeg, dan vindt de proef niemand en slaat ze die stap over, terwijl de
-- hulpfunctie om dezelfde reden altijd waar zou geven. Deze controle leest
-- alleen catalogi en hangt niet af van testdata: elke hulpfunctie moet
-- security definer zijn, en haar eigenaar moet de tabel mogen lezen en ze
-- ook door RLS heen zien. Bewust streng: bij twijfel weigert ze.
do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure::text as functie, o.rolname as eigenaar, c.oid::regclass::text as tabel
    from (values
      ('public.current_app_user_role()', 'public.users'),
      ('public.current_app_user_id()',   'public.users'),
      ('public.current_app_user_mfa_ok()', 'auth.mfa_factors')
    ) v(functie, tabel)
    join pg_catalog.pg_proc p on p.oid = pg_catalog.to_regprocedure(v.functie)
    join pg_catalog.pg_roles o on o.oid = p.proowner
    join pg_catalog.pg_class c on c.oid = pg_catalog.to_regclass(v.tabel)
    where not p.prosecdef
       or not pg_catalog.has_table_privilege(o.oid, c.oid, 'select')
       or (c.relrowsecurity
           and not (o.rolsuper or o.rolbypassrls
                    or (o.oid = c.relowner and not c.relforcerowsecurity)))
  loop
    raise exception 'post-conditie faalt: % (eigenaar %) is geen definer of ziet % niet door RLS of rechten; ze zou stil een leeg resultaat geven', r.functie, r.eigenaar, r.tabel;
  end loop;
end
$$;

-- === Functionele proef als de rol authenticated (SQL-review 29-09) ==========
-- De controles hierboven lezen rechten en catalogi. Dat bewijst niet dat de
-- tweede factor ook echt afgedwongen wordt: draait de hulpfunctie als een
-- eigenaar die auth.mfa_factors door RLS leeg ziet, dan geeft ze altijd waar
-- en blijft alles hierboven groen. Daarom hier het gedrag zelf, met
-- nagebootste claims, als de rol die de browser gebruikt:
--   1. een actieve chauffeur krijgt zijn eigen rol en id terug van de
--      bestaande hulpfuncties (ze lezen users, waar hij zelf niet meer bij
--      mag) en leest planning_version; zo niet vallen de live-updates stil;
--   2. een staflid op aal2 krijgt zijn rol terug;
--   3. een staflid met een bevestigde factor krijgt op aal1 mfa_ok = false.
-- Is er in deze omgeving geen geschikt account (staging zonder ingeschreven
-- staflid), dan meldt de proef dat met een notice en slaat ze die stap over.
-- Er wordt niets geschreven; de claims gelden alleen binnen deze transactie.
do $$
declare
  staf record;
  chauffeur record;
  factor_uid uuid;
  rol text;
  eigen text;
  ok boolean;
  n int;
begin
  select u.id, u.role, u.authid into staf from public.users u
   where u.isactive and u.authid is not null and u.role in ('planner', 'admin') order by u.id limit 1;
  select u.id, u.role, u.authid into chauffeur from public.users u
   where u.isactive and u.authid is not null and u.role not in ('planner', 'admin') order by u.id limit 1;
  select f.user_id into factor_uid from auth.mfa_factors f
   join public.users u on u.authid = f.user_id
   where f.status = 'verified' and u.isactive and u.role in ('planner', 'admin') limit 1;

  if chauffeur.authid is not null then
    perform set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'sub', chauffeur.authid, 'aal', 'aal1')::text, true);
    set local role authenticated;
    select public.current_app_user_role(), public.current_app_user_id() into rol, eigen;
    select count(*) into n from public.planning_version;
    reset role;
    if rol is distinct from chauffeur.role or eigen is distinct from chauffeur.id then
      raise exception 'post-conditie faalt: hulpfuncties geven als authenticated %/% voor %, live-updates zouden stilvallen', rol, eigen, chauffeur.id;
    end if;
    if n = 0 then
      raise exception 'post-conditie faalt: een actieve chauffeur leest planning_version niet meer';
    end if;
  else
    raise notice 'functionele proef chauffeur overgeslagen: geen actief gekoppeld account';
  end if;

  if staf.authid is not null then
    perform set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'sub', staf.authid, 'aal', 'aal2')::text, true);
    set local role authenticated;
    select public.current_app_user_role() into rol;
    reset role;
    if rol is distinct from staf.role then
      raise exception 'post-conditie faalt: current_app_user_role() geeft % voor staflid %', rol, staf.id;
    end if;
  else
    raise notice 'functionele proef staf overgeslagen: geen actief gekoppeld stafaccount';
  end if;

  if factor_uid is not null then
    perform set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'sub', factor_uid, 'aal', 'aal1')::text, true);
    set local role authenticated;
    select public.current_app_user_mfa_ok() into ok;
    reset role;
    if ok is distinct from false then
      raise exception 'post-conditie faalt: staflid met bevestigde factor krijgt op aal1 mfa_ok = %, de tweede factor wordt niet afgedwongen', ok;
    end if;
  else
    raise notice 'proef tweede factor overgeslagen: geen staflid met een bevestigde factor in deze omgeving';
  end if;
  perform set_config('request.jwt.claims', '', true);
end
$$;

commit;

-- === POST-CONDITIE VOOR JARNO (los draaien, leest alleen catalogi) =========
--
-- 1) Wie mag nog wat lezen. Verwacht op productie: exact 6 rijen, elk met
--    rechten = SELECT en policies = 1:
--    diversions, leave, meldingen, planning_version, swaps, updates.
--
-- select g.table_name as tabel,
--        string_agg(distinct g.privilege_type, ',' order by g.privilege_type) as rechten,
--        (select count(*) from pg_policies p
--          where p.schemaname = 'public' and p.tablename = g.table_name) as policies
-- from information_schema.role_table_grants g
-- where g.table_schema = 'public' and g.grantee in ('anon', 'authenticated')
-- group by g.table_name
-- order by g.table_name;
--
-- 2) De functie en de twee policies. Verwacht: (false, true) en 2 rijen waarin
--    current_app_user_mfa_ok voorkomt.
--
-- select has_function_privilege('anon', 'public.current_app_user_mfa_ok()', 'execute') as anon,
--        has_function_privilege('authenticated', 'public.current_app_user_mfa_ok()', 'execute') as authenticated;
-- select tablename, policyname, qual from pg_policies
-- where schemaname = 'public' and tablename in ('leave', 'swaps');
--
-- 3) Hoeveel actieve stafleden hebben een bevestigde tweede factor (alleen
--    aantallen). Wie in "zonder" zit leest leave en swaps zoals voorheen.
--
-- select count(*) filter (where heeft) as staf_met_2fa,
--        count(*) filter (where not heeft) as staf_zonder_2fa
-- from (
--   select exists (
--     select 1 from auth.mfa_factors f
--     where f.user_id = u.authid and f.status = 'verified'
--   ) as heeft
--   from public.users u
--   where u.isactive and u.role in ('planner', 'admin')
-- ) s;
--
-- 4) Gedrag nabootsen voor één staflid met 2FA. Vul de Auth-uid in (kolom
--    users.authid van dat account). Het blok rolt zichzelf terug.
--    Verwacht met "aal":"aal1": mfa_ok = false, verlof = alleen de eigen rijen.
--    Verwacht met "aal":"aal2": mfa_ok = true, verlof = alle rijen.
--
-- begin;
-- select set_config('request.jwt.claims',
--   '{"role":"authenticated","sub":"<auth-uid>","aal":"aal1"}', true);
-- set local role authenticated;
-- select public.current_app_user_mfa_ok() as mfa_ok,
--        (select count(*) from public.leave) as verlof,
--        (select count(*) from public.swaps) as ruilen;
-- rollback;

-- ============================================================================
-- ============================================================================
-- TERUGDRAAIEN
-- ============================================================================
-- Alleen draaien als live-updates of een scherm stuk blijken en de oorzaak
-- hier ligt. Zet de stand van vóór deze migratie terug: de grants, de acht
-- leespolicies van deel A, de twee policies van deel B zonder tweede factor,
-- en verwijdert de hulpfunctie. Idempotent. Daarna opnieuw
--   node --env-file=.env.local scripts/beleid-drift.mjs --update
-- en de snapshot committen (of de PR met de snapshot terugdraaien).
-- Haal de twee streepjes aan het begin van elke regel weg en draai het blok
-- in één keer.
-- ============================================================================
--
-- begin;
--
-- do $$
-- declare
--   t text;
-- begin
--   foreach t in array array[
--     'users', 'planning', 'planning_matrix_rows', 'planning_matrix_import_history',
--     'chauffeur_ids', 'planning_codes', 'services', 'ritblaadje',
--     'activity_log', 'app_settings', 'client_errors', 'coverage_expectations',
--     'ocpi_cdrs', 'ocpi_connectors', 'ocpi_dagpieken', 'ocpi_evses', 'ocpi_locations',
--     'ocpi_power_snapshots', 'ocpi_registration', 'ocpi_sessions',
--     'planning_notes', 'push_subscriptions', 'update_reads',
--     'user_devices', 'user_documents', 'user_expiries'
--   ]
--   loop
--     if to_regclass('public.' || t) is null then
--       continue;
--     end if;
--     execute format('grant select on table public.%I to authenticated', t);
--   end loop;
-- end
-- $$;
--
-- drop policy if exists users_select_self_or_staff on public.users;
-- create policy users_select_self_or_staff
--   on public.users for select
--   to authenticated
--   using (
--     (
--       isactive
--       and (
--         authid = (select auth.uid())
--         or (authid is null and lower(email) = lower((select auth.email())))
--       )
--     )
--     or (select public.current_app_user_role()) in ('planner', 'admin')
--   );
--
-- -- planning_matrix_rows vóór planning, zoals de import ze neemt.
-- drop policy if exists planning_matrix_rows_staff_only on public.planning_matrix_rows;
-- create policy planning_matrix_rows_staff_only
--   on public.planning_matrix_rows for select
--   to authenticated
--   using ((select public.current_app_user_role()) in ('planner', 'admin'));
--
-- drop policy if exists "planning_read_authenticated" on public.planning;
-- create policy "planning_read_authenticated"
--   on public.planning for select
--   to authenticated
--   using (
--     (select public.current_app_user_role()) in ('planner', 'admin')
--     or "driverId" = (select public.current_app_user_id())
--   );
--
-- drop policy if exists planning_matrix_import_history_staff_only on public.planning_matrix_import_history;
-- create policy planning_matrix_import_history_staff_only
--   on public.planning_matrix_import_history for select
--   to authenticated
--   using ((select public.current_app_user_role()) in ('planner', 'admin'));
--
-- do $$
-- begin
--   if to_regclass('public.chauffeur_ids') is not null then
--     execute 'drop policy if exists chauffeur_ids_staff_only on public.chauffeur_ids';
--     execute $p$
--       create policy chauffeur_ids_staff_only
--         on public.chauffeur_ids for select
--         to authenticated
--         using ((select public.current_app_user_role()) in ('planner', 'admin'))
--     $p$;
--   end if;
-- end
-- $$;
--
-- drop policy if exists "planning_codes_read_authenticated" on public.planning_codes;
-- create policy "planning_codes_read_authenticated"
--   on public.planning_codes for select
--   to authenticated
--   using ((select public.is_active_app_user()));
--
-- drop policy if exists "services_read_authenticated" on public.services;
-- create policy "services_read_authenticated"
--   on public.services for select
--   to authenticated
--   using ((select public.is_active_app_user()));
--
-- drop policy if exists "Authenticated can read ritblaadje" on public.ritblaadje;
-- create policy "Authenticated can read ritblaadje"
--   on public.ritblaadje for select
--   to authenticated
--   using ((select public.is_active_app_user()));
--
-- drop policy if exists leave_read_involved_or_staff on public.leave;
-- create policy leave_read_involved_or_staff
--   on public.leave for select
--   to authenticated
--   using (
--     (select public.current_app_user_role()) in ('planner', 'admin')
--     or leave.userid::text = (select public.current_app_user_id())::text
--   );
--
-- drop policy if exists swaps_read_involved_or_staff on public.swaps;
-- create policy swaps_read_involved_or_staff
--   on public.swaps for select
--   to authenticated
--   using (
--     (select public.current_app_user_role()) in ('planner', 'admin')
--     or swaps.requesterid::text = (select public.current_app_user_id())::text
--     or swaps.targetdriverid::text = (select public.current_app_user_id())::text
--   );
--
-- -- Pas nu de functie: zolang een policy haar gebruikt weigert Postgres de
-- -- drop (bewust zonder cascade).
-- drop function if exists public.current_app_user_mfa_ok();
--
-- commit;
