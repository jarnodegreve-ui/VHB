-- 2026-10-08 — Dienstregelingversies (fase 1 van het plan van 08-10, akkoord Jarno).
--
-- De dienstregeling van De Lijn wijzigt om de paar maanden (14/11/2026: één
-- dienst met andere uren; 01/01/2027: bijna elke dienst andere tijden en
-- loopnummers) terwijl de dienstnummers gelijk blijven. Tot nu had het
-- dienstoverzicht (public.services) geen datum: een wijziging gold meteen
-- voor elke dag in de matrix, het verleden inbegrepen, en kon niet vooraf
-- klaargezet worden.
--
-- Deze migratie:
--   1. public.dienstregelingen: één rij per versie met een geldig-vanaf-datum
--      (uniek). Op een dag geldt de versie met de grootste geldig_vanaf die
--      niet na die dag ligt; dagen vóór de eerste versie vallen terug op de
--      eerste versie (shared/dienstregeling.ts, versieVoorDatum).
--   2. public.services."dienstregelingId": bij welke versie een dienst hoort
--      (quoted camelCase zoals de rest van deze tabel). Nullable: een rij
--      zonder versie (oude seeds, rechtstreekse inserts in de databasetests)
--      telt als de oudste versie. De API schrijft de kolom altijd.
--   3. Backfill: één versie "vanaf 01/09/2026" (de dienstregeling van
--      september 2026) als er nog geen is; alle bestaande diensten horen erbij.
--
-- Server-only tabel (API via de service role): RLS aan zonder policies,
-- grants voor anon/authenticated ingetrokken (patroon service_segment_imports).
-- Raakt dus RLS en grants: na het draaien op productie
-- `node --env-file=.env.local scripts/beleid-drift.mjs --update` en
-- supabase/beleid-snapshot.json mee committen.
--
-- Idempotent: veilig om opnieuw te draaien.

begin;

-- === 1) dienstregelingen ===
create table if not exists public.dienstregelingen (
  id uuid primary key default gen_random_uuid(),
  -- Vrije naam ("Dienstregeling januari 2027"); leeg = het scherm toont "Vanaf dd/mm/jjjj".
  naam text,
  geldig_vanaf date not null,
  opmerking text,
  created_at timestamptz not null default now(),
  created_by text,
  constraint dienstregelingen_geldig_vanaf_uniek unique (geldig_vanaf)
);

alter table public.dienstregelingen enable row level security;
revoke all on table public.dienstregelingen from anon, authenticated;
grant all on table public.dienstregelingen to service_role;

-- === 2) services → versie ===
alter table public.services
  add column if not exists "dienstregelingId" uuid references public.dienstregelingen(id) on delete cascade;

create index if not exists services_dienstregeling_idx
  on public.services ("dienstregelingId");

-- === 3) backfill: de huidige lijst wordt de versie van september 2026 ===
insert into public.dienstregelingen (naam, geldig_vanaf)
select 'Dienstregeling september 2026', date '2026-09-01'
where not exists (select 1 from public.dienstregelingen);

update public.services s
set "dienstregelingId" = (select d.id from public.dienstregelingen d order by d.geldig_vanaf limit 1)
where s."dienstregelingId" is null;

-- === register ===
insert into public.schema_migraties (bestand)
values ('2026-10-08_dienstregelingen.sql')
on conflict (bestand) do nothing;

commit;
