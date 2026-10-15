-- 2026-10-15, indexen voor de tabellen die met de tijd groeien (Jarno 15-10:
-- het portaal klaarmaken voor steeds meer data).
--
-- In de migraties hadden planning, leave en swaps alleen hun primaire sleutel:
-- elke lezing per chauffeur of per dag las dus de hele tabel, en de planning
-- groeit met ±10.000 rijen per jaar (één rij per dienstdeel). Welke vraag
-- welke index gebruikt:
--
--   planning ("driverId", date)  getPlanningData({ driverId }): de opstart van
--                                elke chauffeur (GET /api/planning), verlof,
--                                agenda; en het verhuizen van één dienst bij
--                                een ruil (dag + lijn + chauffeur)
--   planning (date)              getShiftsOnDate en de andere lezingen per dag
--                                (bord, dekking, dubbele inplanning, ruil), en
--                                het vervangen van een periode bij de import
--   leave (userid)               getLeaveData({ userId }): het verlof van een
--                                chauffeur
--   leave (enddate)              getLeaveData({ endOnOrAfter }): dekking,
--                                maandplanning, loon, ruilregels, Telegram
--   swaps (requesterid)          getSwapsData({ betrokkenUserId }): de ruilen
--   swaps (targetdriverid)         van een chauffeur (aanvrager óf collega)
--
-- Kolomnamen zoals setup_security.sql ze aanmaakt: planning met quoted
-- camelCase ("driverId", date), leave en swaps zonder quotes en dus in kleine
-- letters (userid, enddate, requesterid, targetdriverid). Alleen indexen: geen
-- kolommen, geen RLS, policies of grants, dus geen beleidssnapshot-update.
-- Idempotent (if not exists). Op deze tabelgroottes duurt elke index een
-- fractie van een seconde; een gewone `create index` houdt schrijfacties op
-- die tabel zo lang tegen, daarom liefst buiten de werkuren draaien.

begin;

create index if not exists planning_driver_date_idx on public.planning ("driverId", date);
create index if not exists planning_date_idx on public.planning (date);

create index if not exists leave_userid_idx on public.leave (userid);
create index if not exists leave_enddate_idx on public.leave (enddate);

create index if not exists swaps_requesterid_idx on public.swaps (requesterid);
create index if not exists swaps_targetdriverid_idx on public.swaps (targetdriverid);

-- === nacontrole: alle zes bestaan ===
do $$
declare
  ontbreekt text;
begin
  select string_agg(naam, ', ') into ontbreekt
  from unnest(array[
    'planning_driver_date_idx', 'planning_date_idx',
    'leave_userid_idx', 'leave_enddate_idx',
    'swaps_requesterid_idx', 'swaps_targetdriverid_idx'
  ]) as naam
  where to_regclass('public.' || naam) is null;
  if ontbreekt is not null then
    raise exception 'post-conditie faalt: index ontbreekt: %', ontbreekt;
  end if;
end $$;

-- === register ===
insert into public.schema_migraties (bestand)
values ('2026-10-15_indexen_groei.sql')
on conflict (bestand) do nothing;

commit;
