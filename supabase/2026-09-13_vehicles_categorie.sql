-- 2026-09-13 — Techniek: voertuigcategorie (bus, bedrijfswagen, privéwagen). Draait in de SQL Editor.
-- Vraag Jarno 13-09: bussen, bedrijfswagens en privéwagens apart kunnen
-- bekijken, los van het type (lijnbus, schoolbus, sprinter, …). Backfill uit
-- het type; de fiche in Beheer › Voertuigen laat het daarna aanpassen.
-- Idempotent. Raakt geen RLS, policies of grants (beleidssnapshot ongewijzigd).
--
-- Volgorde: 2026-09-13_techniek_voertuigen.sql eerst.

begin;

alter table public.vehicles add column if not exists categorie text;

update public.vehicles
set categorie = case
  when type in ('lijnbus', 'schoolbus', 'sprinter') then 'bus'
  when type = 'privevoertuig' then 'privewagen'
  else 'bedrijfswagen'
end
where categorie is null;

alter table public.vehicles alter column categorie set default 'bus';
alter table public.vehicles alter column categorie set not null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'vehicles_categorie_check' and conrelid = 'public.vehicles'::regclass) then
    alter table public.vehicles
      add constraint vehicles_categorie_check check (categorie in ('bus', 'bedrijfswagen', 'privewagen'));
  end if;
end $$;

-- Post-conditie.
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'vehicles' and column_name = 'categorie' and is_nullable = 'NO'
  ) then
    raise exception 'vehicles.categorie ontbreekt of is nullable';
  end if;
  if exists (select 1 from public.vehicles where categorie not in ('bus', 'bedrijfswagen', 'privewagen')) then
    raise exception 'vehicles.categorie bevat een onbekende waarde';
  end if;
end $$;

commit;
