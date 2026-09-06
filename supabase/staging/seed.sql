-- =============================================================================
-- Staging-seed: geanonimiseerde testdata voor het VHB-portaal
-- =============================================================================
-- Alleen voor het staging-project (supabase/staging/README.md). Bevat GEEN
-- echte personen: fictieve Vlaamse namen, e-mail @staging.vhb.test,
-- telefoonnummers 0470 00 00 xx, personeelsnummers STG-xxxx.
--
-- Idempotent: elke run eindigt in dezelfde toestand (voor dezelfde dag).
--   - Vaste id's met prefix `stg-`; vaste records via `on conflict … do update`.
--   - Alles wat relatief aan "vandaag" ligt (planning, matrix, verlof, ruilen,
--     omleidingen, updates, notities, vervaldata, log) wordt eerst per
--     seed-prefix gewist en dan opnieuw opgebouwd — anders bleven rijen van
--     een vorige run op oude datums staan.
--   - Vangrail bovenaan: weigert te draaien in een database met gebruikers
--     die niet uit deze seed komen (lees: productie).
--
-- Volgorde: ná alle migraties (users.authid, planning_version, …). Daarna
-- `node scripts/staging-accounts.mjs` voor de Auth-accounts + authid-koppeling.
--
-- Één transactie: faalt er iets, dan blijft de database zoals ze was.
-- =============================================================================

begin;

-- 0) Vangrail tegen productie.
do $$
begin
  if exists (
    select 1 from public.users
    where id not like 'stg-%'
       or (email is not null and lower(email) not like '%@staging.vhb.test')
  ) then
    raise exception 'Seed afgebroken: deze database bevat gebruikers die niet uit de staging-seed komen. Is dit wel het staging-project?';
  end if;
end $$;

-- "Vandaag" in Belgische tijd (de SQL Editor draait in UTC). Eén bron voor
-- alle relatieve datums hieronder.
create temp table stg_ctx on commit drop as
  select (now() at time zone 'Europe/Brussels')::date as vandaag;

-- ISO-tijdstempel zoals de API ze schrijft (toISOString).
create or replace function pg_temp.stg_iso(ts timestamptz) returns text
language sql immutable as $$
  select to_char(ts at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
$$;

-- ISO-dag (planning."date", leave.startdate, … zijn tekst).
create or replace function pg_temp.stg_dag(d date) returns text
language sql immutable as $$ select to_char(d, 'YYYY-MM-DD') $$;

-- =============================================================================
-- 1) Gebruikers: 1 admin, 2 planners, 10 chauffeurs
-- =============================================================================
insert into public.users
  (id, name, role, employeeid, lastlogin, activesessions, isactive, phone, email,
   verlofbudget, showincontacts, wantssystemmail, section, startdate)
