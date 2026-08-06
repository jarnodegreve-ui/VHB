-- Vervaldata-bewaker (verzoek Jarno 07-08): per chauffeur de vervaldatum van
-- rijbewijs, Code 95-nascholing en medische schifting. Eén rij per
-- gebruiker+soort; beheer door planner/admin via de API (service role).
--
-- Zelfde beveiligingspatroon als user_documents/ocpi_power_snapshots: RLS aan
-- zonder policies — al het verkeer loopt via de API met de service role, die
-- RLS passeert. Idempotent; plakken en draaien in de Supabase SQL Editor.

begin;

create table if not exists public.user_expiries (
  user_id text not null,
  -- Vaste soorten; nieuwe soorten = check uitbreiden (bewust strak, zodat
  -- een typefout geen stille vierde categorie wordt).
  soort text not null check (soort in ('rijbewijs', 'code95', 'medische_schifting')),
  valid_until date not null,
  updated_at timestamptz not null default now(),
  updated_by text,
  primary key (user_id, soort)
);

alter table public.user_expiries enable row level security;

-- Riemen én bretellen bovenop RLS: geen schrijfrechten voor de client-rollen.
revoke insert, update, delete, truncate, references, trigger
  on table public.user_expiries
  from anon, authenticated;
revoke all on table public.user_expiries from anon;

commit;
