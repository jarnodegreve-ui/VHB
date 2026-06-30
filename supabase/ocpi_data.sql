-- OCPI 2.2.1 — datatabellen voor read-only monitoring (Locations/Sessions/CDRs).
-- Eénmalig uitvoeren in de Supabase SQL Editor. Idempotent; veilig te herhalen.
--
-- Opzet: per object een paar getypeerde kolommen voor queries/dashboard + een
-- volledige `raw jsonb` zodat geen enkel OCPI-veld verloren gaat (later extra
-- velden ontsluiten kan zonder migratie). Veldnamen volgen de OCPI 2.2.1-spec.
-- De sync schrijft via de service-role; daarom RLS aan en GEEN policies (enkel
-- de server erbij). Soft references (geen harde FK's) zodat een gedeeltelijke
-- sync nooit op een ontbrekende parent crasht.
--
-- Sleutels (OCPI): Location = (country_code, party_id, id); EVSE.uid is globaal
-- uniek; Connector.id is uniek binnen een EVSE; Session/CDR = (country_code,
-- party_id, id). Upserts (insert ... on conflict) voorkomen dubbels bij pollen.

begin;

-- ---------- Locations ----------
create table if not exists public.ocpi_locations (
  country_code text not null,
  party_id     text not null,
  id           text not null,
  name         text,
  address      text,
  city         text,
  postal_code  text,
  country      text,
  latitude     text,   -- OCPI: coordinates.latitude (decimal als string)
  longitude    text,   -- OCPI: coordinates.longitude
  time_zone    text,
  publish      boolean,
  last_updated timestamptz,
  raw          jsonb not null,
  synced_at    timestamptz not null default now(),
  primary key (country_code, party_id, id)
);

-- ---------- EVSEs ----------
create table if not exists public.ocpi_evses (
  uid                   text primary key,            -- EVSE.uid (globaal uniek)
  evse_id               text,                        -- EVSE.evse_id (zichtbare ID)
  location_country_code text,
  location_party_id     text,
  location_id           text,
  status                text,                        -- AVAILABLE/CHARGING/INOPERATIVE/...
  physical_reference    text,
  last_updated          timestamptz,
  raw                   jsonb not null,
  synced_at             timestamptz not null default now()
);
create index if not exists ocpi_evses_location_idx
  on public.ocpi_evses (location_country_code, location_party_id, location_id);
create index if not exists ocpi_evses_status_idx on public.ocpi_evses (status);

-- ---------- Connectors ----------
create table if not exists public.ocpi_connectors (
  evse_uid          text not null,
  id                text not null,                   -- Connector.id (uniek binnen EVSE)
  standard          text,                            -- IEC_62196_T2 / CHADEMO / ...
  format            text,                            -- SOCKET / CABLE
  power_type        text,                            -- AC_1_PHASE / AC_3_PHASE / DC
  max_voltage       integer,
  max_amperage      integer,
  max_electric_power integer,
  last_updated      timestamptz,
  raw               jsonb not null,
  synced_at         timestamptz not null default now(),
  primary key (evse_uid, id)
);
create index if not exists ocpi_connectors_evse_idx on public.ocpi_connectors (evse_uid);

-- ---------- Sessions (lopende/recente laadsessies) ----------
create table if not exists public.ocpi_sessions (
  country_code        text not null,
  party_id            text not null,
  id                  text not null,
  status              text,                          -- ACTIVE/COMPLETED/INVALID/PENDING/RESERVATION
  start_date_time     timestamptz,
  end_date_time       timestamptz,
  kwh                 numeric,
  currency            text,
  total_cost_excl_vat numeric,                       -- total_cost.excl_vat
  total_cost_incl_vat numeric,                       -- total_cost.incl_vat
  location_id         text,
  evse_uid            text,
  connector_id        text,
  auth_method         text,
  last_updated        timestamptz,
  raw                 jsonb not null,
  synced_at           timestamptz not null default now(),
  primary key (country_code, party_id, id)
);
create index if not exists ocpi_sessions_status_idx on public.ocpi_sessions (status);
create index if not exists ocpi_sessions_start_idx on public.ocpi_sessions (start_date_time);
create index if not exists ocpi_sessions_evse_idx on public.ocpi_sessions (evse_uid);

-- ---------- CDRs (afgeronde sessies, factuurdetail) ----------
create table if not exists public.ocpi_cdrs (
  country_code        text not null,
  party_id            text not null,
  id                  text not null,
  session_id          text,
  start_date_time     timestamptz,
  end_date_time       timestamptz,
  total_energy        numeric,                       -- kWh
  total_time          numeric,                       -- uren
  total_cost_excl_vat numeric,
  total_cost_incl_vat numeric,
  currency            text,
  auth_method         text,
  location_id         text,
  evse_uid            text,
  connector_id        text,
  last_updated        timestamptz,
  raw                 jsonb not null,
  synced_at           timestamptz not null default now(),
  primary key (country_code, party_id, id)
);
create index if not exists ocpi_cdrs_start_idx on public.ocpi_cdrs (start_date_time);
create index if not exists ocpi_cdrs_session_idx on public.ocpi_cdrs (session_id);
create index if not exists ocpi_cdrs_evse_idx on public.ocpi_cdrs (evse_uid);

-- RLS aan, bewust geen policies: enkel de service-role (server) leest/schrijft.
-- Het dashboard haalt deze data via de Express-API (service-role), niet direct.
alter table public.ocpi_locations  enable row level security;
alter table public.ocpi_evses      enable row level security;
alter table public.ocpi_connectors enable row level security;
alter table public.ocpi_sessions   enable row level security;
alter table public.ocpi_cdrs       enable row level security;

commit;
