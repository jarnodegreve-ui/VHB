-- Generieke instellingen-tabel (verzoek Jarno 2026-07-30): eerste gebruiker is
-- de aan/uit-schakelaar van de toestel-whitelist (key 'device_gate', value
-- {"enabled": bool}). RLS aan zonder policies: alleen de service-role (API)
-- kan lezen/schrijven — instellingen zijn nooit client-bereikbaar.
-- NIET deploy-blokkerend: de code valt zonder tabel terug op de veilige
-- default (whitelist aan) en de schakelaar meldt dat de migratie nog mist.
-- Idempotent.
create table if not exists public.app_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.app_settings enable row level security;
