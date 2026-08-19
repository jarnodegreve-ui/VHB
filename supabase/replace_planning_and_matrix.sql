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

-- =============================================================================
-- LET OP — replace_planning_and_matrix staat NIET meer in dit bestand
-- =============================================================================
-- De wrapper is per 2026-08-19 vervangen door replace_planning_and_matrix_periode
-- in supabase/2026-08-19_periode_import.sql: een import vervangt sindsdien
-- alléén het datumbereik van het geüploade bestand i.p.v. álles. Dit bestand
-- opnieuw draaien zou de oude alles-wissende wrapper stil terugzetten (en de
-- UI belooft intussen "de rest blijft staan"), dus de oude definitie is hier
-- verwijderd — zelfde behandeling als replace_planning ooit kreeg in
-- transactional_replace.sql. Draai 2026-08-19_periode_import.sql voor de
-- actuele importfunctie.
-- =============================================================================

-- Alleen de server (service_role) mag deze destructieve replaces aanroepen.
-- Zonder deze revokes exposeert PostgREST elke public-functie als
-- /rest/v1/rpc/... en geeft Postgres EXECUTE standaard aan PUBLIC — een
-- bezoeker met de publieke anon-key kon zo (security definer = RLS-bypass)
-- de volledige planning + matrix wissen, buiten de Express-API om.
revoke all on function public.replace_planning(jsonb) from public, anon, authenticated;
revoke all on function public.replace_planning_matrix_rows(jsonb) from public, anon, authenticated;
grant execute on function public.replace_planning(jsonb) to service_role;
grant execute on function public.replace_planning_matrix_rows(jsonb) to service_role;

commit;
