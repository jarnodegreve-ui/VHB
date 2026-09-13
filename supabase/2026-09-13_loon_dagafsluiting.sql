-- 2026-09-13 — Loon: dagafsluiting en Easypay-export (fase B Access-migratie).
--
-- Vervangt de kern van lijnadministratie.accdb:
--   tblDienstNummerGegevens → public.loon_codes        (loondienstcode → Easypay-parameters,
--                                                       228 rijen geseed + 'vrij')
--   PersoneelsNrEasypay     → public.loon_medewerkers  (matricule per gebruiker, in export?)
--   tblDagAdministratie     → public.dag_afsluitingen  (status per dag)
--                           + public.dag_prestaties    (per chauffeur per dag de werkelijk
--                                                       gereden code, overminuten, premie,
--                                                       kwaliteitsvlaggen)
--   tblbedrijfsgegevens.EasypayLidnr → app_settings['loon'] (jsonb)
--
-- Ontwerp: een dag wordt expliciet geopend (kopie van de cel-waarheid uit de
-- planning: matrix + goedgekeurde ruilen + verlof) en daarna bevestigd; een
-- latere her-import van de planning raakt een afgesloten dag nooit.
-- Beveiligingspatroon zoals user_expiries/meldingen: RLS aan zonder policies,
-- API-only via de service role. Idempotent.

begin;

-- === 1) loon_codes ===
create table if not exists public.loon_codes (
  -- Genormaliseerd: trim + kleine letters van de planningscode of het
  -- dienstnummer ('2102', 'bv', 'ziek', 'vrij', '-').
  code text primary key,
  -- Zoals de code in Access/Excel geschreven staat ('BV', 'Ziek').
  code_weergave text not null,
  omschrijving text,
  -- 'lijn' = lijndienst, 'varia' = afwezigheids-/andere code, 'ander' = niet-LB (car, bijzondere dienst)
  dienst_type text not null check (dienst_type in ('lijn', 'varia', 'ander')),
  in_export boolean not null default true,
  easypay_activiteit text not null default 'LIJN',
  easypay_type_prest integer not null default 0,
  -- Verplichte tiktijden 1..6 ('HH:MM'); HD = eerste gevulde van 1/3/5, HA = laatste gevulde van 6/4/2.
  tik1 text, tik2 text, tik3 text, tik4 text, tik5 text, tik6 text,
  -- Looncomponenten in minuten (informatief, uit Access; fase C leidt ze af uit de ritdelen).
  lb_rijtijd integer, lb_stat100_at integer, lb_stat100_nat integer, lb_stat50_nat integer,
  lb_ond integer, lb_and_wrk integer, lb_nacht integer,
  bron text not null default 'import' check (bron in ('import', 'handmatig', 'segments')),
  updated_at timestamptz not null default now(),
  updated_by text
);

drop trigger if exists loon_codes_set_updated_at on public.loon_codes;
create trigger loon_codes_set_updated_at
  before update on public.loon_codes
  for each row execute function public.set_updated_at();

alter table public.loon_codes enable row level security;
revoke all on table public.loon_codes from anon, authenticated;
grant all on table public.loon_codes to service_role;

-- === 2) loon_medewerkers ===
create table if not exists public.loon_medewerkers (
  -- users.id is text (zelfde conventie als meldingen.user_id); geen FK.
  user_id text primary key,
  easypay_nr integer,
  -- Access: functie like '*lijn*'. Wie niet in de export hoort (schoolbus, bureau).
  in_export boolean not null default true,
  updated_at timestamptz not null default now(),
  updated_by text
);

drop trigger if exists loon_medewerkers_set_updated_at on public.loon_medewerkers;
create trigger loon_medewerkers_set_updated_at
  before update on public.loon_medewerkers
  for each row execute function public.set_updated_at();

alter table public.loon_medewerkers enable row level security;
revoke all on table public.loon_medewerkers from anon, authenticated;
grant all on table public.loon_medewerkers to service_role;

-- === 3) dag_afsluitingen ===
create table if not exists public.dag_afsluitingen (
  datum date primary key,
  status text not null default 'open' check (status in ('open', 'afgesloten')),
  geopend_op timestamptz not null default now(),
  geopend_door text,
  afgesloten_op timestamptz,
  afgesloten_door text,
  heropend_op timestamptz,
  heropend_door text,
  heropend_reden text
);

alter table public.dag_afsluitingen enable row level security;
revoke all on table public.dag_afsluitingen from anon, authenticated;
grant all on table public.dag_afsluitingen to service_role;

-- === 4) dag_prestaties ===
create table if not exists public.dag_prestaties (
  id uuid primary key default gen_random_uuid(),
  datum date not null references public.dag_afsluitingen(datum) on delete cascade,
  user_id text not null,
  -- Access laat twee regels per persoon-dag toe (313 gevallen): volgnr 1, 2.
  volgnr smallint not null default 1,
  -- Wat de planning zei bij het openen (null = stond niet in de planning).
  planning_code text,
  -- De bevestigde loondienstcode (dienstnummer of afwezigheidscode).
  gereden_code text,
  overmin integer not null default 0,
  overmin_nacht integer not null default 0,
  overmin_extra integer not null default 0,
  onv_premie boolean not null default false,
  qual_ongeval boolean not null default false,
  qual_panne boolean not null default false,
  qual_verkeersovertreding boolean not null default false,
  qual_klantklacht boolean not null default false,
  qual_admfout boolean not null default false,
  qual_interneklacht boolean not null default false,
  qual_vertraging_dr_schuld boolean not null default false,
  qual_rit_nt_gereden_dr_schuld boolean not null default false,
  opmerking text,
  bewerkt_op timestamptz,
  bewerkt_door text,
  unique (datum, user_id, volgnr)
);

-- (geen aparte datum-index: de unique (datum, user_id, volgnr) dekt de periode-queries)
create index if not exists dag_prestaties_user_datum_idx on public.dag_prestaties (user_id, datum);

alter table public.dag_prestaties enable row level security;
revoke all on table public.dag_prestaties from anon, authenticated;
grant all on table public.dag_prestaties to service_role;

