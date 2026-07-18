-- Toestel-whitelist (2026-07): chauffeurs kunnen hun login niet meer doorgeven
-- aan derden. Elk toestel meldt zich met een lokaal gegenereerd token; het
-- eerste toestel van een chauffeur wordt automatisch vertrouwd, elk volgend
-- toestel wacht op goedkeuring door de admin. Planner/admin-toestellen worden
-- altijd automatisch goedgekeurd (registratie = alleen zichtbaarheid) zodat de
-- beheerder zichzelf nooit kan buitensluiten.
--
-- Server-only systeemtabel: alle lees/schrijf-verkeer loopt via de API met de
-- service role, dus bewust GEEN select/insert-policies (RLS aan = dicht voor
-- anon/authenticated) en snake_case — zelfde patroon als user_documents/
-- update_reads.
--
-- Idempotent; plakken en draaien in de Supabase SQL Editor.

begin;

create table if not exists public.user_devices (
  user_id text not null,
  device_token text not null,
  name text not null default 'Onbekend toestel',
  -- 'approved' | 'pending' | 'revoked'
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  approved_at timestamptz,
  approved_by text,
  primary key (user_id, device_token)
);

-- Wees-rijen voorkomen: saveUsersData verwijdert geschrapte gebruikers hard
-- uit public.users (replace-all), dus cascade de toestel-registraties mee weg.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'user_devices_user_id_fkey'
  ) then
    alter table public.user_devices
      add constraint user_devices_user_id_fkey
      foreign key (user_id) references public.users(id) on delete cascade;
  end if;
end
$$;

-- Status is een klein, stabiel, security-relevant domein — een typo hier heeft
-- directe autorisatie-impact, dus wél een check-constraint (als apart blok,
-- zodat een latere uitbreiding de drop-en-heropbouw-route kan volgen).
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'user_devices_status_check'
  ) then
    alter table public.user_devices
      add constraint user_devices_status_check
      check (status in ('approved', 'pending', 'revoked'));
  end if;
end
$$;

alter table public.user_devices enable row level security;

commit;
