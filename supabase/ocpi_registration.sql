-- OCPI 2.2.1 — opslag van het registratie-resultaat (credentials-handshake).
-- Eénmalig uitvoeren in de Supabase SQL Editor.
--
-- Bevat GEHEIME tokens (Token B die wij aan ChargEye gaven, Token C waarmee wij
-- ChargEye pollen). Daarom: RLS aan en GEEN policies → geen enkele client
-- (anon/authenticated) kan dit lezen; alleen de server (service-role, omzeilt
-- RLS) heeft toegang. Eén rij, vaste id 'default'.

begin;

create table if not exists public.ocpi_registration (
  -- Eén-rij-tabel: de check dwingt af dat er nooit een tweede config-rij komt.
  id text primary key default 'default' check (id = 'default'),
  -- token dat WIJ uitgaven aan ChargEye (zij gebruiken het om ons te bellen)
  our_token_b text,
  -- token waarmee WIJ ChargEye's Sender-endpoints pollen (Token C)
  cpo_token_c text,
  -- ontdekte tegenpartij-identiteit
  cpo_party_id text,
  cpo_country_code text,
  -- volledige endpoints-lijst uit ChargEye's version-details (locations/sessions/cdrs/…)
  cpo_endpoints jsonb,
  -- welke OCPI-versie de handshake opleverde (2.2.1 / 2.2)
  ocpi_version text,
  registered_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.ocpi_registration enable row level security;
-- Bewust geen policies: enkel de service-role (server) mag hierbij.

-- Zelfvoorzienend: zorg dat de updated_at-helper bestaat. (create or replace is
-- idempotent en botst niet met de identieke definitie in setup_security.sql.)
-- Nodig omdat deze migratie los gedraaid kan worden vóór setup_security.sql;
-- ontbrak de functie, dan rolde de hele transactie terug → geen tabel.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Houd updated_at automatisch bij.
drop trigger if exists ocpi_registration_set_updated_at on public.ocpi_registration;
create trigger ocpi_registration_set_updated_at
before update on public.ocpi_registration
for each row
execute function public.set_updated_at();

commit;
