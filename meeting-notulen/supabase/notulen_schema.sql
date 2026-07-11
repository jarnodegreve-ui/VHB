-- Schema voor de meeting-notulen tool (fase 2: Supabase-opslag).
-- Eénmalig uitvoeren in de Supabase SQL-editor van het project waar de
-- notulen moeten landen.
--
-- De tool schrijft met de service-role key (server-side); RLS staat aan
-- zonder policies zodat de anon/publishable key nergens bij kan. Voeg zelf
-- policies toe zodra een frontend leesrechten nodig heeft.

create extension if not exists pgcrypto;

create table if not exists public.notulen (
  id uuid primary key default gen_random_uuid(),
  titel text not null,
  -- datum als tekst: het model geeft bij voorkeur YYYY-MM-DD, maar kan ook
  -- "10 juli" teruggeven als dat het enige is wat in het gesprek genoemd wordt
  datum text,
  doel text,
  deelnemers jsonb not null default '[]'::jsonb,
  kernpunten jsonb not null default '[]'::jsonb,
  beslissingen jsonb not null default '[]'::jsonb,
  open_punten jsonb not null default '[]'::jsonb,
  -- volledig transcript met tijdcodes (en sprekerlabels bij diarization),
  -- zodat latere fases erop kunnen zoeken of hersamenvatten
  transcript text,
  taal text,
  duur_seconden numeric,
  bronbestand text,
  model text,
  created_at timestamptz not null default now()
);

create table if not exists public.notulen_actiepunten (
  id uuid primary key default gen_random_uuid(),
  notulen_id uuid not null references public.notulen(id) on delete cascade,
  volgorde int not null,
  omschrijving text not null,
  eigenaar text,
  -- deadline als tekst ("vrijdag", "eind Q3", "2026-08-01") — normaliseren
  -- naar echte datums is bewust een latere fase
  deadline text,
  created_at timestamptz not null default now()
);

create index if not exists notulen_actiepunten_notulen_id_idx
  on public.notulen_actiepunten (notulen_id);

alter table public.notulen enable row level security;
alter table public.notulen_actiepunten enable row level security;