values
  ('stg-admin',        'Bram Vermeulen',    'admin',     'STG-0001', null, 0, true, '0470 00 00 01', 'bram.vermeulen@staging.vhb.test',    null, true,  false, null,        '2015-03-01'),
  ('stg-planner-1',    'Els Peeters',       'planner',   'STG-0002', null, 0, true, '0470 00 00 02', 'els.peeters@staging.vhb.test',       null, true,  false, null,        '2017-09-04'),
  ('stg-planner-2',    'Koen Jacobs',       'planner',   'STG-0003', null, 0, true, '0470 00 00 03', 'koen.jacobs@staging.vhb.test',       null, true,  false, null,        '2021-02-01'),
  ('stg-chauffeur-01', 'Jef Claes',         'chauffeur', 'STG-0101', null, 0, true, '0470 00 00 11', 'jef.claes@staging.vhb.test',         24,   true,  true,  'Reguliere', '2008-09-01'),
  ('stg-chauffeur-02', 'Mieke Willems',     'chauffeur', 'STG-0102', null, 0, true, '0470 00 00 12', 'mieke.willems@staging.vhb.test',     24,   true,  true,  'Reguliere', '2012-01-16'),
  ('stg-chauffeur-03', 'Tom Maes',          'chauffeur', 'STG-0103', null, 0, true, '0470 00 00 13', 'tom.maes@staging.vhb.test',          24,   true,  true,  'Reguliere', '2016-05-02'),
  ('stg-chauffeur-04', 'Lien Goossens',     'chauffeur', 'STG-0104', null, 0, true, '0470 00 00 14', 'lien.goossens@staging.vhb.test',     22,   true,  true,  'Nacht',     '2018-11-05'),
  ('stg-chauffeur-05', 'Dirk Wouters',      'chauffeur', 'STG-0105', null, 0, true, '0470 00 00 15', 'dirk.wouters@staging.vhb.test',      26,   true,  true,  'Nacht',     '2010-04-12'),
  ('stg-chauffeur-06', 'Sofie Mertens',     'chauffeur', 'STG-0106', null, 0, true, '0470 00 00 16', 'sofie.mertens@staging.vhb.test',     24,   true,  true,  'Reguliere', '2020-02-03'),
  ('stg-chauffeur-07', 'Wim De Smet',       'chauffeur', 'STG-0107', null, 0, true, '0470 00 00 17', 'wim.desmet@staging.vhb.test',        24,   true,  true,  'Flexi',     '2019-08-19'),
  ('stg-chauffeur-08', 'Nele Vandenberghe', 'chauffeur', 'STG-0108', null, 0, true, '0470 00 00 18', 'nele.vandenberghe@staging.vhb.test', 20,   false, true,  'Flexi',     '2022-09-05'),
  ('stg-chauffeur-09', 'Pieter Lambrechts', 'chauffeur', 'STG-0109', null, 0, true, '0470 00 00 19', 'pieter.lambrechts@staging.vhb.test', 24,   true,  true,  'Reguliere', '2014-06-30'),
  ('stg-chauffeur-10', 'Karen Desmet',      'chauffeur', 'STG-0110', null, 0, true, '0470 00 00 20', 'karen.desmet@staging.vhb.test',      24,   true,  true,  'Reguliere', '2023-01-09')
on conflict (id) do update set
  name = excluded.name,
  role = excluded.role,
  employeeid = excluded.employeeid,
  isactive = excluded.isactive,
  phone = excluded.phone,
  email = excluded.email,
  verlofbudget = excluded.verlofbudget,
  showincontacts = excluded.showincontacts,
  wantssystemmail = excluded.wantssystemmail,
  section = excluded.section,
  startdate = excluded.startdate;
-- lastlogin/activesessions/authid bewust niet overschreven: die zet de app
-- (resp. scripts/staging-accounts.mjs) zelf.

-- =============================================================================
-- 2) Dienstoverzicht: 25 diensten in 1–3 delen, met loopnummers per deel
-- =============================================================================
-- Kolommen exact zoals api/schemaProbes.ts (quoted camelCase). Een leeg
-- eerste blok ('') = nachtdienst die pas in blok 2 begint, zoals in de echte
-- dienstregeling; uren > 24:00 = na middernacht (getServiceSegments staat
-- tot 47:59 toe).
insert into public.services
  (id, "serviceNumber", "startTime", "endTime", loopnr, "startTime2", "endTime2", loopnr2, "startTime3", "endTime3", loopnr3)
