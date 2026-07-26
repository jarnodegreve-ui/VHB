-- =============================================================================
-- Transactionele "replace" voor planning + matrix  (top-5 #2, atomiciteit)
-- =============================================================================
-- PROBLEEM
--   replacePlanningData / savePlanningMatrixRows doen `delete` gevolgd door
--   `insert` als twee aparte calls. Tussen die twee is de tabel even LEEG, en
--   als de insert faalt (of het proces sterft) blijft de tabel leeg → de hele
--   planning is weg. Supabase-JS kent geen multi-statement-transactie, dus de
--   atomiciteit moet in een Postgres-functie zitten.
--
-- OPLOSSING
--   Eén functie per tabel die delete+insert in één transactie doet (een
--   plpgsql-functie draait atomair). `jsonb_populate_recordset(null::tabel, …)`
--   mapt de JSON-keys op de kolommen — exact dezelfde mapping als de huidige
--   `.insert(data)`, dus gedraagt zich identiek, maar nu alles-of-niets.
--
-- HOE TE GEBRUIKEN
--   1. Plak dit in de Supabase SQL-editor en run één keer.
--   2. Test op de PREVIEW een planning-import + een matrix-import en controleer
--      dat alles correct verschijnt (de API valt automatisch terug op het oude,
--      veilige pad zolang deze functies nog niet bestaan).
--   3. Zeg het wanneer het op preview klopt — dan zet ik de API-aanroep
--      (`rpc('replace_planning', …)`) als primair pad aan, met de huidige
--      JS-guards als vangnet.
-- =============================================================================

-- =============================================================================
-- LET OP — replace_planning staat NIET meer in dit bestand
-- =============================================================================
-- De definitie hier gebruikte `insert … select * from jsonb_populate_recordset`
-- en is vervangen door de versie met een EXPLICIETE kolomlijst in
-- supabase/replace_planning_and_matrix.sql (dezelfde bug-klasse brak de import
-- al 2×: ontbrekende JSON-keys werden NULL en overschreven kolom-defaults).
-- Dit bestand opnieuw draaien zou die fix stil terugdraaien, dus de oude
-- definitie is hier verwijderd. Draai replace_planning_and_matrix.sql voor de
-- actuele versie.
-- =============================================================================

create or replace function public.replace_planning_matrix_rows(rows jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  inserted integer;
begin
  if rows is null or jsonb_typeof(rows) <> 'array' or jsonb_array_length(rows) = 0 then
    raise exception 'Lege matrix-set geweigerd: dit zou de volledige matrixplanning wissen.';
  end if;
  -- `where true`: alle rijen, mét WHERE-clausule tegen de DELETE-guard.
  delete from public.planning_matrix_rows where true;
  -- Expliciete kolommen + coalesce: jsonb_populate_recordset zet ontbrekende
  -- keys op NULL, wat de `default now()` van created_at zou overschrijven
  -- (NOT NULL-schending). Zo vult de default alsnog, en assignments valt terug
  -- op '{}' als de bron 'm niet meelevert.
  insert into public.planning_matrix_rows (id, source_date, day_type, assignments, raw_row, created_at)
  select
    r.id, r.source_date, r.day_type,
    coalesce(r.assignments, '{}'::jsonb),
    r.raw_row,
    coalesce(r.created_at, now())
  from jsonb_populate_recordset(null::public.planning_matrix_rows, rows) as r;
  get diagnostics inserted = row_count;
  return inserted;
end;
$$;

-- =============================================================================
-- (Optioneel, latere stap) Optimistic concurrency tegen lost-updates
-- =============================================================================
-- Twee planners die tegelijk bewerken → de laatste die opslaat overschrijft de
-- ander stil (heel-de-array-POST). Een `updated_at` + versie-check lost dit op,
-- maar vereist ook API-wijzigingen (per-record schrijven + 409 bij stale).
-- Daarom hier alleen de kolom + trigger klaargezet; de API-kant volgt apart.
--
-- alter table public.leave    add column if not exists updated_at timestamptz not null default now();
-- alter table public.swaps    add column if not exists updated_at timestamptz not null default now();
-- alter table public.planning add column if not exists updated_at timestamptz not null default now();
--
-- create or replace function public.touch_updated_at()
-- returns trigger language plpgsql as $$
-- begin new.updated_at = now(); return new; end; $$;
--
-- do $$ begin
--   create trigger trg_leave_updated_at before update on public.leave
--     for each row execute function public.touch_updated_at();
-- exception when duplicate_object then null; end $$;
-- (idem voor swaps / planning)
-- =============================================================================