-- === 5) Seed: loon_codes uit tblDienstNummerGegevens (13-09-2026), plus 'vrij'
-- (de portaalcode voor "geen dienst", in Access '-'). Idempotent: bestaande
-- rijen (na aanpassing in het portaal) blijven staan. Let op: een code die in
-- het portaal verwijderd is, komt bij een herhaalde run terug; zet hem dan
-- liever op in_export = false.
insert into public.loon_codes (code, code_weergave, omschrijving, dienst_type, in_export, easypay_activiteit, easypay_type_prest, tik1, tik2, tik3, tik4, tik5, tik6, lb_rijtijd, lb_stat100_at, lb_stat100_nat, lb_stat50_nat, lb_ond, lb_and_wrk, lb_nacht) values
  ('vrij', 'vrij', 'Vrij (geen dienst)', 'varia', true, '01', 15102, null, null, null, null, null, null, 0, 0, 0, 0, null, 0, 0),
  ('-', '-', null, 'varia', true, '01', 15102, null, null, null, null, null, null, 0, 0, 0, 0, null, 0, 0),
  ('21001', '21001', null, 'lijn', true, 'LIJN', 40140, '04:32', '08:33', '15:50', '19:52', null, null, 404, 28, 21, 0, 1, 0, 88),
  ('21002', '21002', null, 'lijn', true, 'LIJN', 40140, '05:28', '12:13', '15:28', '17:27', null, null, 449, 41, 4, 0, 1, 0, 32),
  ('21003', '21003', null, 'lijn', true, 'LIJN', 40140, '05:44', '13:13', '15:42', '18:37', null, null, 455, 78, 61, 0, 1, 0, 16),
  ('21004', '21004', null, 'lijn', true, 'LIJN', 40140, '06:07', '14:19', '15:54', '17:56', null, null, 495, 48, 36, 5, 1, 0, 0),
  ('21005', '21005', null, 'lijn', true, 'LIJN', 40140, '06:21', '08:54', '12:20', '17:55', null, null, 352, 45, 36, 25, 1, 0, 0),
  ('21006', '21006', null, 'lijn', true, 'LIJN', 40140, '06:08', '12:20', '14:19', '19:32', null, null, 519, 69, 60, 7, 1, 0, 0),
  ('21007', '21007', null, 'lijn', true, 'LIJN', 40140, '06:32', '08:34', '12:05', '19:02', null, null, 422, 59, 28, 0, 1, 0, 0),
  ('21008', '21008', null, 'lijn', true, 'LIJN', 40140, '06:44', '08:43', '15:28', '20:36', null, null, 367, 28, 2, 0, 1, 0, 36),
  ('21009', '21009', null, 'lijn', true, 'LIJN', 40140, '06:55', '08:30', '13:13', '20:46', null, null, 423, 65, 30, 0, 1, 0, 46),
  ('2101', '2101', null, 'lijn', true, 'LIJN', 40140, '04:32', '08:18', '15:35', '19:52', null, null, 404, 28, 21, 0, 1, 0, 88),
  ('21010', '21010', null, 'lijn', true, 'LIJN', 40140, '06:53', '08:31', '15:54', '23:37', null, null, 462, 68, 1, 0, 1, 0, 217),
  ('21011', '21011', null, 'lijn', true, 'LIJN', 40140, '07:18', '08:48', '15:58', '23:36', null, null, 428, 69, 21, 0, 1, 0, 216),
  ('2102', '2102', null, 'lijn', true, 'LIJN', 40140, '05:28', '11:58', '15:13', '17:27', null, null, 449, 41, 4, 0, 1, 0, 32),
  ('2103', '2103', null, 'lijn', true, 'LIJN', 40140, '05:44', '13:13', '15:42', '18:37', null, null, 455, 78, 61, 0, 1, 0, 16),
  ('2104', '2104', null, 'lijn', true, 'LIJN', 40140, '06:07', '14:19', '15:54', '17:56', null, null, 495, 48, 36, 5, 1, 0, 0),
  ('2105', '2105', null, 'lijn', true, 'LIJN', 40140, '06:21', '08:39', '12:05', '17:55', null, null, 352, 45, 36, 25, 1, 0, 0),
  ('2106', '2106', null, 'lijn', true, 'LIJN', 40140, '06:30', '12:20', '14:19', '19:32', null, null, 532, 69, 40, 7, 1, 0, 0),
  ('2107', '2107', null, 'lijn', true, 'LIJN', 40140, '06:32', '08:34', '12:05', '19:02', null, null, 422, 59, 28, 0, 1, 0, 0),
  ('2108', '2108', null, 'lijn', true, 'LIJN', 40140, '06:44', '08:28', '15:13', '20:36', null, null, 367, 28, 2, 0, 1, 0, 36),
  ('2109', '2109', null, 'lijn', true, 'LIJN', 40140, '06:55', '08:15', '12:58', '20:46', null, null, 423, 65, 30, 0, 1, 0, 46),
  ('2110', '2110', null, 'lijn', true, 'LIJN', 40140, '06:53', '08:16', '15:39', '23:37', null, null, 462, 68, 1, 0, 1, 0, 217),
  ('21103', '21103', null, 'lijn', true, 'LIJN', 40140, null, null, null, null, null, null, 0, 0, 0, 0, null, 0, 0),
  ('21106', '21106', null, 'lijn', true, 'LIJN', 40140, null, null, null, null, null, null, 0, 0, 0, 0, null, 0, 0),
  ('21107', '21107', null, 'lijn', true, 'LIJN', 40140, null, null, null, null, null, null, 0, 0, 0, 0, 0, 0, 0),
  ('2111', '2111', null, 'lijn', true, 'LIJN', 40140, '07:18', '08:16', '15:43', '23:36', null, null, 426, 50, 20, 0, 1, 0, 216),
  ('2112', '2112', null, 'lijn', true, 'LIJN', 40140, '07:18', '08:31', '15:58', '23:35', null, null, 426, 50, 20, 0, 1, 0, 216),
  ('2113', '2113', null, 'lijn', true, 'LIJN', 40140, null, null, null, null, null, null, 0, 0, 0, 0, 0, 0, 0),
  ('2114', '2114', null, 'lijn', true, 'LIJN', 40140, null, null, null, null, null, null, 0, 0, 0, 0, 0, 0, 0),
  ('2115', '2115', null, 'lijn', true, 'LIJN', 40140, null, null, null, null, null, null, 0, 0, 0, 0, 0, 0, 0),
  ('2116', '2116', null, 'lijn', true, 'LIJN', 40140, null, null, null, null, null, null, 0, 0, 0, 0, 0, 0, 0),
  ('2117', '2117', null, 'lijn', true, 'LIJN', 40140, null, null, null, null, null, null, 0, 0, 0, 0, 0, 0, 0),
  ('2118', '2118', null, 'lijn', true, 'LIJN', 40140, null, null, null, null, null, null, 0, 0, 0, 0, 0, 0, 0),
  ('2119', '2119', null, 'lijn', true, 'LIJN', 40140, null, null, null, null, null, null, 0, 0, 0, 0, 0, 0, 0),
  ('2120', '2120', null, 'lijn', true, 'LIJN', 40140, null, null, null, null, null, null, 0, 0, 0, 0, 0, 0, 0),
  ('2151', '2151', null, 'lijn', true, 'LIJN', 40140, '16:07', '18:10', null, null, null, null, 98, 0, 0, 0, 1, 0, 0),
  ('2152', '2152', null, 'lijn', true, 'LIJN', 40140, '16:40', '18:35', null, null, null, null, 90, 0, 0, 0, 1, 0, 0),
  ('21812', '21812', null, 'lijn', true, 'LIJN', 40140, null, null, null, null, null, null, 0, 0, 0, 0, null, 0, 0),
  ('21813', '21813', null, 'lijn', true, 'LIJN', 40140, null, null, null, null, null, null, 0, 0, 0, 0, null, 0, 0),
  ('2205', '2205', null, 'lijn', true, 'LIJN', 40140, null, null, null, null, null, null, 0, 0, 0, 0, 0, 0, 0),
  ('2208', '2208', null, 'lijn', true, 'LIJN', 40140, null, null, null, null, null, null, 0, 0, 0, 0, 0, 0, 0),
  ('22117', '22117', null, 'lijn', true, 'LIJN', 40140, null, null, null, null, null, null, 0, 0, 0, 0, 0, 0, 0),
  ('22118', '22118', null, 'lijn', true, 'LIJN', 40140, null, null, null, null, null, null, 0, 0, 0, 0, 0, 0, 0),
  ('23001', '23001', null, 'lijn', true, 'LIJN', 40140, '04:32', '08:18', '11:54', '13:03', '17:09', '19:52', 386, 21, 21, 0, 2, 0, 88),
  ('23002', '23002', null, 'lijn', true, 'LIJN', 40140, '05:28', '13:39', null, null, null, null, 394, 70, 12, 0, null, 0, 32),
  ('23003', '23003', null, 'lijn', true, 'LIJN', 40140, '05:44', '13:13', '15:42', '18:37', null, null, 455, 78, 61, 0, 1, 0, 16),
  ('23004', '23004', null, 'lijn', true, 'LIJN', 40140, '06:07', '14:19', '15:54', '17:56', null, null, 495, 48, 36, 5, 1, 0, 0),
  ('23005', '23005', null, 'lijn', true, 'LIJN', 40140, '06:21', '08:54', '12:20', '17:36', null, null, 352, 45, 36, 6, 1, 0, 0),
  ('23006', '23006', null, 'lijn', true, 'LIJN', 40140, '06:21', '12:20', '14:19', '19:32', null, null, 531, 69, 50, 7, 1, 0, 0),
  ('23007', '23007', null, 'lijn', true, 'LIJN', 40140, '06:32', '08:49', '12:20', '19:02', null, null, 422, 59, 28, 0, 1, 0, 0),
  ('23008', '23008', null, 'lijn', true, 'LIJN', 40140, '06:44', '08:28', '11:55', '13:25', '15:28', '20:36', 418, 43, 11, 0, 2, 0, 36),
  ('23009', '23009', null, 'lijn', true, 'LIJN', 40140, '06:55', '08:31', '11:44', '20:46', null, null, 461, 82, 60, 5, 1, 0, 46),
  ('2301', '2301', null, 'lijn', true, 'LIJN', 40140, '04:32', '08:18', '11:54', '13:03', '17:09', '19:52', 386, 21, 21, 0, 2, 0, 88),
  ('23010', '23010', null, 'lijn', true, 'LIJN', 40140, '06:53', '08:30', '15:54', '23:37', null, null, 463, 66, 1, 0, 1, 0, 217),
  ('23011', '23011', null, 'lijn', true, 'LIJN', 40140, '07:18', '08:48', '11:56', '13:26', '15:58', '23:36', 516, 65, 27, 0, 2, 0, 216),
  ('2302', '2302', null, 'lijn', true, 'LIJN', 40140, '05:28', '13:39', null, null, null, null, 394, 70, 12, 0, 0, 0, 32),
  ('2303', '2303', null, 'lijn', true, 'LIJN', 40140, '05:44', '13:13', '15:42', '18:37', null, null, 455, 78, 61, 0, 1, 0, 16),
  ('2304', '2304', null, 'lijn', true, 'LIJN', 40140, '06:07', '14:19', '15:54', '17:56', null, null, 495, 48, 36, 5, 1, 0, 0),
  ('2305', '2305', null, 'lijn', true, 'LIJN', 40140, '06:30', '08:39', '12:05', '17:36', null, null, 359, 44, 34, 6, 1, 0, 0),
  ('2306', '2306', null, 'lijn', true, 'LIJN', 40140, '06:21', '12:20', '14:19', '19:22', null, null, 559, 69, 50, 7, 1, 0, 0),
  ('2307', '2307', null, 'lijn', true, 'LIJN', 40140, '06:32', '08:34', '12:05', '19:02', null, null, 422, 59, 28, 0, 1, 0, 0),
  ('2308', '2308', null, 'lijn', true, 'LIJN', 40140, '06:44', '08:28', '11:55', '13:25', '15:28', '20:36', 418, 28, 2, 0, 2, 0, 36),
  ('2309', '2309', null, 'lijn', true, 'LIJN', 40140, '06:55', '08:16', '11:29', '20:46', null, null, 461, 82, 60, 5, 1, 0, 46),
  ('2310', '2310', null, 'lijn', true, 'LIJN', 40140, '06:53', '08:15', '15:39', '23:37', null, null, 463, 66, 1, 0, 1, 0, 217),
  ('23107', '23107', null, 'lijn', true, 'LIJN', 40140, null, null, null, null, null, null, 0, 0, 0, 0, null, 0, 0),
  ('2311', '2311', null, 'lijn', true, 'LIJN', 40140, '07:18', '08:16', '11:41', '13:26', '15:58', '23:35', 516, 50, 20, 0, 1, 0, 216),
  ('2312', '2312', null, 'lijn', true, 'LIJN', 40140, '07:18', '08:31', '11:56', '13:26', '19:22', '23:35', 0, 0, 0, 0, 0, 0, 0),
  ('2313', '2313', null, 'lijn', true, 'LIJN', 40140, null, null, null, null, null, null, 0, 0, 0, 0, 0, 0, 0),
  ('2314', '2314', null, 'lijn', true, 'LIJN', 40140, null, null, null, null, null, null, 0, 0, 0, 0, 0, 0, 0),
  ('2315', '2315', null, 'lijn', true, 'LIJN', 40140, null, null, null, null, null, null, 0, 0, 0, 0, 0, 0, 0),
  ('2316', '2316', null, 'lijn', true, 'LIJN', 40140, null, null, null, null, null, null, 0, 0, 0, 0, 0, 0, 0),
  ('2317', '2317', null, 'lijn', true, 'LIJN', 40140, null, null, null, null, null, null, 0, 0, 0, 0, 0, 0, 0),
  ('2318', '2318', null, 'lijn', true, 'LIJN', 40140, null, null, null, null, null, null, 0, 0, 0, 0, 0, 0, 0),
  ('2319', '2319', null, 'lijn', true, 'LIJN', 40140, null, null, null, null, null, null, 0, 0, 0, 0, 0, 0, 0),
  ('2351', '2351', null, 'lijn', true, 'LIJN', 40140, '16:07', '18:10', null, null, null, null, 98, 0, 0, 0, 1, 0, 0),
  ('2352', '2352', null, 'lijn', true, 'LIJN', 40140, null, null, null, null, null, null, 0, 0, 0, 0, null, 0, 0),
  ('23812', '23812', null, 'lijn', true, 'LIJN', 40140, null, null, null, null, null, null, 0, 0, 0, 0, null, 0, 0),
  ('23813', '23813', null, 'lijn', true, 'LIJN', 40140, null, null, null, null, null, null, 0, 0, 0, 0, null, 0, 0),
  ('24101', '24101', null, 'lijn', true, 'LIJN', 40140, '04:32', '08:33', '14:30', '19:52', null, null, 454, 58, 21, 0, 1, 0, 88),
  ('24106', '24106', null, 'lijn', true, 'LIJN', 40140, null, null, null, null, null, null, 0, 0, 0, 0, null, 0, 0),
  ('24111', '24111', null, 'lijn', true, 'LIJN', 40140, '07:18', '08:48', '13:00', '23:36', null, null, 472, 119, 65, 40, 1, 0, 216),
  ('24114', '24114', null, 'lijn', true, 'LIJN', 40140, null, null, null, null, null, null, 0, 0, 0, 0, 0, 0, 0),
  ('24117', '24117', null, 'lijn', true, 'LIJN', 40140, null, null, null, null, null, null, 0, 0, 0, 0, 0, 0, 0),
  ('24118', '24118', null, 'lijn', true, 'LIJN', 40140, null, null, null, null, null, null, 0, 0, 0, 0, 0, 0, 0),
  ('25011', '25011', null, 'lijn', true, 'LIJN', 40140, null, null, null, null, null, null, 0, 0, 0, 0, null, 0, 0),
  ('25111', '25111', null, 'lijn', true, 'LIJN', 40140, '07:18', '11:50', '15:58', '23:36', null, null, 563, 78, 49, 25, 1, 0, 216),
  ('2518', '2518', null, 'lijn', true, 'LIJN', 40140, null, null, null, null, null, null, 0, 0, 0, 0, 0, 0, 0),
  ('2519', '2519', null, 'lijn', true, 'LIJN', 40140, null, null, null, null, null, null, 0, 0, 0, 0, 0, 0, 0),
  ('2520', '2520', null, 'lijn', true, 'LIJN', 40140, null, null, null, null, null, null, 0, 0, 0, 0, 0, 0, 0),
  ('25211', '25211', null, 'lijn', true, 'LIJN', 40140, '07:18', '12:15', '15:58', '23:36', null, null, 553, 84, 53, 50, 1, 0, 216),
  ('26001', '26001', null, 'lijn', true, 'LIJN', 40140, '05:33', '14:22', null, null, null, null, 433, 49, 32, 0, 0, 0, 27),
  ('26002', '26002', null, 'lijn', true, 'LIJN', 40140, '06:22', '15:28', null, null, null, null, 440, 55, 34, 2, 0, 0, 0),
  ('2601', '2601', null, 'lijn', true, 'LIJN', 40140, '05:33', '14:12', null, null, null, null, 433, 49, 32, 0, 0, 0, 27),
  ('26011', '26011', null, 'lijn', true, 'LIJN', 40140, '14:07', '23:51', null, null, null, null, 483, 61, 25, 0, 0, 0, 231),
  ('26012', '26012', null, 'lijn', true, 'LIJN', 40140, '15:13', '23:30', null, null, null, null, 428, 42, 12, 0, 0, 0, 210),
  ('2602', '2602', null, 'lijn', true, 'LIJN', 40140, '06:22', '15:18', null, null, null, null, 440, 55, 34, 2, 0, 0, 0),
  ('2603', '2603', null, 'lijn', true, 'LIJN', 40140, null, null, null, null, null, null, 0, 0, 0, 0, 0, 0, 0),
  ('2604', '2604', null, 'lijn', true, 'LIJN', 40140, null, null, null, null, null, null, 0, 0, 0, 0, 0, 0, 0),
  ('2605', '2605', null, 'lijn', true, 'LIJN', 40140, null, null, null, null, null, null, 0, 0, 0, 0, 0, 0, 0),
  ('2606', '2606', null, 'lijn', true, 'LIJN', 40140, null, null, null, null, null, null, 0, 0, 0, 0, 0, 0, 0),
  ('2607', '2607', null, 'lijn', true, 'LIJN', 40140, null, null, null, null, null, null, 0, 0, 0, 0, 0, 0, 0),
  ('2608', '2608', null, 'lijn', true, 'LIJN', 40140, null, null, null, null, null, null, 0, 0, 0, 0, 0, 0, 0),
  ('2611', '2611', null, 'lijn', true, 'LIJN', 40140, '14:07', '23:51', null, null, null, null, 484, 60, 25, 0, 0, 0, 231),
  ('2612', '2612', null, 'lijn', true, 'LIJN', 40140, '15:13', '23:30', null, null, null, null, 429, 41, 12, 0, 0, 0, 210),
  ('2651', '2651', null, 'lijn', true, 'LIJN', 40140, null, null, null, null, null, null, 0, 0, 0, 0, 0, 0, 0),
  ('2652', '2652', null, 'lijn', true, 'LIJN', 40140, null, null, null, null, null, null, 0, 0, 0, 0, 0, 0, 0),
  ('27001', '27001', null, 'lijn', true, 'LIJN', 40140, '06:28', '14:32', null, null, null, null, 375, 39, 42, 13, 0, 0, 0),
  ('27002', '27002', null, 'lijn', true, 'LIJN', 40140, '10:43', '16:48', null, null, null, null, 271, 45, 34, 0, 0, 0, 0),
  ('2701', '2701', null, 'lijn', true, 'LIJN', 40140, '06:28', '14:32', null, null, null, null, 375, 39, 42, 13, 0, 0, 0),
  ('27011', '27011', null, 'lijn', true, 'LIJN', 40140, '14:17', '22:32', null, null, null, null, 421, 47, 12, 0, 0, 0, 152),
  ('27012', '27012', null, 'lijn', true, 'LIJN', 40140, '16:33', '23:32', null, null, null, null, 360, 32, 12, 0, 0, 0, 212),
  ('2702', '2702', null, 'lijn', true, 'LIJN', 40140, '10:40', '16:38', null, null, null, null, 274, 45, 34, 0, 0, 0, 0),
  ('2703', '2703', null, 'lijn', true, 'LIJN', 40140, null, null, null, null, null, null, 0, 0, 0, 0, 0, 0, 0),
  ('2704', '2704', null, 'lijn', true, 'LIJN', 40140, null, null, null, null, null, null, 0, 0, 0, 0, 0, 0, 0),
  ('2705', '2705', null, 'lijn', true, 'LIJN', 40140, null, null, null, null, null, null, 0, 0, 0, 0, 0, 0, 0),
  ('2711', '2711', null, 'lijn', true, 'LIJN', 40140, '14:17', '22:32', null, null, null, null, 428, 45, 12, 0, 0, 0, 152),
  ('2712', '2712', null, 'lijn', true, 'LIJN', 40140, '16:33', '23:32', null, null, null, null, 367, 30, 12, 0, 0, 0, 212),
  ('2751', '2751', null, 'lijn', true, 'LIJN', 40140, null, null, null, null, null, null, 0, 0, 0, 0, 0, 0, 0),
  ('2752', '2752', null, 'lijn', true, 'LIJN', 40140, null, null, null, null, null, null, 0, 0, 0, 0, 0, 0, 0),
  ('41001', '41001', null, 'lijn', true, 'LIJN', 40140, '04:28', '08:32', '12:22', '15:36', null, null, 382, 26, 0, 0, 1, 0, 92),
  ('41002', '41002', null, 'lijn', true, 'LIJN', 40140, '05:28', '14:59', null, null, null, null, 480, 56, 20, 0, 0, 0, 32),
  ('41003', '41003', null, 'lijn', true, 'LIJN', 40140, '05:45', '11:47', null, null, null, null, 275, 45, 27, 0, 0, 0, 15),
  ('41004', '41004', null, 'lijn', true, 'LIJN', 40140, '05:43', '13:07', '16:43', '19:58', null, null, 445, 75, 78, 11, 1, 0, 17),
  ('41005', '41005', null, 'lijn', true, 'LIJN', 40140, '06:11', '14:49', null, null, null, null, 430, 47, 26, 0, 0, 0, 0),
  ('41006', '41006', null, 'lijn', true, 'LIJN', 40140, '11:32', '19:07', null, null, null, null, 402, 32, 6, 0, 0, 0, 0),
  ('41007', '41007', null, 'lijn', true, 'LIJN', 40140, '08:32', '12:37', '15:11', '20:04', null, null, 459, 47, 7, 0, 1, 0, 4),
  ('41008', '41008', null, 'lijn', true, 'LIJN', 40140, '14:34', '23:29', null, null, null, null, 417, 68, 35, 0, 0, 0, 209),
  ('41009', '41009', null, 'lijn', true, 'LIJN', 40140, '14:44', '23:30', null, null, null, null, 421, 55, 35, 0, 0, 0, 210),
  ('4101', '4101', null, 'lijn', true, 'LIJN', 40140, '04:31', '08:32', '12:22', '15:36', null, null, 379, 26, 0, 0, 1, 0, 89),
  ('4102', '4102', null, 'lijn', true, 'LIJN', 40140, '05:31', '14:49', null, null, null, null, 476, 57, 20, 0, 0, 0, 29),
  ('4103', '4103', null, 'lijn', true, 'LIJN', 40140, '05:45', '11:47', null, null, null, null, 275, 45, 27, 0, 0, 0, 15),
  ('4104', '4104', null, 'lijn', true, 'LIJN', 40140, '05:43', '13:07', '16:43', '19:58', null, null, 461, 74, 78, 11, 1, 0, 17),
  ('4105', '4105', null, 'lijn', true, 'LIJN', 40140, '06:11', '14:49', null, null, null, null, 430, 47, 26, 0, 0, 0, 0),
  ('4106', '4106', null, 'lijn', true, 'LIJN', 40140, '11:32', '19:07', null, null, null, null, 402, 32, 6, 0, 0, 0, 0),
  ('4107', '4107', null, 'lijn', true, 'LIJN', 40140, '08:27', '12:37', '15:11', '20:04', null, null, 464, 47, 7, 0, 1, 0, 4),
  ('4108', '4108', null, 'lijn', true, 'LIJN', 40140, '14:34', '23:29', null, null, null, null, 420, 70, 35, 0, 0, 0, 209),
  ('4109', '4109', null, 'lijn', true, 'LIJN', 40140, '14:44', '23:30', null, null, null, null, 424, 56, 36, 0, 0, 0, 210),
  ('4110', '4110', null, 'lijn', true, 'LIJN', 40140, '14:48', '23:29', null, null, null, null, 0, 0, 0, 0, 0, 0, 209),
  ('4111', '4111', null, 'lijn', true, 'LIJN', 40140, null, null, null, null, null, null, 0, 0, 0, 0, 0, 0, 0),
  ('4112', '4112', null, 'lijn', true, 'LIJN', 40140, null, null, null, null, null, null, 0, 0, 0, 0, 0, 0, 0),
  ('4113', '4113', null, 'lijn', true, 'LIJN', 40140, null, null, null, null, null, null, 0, 0, 0, 0, 0, 0, 0),
  ('4151', '4151', null, 'lijn', true, 'LIJN', 40140, null, null, null, null, null, null, 0, 0, 0, 0, 0, 0, 0),
  ('4152', '4152', null, 'lijn', true, 'LIJN', 40140, null, null, null, null, null, null, 0, 0, 0, 0, 0, 0, 0),
  ('4512', '4512', null, 'lijn', true, 'LIJN', 40140, null, null, null, null, null, null, 0, 0, 0, 0, 0, 0, 0),
  ('4513', '4513', null, 'lijn', true, 'LIJN', 40140, null, null, null, null, null, null, 0, 0, 0, 0, 0, 0, 0),
  ('51001', '51001', null, 'lijn', true, 'LIJN', 40140, '04:32', '08:33', '11:56', '13:26', '15:50', '19:52', 494, 28, 21, 0, 2, 0, 88),
  ('51002', '51002', null, 'lijn', true, 'LIJN', 40140, '05:28', '12:08', null, null, null, null, 340, 41, 4, 0, 0, 0, 32),
  ('51008', '51008', null, 'lijn', true, 'LIJN', 40140, '06:44', '08:43', '11:40', '12:46', '15:28', '20:36', 418, 28, 2, 0, 2, 0, 36),
  ('5101', '5101', null, 'lijn', true, 'LIJN', 40140, '04:32', '08:18', '11:41', '13:26', '15:50', '19:52', 494, 28, 21, 0, 1, 0, 88),
  ('5102', '5102', null, 'lijn', true, 'LIJN', 40140, '05:28', '12:08', null, null, null, null, 340, 41, 4, 0, 0, 0, 32),
  ('5103', '5103', null, 'lijn', true, 'LIJN', 40140, null, null, null, null, null, null, 0, 0, 0, 0, 0, 0, 0),
  ('5104', '5104', null, 'lijn', true, 'LIJN', 40140, null, null, null, null, null, null, 0, 0, 0, 0, 0, 0, 0),
  ('5105', '5105', null, 'lijn', true, 'LIJN', 40140, null, null, null, null, null, null, 0, 0, 0, 0, 0, 0, 0),
  ('5108', '5108', null, 'lijn', true, 'LIJN', 40140, '06:44', '08:18', '11:40', '12:46', '15:28', '20:36', 408, 28, 2, 0, 1, 0, 36),
  ('5109', '5109', null, 'lijn', true, 'LIJN', 40140, '06:37', '08:28', '11:05', '13:25', '15:25', '20:44', 408, 28, 2, 0, 1, 0, 36),
  ('5110', '5110', null, 'lijn', true, 'LIJN', 40140, null, null, null, null, null, null, 0, 0, 0, 0, 0, 0, 0),
  ('5111', '5111', null, 'lijn', true, 'LIJN', 40140, null, null, null, null, null, null, 0, 0, 0, 0, 0, 0, 0),
  ('5113', '5113', null, 'lijn', true, 'LIJN', 40140, null, null, null, null, null, null, 0, 0, 0, 0, 0, 0, 0),
  ('5116', '5116', null, 'lijn', true, 'LIJN', 40140, null, null, null, null, null, null, 0, 0, 0, 0, 0, 0, 0),
  ('5117', '5117', null, 'lijn', true, 'LIJN', 40140, null, null, null, null, null, null, 0, 0, 0, 0, 0, 0, 0),
  ('51853', '51853', null, 'lijn', true, 'LIJN', 40140, null, null, null, null, null, null, 151, 2, 0, 0, null, 4, 0),
  ('54101', '54101', null, 'lijn', true, 'LIJN', 40140, '04:32', '08:33', '11:56', '19:52', null, null, 544, 73, 51, 19, 1, 0, 88),
  ('7107', '7107', null, 'lijn', true, 'LIJN', 40140, null, null, null, null, null, null, 0, 0, 0, 0, 0, 0, 0),
  ('7218', '7218', null, 'lijn', true, 'LIJN', 40140, null, null, null, null, null, null, 0, 0, 0, 0, 0, 0, 0),
  ('7414', '7414', null, 'lijn', true, 'LIJN', 40140, null, null, null, null, null, null, 0, 0, 0, 0, 0, 0, 0),
  ('92701', '92701', null, 'lijn', true, 'LIJN', 40140, null, null, null, null, null, null, 0, 0, 0, 0, 0, 0, 0),
  ('92702', '92702', null, 'lijn', true, 'LIJN', 40140, null, null, null, null, null, null, 0, 0, 0, 0, 0, 0, 0),
  ('92711', '92711', null, 'lijn', true, 'LIJN', 40140, null, null, null, null, null, null, 0, 0, 0, 0, 0, 0, 0),
  ('92712', '92712', null, 'lijn', true, 'LIJN', 40140, null, null, null, null, null, null, 0, 0, 0, 0, 0, 0, 0),
  ('94101', '94101', null, 'lijn', true, 'LIJN', 40140, null, null, null, null, null, null, 0, 0, 0, 0, 0, 0, 0),
  ('94102', '94102', null, 'lijn', true, 'LIJN', 40140, null, null, null, null, null, null, 0, 0, 0, 0, 0, 0, 0),
  ('94103', '94103', null, 'lijn', true, 'LIJN', 40140, null, null, null, null, null, null, 0, 0, 0, 0, 0, 0, 0),
  ('94104', '94104', null, 'lijn', true, 'LIJN', 40140, null, null, null, null, null, null, 0, 0, 0, 0, 0, 0, 0),
  ('94105', '94105', null, 'lijn', true, 'LIJN', 40140, null, null, null, null, null, null, 0, 0, 0, 0, 0, 0, 0),
  ('94106', '94106', null, 'lijn', true, 'LIJN', 40140, null, null, null, null, null, null, 0, 0, 0, 0, 0, 0, 0),
  ('94107', '94107', null, 'lijn', true, 'LIJN', 40140, null, null, null, null, null, null, 0, 0, 0, 0, 0, 0, 0),
  ('94108', '94108', null, 'lijn', true, 'LIJN', 40140, null, null, null, null, null, null, 0, 0, 0, 0, 0, 0, 0),
  ('94109', '94109', null, 'lijn', true, 'LIJN', 40140, null, null, null, null, null, null, 0, 0, 0, 0, 0, 0, 0),
  ('94110', '94110', null, 'lijn', true, 'LIJN', 40140, null, null, null, null, null, null, 0, 0, 0, 0, 0, 0, 0),
  ('9999', '9999', null, 'lijn', true, 'LIJN', 40140, null, null, null, null, null, null, 0, 0, 0, 0, 0, 0, 0),
  ('99999', '99999', null, 'lijn', true, 'LIJN', 40140, null, null, null, null, null, null, 0, 0, 0, 0, 0, 0, 0),
  ('adm', 'adm', null, 'varia', true, 'AUT', 40115, null, null, null, null, null, null, 0, 0, 0, 0, null, 0, 0),
  ('bijzdienst', 'BijzDienst', null, 'ander', false, 'SP', 40195, null, null, null, null, null, null, 0, 0, 0, 0, null, 0, 0),
  ('bv', 'BV', 'Betaald verlof', 'varia', true, '01', 15200, null, null, null, null, null, null, 0, 0, 0, 0, null, 0, 0),
  ('bva', 'Bva', 'ancienniteitsverlof', 'varia', true, '01', 15240, null, null, null, null, null, null, 0, 0, 0, 0, 0, 0, 0),
  ('car', 'Car', 'Car-activiteit', 'ander', false, 'TOUR', 20180, null, null, null, null, null, null, 0, 0, 0, 0, null, 0, 0),
  ('ev', 'EV', 'Educatief verlof', 'varia', true, '02', 15160, null, null, null, null, null, null, 0, 0, 0, 0, null, 0, 0),
  ('ew', 'EW', 'Econom werkloos', 'varia', true, '01', 15400, null, null, null, null, null, null, 0, 0, 0, 0, null, 0, 0),
  ('f', 'F', 'betaalde Feestdag', 'varia', true, '01', 15100, null, null, null, null, null, null, 0, 0, 0, 0, null, 0, 0),
  ('fv', 'FV', 'Familiaal verlof', 'varia', true, '01', 15660, null, null, null, null, null, null, 0, 0, 0, 0, null, 0, 0),
  ('gar', 'gar', null, 'varia', true, 'GAR', 40920, null, null, null, null, null, null, 0, 0, 0, 0, null, 0, 0),
  ('hz', 'HZ', 'herval ziekte<14d', 'varia', true, '01', 15890, null, null, null, null, null, null, 0, 0, 0, 0, null, 0, 0),
  ('kv', 'KV', 'klein verlet', 'varia', true, '01', 15110, null, null, null, null, null, null, 0, 0, 0, 0, null, 0, 0),
  ('lijndienst', 'Lijndienst', null, 'lijn', true, 'LIJN', 40115, null, null, null, null, null, null, 0, 0, 0, 0, null, 0, 0),
  ('m2101', 'M2101', null, 'lijn', true, 'LIJN', 40140, null, null, null, null, null, null, 0, 0, 0, 0, 0, 0, 0),
  ('nmbs', 'nmbs', null, 'varia', true, 'TOUR', 40155, null, null, null, null, null, null, 0, 0, 0, 0, null, 0, 0),
  ('opl', 'Opl', null, 'varia', true, '02', 15024, null, null, null, null, null, null, 0, 0, 0, 0, null, 0, 0),
  ('ov', 'OV', 'ouderschapsverlof', 'varia', true, 'AUT', 15260, null, null, null, null, null, null, 0, 0, 0, 0, null, 0, 0),
  ('rn', 'RN', 'recup niet betaald', 'varia', true, '01', 15171, null, null, null, null, null, null, 0, 0, 0, 0, 0, 0, 0),
  ('sol', 'SOL', 'Solicitatieverlof', 'varia', true, '01', 15165, null, null, null, null, null, null, 0, 0, 0, 0, 0, 0, 0),
  ('st', 'ST', 'staking', 'varia', true, '01', 15472, null, null, null, null, null, null, 0, 0, 0, 0, 0, 0, 0),
  ('sv', 'SV', 'Syndicale verplichting', 'varia', true, '01', 15180, null, null, null, null, null, null, 0, 0, 0, 0, 0, 0, 0),
  ('ta', 'TA', 'verlof zonder wedde', 'varia', true, '01', 15206, null, null, null, null, null, null, 0, 0, 0, 0, null, 0, 0),
  ('tk', 'Tk', 'tijdkrediet deeltijd', 'varia', true, '01', 15501, null, null, null, null, null, null, 0, 0, 0, 0, 0, 0, 0),
  ('tkdeel', 'Tkdeel', 'tijdkrediet deeltijd', 'varia', true, '01', 15501, null, null, null, null, null, null, 0, 0, 0, 0, null, 0, 0),
  ('tkvoll', 'Tkvoll', 'tijdkrediet voltijds', 'varia', true, '01', 15511, null, null, null, null, null, null, 0, 0, 0, 0, 0, 0, 0),
  ('tw', 'tw', 'tijdelijk werkloos', 'varia', true, '01', 15430, null, null, null, null, null, null, 0, 0, 0, 0, null, 0, 0),
  ('va', 'va', 'vaderschapsverlof', 'varia', true, '01', 15532, null, null, null, null, null, null, 0, 0, 0, 0, null, 0, 0),
  ('ziek', 'Ziek', 'ziekte', 'varia', true, '01', 15800, null, null, null, null, null, null, 0, 0, 0, 0, null, 0, 0),
  ('2204', '2204', null, 'lijn', true, 'LIJN', 40140, null, null, null, null, null, null, 0, 0, 0, 0, 0, 0, 0),
  ('2214', '2214', null, 'lijn', true, 'LIJN', 40140, null, null, null, null, null, null, 0, 0, 0, 0, 0, 0, 0),
  ('5106', '5106', null, 'lijn', true, 'LIJN', 40140, null, null, null, null, null, null, 0, 0, 0, 0, 0, 0, 0),
  ('5207', '5207', null, 'lijn', true, 'LIJN', 40140, null, null, null, null, null, null, 0, 0, 0, 0, 0, 0, 0),
  ('2207', '2207', null, 'lijn', true, 'LIJN', 40140, null, null, null, null, null, null, 0, 0, 0, 0, 0, 0, 0),
  ('5107', '5107', null, 'lijn', true, 'LIJN', 40140, null, null, null, null, null, null, 0, 0, 0, 0, 0, 0, 0),
  ('5114', '5114', null, 'lijn', true, 'LIJN', 40140, null, null, null, null, null, null, 0, 0, 0, 0, 0, 0, 0),
  ('2516', '2516', null, 'lijn', true, 'LIJN', 40140, null, null, null, null, null, null, 0, 0, 0, 0, 0, 0, 0),
  ('2517', '2517', null, 'lijn', true, 'LIJN', 40140, null, null, null, null, null, null, 0, 0, 0, 0, 0, 0, 0),
  ('5112', '5112', null, 'lijn', true, 'LIJN', 40140, null, null, null, null, null, null, 0, 0, 0, 0, 0, 0, 0),
  ('7216', '7216', null, 'lijn', true, 'LIJN', 40140, null, null, null, null, null, null, 0, 0, 0, 0, 0, 0, 0),
  ('7403', '7403', null, 'lijn', true, 'LIJN', 40140, null, null, null, null, null, null, 0, 0, 0, 0, 0, 0, 0),
  ('7104', '7104', null, 'lijn', true, 'LIJN', 40140, null, null, null, null, null, null, 0, 0, 0, 0, 0, 0, 0),
  ('bru4462', 'BRU4462', null, 'lijn', true, 'LIJN', 40140, null, null, null, null, null, null, 0, 0, 0, 0, 0, 0, 0),
  ('7411', '7411', null, 'lijn', true, 'LIJN', 40140, null, null, null, null, null, null, 0, 0, 0, 0, 0, 0, 0),
  ('4406', '4406', null, 'lijn', true, 'LIJN', 40140, null, null, null, null, null, null, 0, 0, 0, 0, 0, 0, 0),
  ('4407', '4407', null, 'lijn', true, 'LIJN', 40140, null, null, null, null, null, null, 0, 0, 0, 0, 0, 0, 0),
  ('4511', '4511', null, 'lijn', true, 'LIJN', 40140, null, null, null, null, null, null, 0, 0, 0, 0, 0, 0, 0),
  ('2515', '2515', null, 'lijn', true, 'LIJN', 40140, null, null, null, null, null, null, 0, 0, 0, 0, 0, 0, 0)
