-- Omleiding-'ernst' (severity) uit het portaal (verbeterronde 2026-07).
--
-- De code toont/gebruikt geen severity meer ("een omleiding is een omleiding").
-- De kolom diversions.severity stond op NOT NULL zonder default; zodra de code
-- geen severity meer meestuurt bij een insert/upsert zou dat falen. Deze
-- migratie maakt de kolom nullable.
--
-- VOLGORDE telt: draai deze migratie VÓÓR je de bijhorende code-PR
-- merget/deployt. De wijziging zelf kan nooit iets breken (een constraint
-- versoepelen), maar draai je 'm ná de deploy, dan faalt elke insert/upsert
-- van een omleiding met een NOT NULL-violation vanaf het moment dat de nieuwe
-- code (die severity weglaat) live is, tot je de SQL alsnog draait. Oude code
-- (die severity nog wél meestuurt) blijft de hele tijd werken.
--
-- De kolom zelf blijft (vestigiaal, NULL voor nieuwe rijen). Ze later volledig
-- droppen kan veilig ná deze deploy met:  alter table public.diversions drop
-- column if exists severity;  — niet nodig, puur opruiming.
--
-- Idempotent (drop not null is een no-op als de constraint al weg is).

begin;

alter table public.diversions
  alter column severity drop not null;

commit;
