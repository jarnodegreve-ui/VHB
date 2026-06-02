-- Zenobe-export: referentietabellen.
-- Voedt het /api/zenobe-export endpoint dat het upload-CSV voor het Zenobe-
-- portaal genereert uit de planning-matrix.
--
-- Paste in de Supabase SQL editor en run één keer. Daarna
-- _seed_zenobe_reference.sql draaien om de referentiedata te vullen.

begin;

-- Bussen: nummer -> Zenobe MIX-id + bustype (12m standaard / 18m geleed).
create table if not exists public.vehicles (
  nummer integer primary key,
  mix_id text not null,
  bustype text not null check (bustype in ('12m', '18m'))
);

-- Chauffeur -> portaal-ID (employeeId in tab 'chauffeurs', bv. '224').
-- Apart gehouden van public.users zodat de naam-matching uit de planning-
-- matrix los staat van de loginaccounts.
create table if not exists public.chauffeur_ids (
  naam text primary key,
  employee_id text not null
);

-- Per (dagtype, loopnummer): vaste tijden/km/categorie (uit dienstloop) +
-- route_id (stabiel per loop, afgeleid uit de upload-historie).
create table if not exists public.service_loops (
  dagtype integer not null,
  loopnummer integer not null,
  begin_tijd text,
  einde_tijd text,
  km numeric,
  categorie text check (categorie in ('K', 'S', 'G')),
  route_id text,
  primary key (dagtype, loopnummer)
);

-- Standaardbus per loop (uit bus-toewijzing). "Bijna altijd vast"; bij
-- rotatie/last-minute wissel overschrijft de planner dit in de export-UI.
-- GEEN FK naar vehicles: bus-toewijzing bevat ook niet-Zenobe bussen
-- (bv. diesel) die geen MIX-id hebben; de export waarschuwt dan i.p.v. een
-- foute regel te schrijven.
create table if not exists public.loop_vehicle_defaults (
  dagtype integer not null,
  loopnummer integer not null,
  default_busnummer integer,
  primary key (dagtype, loopnummer)
);

-- Dienst -> loops. De planning-matrix wijst per chauffeur/dag één
-- dienstnummer toe (bv. 2101); een dienst bestaat uit 1-3 loops. Deze brug
-- vertaalt dienst -> de loops die voor de Zenobe-upload nodig zijn.
-- Dagtype-onafhankelijk: een dienstnummer is uniek (bron: diensten.xlsx).
create table if not exists public.dienst_loops (
  dienst integer not null,
  volgorde integer not null,
  loopnummer integer not null,
  begin_tijd text,
  einde_tijd text,
  primary key (dienst, volgorde)
);

-- RLS: lezen voor ingelogde gebruikers; schrijven gaat via de service-role
-- (supabaseAdmin in api/db.ts), die RLS omzeilt. Zelfde patroon als
-- planning_matrix_schema.sql.
alter table public.vehicles enable row level security;
alter table public.chauffeur_ids enable row level security;
alter table public.service_loops enable row level security;
alter table public.loop_vehicle_defaults enable row level security;
alter table public.dienst_loops enable row level security;

drop policy if exists "vehicles_read_authenticated" on public.vehicles;
create policy "vehicles_read_authenticated" on public.vehicles
  for select to authenticated using (true);

drop policy if exists "chauffeur_ids_read_authenticated" on public.chauffeur_ids;
create policy "chauffeur_ids_read_authenticated" on public.chauffeur_ids
  for select to authenticated using (true);

drop policy if exists "service_loops_read_authenticated" on public.service_loops;
create policy "service_loops_read_authenticated" on public.service_loops
  for select to authenticated using (true);

drop policy if exists "loop_vehicle_defaults_read_authenticated" on public.loop_vehicle_defaults;
create policy "loop_vehicle_defaults_read_authenticated" on public.loop_vehicle_defaults
  for select to authenticated using (true);

drop policy if exists "dienst_loops_read_authenticated" on public.dienst_loops;
create policy "dienst_loops_read_authenticated" on public.dienst_loops
  for select to authenticated using (true);

commit;
