-- Ruwe planningmatrix, importhistoriek en chauffeur-ID-mapping staff-only maken.
-- Draaien in de Supabase SQL Editor.
--
-- Waarom: planning_matrix_rows.assignments bevat afwezigheidscodes, waaronder
-- 'ziek' (86 rijen op 31-07-2026). Ziekte is een bijzondere categorie
-- persoonsgegevens (AVG art. 9). De leave-tabel is al afgeschermd met
-- leave_read_involved_or_staff — via de matrix lekte diezelfde informatie
-- alsnog naar elke ingelogde chauffeur.
--
-- Dit is GEEN uitspraak over de planning zelf: `planning` en
-- /api/month-planning blijven bewust voor iedereen leesbaar — chauffeurs
-- moeten elkaars rooster zien om te kunnen ruilen (availability-matching in
-- de ruilwizard). Alleen de rúwe importlaag gaat dicht.
--
-- Veilig: de frontend leest deze drie tabellen nergens rechtstreeks via de
-- Supabase-client (0× supabase.from() in src/), alles loopt via Express met
-- de service-role key, die RLS bypasst. src/App.tsx slaat refetchMatrix al
-- over voor chauffeurs ("Alleen planner/admin gebruiken het
-- Planning-overzicht"), dus ook de realtime-events die hierdoor wegvallen
-- werden voor chauffeurs al genegeerd.
--
-- Idempotent. De policies worden NAAM-ONAFHANKELIJK gedropt: chauffeur_ids is
-- buiten de repo om aangemaakt (zie enable_rls_gaps.sql), dus de bestaande
-- naam is niet uit git af te leiden. Blijft er een oude permissive policy
-- staan, dan stapelt die met OR en is de afscherming ongedaan gemaakt terwijl
-- de migratie "geslaagd" lijkt — precies de valkuil die setup_security.sql
-- documenteert.

begin;

-- RLS staat al aan op alle drie (geverifieerd 31-07-2026), maar een policy
-- zonder RLS is decoratie — en voor chauffeur_ids geeft de repo geen enkele
-- garantie. Idempotent, dus vandaag een no-op.
--
-- chauffeur_ids is buiten de repo om aangemaakt en staat in geen enkel
-- schemabestand. In een verse omgeving bestaat die tabel dus niet, en een
-- `alter table` op iets onbestaands rolt de héle transactie terug — inclusief
-- de afscherming van de matrix, terwijl de migratie eruitziet als "gefaald op
-- een detail". Vandaar de guard: ontbreekt de tabel, dan slaan we alleen dát
-- deel over. (2026-08-02)
alter table public.planning_matrix_rows           enable row level security;
alter table public.planning_matrix_import_history enable row level security;

do $$
begin
  if to_regclass('public.chauffeur_ids') is not null then
    execute 'alter table public.chauffeur_ids enable row level security';
  else
    raise notice 'chauffeur_ids bestaat niet in deze omgeving — RLS overgeslagen';
  end if;
end $$;

-- Alle bestaande policies op de drie tabellen weg, ongeacht hun naam.
do $$
declare p record;
begin
  for p in
    select tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename in ('planning_matrix_rows',
                        'planning_matrix_import_history',
                        'chauffeur_ids')
  loop
    execute format('drop policy %I on public.%I', p.policyname, p.tablename);
  end loop;
end $$;

-- Ruwe matrixrijen: bevatten de afwezigheidscodes per chauffeur.
create policy planning_matrix_rows_staff_only
  on public.planning_matrix_rows for select
  to authenticated
  using ((select public.current_app_user_role()) in ('planner', 'admin'));

-- Importhistoriek: interne metadata (wie importeerde wanneer wat).
create policy planning_matrix_import_history_staff_only
  on public.planning_matrix_import_history for select
  to authenticated
  using ((select public.current_app_user_role()) in ('planner', 'admin'));

-- Chauffeur-ID-mapping: naam -> personeelsnummer. Zelfde guard als hierboven.
--
-- LET OP (02-08-2026): deze tabel lijkt dood — geen enkele codepad leest hem —
-- maar hij is dat NIET. Hij bevat 31 personeelsnummers (307, 346, 108, …)
-- terwijl users.employeeid bij 29 van de 41 chauffeurs het GSM-nummer bevat,
-- letterlijk gelijk aan users.phone. Dit is dus mogelijk de enige plek waar de
-- échte personeelsnummers staan. Niet droppen zonder dat uit te zoeken.
do $$
begin
  if to_regclass('public.chauffeur_ids') is not null then
    execute $p$
      create policy chauffeur_ids_staff_only
        on public.chauffeur_ids for select
        to authenticated
        using ((select public.current_app_user_role()) in ('planner', 'admin'))
    $p$;
  end if;
end $$;

commit;

-- Controle na afloop. Verwacht EXACT 3 rijen, elk met de staff-check in qual.
-- Meer dan 3 = er staat nog een oude permissive policy die met OR stapelt en
-- de afscherming ongedaan maakt; die dan alsnog droppen.
--   select tablename, policyname, cmd, qual
--   from pg_policies
--   where schemaname = 'public'
--     and tablename in ('planning_matrix_rows',
--                       'planning_matrix_import_history',
--                       'chauffeur_ids')
--   order by tablename, policyname;
