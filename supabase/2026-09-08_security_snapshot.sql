-- 2026-09-08 — Beveiligingssnapshot voor de nachtelijke drift-check
-- (verbeterronde 07-09, nr. 10).
--
-- De security-audit van 07-09 kon niet nagaan welke RLS-policies, grants en
-- helperfuncties écht live staan: de repo bevat alleen migraties die met de
-- hand in de SQL Editor gedraaid worden (productie én staging), dus tussen
-- "wat in git staat" en "wat de database doet" zit geen enkele controle.
-- Deze functie geeft de volledige beveiligingsstand terug als één
-- deterministisch gesorteerd jsonb-document:
--   (a) per tabel in public: RLS aan/uit en force-RLS;
--   (b) alle policies op schema public plus die op realtime.messages
--       (presence-kanaal, 2026-09-07);
--   (c) tabelgrants voor anon/authenticated/service_role/PUBLIC op schema public;
--   (d) definitie (pg_get_functiondef) en security-definer-vlag van de
--       RLS-helpers (current_app_user_role, current_app_user_id,
--       is_active_app_user, security_snapshot zelf) en van élke andere
--       security-definer-functie in public;
--   (e) per zo'n functie: welke van anon/authenticated execute-recht heeft.
-- scripts/beleid-drift.mjs haalt dit document via PostgREST op, normaliseert
-- het en vergelijkt het met supabase/beleid-snapshot.json (nachtelijk in CI,
-- .github/workflows/beleid-drift.yml). Verschil = rode run = mail.
--
-- Alleen de service-role mag de functie aanroepen: hij toont de volledige
-- policy-teksten en functiebodies, en dat hoort niet bij een ingelogde
-- gebruiker terecht te komen. Leest uitsluitend catalogi (stable), schrijft
-- niets.
--
-- Draaien in de Supabase SQL Editor (productie én staging). Idempotent:
-- create or replace + revoke/grant zijn herhaalbaar. Niet destructief: geen
-- tabellen, kolommen, policies of data geraakt; alleen één nieuwe functie.

begin;

create or replace function public.security_snapshot()
  returns jsonb
  language sql
  stable
  security definer
  set search_path = ''
as $function$
  select jsonb_build_object(
    'versie', 1,

    -- (a) RLS-stand per tabel (gewone en gepartitioneerde tabellen).
    'tabellen', coalesce((
      select jsonb_agg(jsonb_build_object(
          'tabel', c.relname::text,
          'rls', c.relrowsecurity,
          'force_rls', c.relforcerowsecurity
        ) order by c.relname)
      from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relkind in ('r', 'p')
    ), '[]'::jsonb),

    -- (b) Policies: schema public + realtime.messages (presence-topic).
    'policies', coalesce((
      select jsonb_agg(jsonb_build_object(
          'schema', p.schemaname::text,
          'tabel', p.tablename::text,
          'policy', p.policyname::text,
          'permissive', p.permissive,
          'cmd', p.cmd,
          'rollen', (
            select coalesce(jsonb_agg(r::text order by r::text), '[]'::jsonb)
            from unnest(p.roles) as r
          ),
          'using', p.qual,
          'with_check', p.with_check
        ) order by p.schemaname, p.tablename, p.policyname)
      from pg_catalog.pg_policies p
      where p.schemaname = 'public'
         or (p.schemaname = 'realtime' and p.tablename = 'messages')
    ), '[]'::jsonb),

    -- (c) Tabelgrants voor de drie PostgREST-rollen én PUBLIC (een grant aan
    --     PUBLIC geeft anon/authenticated effectief hetzelfde recht, SQL-review
    --     07-09). role_table_grants toont grants waarvan de grantor of grantee
    --     een actieve rol is; als security definer draait dit als de eigenaar
    --     (postgres, de SQL-Editor-rol), en die is de grantor van alles in
    --     public.
    'grants', coalesce((
      select jsonb_agg(jsonb_build_object(
          'tabel', g.table_name::text,
          'grantee', g.grantee::text,
          'privilege', g.privilege_type::text,
          'grantable', g.is_grantable = 'YES'
        ) order by g.table_name, g.grantee, g.privilege_type, g.is_grantable)
      from information_schema.role_table_grants g
      where g.table_schema = 'public'
        and g.grantee in ('PUBLIC', 'anon', 'authenticated', 'service_role')
    ), '[]'::jsonb),

    -- (d)+(e) RLS-helpers en alle security-definer-functies in public, met
    --         de volledige definitie (dus ook `set search_path`) en de
    --         effectieve execute-rechten van anon en authenticated
    --         (has_function_privilege telt ook een grant aan PUBLIC mee).
    'functies', coalesce((
      select jsonb_agg(jsonb_build_object(
          'functie', f.naam,
          'security_definer', f.prosecdef,
          'definitie', pg_catalog.pg_get_functiondef(f.oid),
          'execute', (
            select coalesce(jsonb_agg(r::text order by r::text), '[]'::jsonb)
            from unnest(array['anon', 'authenticated']::name[]) as r
            where pg_catalog.has_function_privilege(r, f.oid, 'execute')
          )
        ) order by f.naam collate "C")
      from (
        select p.oid,
               p.prosecdef,
               p.proname::text || '(' || pg_catalog.pg_get_function_identity_arguments(p.oid) || ')' as naam
        from pg_catalog.pg_proc p
        join pg_catalog.pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.prokind in ('f', 'p')
          and (
            p.prosecdef
            or p.proname in ('current_app_user_role', 'current_app_user_id', 'is_active_app_user', 'security_snapshot')
          )
      ) f
    ), '[]'::jsonb)
  )
$function$;

comment on function public.security_snapshot() is
  'Beveiligingsstand (RLS, policies, grants, definer-functies) als jsonb voor scripts/beleid-drift.mjs. Alleen service_role.';

-- Alleen de service-role (CI-script) mag dit lezen; PostgREST weigert de
-- RPC dan voor anon/authenticated met 42501.
revoke all on function public.security_snapshot() from public, anon, authenticated;
grant execute on function public.security_snapshot() to service_role;

commit;

-- PostgREST leest zijn schema-cache normaal zelf opnieuw na DDL (Supabase's
-- event trigger); dit is de expliciete variant voor als de RPC meteen na het
-- draaien nog PGRST202 ("function not found") geeft.
notify pgrst, 'reload schema';

-- Post-conditie (handmatig, in de SQL Editor):
--   select jsonb_pretty(public.security_snapshot());
--     → één document met tabellen/policies/grants/functies, gesorteerd.
--   select pg_catalog.has_function_privilege('anon', 'public.security_snapshot()', 'execute'),
--          pg_catalog.has_function_privilege('authenticated', 'public.security_snapshot()', 'execute'),
--          pg_catalog.has_function_privilege('service_role', 'public.security_snapshot()', 'execute');
--     → (false, false, true).
-- Daarna lokaal de eerste snapshot maken en committen (README › Beleidssnapshot):
--   node --env-file=.env.local scripts/beleid-drift.mjs --update
