-- 2026-10-13 — Ritbladen per dienstregelingversie (fase 2 van het plan van 08-10, keuzes Jarno 13-10).
--
-- Tot nu was er één ritbladbundel voor iedereen (public.ritblaadje, precies
-- één rij met id 'current'). Bij een dienstregelingwijziging (14/11, 1/1)
-- moest de bundel op de dag zelf vervangen worden: ervoor zag een chauffeur
-- de oude bladen, erna waren ze weg. Nu hangt elke bundel aan een versie uit
-- public.dienstregelingen: de app kiest per dag de bundel van de versie die
-- op die dag geldt, een toekomstige bundel is vooraf te bekijken en de vorige
-- blijft staan zolang haar versie bestaat.
--
-- Deze migratie:
--   1. laat de check "precies één rij" los;
--   2. kolom dienstregeling_id (nullable; null = de oudste versie, zoals bij
--      services."dienstregelingId"; verwijderen van de versie neemt de rij mee);
--   3. hoogstens één bundel per versie (partiële unieke index);
--   4. backfill: de bestaande rij 'current' wordt de bundel van de versie die
--      vandaag (Belgische dag) geldt, anders de oudste;
--   5. de default 'current' op id weg: elke rij krijgt haar id van de API.
--
-- Raakt geen RLS, policies of grants: geen beleidssnapshot-update.
-- Idempotent: veilig om opnieuw te draaien.

begin;

alter table public.ritblaadje drop constraint if exists only_one_row;

alter table public.ritblaadje
  add column if not exists dienstregeling_id uuid references public.dienstregelingen(id) on delete cascade;

create unique index if not exists ritblaadje_dienstregeling_uniek
  on public.ritblaadje (dienstregeling_id)
  where dienstregeling_id is not null;

update public.ritblaadje r
set dienstregeling_id = coalesce(
  (select d.id from public.dienstregelingen d where d.geldig_vanaf <= (now() at time zone 'Europe/Brussels')::date order by d.geldig_vanaf desc limit 1),
  (select d.id from public.dienstregelingen d order by d.geldig_vanaf asc limit 1)
)
where r.id = 'current'
  and r.dienstregeling_id is null
  and exists (select 1 from public.dienstregelingen);

alter table public.ritblaadje alter column id drop default;

-- === register ===
insert into public.schema_migraties (bestand)
values ('2026-10-13_ritblaadje_per_versie.sql')
on conflict (bestand) do nothing;

commit;
