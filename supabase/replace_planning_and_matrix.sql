-- =============================================================================
-- Atomische import: planning + matrix in ÉÉN transactie
-- =============================================================================
-- PROBLEEM
--   De Excel-import verving planning_matrix_rows en planning via twee LOSSE
--   RPC-calls. Faalde de tweede (bv. dubbele shift-id, of een import die
--   legitiem 0 diensten oplevert omdat de maand enkel verlof-/afwezigheids-
--   codes bevat), dan stond de matrix al op de nieuwe maand terwijl de
--   planning nog de oude toonde — Maandplanning en roosters spraken elkaar
--   dan tegen (skew).
--
-- OPLOSSING
--   1. Wrapper-functie replace_planning_and_matrix die beide replaces in één
--      plpgsql-transactie draait (alles-of-niets). Een lege diensten-set is
--      toegestaan zolang de matrix niet leeg is: de planning volgt de matrix,
--      dus dan wordt de planning bewust (en atomair) geleegd.
--   2. replace_planning geherdefinieerd met EXPLICIETE kolomlijst i.p.v.
--      `select *` — dezelfde bug-klasse die de import al 2× brak:
--      jsonb_populate_recordset zet kolommen die niet in de JSON zitten op
--      NULL, wat een toekomstige NOT NULL DEFAULT-kolom (bv. created_at)
--      meteen zou breken. LET OP: de planning-tabel heeft in productie
--      quoted camelCase-kolommen ("startTime", "driverId", …) — aangemaakt
--      via de Table Editor, net als services. De unquoted definitie in
--      setup_security.sql klopt dus niet met prod; deze functie volgt prod.
--
-- Idempotent (create or replace). De API valt automatisch terug op het oude
-- pad zolang de wrapper nog niet bestaat, dus dit mag vóór of na de deploy
-- gedraaid worden — vóór is netter.
-- =============================================================================

begin;

create or replace function public.replace_planning(rows jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  inserted integer;
begin
  if rows is null or jsonb_typeof(rows) <> 'array' or jsonb_array_length(rows) = 0 then
    raise exception 'Lege planning-set geweigerd: dit zou alle planning wissen.';
  end if;
  -- `where true` = alle rijen wissen, mét WHERE-clausule (Supabase-guard).
  delete from public.planning where true;
  -- Expliciete kolomlijst i.p.v. `select *` (zie kop van dit bestand).
  insert into public.planning (id, date, "startTime", "endTime", line, "busNumber", loopnr, "driverId")
  select
    r.id, r.date, r."startTime", r."endTime", r.line, r."busNumber", r.loopnr, r."driverId"
  from jsonb_populate_recordset(null::public.planning, rows) as r;
  get diagnostics inserted = row_count;
  return inserted;
end;
$$;

create or replace function public.replace_planning_and_matrix(matrix_rows jsonb, shifts jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  matrix_count integer;
  shift_count integer := 0;
begin
  if matrix_rows is null or jsonb_typeof(matrix_rows) <> 'array' or jsonb_array_length(matrix_rows) = 0 then
    raise exception 'Lege matrix-set geweigerd: dit zou de volledige matrixplanning wissen.';
  end if;

  -- Hergebruikt de bestaande, gereviewde replace-functies; omdat dit alles
  -- binnen één functie-aanroep gebeurt, is het geheel één transactie:
  -- faalt eender welke stap, dan rolt álles terug (geen skew meer).
  select public.replace_planning_matrix_rows(matrix_rows) into matrix_count;

  if shifts is not null and jsonb_typeof(shifts) = 'array' and jsonb_array_length(shifts) > 0 then
    select public.replace_planning(shifts) into shift_count;
  else
    -- Import met enkel niet-dienst-codes (verlof/ziekte/…): legitiem 0
    -- diensten. De planning is afgeleid van de matrix, dus die wordt hier
    -- bewust mee geleegd — atomair, binnen dezelfde transactie.
    delete from public.planning where true;
    shift_count := 0;
  end if;

  return jsonb_build_object('matrix', matrix_count, 'shifts', shift_count);
end;
$$;

-- Alleen de server (service_role) mag deze destructieve replaces aanroepen.
-- Zonder deze revokes exposeert PostgREST elke public-functie als
-- /rest/v1/rpc/... en geeft Postgres EXECUTE standaard aan PUBLIC — een
-- bezoeker met de publieke anon-key kon zo (security definer = RLS-bypass)
-- de volledige planning + matrix wissen, buiten de Express-API om. Dit gat
-- bestond ook al op de oudere functies; we dichten het hier voor alle drie.
revoke all on function public.replace_planning(jsonb) from public, anon, authenticated;
revoke all on function public.replace_planning_matrix_rows(jsonb) from public, anon, authenticated;
revoke all on function public.replace_planning_and_matrix(jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.replace_planning(jsonb) to service_role;
grant execute on function public.replace_planning_matrix_rows(jsonb) to service_role;
grant execute on function public.replace_planning_and_matrix(jsonb, jsonb) to service_role;

commit;