values
  ('stg-dienst-2101', '2101', '04:36', '07:52', '4500', '13:39', '17:53', '4611', null,    null,    null),
  ('stg-dienst-2103', '2103', '05:08', '13:54', '4502', null,    null,    null,   null,    null,    null),
  ('stg-dienst-2104', '2104', '06:01', '09:26', '4503', '16:06', '19:56', '4612', null,    null,    null),
  ('stg-dienst-2107', '2107', '07:07', '13:52', '4506', '16:23', '18:53', '4613', null,    null,    null),
  ('stg-dienst-2112', '2112', '06:28', '12:24', '4508', '18:37', '21:14', '4620', null,    null,    null),
  ('stg-dienst-2115', '2115', '',      '',      null,   '15:13', '21:58', '4630', '23:36', '25:20', '4631'),
  ('stg-dienst-2116', '2116', '',      '',      null,   '15:56', '23:51', '4632', null,    null,    null),
  ('stg-dienst-2117', '2117', '',      '',      null,   '16:24', '24:29', '4633', null,    null,    null),
  ('stg-dienst-2151', '2151', '07:05', '14:58', '4507', null,    null,    null,   null,    null,    null),
  ('stg-dienst-2304', '2304', '06:01', '09:26', '4503', '11:47', '14:02', '4540', '15:05', '19:35', '4614'),
  ('stg-dienst-2309', '2309', '06:37', '08:53', '4509', '11:46', '13:34', '4541', '16:06', '19:56', '4612'),
  ('stg-dienst-2313', '2313', '07:11', '08:42', '4511', '11:37', '13:20', '4542', '15:36', '21:48', '4621'),
  ('stg-dienst-2601', '2601', '05:41', '12:50', '4700', null,    null,    null,   null,    null,    null),
  ('stg-dienst-2602', '2602', '06:11', '10:20', '4701', null,    null,    null,   null,    null,    null),
  ('stg-dienst-2603', '2603', '06:36', '16:11', '4702', null,    null,    null,   null,    null,    null),
  ('stg-dienst-2604', '2604', '08:32', '18:58', '4703', null,    null,    null,   null,    null,    null),
  ('stg-dienst-2605', '2605', '13:05', '20:14', '4704', null,    null,    null,   null,    null,    null),
  ('stg-dienst-2607', '2607', '15:45', '26:11', '4705', null,    null,    null,   null,    null,    null),
  ('stg-dienst-2608', '2608', '17:09', '26:18', '4706', null,    null,    null,   null,    null,    null),
  ('stg-dienst-2651', '2651', '07:51', '15:49', '4710', null,    null,    null,   null,    null,    null),
  ('stg-dienst-2652', '2652', '15:51', '20:47', '4711', null,    null,    null,   null,    null,    null),
  ('stg-dienst-4101', '4101', '04:27', '12:20', '4800', null,    null,    null,   null,    null,    null),
  ('stg-dienst-4105', '4105', '08:05', '13:48', '4801', '16:28', '18:16', '4810', null,    null,    null),
  ('stg-dienst-4111', '4111', '16:11', '25:18', '4802', null,    null,    null,   null,    null,    null),
  ('stg-dienst-4152', '4152', '12:05', '19:58', '4803', null,    null,    null,   null,    null,    null)
on conflict (id) do update set
  "serviceNumber" = excluded."serviceNumber",
  "startTime" = excluded."startTime",   "endTime" = excluded."endTime",   loopnr = excluded.loopnr,
  "startTime2" = excluded."startTime2", "endTime2" = excluded."endTime2", loopnr2 = excluded.loopnr2,
  "startTime3" = excluded."startTime3", "endTime3" = excluded."endTime3", loopnr3 = excluded.loopnr3;

-- =============================================================================
-- 3) Planningscodes (bovenop planning_code_mapping.sql) + app-instellingen
-- =============================================================================
insert into public.planning_codes (code, category, description, counts_as_shift, is_paid_absence, is_day_off)
values ('ziek', 'absence', 'Ziek', false, true, false)
on conflict (code) do update set
  category = excluded.category, description = excluded.description,
  counts_as_shift = excluded.counts_as_shift, is_paid_absence = excluded.is_paid_absence,
  is_day_off = excluded.is_day_off, updated_at = now();

-- Toestel-whitelist UIT op staging: testers delen accounts over meerdere
-- toestellen en zouden anders na het eerste toestel op goedkeuring wachten.
insert into public.app_settings (key, value)
values ('device_gate', '{"enabled": false}'::jsonb)
on conflict (key) do update set value = excluded.value, updated_at = now();

