-- Migration: entity_type + entity_id toevoegen aan activity_log zodat we
-- per-entity wijzigingsgeschiedenis kunnen tonen (bv. "alle changes op
-- service 1234" of "alle changes op verlofaanvraag X").
--
-- Nullable: bestaande rijen blijven zonder entity gevuld. Vanaf nu populeert
-- de API entity_type/entity_id voor services, swaps, leave, users, etc.
--
-- Run dit ZELF op Supabase. Veilig om opnieuw te draaien (IF NOT EXISTS).

alter table public.activity_log
  add column if not exists entity_type text,
  add column if not exists entity_id text;

-- Index zodat per-entity queries snel zijn ook bij grote logs
create index if not exists activity_log_entity_idx
  on public.activity_log (entity_type, entity_id, created_at desc);

-- De bestaande category-check breidt uit met 'leave' en 'swaps' (waren al
-- toegevoegd in de TypeScript-typen, maar de SQL-check liep achter). Veilig
-- om idempotent te runnen: we droppen de oude constraint als die bestaat
-- en zetten 'm met de volledige lijst terug.
do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conname = 'activity_log_category_check'
  ) then
    alter table public.activity_log drop constraint activity_log_category_check;
  end if;
end $$;

alter table public.activity_log
  add constraint activity_log_category_check
  check (category in ('users','planning','planning_codes','services','diversions','updates','auth','leave','swaps'));
