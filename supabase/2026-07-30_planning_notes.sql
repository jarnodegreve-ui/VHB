-- Dienstnotities (verbetervoorstel 3, 30/07): kort bericht van de planner
-- aan een chauffeur bij één dienstdag ("neem bus 412, eerst tanken").
-- Bewust een EIGEN tabel op (driver, datum) en niet een kolom op planning:
-- "Planning opnieuw opbouwen" vervangt de hele planning-tabel en zou
-- notities anders stil wissen.
-- RLS aan zonder policies: alleen de service-role (API) kan erbij; de API
-- scopet chauffeurs op hun eigen notities. NIET deploy-blokkerend: lezen
-- valt zonder tabel terug op leeg, schrijven meldt welke migratie mist.
-- Idempotent.
create table if not exists public.planning_notes (
  driver_id text not null,
  date text not null, -- YYYY-MM-DD, zelfde stringconventie als planning
  note text not null,
  updated_by text,
  updated_at timestamptz not null default now(),
  primary key (driver_id, date)
);
alter table public.planning_notes enable row level security;