-- Dekking: dag-types + standaard weekdagtoewijzing (api/coverageGaps.ts
-- DEFAULT_WEEKDAYS: zondag, schooldag ×5, zaterdag). Bewust niet álle
-- diensten verwacht: een paar open diensten per dag is precies wat het
-- Openstaande-diensten-scherm moet tonen.
insert into public.coverage_expectations (day_type, service_numbers)
values
  ('schooldag', array['2101','2103','2104','2107','2112','2115','2151','2304','2309','2313','2601','2602','2603','2604','2607','4101','4105','4111']),
  ('zaterdag',  array['2101','2104','2601','2604','2607','2651','2652','4101']),
  ('zondag',    array['2601','2607','2651','2652']),
  ('vakantie',  array['2101','2103','2104','2601','2603','2607','4101']),
  ('__weekdagen__', array['zondag','schooldag','schooldag','schooldag','schooldag','schooldag','zaterdag'])
on conflict (day_type) do update set service_numbers = excluded.service_numbers;

-- =============================================================================
-- 4) Rooster: 3 weken rond vandaag (−7 … +13) voor de 10 chauffeurs
-- =============================================================================
-- Per chauffeur een 7-daags patroon (index 0 = zondag … 6 = zaterdag, zoals
-- extract(dow)); elke week schuift het patroon 3 posities op zodat de drie
-- weken van elkaar verschillen. Verlof- en ziektecodes komen uit de
-- goedgekeurde aanvragen in stap 5 (bv / ziek), afwezigheidscodes uit het
-- patroon zelf (opl, tk, vrij).
create temp table stg_chauffeur on commit drop as
  select * from (values
    (1,  'stg-chauffeur-01', 'Jef Claes'),
    (2,  'stg-chauffeur-02', 'Mieke Willems'),
    (3,  'stg-chauffeur-03', 'Tom Maes'),
    (4,  'stg-chauffeur-04', 'Lien Goossens'),
    (5,  'stg-chauffeur-05', 'Dirk Wouters'),
    (6,  'stg-chauffeur-06', 'Sofie Mertens'),
    (7,  'stg-chauffeur-07', 'Wim De Smet'),
    (8,  'stg-chauffeur-08', 'Nele Vandenberghe'),
    (9,  'stg-chauffeur-09', 'Pieter Lambrechts'),
    (10, 'stg-chauffeur-10', 'Karen Desmet')
  ) as t(nr, id, name);

create temp table stg_patroon on commit drop as
  select nr, idx, code from (values
    -- nr, idx: zo ma di wo do vr za
    (1, 0, 'vrij'), (1, 1, '2101'), (1, 2, '2103'), (1, 3, '2104'), (1, 4, '2101'), (1, 5, '2107'), (1, 6, 'vrij'),
    (2, 0, 'vrij'), (2, 1, '2601'), (2, 2, '2602'), (2, 3, '2603'), (2, 4, 'vrij'), (2, 5, '2604'), (2, 6, '2651'),
    (3, 0, '2652'), (3, 1, '2304'), (3, 2, '2309'), (3, 3, 'vrij'), (3, 4, '2313'), (3, 5, '2304'), (3, 6, 'vrij'),
    (4, 0, '2608'), (4, 1, '2115'), (4, 2, '2116'), (4, 3, '2117'), (4, 4, 'vrij'), (4, 5, 'vrij'), (4, 6, '2607'),
    (5, 0, '2116'), (5, 1, '2607'), (5, 2, '2608'), (5, 3, '4111'), (5, 4, '2115'), (5, 5, 'vrij'), (5, 6, 'vrij'),
    (6, 0, '2601'), (6, 1, '4101'), (6, 2, '4105'), (6, 3, '4152'), (6, 4, '4101'), (6, 5, 'vrij'), (6, 6, 'vrij'),
    (7, 0, 'vrij'), (7, 1, '2151'), (7, 2, 'opl'),  (7, 3, '2112'), (7, 4, '2151'), (7, 5, '2107'), (7, 6, 'vrij'),
    (8, 0, 'vrij'), (8, 1, '2605'), (8, 2, '2604'), (8, 3, 'vrij'), (8, 4, '2603'), (8, 5, '2652'), (8, 6, '2651'),
    (9, 0, 'vrij'), (9, 1, '2313'), (9, 2, '2309'), (9, 3, '2304'), (9, 4, 'vrij'), (9, 5, '2313'), (9, 6, '2103'),
    (10, 0, '2602'), (10, 1, '2104'), (10, 2, '2101'), (10, 3, 'tk'), (10, 4, '2107'), (10, 5, '2112'), (10, 6, 'vrij')
  ) as t(nr, idx, code);

