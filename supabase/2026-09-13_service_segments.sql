-- 2026-09-13 — Dienstopbouw op rit-niveau (fase C Access-migratie).
--
-- Vervangt de kern van dienstregeling.accdb:
--   tbl-importDienstenET → public.service_segment_imports + public.service_segments
--                          (de ET-export per import bewaard; precies één import actief)
--   tbl-dagcodes         → public.dagtype_codes (24 dagtypecodes van De Lijn,
--                          met een mapping naar de dagtypes van het portaal)
-- De rekenregels (looncomponenten, loonparameters, controles, ritblad) zijn
-- pure functies in shared/dienst/*.ts; de database bewaart alleen de ritdelen.
-- Beveiligingspatroon zoals de andere migraties van 13-09: RLS aan zonder
-- policies, API-only via de service role. Idempotent.

begin;

-- === 1) service_segment_imports ===
create table if not exists public.service_segment_imports (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  imported_by text,
  filename text,
  rijen integer not null default 0,
  diensten integer not null default 0,
  dagtypes text[] not null default '{}',
  waarschuwingen jsonb not null default '[]'::jsonb,
  bevindingen jsonb not null default '[]'::jsonb,
  -- Precies één import is actief (partial unique index hieronder); de
  -- vorige blijft bewaard om terug te kunnen.
  actief boolean not null default false,
  actief_sinds timestamptz
);

create unique index if not exists service_segment_imports_actief_idx
  on public.service_segment_imports (actief) where actief;

alter table public.service_segment_imports enable row level security;
revoke all on table public.service_segment_imports from anon, authenticated;
grant all on table public.service_segment_imports to service_role;

-- === 2) service_segments ===
create table if not exists public.service_segments (
  id uuid primary key default gen_random_uuid(),
  import_id uuid not null references public.service_segment_imports(id) on delete cascade,
  -- Dienstnummer als tekst, sluit aan op services."serviceNumber" (geen FK:
  -- de ET-export kan diensten bevatten die het dienstoverzicht nog niet kent).
  service_number text not null,
  -- Dagtypecode van De Lijn zoals in de export ('21/0', '26/0'); koppeling met
  -- dagtype_codes.code via split_part(dagtype_code, '/', 1).
  dagtype_code text not null,
  volgorde integer not null,
  type text not null constraint service_segments_type_check check (type in ('RIT', 'LED', 'STA', 'ONE', 'ONV', 'ONS', 'AVO', 'ANA', 'ATU', 'ANW', 'AFL')),
  -- Minuten sinds 00:00 van de dienstdag; boven 1440 = na middernacht.
  start_min integer not null,
  einde_min integer not null,
  duur_min integer not null,
  loop text,
  intern_loop text,
  lijn text,
  variant text,
  rit text,
  voertuig text,
  vertrek text,
  vertrek_code text,
  aankomst text,
  aankomst_code text,
  afstand_km numeric(7, 3),
  at_tijd text,
  vt_tijd text,
  unique (import_id, service_number, dagtype_code, volgorde)
);

-- (geen aparte index: de unique (import_id, service_number, dagtype_code, volgorde)
-- dekt de filters van getSegments en de FK-cascade)
drop index if exists public.service_segments_import_dienst_idx;

alter table public.service_segments enable row level security;
revoke all on table public.service_segments from anon, authenticated;
grant all on table public.service_segments to service_role;

-- === 3) dagtype_codes ===
create table if not exists public.dagtype_codes (
  code text primary key,
  omschrijving text not null,
  periode text,
  aantal_per_jaar integer,
  -- Dagtype van het portaal (dekking): 'schooldag' | 'vakantie' | 'zaterdag' | 'zondag'; null = niet gekoppeld.
  portaal_dagtype text,
  updated_at timestamptz not null default now()
);

-- Strak in de database (patroon user_expiries.soort): alleen de vier portaal-dagtypes of null.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'dagtype_codes_portaal_dagtype_check') then
    alter table public.dagtype_codes
      add constraint dagtype_codes_portaal_dagtype_check
      check (portaal_dagtype is null or portaal_dagtype in ('schooldag', 'vakantie', 'zaterdag', 'zondag'));
  end if;
end $$;

drop trigger if exists dagtype_codes_set_updated_at on public.dagtype_codes;
create trigger dagtype_codes_set_updated_at
  before update on public.dagtype_codes
  for each row execute function public.set_updated_at();

alter table public.dagtype_codes enable row level security;
revoke all on table public.dagtype_codes from anon, authenticated;
grant all on table public.dagtype_codes to service_role;

-- Seed uit tbl-dagcodes (13-09-2026) met een eerste mapping; de planner past
-- ze aan in Dienstopbouw › Dagtypes. Idempotent.
insert into public.dagtype_codes (code, omschrijving, periode, aantal_per_jaar, portaal_dagtype) values
  ('0', 'onbepaald', '0', 0, null),
  ('21', 'Maandag schooldag', '2', 141, 'schooldag'),
  ('22', 'Dinsdag schooldag', '2', 0, 'schooldag'),
  ('23', 'Woensdag schooldag', '2', 35, 'schooldag'),
  ('24', 'Donderdag schooldag', '2', 0, 'schooldag'),
  ('25', 'Vrijdag schooldag', '2', 0, 'schooldag'),
  ('26', 'Zaterdag', '2', 52, 'zaterdag'),
  ('27', 'Zondag', '2', 61, 'zondag'),
  ('28', 'Feestdag', '2', 0, 'zondag'),
  ('31', 'Maandag schoolvakantie', '3', 76, 'vakantie'),
  ('32', 'Dinsdag schoolvakantie', '3', 0, 'vakantie'),
  ('33', 'Woensdag schoolvakantie', '3', 0, 'vakantie'),
  ('34', 'Donderdag schoolvakantie', '3', 0, 'vakantie'),
  ('35', 'Vrijdag schoolvakantie', '3', 0, 'vakantie'),
  ('41', 'Maandag juli-augustus', '4', 0, 'vakantie'),
  ('42', 'Dinsdag juli-augustus', '4', 0, 'vakantie'),
  ('43', 'Woensdag juli-augustus', '4', 0, 'vakantie'),
  ('44', 'Donderdag juli-augustus', '4', 0, 'vakantie'),
  ('45', 'Vrijdag juli-augustus', '4', 0, 'vakantie'),
  ('51', 'Maandag examen', '5', 0, null),
  ('52', 'Dinsdag examen', '5', 0, null),
  ('53', 'Woensdag examen', '5', 0, null),
  ('54', 'Donderdag examen', '5', 0, null),
  ('55', 'Vrijdag examen', '5', 0, null)
on conflict (code) do nothing;

do $$
begin
  if to_regclass('public.service_segment_imports') is null then raise exception 'post-conditie faalt: service_segment_imports ontbreekt'; end if;
  if to_regclass('public.service_segments') is null then raise exception 'post-conditie faalt: service_segments ontbreekt'; end if;
  if to_regclass('public.dagtype_codes') is null then raise exception 'post-conditie faalt: dagtype_codes ontbreekt'; end if;
  if to_regclass('public.service_segment_imports_actief_idx') is null then raise exception 'post-conditie faalt: actief-index ontbreekt'; end if;
  if (select count(*) from public.dagtype_codes) < 24 then raise exception 'post-conditie faalt: dagtype_codes niet geseed'; end if;
end $$;

commit;

-- === Controle na het draaien ===
-- select code, omschrijving, portaal_dagtype from public.dagtype_codes order by code;   -- 24 rijen
-- select count(*) from public.service_segment_imports where actief;                     -- 0 (nog geen import)
