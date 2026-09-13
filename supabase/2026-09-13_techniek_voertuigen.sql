-- 2026-09-13 — Techniek: voertuigen, gele boek, werkprestaties, vervaldata
-- (fase A van de Access-migratie, zie ~/VHB/Lijnadmin/inspectie-2026-09-13).
--
-- Vervangt de kern van garage.accdb:
--   tblBusGegevens          → public.vehicles          (voertuigregister, 40 rijen geseed)
--   tblAangevraagdeWerken   → public.vehicle_defects   (het "gele boek": chauffeur meldt,
--                                                       technieker zet op uitgevoerd)
--   tblUtgevoerdeWerken     → public.vehicle_work      (dagprestaties van de techniekers)
--   tblVervaldata           → public.vehicle_expiries  (keuring / brandblussers / tachograaf)
--
-- Beveiligingspatroon zoals user_expiries/meldingen: RLS aan zonder policies,
-- geen rechten voor anon/authenticated — al het verkeer loopt via de API met
-- de service role. Snake_case zoals elke migratie sinds 07-2026.
-- Idempotent: veilig om opnieuw te draaien. Zonder deze migratie antwoordt
-- de API met 503 en de naam van dit bestand (isMissingTableError).

begin;

-- === 1) vehicles ===
create table if not exists public.vehicles (
  id uuid primary key default gen_random_uuid(),
  -- Garage-notatie zoals op de bus zelf ('613 026'); uniek.
  busnr text not null unique,
  -- Kort nummer zoals chauffeurs het zeggen (26); uniek, nullable voor
  -- voertuigen zonder kort nummer.
  kort_nr integer unique,
  nummerplaat text,
  chassisnr text,
  merk text,
  type text not null check (type in ('lijnbus', 'schoolbus', 'sprinter', 'privevoertuig', 'ander')),
  aandrijving text check (aandrijving in ('elektrisch', 'diesel', 'hybride', 'ander')),
  status text not null default 'actief' check (status in ('actief', 'reserve', 'uit_dienst')),
  in_dienst date,
  uit_dienst date,
  zitplaatsen integer,
  opmerking text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists vehicles_set_updated_at on public.vehicles;
create trigger vehicles_set_updated_at
  before update on public.vehicles
  for each row execute function public.set_updated_at();

alter table public.vehicles enable row level security;
revoke all on table public.vehicles from anon, authenticated;
grant all on table public.vehicles to service_role;

-- === 2) vehicle_defects (gele boek) ===
create table if not exists public.vehicle_defects (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references public.vehicles(id),
  gemeld_op timestamptz not null default now(),
  -- users.id is text (zelfde conventie als meldingen.user_id); geen FK.
  gemeld_door text not null,
  -- T technisch · C carrosserie · I interieur · L door De Lijn op te lossen
  werktype text not null check (werktype in ('T', 'C', 'I', 'L')),
  omschrijving text not null,
  status text not null default 'open' check (status in ('open', 'uitgevoerd', 'geannuleerd')),
  uitgevoerd_op date,
  uitgevoerd_door text,
  uitgevoerd_werk text,
  manuren numeric(5, 2),
  opmerking text,
  updated_at timestamptz not null default now()
);

create index if not exists vehicle_defects_status_gemeld_idx
  on public.vehicle_defects (status, gemeld_op desc);
create index if not exists vehicle_defects_vehicle_idx
  on public.vehicle_defects (vehicle_id, gemeld_op desc);
create index if not exists vehicle_defects_melder_idx
  on public.vehicle_defects (gemeld_door, gemeld_op desc);

drop trigger if exists vehicle_defects_set_updated_at on public.vehicle_defects;
create trigger vehicle_defects_set_updated_at
  before update on public.vehicle_defects
  for each row execute function public.set_updated_at();

alter table public.vehicle_defects enable row level security;
revoke all on table public.vehicle_defects from anon, authenticated;
grant all on table public.vehicle_defects to service_role;

