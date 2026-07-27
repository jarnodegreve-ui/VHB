-- Loopnummers per dienstdeel (verzoek Jarno, 2026-07-26).
-- Idempotent; plakken/draaien in de SQL Editor.
--
-- Een loop is het deel van een dienst waaronder bepaalde ritten vallen. Een
-- dienst heeft tot drie tijdsblokken (startTime/startTime2/startTime3) en elk
-- blok krijgt nu zijn eigen loopnummer. De Excel-import van de planning zet
-- dat nummer per gegenereerde planning-rij in de bestaande kolom
-- planning."loopnr", zodat chauffeurs het bij hun uren zien.
--
-- Let op: quoted camelCase-identifiers, zoals de rest van dit schema.

alter table public.services add column if not exists "loopnr"  text;
alter table public.services add column if not exists "loopnr2" text;
alter table public.services add column if not exists "loopnr3" text;

comment on column public.services."loopnr"  is 'Loopnummer van dienstdeel 1 (blok startTime/endTime)';
comment on column public.services."loopnr2" is 'Loopnummer van dienstdeel 2 (blok startTime2/endTime2)';
comment on column public.services."loopnr3" is 'Loopnummer van dienstdeel 3 (blok startTime3/endTime3)';
