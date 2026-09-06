-- Foutopsporing met bronkaarten en groepering (2026-09-06).
--
-- 1. client_errors krijgt extra context per rapport: fingerprint (één per
--    oorzaak — hash van bron + genormaliseerde melding + top-frame na
--    symbolicatie), release (build-SHA), scherm, rol, online-status, de
--    laatste 10 broodkruimels (navigaties/fout-toasts) en het gesymboliseerde
--    top-frame. Alles nullable: oude rijen blijven geldig, de API rekent
--    een ontbrekende fingerprint zelf uit (api/_lib/foutgroepen.ts).
-- 2. client_error_status: status per foutgroep (open / opgelost / genegeerd),
--    met de release waarin ze gezet werd — een 'opgelost' groep die in een
--    andere release terugkomt, wordt door de API automatisch weer 'open'.
--
-- Server-only tabellen (service role via de API): RLS aan, bewust geen
-- policies — zelfde patroon als client_errors zelf (enable_rls_gaps.sql).
-- Zonder deze migratie werkt de code gewoon door: het insert-pad valt terug
-- op de basiskolommen en de statusacties melden dat de migratie ontbreekt.
--
-- Idempotent; plakken en draaien in de Supabase SQL Editor.

begin;

-- 1. Extra kolommen op client_errors (alleen als de tabel bestaat: ze is optioneel).
do $$
begin
  if to_regclass('public.client_errors') is not null then
    alter table public.client_errors
      add column if not exists fingerprint text,
      add column if not exists release text,
      add column if not exists view text,
      add column if not exists role text,
      add column if not exists online boolean,
      add column if not exists breadcrumbs jsonb,
      add column if not exists top_frame text;
    -- Groeperen en "laatste voorval per groep" lezen op fingerprint + tijd.
    create index if not exists client_errors_fingerprint_created_idx
      on public.client_errors (fingerprint, created_at desc);
  end if;
end
$$;

-- 2. Status per foutgroep.
create table if not exists public.client_error_status (
  fingerprint text primary key,
  status text not null default 'open',
  release text,
  bijgewerkt_op timestamptz not null default now(),
  door text
);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'client_error_status_status_check'
  ) then
    alter table public.client_error_status
      add constraint client_error_status_status_check
      check (status in ('open', 'opgelost', 'genegeerd'));
  end if;
end
$$;

alter table public.client_error_status enable row level security;

-- Geen anon/authenticated-rechten: alleen de service role (API) leest en schrijft.
revoke all on table public.client_error_status from anon, authenticated;

commit;