on conflict do nothing;

-- Bedrijfsnummer Easypay (alphal2 in de export) als instelling; de admin kan
-- hem in Looncontrole aanpassen. De waarde 1234 is letterlijk
-- tblbedrijfsgegevens.EasypayLidnr uit Access (en staat zo in elke rij van de
-- oude exports); geen placeholder. Bij 0 weigert de export.
insert into public.app_settings (key, value)
  values ('loon', '{"easypayLidnr": 1234}'::jsonb)
on conflict (key) do nothing;

do $$
begin
  if to_regclass('public.loon_codes') is null then raise exception 'post-conditie faalt: loon_codes ontbreekt'; end if;
  if to_regclass('public.loon_medewerkers') is null then raise exception 'post-conditie faalt: loon_medewerkers ontbreekt'; end if;
  if to_regclass('public.dag_afsluitingen') is null then raise exception 'post-conditie faalt: dag_afsluitingen ontbreekt'; end if;
  if to_regclass('public.dag_prestaties') is null then raise exception 'post-conditie faalt: dag_prestaties ontbreekt'; end if;
  if (select count(*) from public.loon_codes) < 229 then raise exception 'post-conditie faalt: loon_codes niet geseed'; end if;
end $$;

commit;

-- === Controle na het draaien ===
-- select code, dienst_type, easypay_type_prest, tik1, tik2 from public.loon_codes where code in ('2102','bv','ziek','vrij');
-- select value from public.app_settings where key = 'loon';
