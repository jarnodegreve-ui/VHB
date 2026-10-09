-- 2026-10-10 — Afwijkende diensttijden per dagtype (keuze Jarno 09-10).
--
-- Een dienst in het dienstoverzicht heeft één set tijden, delen en
-- loopnummers. De schoolritten (EEK1, EEK5, EEK6, EEK8, EEK9, EEK10) rijden op
-- woensdag een korter namiddagdeel, en De Lijn deelt elke dag in op dagtype
-- (21-25 schooldag maandag tot vrijdag, 26 zaterdag, 27 zondag, 28 feestdag,
-- 31-35 schoolvakantie, 41-45 juli en augustus, 51-55 examen; zie
-- public.dagtype_codes). Daarom per dienst nul of meer afwijkingen:
--
--   varianten jsonb, bv.
--   [{"dagtypes": ["23"], "startTime": "07:10", "endTime": "08:40",
--     "startTime2": "11:50", "endTime2": "13:20"}]
--
-- Leesregel (shared/dagtype.ts, tijdenOpDag): op een dag met dagtype X gelden
-- de tijden van de afwijking die X noemt, anders de gewone kolommen. Een
-- afwijking is een volledige set (wat ontbreekt is leeg). Het dagtype van een
-- dag komt uit planning_matrix_rows.day_type, of wordt afgeleid uit de
-- dekkingskalender en de weekdag (dagtypeVanDag). De API normaliseert wat ze
-- schrijft (alleen bekende codes, elk in hoogstens één afwijking); null = geen.
--
-- Raakt geen RLS, policies of grants: geen snapshot-update.
-- Idempotent: veilig om opnieuw te draaien.

begin;

alter table public.services
  add column if not exists varianten jsonb;

comment on column public.services.varianten is
  'Afwijkende tijden per De Lijn-dagtype, [{"dagtypes": ["23"], "startTime": ...}]; null = overal de gewone tijden.';

-- === register ===
insert into public.schema_migraties (bestand)
values ('2026-10-10_services_varianten.sql')
on conflict (bestand) do nothing;

commit;