-- Code per (dag, chauffeur), mét de overrides uit de goedgekeurde aanvragen.
create temp table stg_codes on commit drop as
  with dagen as (
    select d::date as dag,
           (d::date - v.vandaag) as offset_dagen,
           ((d::date - (v.vandaag - 7)) / 7) as week_nr
    from stg_ctx v, generate_series(v.vandaag - 7, v.vandaag + 13, interval '1 day') as d
  )
  select
    d.dag,
    d.offset_dagen,
    c.nr,
    c.id as driver_id,
    c.name as driver_name,
    case
      when c.nr = 3 and d.offset_dagen between 3 and 5 then 'bv'    -- goedgekeurd betaald verlof (stap 5)
      when c.nr = 6 and d.offset_dagen between -2 and 1 then 'ziek' -- geregistreerde ziekte (stap 5)
      else p.code
    end as code
  from dagen d
  cross join stg_chauffeur c
  join stg_patroon p
    on p.nr = c.nr
   and p.idx = ((extract(dow from d.dag)::int + d.week_nr * 3) % 7);

-- 4a) Planningmatrix (één rij per dag, assignments op chauffeursNAAM — zo
--     leest de import ze ook, zie parsePlanningMatrixXlsx).
delete from public.planning_matrix_rows where raw_row = 'seed:staging' or id like '%-stg';
insert into public.planning_matrix_rows (id, source_date, day_type, assignments, raw_row)
select
  pg_temp.stg_dag(dag) || '-stg',
  dag,
  case extract(dow from dag) when 0 then 'zondag' when 6 then 'zaterdag' else 'schooldag' end,
  jsonb_object_agg(driver_name, code order by nr),
  'seed:staging'
from stg_codes
group by dag;

-- 4b) Planning: één rij per dienstdeel, id/kolommen exact zoals
--     bouwPlanningUitMatrix (api/storage.ts): `<datum>-<driverId>-<dienst>-<deel>`,
--     busNumber leeg, loopnr van het blok.
delete from public.planning where "driverId" like 'stg-chauffeur-%';
insert into public.planning (id, date, "startTime", "endTime", line, "busNumber", loopnr, "driverId")
select
  pg_temp.stg_dag(c.dag) || '-' || c.driver_id || '-' || s."serviceNumber" || '-' || deel.n,
  pg_temp.stg_dag(c.dag),
  deel.s,
  deel.e,
  s."serviceNumber",
  '',
  coalesce(deel.l, ''),
  c.driver_id
from stg_codes c
join public.services s on s."serviceNumber" = c.code and s.id like 'stg-dienst-%'
cross join lateral (values
  (1, s."startTime",  s."endTime",  s.loopnr),
  (2, s."startTime2", s."endTime2", s.loopnr2),
  (3, s."startTime3", s."endTime3", s.loopnr3)
) as deel(n, s, e, l)
where deel.s ~ '^\d{1,2}:\d{2}$' and deel.e ~ '^\d{1,2}:\d{2}$';

-- Import-historiek: één regel zodat "laatste import" in de app iets toont.
insert into public.planning_matrix_import_history
  (id, created_at, imported_days, detected_drivers, generated_shifts, matched_services, skipped_absences,
   unknown_codes, unmatched_drivers, filename, imported_by, period_start, period_end, file_start, file_end, snapshot_path)
