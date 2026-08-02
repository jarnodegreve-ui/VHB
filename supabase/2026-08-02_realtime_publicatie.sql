-- Realtime aanzetten: de vier tabellen waarop de app zich abonneert én die
-- veilig en betaalbaar zijn, in de publicatie supabase_realtime zetten.
-- Draaien in de Supabase SQL Editor.
--
-- Waarom: src/lib/realtime.ts abonneert sinds jaar en dag op postgres_changes,
-- maar de publicatie bevat NUL tabellen (geverifieerd 01-08-2026:
-- puballtables = false én 0 rijen in pg_publication_tables). Er is dus nooit
-- één event afgeleverd. Geen enkel .sql-bestand in deze map bevat een
-- `alter publication` — dit is nooit aangezet, niet per ongeluk uitgezet.
--
-- Zonder deze migratie verschijnt een verlofbeslissing, een nieuwe omleiding of
-- een ruilwijziging pas na een reload of na de visibility-catch-up (app ≥60s
-- weggelegd, dan heropend).
--
-- === Privacy: RLS geldt NIET voor DELETE ===
--
-- postgres_changes past RLS toe op INSERT en UPDATE: walrus draait
-- `select exists(select 1 from <tabel> where pk = …)` met de rol en de
-- JWT-claims van de abonnee. DELETE is de uitzondering — realtime.apply_rls
-- bouwt bij action 'DELETE' géén RLS-statement, dus ELKE abonnee krijgt ELK
-- delete-event. Het old_record wordt dan wel tot de primary key gestript
-- (`not is_rls_enabled or (c).is_pkey` in realtime.apply_rls).
--
-- HARDE REGEL die daaruit volgt: de primary key van leave en swaps mag NOOIT
-- persoonsgegevens bevatten. Nu is dat epoch-ms resp. een uuid — prima. Een PK
-- in de vorm '<userid>-<timestamp>' zou elke geannuleerde verlofaanvraag naar
-- de hele vloot lekken, en dat is per tabel niet dicht te zetten: Realtime
-- leest alleen deze ene publicatie.
--
--   leave / swaps            INSERT+UPDATE: enkel betrokkene of staf
--                            DELETE: iedereen, maar alleen de PK
--   diversions / updates     iedereen — bewust gedeeld (SELECT-policy = true)
--
-- === Waarom planning en planning_matrix_rows er NIET in zitten ===
--
-- Ze staan wél in realtime.ts, maar een heropbouw (replace_planning_and_matrix)
-- vervangt alles in één transactie: 655 + 184 rijen, dus ~1.678 WAL-mutaties.
-- Realtime verwerkt changes op één thread en doet per abonnee een access-check,
-- dus bij ~30 verbonden chauffeurs zijn dat tienduizenden queries per import.
-- Loopt dat in een timeout, dan krijgen alle clients CHANNEL_ERROR → reconnect
-- → refetchAll, en trekken ze tegelijk de hele API leeg. De 400ms-debounce in
-- realtime.ts beschermt alleen de client-render, niet de database.
--
-- De juiste oplossing is een aparte migratie: één tabel planning_version met
-- één rij die replace_planning_and_matrix ophoogt, die in de publicatie zetten
-- en realtime.ts daarop laten luisteren. Eén event per import in plaats van
-- 1.678. Tot dan blijft de planning op refetch/catch-up — en dat is sinds de
-- service-worker-fix (network-first op /api/planning) ook gewoon vers.
--
-- REPLICA IDENTITY blijft op default (primary key). FULL is overbodig omdat
-- realtime.ts de payload niet gebruikt, en kost extra WAL bij elke update.
--
-- Idempotent, met een harde post-conditie.

begin;

do $$
declare
  t text;
  tabellen text[] := array[
    'leave',
    'swaps',
    'diversions',
    'updates'
  ];
begin
  foreach t in array tabellen loop
    if to_regclass('public.' || t) is null then
      raise notice 'tabel % bestaat niet — overgeslagen', t;
      continue;
    end if;

    -- Een tabel zónder primary key en met replica identity default laat
    -- Postgres élke update/delete hard weigeren zodra hij updates/deletes
    -- publiceert. Liever hier stoppen dan de app morgen laten breken.
    if not exists (
      select 1 from pg_index i
      where i.indrelid = to_regclass('public.' || t) and i.indisprimary
    ) then
      raise exception 'tabel % heeft geen primary key — toevoegen aan supabase_realtime zou elke update/delete op die tabel breken', t;
    end if;

    if exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      raise notice 'tabel % zit al in supabase_realtime', t;
      continue;
    end if;

    execute format('alter publication supabase_realtime add table public.%I', t);
    raise notice 'tabel % toegevoegd aan supabase_realtime', t;
  end loop;
end $$;

-- Post-conditie in de transactie: een halve toepassing rolt terug.
do $$
declare n int;
begin
  select count(*) into n
  from pg_publication_tables
  where pubname = 'supabase_realtime' and schemaname = 'public'
    and tablename in ('leave', 'swaps', 'diversions', 'updates');
  if n <> 4 then
    raise exception 'post-conditie faalt: % van 4 tabellen in supabase_realtime', n;
  end if;
end $$;

commit;

-- === Controle na het draaien ===
--
-- Verwacht: exact vier rijen (diversions, leave, swaps, updates).
--
-- select schemaname, tablename
-- from pg_publication_tables
-- where pubname = 'supabase_realtime'
-- order by tablename;
--
-- En in de app: open het portaal in twee vensters, keur in het ene een
-- verlofaanvraag goed en kijk of het andere binnen een seconde bijwerkt
-- zónder verversen.