-- === 3) vehicle_work (dagprestaties technieker) ===
create table if not exists public.vehicle_work (
  id uuid primary key default gen_random_uuid(),
  datum date not null,
  mecanicien_id text not null,
  -- null = garage/algemeen (Access busnummer 999).
  vehicle_id uuid references public.vehicles(id),
  -- H herstelling · O onderhoud · G garantie · Kb keuring bezoek SBAT ·
  -- Kv keuring voorbereiding · D depannage · E extern · L stukken · A administratie
  werkcode text not null check (werkcode in ('H', 'O', 'G', 'Kb', 'Kv', 'D', 'E', 'L', 'A')),
  omschrijving text not null,
  begin_tijd text,
  einde_tijd text,
  werkuren numeric(5, 2) not null,
  kmstand integer,
  defect_id uuid references public.vehicle_defects(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists vehicle_work_datum_idx on public.vehicle_work (datum desc);
create index if not exists vehicle_work_vehicle_idx on public.vehicle_work (vehicle_id, datum desc);
create index if not exists vehicle_work_mecanicien_idx on public.vehicle_work (mecanicien_id, datum desc);
create index if not exists vehicle_work_defect_idx on public.vehicle_work (defect_id) where defect_id is not null;

drop trigger if exists vehicle_work_set_updated_at on public.vehicle_work;
create trigger vehicle_work_set_updated_at
  before update on public.vehicle_work
  for each row execute function public.set_updated_at();

alter table public.vehicle_work enable row level security;
revoke all on table public.vehicle_work from anon, authenticated;
grant all on table public.vehicle_work to service_role;

-- === 4) vehicle_expiries (spiegel van user_expiries) ===
create table if not exists public.vehicle_expiries (
  vehicle_id uuid not null references public.vehicles(id) on delete cascade,
  soort text not null check (soort in ('keuring', 'brandblussers', 'tachograaf')),
  valid_until date not null,
  opmerking text,
  updated_at timestamptz not null default now(),
  updated_by text,
  primary key (vehicle_id, soort)
);

alter table public.vehicle_expiries enable row level security;
revoke all on table public.vehicle_expiries from anon, authenticated;
grant all on table public.vehicle_expiries to service_role;

-- === 5) Seed: de 40 voertuigen uit garage.accdb (tblBusGegevens, 13-09-2026).
-- 'garage' (999) en 'CPO-Lede' zijn geen voertuigen en blijven weg; garage/
-- algemeen werk krijgt vehicle_id null in vehicle_work. Idempotent op busnr:
-- bestaande rijen worden niet overschreven (de fiche is na de seed van het
-- portaal, niet van Access).
insert into public.vehicles (busnr, kort_nr, nummerplaat, chassisnr, type, aandrijving, status, in_dienst, uit_dienst, zitplaatsen, merk) values
  ('013 023', 23, '1-VPZ-070', 'WMAA23ZZ8KF009372', 'lijnbus', 'diesel', 'actief', '2019-01-23', null, 50, 'MAN'),
  ('013 024', 24, '1-WBS-002', 'WMAA21ZZ8KF010235', 'lijnbus', 'diesel', 'actief', '2019-04-16', null, 38, 'MAN'),
  ('2030 04', 3004, '1-CIC-975', 'WDB9066571S616785', 'sprinter', 'diesel', 'actief', '2011-12-02', null, 12, 'Mercedes sprinter'),
  ('2030 05', 3005, '1-TPJ-715', 'WDB9066571P350926', 'sprinter', 'diesel', 'actief', '2018-01-04', null, 12, 'Mercedes sprinter'),
  ('2030 06', 3006, '1-TPJ-754', 'WDB9066571P351240', 'sprinter', 'diesel', 'actief', '2018-01-04', null, null, 'Mercedes sprinter'),
  ('2203 44', 44, '1-FXO-644', 'WMAA21ZZ6ER012746', 'lijnbus', 'diesel', 'actief', '2013-11-28', null, 38, 'MAN'),
  ('2203 47', 47, '1-RLK-506', 'WMAA23ZZ7HF003670', 'lijnbus', 'diesel', 'actief', '2017-01-20', null, 50, 'MAN'),
  ('613 025', 25, '2-CTL-703', 'WMAA21ZZ48R004682', 'lijnbus', 'diesel', 'actief', '2022-11-22', null, 38, 'MAN LION CITY NL273'),
  ('613 026', 26, '2-CWF-068', 'WMA12CZZ4PF019730', 'lijnbus', 'elektrisch', 'actief', '2022-12-20', null, 40, 'MAN LION''S CITY 12E'),
  ('613 027', 27, '2-EAA-540', 'WMA18CZZXPF021237', 'lijnbus', 'elektrisch', 'actief', '2023-08-01', null, 50, 'MAN LION''S CITY 18E'),
  ('613 028', 28, '2-EDC-360', 'WMA12CZZ1PF021239', 'lijnbus', 'elektrisch', 'actief', '2023-09-01', null, 40, 'MAN LION''S CITY 12E'),
  ('613 029', 29, '2-GLX-337', 'WMA12CZZ4SF024029', 'lijnbus', 'elektrisch', 'actief', '2025-01-23', null, 40, 'MAN LION''S CITY 12E'),
  ('613 030', 30, '2-GLX-341', 'WMA12CZZ0SF024030', 'lijnbus', 'elektrisch', 'actief', '2025-01-23', null, 40, 'MAN LION''S CITY 12E'),
  ('613 031', 31, '2-GLX-350', 'WMA12CZZ8SF024020', 'lijnbus', 'elektrisch', 'actief', '2025-01-23', null, 40, 'MAN LION''S CITY 12E'),
  ('613 032', 32, '2-GLU-129', 'WMA12CZZXSF024021', 'lijnbus', 'elektrisch', 'actief', '2025-01-22', null, 40, 'MAN LION''S CITY 12E'),
  ('613 033', 33, '2-GNG-430', 'WMA12CZZ4SF024032', 'lijnbus', 'elektrisch', 'actief', '2025-02-05', null, 40, 'MAN LION''S CITY 12E'),
  ('613 034', 34, '2-GPY-265', 'WMA18CZZ9SF023747', 'lijnbus', 'elektrisch', 'actief', '2025-02-20', null, 50, 'MAN LION''S CITY 18E'),
  ('613 035', 35, '2-GPY-290', 'WMA18CZZ5SF023809', 'lijnbus', 'elektrisch', 'actief', '2025-02-20', null, 50, 'MAN LION''S CITY 18E'),
  ('613 036', 36, '2-GQF-821', 'WMA18CZZ0SF023944', 'lijnbus', 'elektrisch', 'actief', '2025-02-24', null, 50, 'MAN LION''S CITY 18E'),
  ('613 037', 37, '2-GQJ-367', 'WMA18CZZ4SF023767', 'lijnbus', 'elektrisch', 'actief', '2025-03-05', null, 50, 'MAN LION''S CITY 18E'),
  ('613 038', 38, '2-GRN-573', 'WMA18CZZ0SF023930', 'lijnbus', 'elektrisch', 'actief', '2025-03-20', null, 50, 'MAN LION''S CITY 18E'),
  ('613 039', 39, '2-GSZ-256', 'WMA18CZZ9SF023750', 'lijnbus', 'elektrisch', 'actief', '2025-03-20', null, 50, 'MAN LION''S CITY 18E'),
  ('613 040', 40, '2-GWE-162', 'XNL409G500C042038', 'lijnbus', 'elektrisch', 'actief', '2025-04-18', null, 54, 'VDL'),
  ('613 041', 41, '2-HAP-806', 'WMA18CZZXSF023921', 'lijnbus', 'elektrisch', 'actief', '2025-05-14', null, 50, 'MAN LION''S CITY 18E'),
  ('613 043', 43, '2-JVW-738', 'XNL408E560C043896', 'lijnbus', 'elektrisch', 'actief', '2026-07-09', null, 42, 'VDL'),
  ('Reserve 98', 98, '2-ECM-130', 'XNL405E100B003953', 'lijnbus', 'diesel', 'reserve', '2023-08-29', null, null, 'VDL'),
  ('BRU 004', 404, '1-HKY-441', 'XMGDE40PS0H018796', 'schoolbus', 'diesel', 'actief', '2013-02-26', null, null, 'VDL Lexio'),
  ('bru4462', 444, '1-XQS-928', 'WDB9066571P349463', 'schoolbus', 'diesel', 'actief', '2020-03-10', null, null, 'Mercedes sprinter'),
  ('EEK001', 401, '2-DDM-852', 'ZCFC672C005500120', 'schoolbus', 'diesel', 'actief', '2023-02-14', null, 38, 'Feniksbus Iveco 70C18'),
  ('EEK005', 405, '2-CWP-425', 'ZCFC872F905500511', 'schoolbus', 'diesel', 'actief', '2022-12-23', null, 31, 'Feniksbus iveco'),
  ('EEK006', 406, '1-SZF-755', 'WDB6703741N148673', 'schoolbus', 'diesel', 'actief', '2014-01-22', null, 35, 'Mercedes vario automet jupiter'),
  ('EEK008', 408, '1-VDP-138', 'ZCFC270D905245216', 'schoolbus', 'diesel', 'actief', '2018-10-04', null, 38, 'Feniksbus iveco'),
  ('EEK009', 409, '2-BMK-064', 'ZCFC670D805391207', 'schoolbus', 'diesel', 'actief', '2022-01-20', null, 39, 'Feniksbus iveco'),
  ('EEK010', 410, '2-CLA-812', 'WDB6703741N49550', 'schoolbus', 'diesel', 'actief', '2022-08-31', null, 39, 'Mercedes'),
  ('Reserve S', 400, 'VND-810', 'WDB6703741N123893', 'schoolbus', 'diesel', 'reserve', '2006-07-17', null, 35, 'Mercedes vario automet jupiter'),
  ('CLA 250 e', 7, '2-ASB-293', 'W1K1186861N238334', 'privevoertuig', 'ander', 'actief', '2021-06-29', null, null, 'Mercedes'),
  ('Jumpy', 5, '480-ALD', 'VF7XS9HUC9Z008567', 'privevoertuig', 'ander', 'actief', '2009-04-06', null, null, 'Citroën'),
  ('Sprinter', 9, '2-EPP-968', 'W1V3KBFZ5RP647841', 'privevoertuig', 'ander', 'actief', '2023-12-12', null, 3, 'Mercedes sprinter'),
  ('Traffic', 8, '1-WBS-821', 'VF1FL000X63190252', 'privevoertuig', 'ander', 'actief', '2019-04-16', null, null, 'Renault traffic'),
  ('Tesla', 10, '2-HUS-721', 'LRW3E7FS1TC670950', 'privevoertuig', 'elektrisch', 'actief', '2025-11-18', null, null, 'Model 3')