select
  'stg-import-1', now() - interval '2 days', 21, 10,
  (select count(*) from public.planning where "driverId" like 'stg-chauffeur-%'),
  (select count(*) from stg_codes where code ~ '^\d{4}$'),
  (select count(*) from stg_codes where code !~ '^\d{4}$'),
  '{}', '{}', 'staging-seed.xlsx', 'Els Peeters',
  pg_temp.stg_dag(v.vandaag - 7), pg_temp.stg_dag(v.vandaag + 13),
  pg_temp.stg_dag(v.vandaag - 7), pg_temp.stg_dag(v.vandaag + 13), null
from stg_ctx v
on conflict (id) do update set
  created_at = excluded.created_at, imported_days = excluded.imported_days,
  detected_drivers = excluded.detected_drivers, generated_shifts = excluded.generated_shifts,
  matched_services = excluded.matched_services, skipped_absences = excluded.skipped_absences,
  filename = excluded.filename, imported_by = excluded.imported_by,
  period_start = excluded.period_start, period_end = excluded.period_end,
  file_start = excluded.file_start, file_end = excluded.file_end;

-- Dienstnotities van de planner (planning_notes: pk driver_id + date).
delete from public.planning_notes where driver_id like 'stg-chauffeur-%';
insert into public.planning_notes (driver_id, date, note, updated_by)
select 'stg-chauffeur-01', pg_temp.stg_dag(v.vandaag + 1), 'Neem bus 412 — eerst tanken aan de stelplaats.', 'Els Peeters' from stg_ctx v
union all
select 'stg-chauffeur-02', pg_temp.stg_dag(v.vandaag),     'Werfverkeer op de N9: reken 10 min extra voor blok 1.', 'Koen Jacobs' from stg_ctx v;

-- =============================================================================
-- 5) Verlof (5 aanvragen, alle statussen) en ziekte
-- =============================================================================
-- Kolommen lowercase (leave is ongequote, zie setup_security.sql). Types en
-- statussen uit api/types.ts LeaveRecord.
delete from public.leave where id like 'stg-verlof-%';
insert into public.leave (id, userid, startdate, enddate, type, status, comment, createdat, decidedat)
select * from (
  select 'stg-verlof-1', 'stg-chauffeur-02', pg_temp.stg_dag(v.vandaag + 10), pg_temp.stg_dag(v.vandaag + 12), 'betaald_verlof', 'pending',
         'Lang weekend aan zee.', pg_temp.stg_iso(now() - interval '1 day'), null from stg_ctx v
  union all
  select 'stg-verlof-2', 'stg-chauffeur-03', pg_temp.stg_dag(v.vandaag + 3), pg_temp.stg_dag(v.vandaag + 5), 'betaald_verlof', 'approved',
         'Verhuis.', pg_temp.stg_iso(now() - interval '9 days'), pg_temp.stg_iso(now() - interval '8 days') from stg_ctx v
  union all
  select 'stg-verlof-3', 'stg-chauffeur-04', pg_temp.stg_dag(v.vandaag + 8), pg_temp.stg_dag(v.vandaag + 8), 'klein_verlet', 'rejected',
         'Te weinig nachtchauffeurs die dag.', pg_temp.stg_iso(now() - interval '4 days'), pg_temp.stg_iso(now() - interval '3 days') from stg_ctx v
  union all
  select 'stg-verlof-4', 'stg-chauffeur-05', pg_temp.stg_dag(v.vandaag - 10), pg_temp.stg_dag(v.vandaag - 9), 'betaald_verlof', 'cancelled',
         null, pg_temp.stg_iso(now() - interval '20 days'), pg_temp.stg_iso(now() - interval '15 days') from stg_ctx v
  union all
  select 'stg-verlof-5', 'stg-chauffeur-06', pg_temp.stg_dag(v.vandaag - 2), pg_temp.stg_dag(v.vandaag + 1), 'ziekte', 'approved',
         'Griep, attest bezorgd.', pg_temp.stg_iso(now() - interval '2 days'), pg_temp.stg_iso(now() - interval '2 days') from stg_ctx v
) as t;

