-- =============================================================================
-- Staging: tabellen die productie buiten de repo om kreeg
-- =============================================================================
-- push_subscriptions, client_errors en coverage_expectations zijn in productie
-- via de Table Editor / losse SQL aangemaakt (zie enable_rls_gaps.sql) en
-- staan dus in geen enkel schemabestand. Een verse omgeving mist ze; de API
-- tolereert dat deels (client_errors en coverage_expectations vallen terug op
-- "leeg"), maar de dekking-module kan dan niets opslaan en push-registratie
-- faalt hard. Kolommen zijn overgenomen uit hoe api/push.ts, api/storage.ts
-- (logClientError, mapClientErrorRow, retentie) en getCoverageExpectations
-- ze lezen en schrijven.
--
-- Daarnaast twee swaps-kolommen (return_date/return_code) en de privé bucket
-- `backups` (nachtcron + import-herstelpunten, docs/RESTORE.md) — ook die zijn
-- in productie handmatig aangemaakt.
--
-- Draai dit VÓÓR enable_rls_gaps.sql (die zet alleen RLS aan op tabellen die
-- al bestaan). Idempotent; op productie is het een no-op (alles bestaat al).
-- =============================================================================

begin;

create extension if not exists pgcrypto;

-- Web-push-abonnementen: één rij per endpoint (api/push.ts upsert onConflict endpoint).
create table if not exists public.push_subscriptions (
  endpoint text primary key,
  user_id text not null,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);
create index if not exists push_subscriptions_user_id_idx on public.push_subscriptions (user_id);

-- Client-foutmeldingen (POST /api/client-errors), opgeruimd door de retentie-cron.
create table if not exists public.client_errors (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  message text not null,
  stack text,
  source text,
  url text,
  user_agent text,
  user_id text
);
create index if not exists client_errors_created_at_idx on public.client_errors (created_at desc);

-- Dekking: verwachte diensten per dag-type. Gereserveerde sleutels
-- (__weekdagen__, __uitzonderingen__, …) delen dezelfde tabel (api/coverageRoutes.ts).
create table if not exists public.coverage_expectations (
  day_type text primary key,
  service_numbers text[] not null default '{}'
);

-- Server-only: RLS aan zonder policies (alleen de service-role komt erbij),
-- plus expliciete revokes zoals 2026-08-02_anon_rechten_intrekken.sql — zo
-- maakt het niet uit in welke volgorde die migratie en dit bestand draaien.
alter table public.push_subscriptions   enable row level security;
alter table public.client_errors        enable row level security;
alter table public.coverage_expectations enable row level security;

revoke all on table public.push_subscriptions, public.client_errors, public.coverage_expectations from anon;
revoke insert, update, delete, truncate, references, trigger
  on table public.push_subscriptions, public.client_errors, public.coverage_expectations
  from authenticated;

-- swaps.return_date / return_code (tegenprestatie bij een 1-op-1-ruil) zijn
-- in productie ook buiten de repo om toegevoegd: geen enkel .sql-bestand
-- maakt ze aan, terwijl api/schemaProbes.ts en toDatabaseSwap ze verwachten.
alter table public.swaps add column if not exists return_date text;
alter table public.swaps add column if not exists return_code text;

-- Privé bucket voor back-ups en import-herstelpunten.
insert into storage.buckets (id, name, public)
values ('backups', 'backups', false)
on conflict (id) do update set public = false;

commit;