-- `on conflict do nothing` zonder doel: dekt élke unique (busnr, kort_nr,
-- nummerplaat) zodat een herhaalde run nooit op 23505 afbreekt.
on conflict do nothing;

-- Post-conditie in de transactie: een halve toepassing rolt terug.
do $$
begin
  if to_regclass('public.vehicles') is null then
    raise exception 'post-conditie faalt: public.vehicles ontbreekt';
  end if;
  if to_regclass('public.vehicle_defects') is null then
    raise exception 'post-conditie faalt: public.vehicle_defects ontbreekt';
  end if;
  if to_regclass('public.vehicle_work') is null then
    raise exception 'post-conditie faalt: public.vehicle_work ontbreekt';
  end if;
  if to_regclass('public.vehicle_expiries') is null then
    raise exception 'post-conditie faalt: public.vehicle_expiries ontbreekt';
  end if;
  if (select count(*) from public.vehicles) < 40 then
    raise exception 'post-conditie faalt: minder dan 40 voertuigen geseed';
  end if;
end $$;

commit;

-- === Controle na het draaien ===
--
-- select busnr, kort_nr, type, aandrijving, status from public.vehicles order by kort_nr;  -- 40 rijen
-- select relname, relrowsecurity from pg_class
--   where relname in ('vehicles','vehicle_defects','vehicle_work','vehicle_expiries');  -- alle true
-- In de app: /beheer/systeemstatus → schema-check groen; /techniek/voertuigen toont 40 voertuigen.