-- =============================================================================
-- 6) Dienstruilen (3): pending ruil, goedgekeurde overname, afgewezen ruil
-- =============================================================================
-- shiftid verwijst naar een échte planning-rij van de aanvrager (eerste
-- werkdag in het venster), shift_date/shift_line zoals de server ze invult.
delete from public.swaps where id like 'stg-ruil-%';
insert into public.swaps
  (id, shiftid, requesterid, targetdriverid, status, createdat, reason, decidedat,
   return_date, return_code, swap_type, shift_date, shift_line, target_seen_at)
select 'stg-ruil-1', p.id, 'stg-chauffeur-01', 'stg-chauffeur-02', 'pending',
       pg_temp.stg_iso(now() - interval '3 hours'), 'Familiefeest', null,
       pg_temp.stg_dag(v.vandaag + 4), 'vrij', 'ruil', p.date, p.line, null
from stg_ctx v
join lateral (
  select id, date, line from public.planning
  where "driverId" = 'stg-chauffeur-01' and date >= pg_temp.stg_dag(v.vandaag + 1)
  order by date, "startTime" limit 1
) p on true
union all
select 'stg-ruil-2', p.id, 'stg-chauffeur-07', 'stg-chauffeur-08', 'approved',
       pg_temp.stg_iso(now() - interval '6 days'), 'Doktersafspraak', pg_temp.stg_iso(now() - interval '5 days'),
       null, null, 'overname', p.date, p.line, pg_temp.stg_iso(now() - interval '4 days')
from stg_ctx v
join lateral (
  select id, date, line from public.planning
  where "driverId" = 'stg-chauffeur-07' and date <= pg_temp.stg_dag(v.vandaag - 2)
  order by date desc, "startTime" limit 1
) p on true
union all
select 'stg-ruil-3', p.id, 'stg-chauffeur-09', 'stg-chauffeur-10', 'rejected',
       pg_temp.stg_iso(now() - interval '2 days'), 'Wil die dag liever de late.', pg_temp.stg_iso(now() - interval '1 day'),
       pg_temp.stg_dag(v.vandaag + 9), 'vrij', 'ruil', p.date, p.line, null
from stg_ctx v
join lateral (
  select id, date, line from public.planning
  where "driverId" = 'stg-chauffeur-09' and date >= pg_temp.stg_dag(v.vandaag + 5)
  order by date, "startTime" limit 1
) p on true;

-- De goedgekeurde overname is door de server doorgevoerd: de planning-rijen
-- van die dienst-dag staan op de overnemer (zoals movePlanningRows doet; de
-- matrix blijft de import-waarheid en verandert niet).
update public.planning p
set "driverId" = s.targetdriverid
from public.swaps s
where s.id = 'stg-ruil-2'
  and p.date = s.shift_date and p.line = s.shift_line and p."driverId" = s.requesterid;

-- =============================================================================
-- 7) Omleidingen (3) en updates (4)
-- =============================================================================
delete from public.diversions where id like 'stg-omleiding-%';
insert into public.diversions (id, line, title, description, "startDate", "endDate", severity, "pdfUrl")
select 'stg-omleiding-1', '58', 'Werken Markt Zottegem',
       'Omleiding via de ring. Haltes Markt en Station vervallen tijdelijk; vervanghalte aan de Bevegemse Vijvers.',
       pg_temp.stg_dag(v.vandaag - 3), pg_temp.stg_dag(v.vandaag + 14), null, null from stg_ctx v
union all
select 'stg-omleiding-2', '23', 'Wielerwedstrijd Oudenaarde',
       'Volledige doortocht afgesloten tussen 12u en 18u. Rijden via de N60, halte Markt bediend aan de Tacambaroplein.',
       pg_temp.stg_dag(v.vandaag - 30), pg_temp.stg_dag(v.vandaag - 2), null, null from stg_ctx v
union all
select 'stg-omleiding-3', '71', 'Herasfaltering Brusselsesteenweg',
       'Vanaf de start van de werken rijden alle ritten via de Gentsesteenweg. Einddatum nog niet gekend.',
       pg_temp.stg_dag(v.vandaag + 7), null, null, null from stg_ctx v;

