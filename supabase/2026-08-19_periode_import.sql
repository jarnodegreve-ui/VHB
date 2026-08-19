-- =============================================================================
-- Periode-import: een Excel vervangt alléén zijn eigen datumbereik
-- =============================================================================
-- PROBLEEM
--   replace_planning_and_matrix wiste bij elke import de VOLLEDIGE matrix én
--   planning (`where true`) en zette er uitsluitend het geüploade bestand voor
--   in de plaats. Twee aansluitende maandplanningen — "dienstregeling actueel"
--   en "dienstregeling vanaf september" — konden dus niet naast elkaar
--   bestaan: de tweede import wiste de eerste. Ook wiste een terug-
--   geïmporteerde maandexport (die is per maand) stilletjes alle andere
--   maanden.
--
-- OPLOSSING
--   Nieuwe functie replace_planning_and_matrix_periode. Zelfde atomische
--   opzet (matrix + planning in één transactie), maar het wissen is beperkt
--   tot het datumbereik van het bestand zelf: min t/m max source_date van de
--   aangeleverde matrixrijen. Alles buiten dat bereik blijft staan. Dagen
--   bínnen het bereik die het bestand overslaat worden wél gewist — het
--   bestand is de waarheid voor zijn volledige periode.
--
--   Bewust een NIEUWE functienaam i.p.v. de oude herdefiniëren: zo kan
--   verouderde servercode nooit stil de oude alles-wissende semantiek
--   aanroepen terwijl de UI "de rest blijft staan" belooft, en vice versa.
--   De oude wrapper wordt gedropt; de losse replace_planning en
--   replace_planning_matrix_rows blijven bestaan voor sync-from-matrix en
--   backup-restore, waar volledig vervangen wél de bedoelde semantiek is.
--
-- TYPES (prod, geverifieerd 2026-08-19)
--   planning_matrix_rows.source_date = date; planning."date" = text (ISO).
--   Daarom: span als tekst (ISO vergelijkt lexicografisch = chronologisch),
--   met ::date-cast enkel aan de matrix-kant.
--
-- Idempotent (create or replace / drop if exists).
-- LET OP: supabase/replace_planning_and_matrix.sql opnieuw draaien zou de
-- oude alles-wissende wrapper terugzetten — de definitie is daar verwijderd
-- en vervangen door een verwijzing naar dit bestand.
-- =============================================================================

begin;

create or replace function public.replace_planning_and_matrix_periode(matrix_rows jsonb, shifts jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  span_start text;
  span_end text;
  buiten_bereik integer;
  matrix_count integer;
  shift_count integer := 0;
begin
  if matrix_rows is null or jsonb_typeof(matrix_rows) <> 'array' or jsonb_array_length(matrix_rows) = 0 then
    raise exception 'Lege matrix-set geweigerd: er valt geen periode uit af te leiden.';
  end if;

  -- Élke rij moet een geldige ISO-datum hebben — niet alleen de extremen:
  -- een kapotte rij middenin zou anders pas bij de insert falen, met een
  -- cryptische Postgres-fout i.p.v. deze melding.
  if exists (
    select 1 from jsonb_array_elements(matrix_rows) as elem
    where (elem->>'source_date') is null
       or (elem->>'source_date') !~ '^\d{4}-\d{2}-\d{2}$'
  ) then
    raise exception 'Matrixrijen zonder geldige source_date (YYYY-MM-DD) — periode niet af te leiden.';
  end if;

  -- Te vervangen bereik = het datumbereik van het bestand zelf.
  select min(elem->>'source_date'), max(elem->>'source_date')
    into span_start, span_end
    from jsonb_array_elements(matrix_rows) as elem;

  -- Vangnet: elke dienst hoort binnen het matrixbereik te vallen (de opbouw
  -- werkt per matrixrij en ruilen verleggen alleen driverId, nooit de datum).
  -- Een dienst erbuiten zou blijven plakken op een dag die deze import niet
  -- vervangt, en bij een latere import van díe periode een id-conflict geven.
  if shifts is not null and jsonb_typeof(shifts) = 'array' then
    select count(*) into buiten_bereik
      from jsonb_array_elements(shifts) as s
     where (s->>'date') is null
        or (s->>'date') !~ '^\d{4}-\d{2}-\d{2}$'
        or (s->>'date') < span_start
        or (s->>'date') > span_end;
    if buiten_bereik > 0 then
      raise exception 'Import geweigerd: % dienst(en) vallen buiten het matrixbereik % t/m %.', buiten_bereik, span_start, span_end;
    end if;
  end if;

  delete from public.planning_matrix_rows
   where source_date >= span_start::date and source_date <= span_end::date;
  -- Expliciete kolommen + coalesce, zelfde reden als replace_planning_matrix_rows:
  -- jsonb_populate_recordset zet ontbrekende keys op NULL en zou anders de
  -- defaults van created_at/assignments overschrijven.
  insert into public.planning_matrix_rows (id, source_date, day_type, assignments, raw_row, created_at)
  select
    r.id, r.source_date, r.day_type,
    coalesce(r.assignments, '{}'::jsonb),
    r.raw_row,
    coalesce(r.created_at, now())
  from jsonb_populate_recordset(null::public.planning_matrix_rows, matrix_rows) as r;
  get diagnostics matrix_count = row_count;

  delete from public.planning
   where date >= span_start and date <= span_end;
  if shifts is not null and jsonb_typeof(shifts) = 'array' and jsonb_array_length(shifts) > 0 then
    insert into public.planning (id, date, "startTime", "endTime", line, "busNumber", loopnr, "driverId")
    select
      r.id, r.date, r."startTime", r."endTime", r.line, r."busNumber", r.loopnr, r."driverId"
    from jsonb_populate_recordset(null::public.planning, shifts) as r;
    get diagnostics shift_count = row_count;
  end if;
  -- Bestand met enkel verlof-/afwezigheidscodes: legitiem 0 diensten — de
  -- planning binnen het bereik is dan bewust leeg (en alléén binnen het bereik).

  return jsonb_build_object('matrix', matrix_count, 'shifts', shift_count, 'span_start', span_start, 'span_end', span_end);
end;
$$;

-- Zelfde gat als bij de oude replaces: security definer + PostgREST zou deze
-- destructieve functie anders voor iedereen met de anon-key bereikbaar maken.
revoke all on function public.replace_planning_and_matrix_periode(jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.replace_planning_and_matrix_periode(jsonb, jsonb) to service_role;

-- De oude alles-wissende wrapper verdwijnt: niets hoort hem nog aan te roepen,
-- en laten staan riskeert dat de oude semantiek stil terugkeert. Nog niet
-- geherdeployde servercode valt hierna terug op zijn JS-pad (zelfde gedrag
-- als voorheen, met dezelfde guards) tot de nieuwe deploy live is.
drop function if exists public.replace_planning_and_matrix(jsonb, jsonb);

commit;