delete from public.updates where id like 'stg-update-%';
insert into public.updates (id, date, title, content, category)
select 'stg-update-1', pg_temp.stg_dag(v.vandaag - 1), 'Nieuwe zomeruniformen beschikbaar',
       'Vanaf volgende week liggen de nieuwe zomeruniformen klaar in het depot. Kom langs tijdens de kantooruren om jouw maat te passen.', 'algemeen' from stg_ctx v
union all
select 'stg-update-2', pg_temp.stg_dag(v.vandaag - 5), 'Onderhoud aan de boordcomputers',
       'Alle bussen krijgen dit weekend een software-update. Start de boordcomputer maandag één keer volledig opnieuw op.', 'technisch' from stg_ctx v
union all
select 'stg-update-3', pg_temp.stg_dag(v.vandaag - 12), 'Gladheid: winterbanden gemonteerd',
       'Alle voertuigen staan op winterbanden. Meld een bus met slechte grip meteen aan de planning.', 'veiligheid' from stg_ctx v
union all
select 'stg-update-4', pg_temp.stg_dag(v.vandaag - 20), 'Laadpalen stelplaats: nieuwe volgorde',
       'Bussen 401–412 laden voortaan aan de linkerrij. Kijk op het bord in het lokaal voor het schema.', 'algemeen' from stg_ctx v;

-- =============================================================================
-- 8) Vervaldata en activiteitenlog (voor de beheerschermen)
-- =============================================================================
delete from public.user_expiries where user_id like 'stg-chauffeur-%';
insert into public.user_expiries (user_id, soort, valid_until, updated_by)
select 'stg-chauffeur-01', 'rijbewijs',          v.vandaag + 400, 'Els Peeters' from stg_ctx v union all
select 'stg-chauffeur-02', 'code95',             v.vandaag + 20,  'Els Peeters' from stg_ctx v union all
select 'stg-chauffeur-03', 'medische_schifting', v.vandaag - 5,   'Koen Jacobs' from stg_ctx v union all
select 'stg-chauffeur-04', 'code95',             v.vandaag + 120, 'Koen Jacobs' from stg_ctx v union all
select 'stg-chauffeur-05', 'rijbewijs',          v.vandaag + 30,  'Els Peeters' from stg_ctx v;

delete from public.activity_log where id like 'stg-log-%';
insert into public.activity_log (id, created_at, actor_name, actor_role, category, action, details, entity_type, entity_id)
values
  ('stg-log-1', now() - interval '2 days',   'Els Peeters',    'planner', 'planning', 'Planning geïmporteerd', 'staging-seed.xlsx: 21 dagen, 10 chauffeurs.', null, null),
  ('stg-log-2', now() - interval '8 days',   'Els Peeters',    'planner', 'leave',    'Verlof goedgekeurd',    'Tom Maes — betaald verlof (3 dagen).', 'leave', 'stg-verlof-2'),
  ('stg-log-3', now() - interval '5 days',   'Koen Jacobs',    'planner', 'swaps',    'Overname goedgekeurd',  'Wim De Smet → Nele Vandenberghe.', 'swap', 'stg-ruil-2'),
  ('stg-log-4', now() - interval '3 hours',  'Bram Vermeulen', 'admin',   'users',    'Gebruiker gewijzigd',   'Nele Vandenberghe: niet in contactlijst.', 'user', 'stg-chauffeur-08');

commit;

-- Controle (optioneel):
--   select role, count(*) from public.users group by role;                       -- admin 1, planner 2, chauffeur 10
--   select count(*) from public.services where id like 'stg-dienst-%';           -- 25
--   select count(distinct date), count(*) from public.planning;                  -- 21 dagen, ±180 rijen
--   select status, count(*) from public.leave group by status;                   -- pending/approved/rejected/cancelled
--   select id, status, swap_type, shift_date, shift_line from public.swaps;      -- 3 ruilen
