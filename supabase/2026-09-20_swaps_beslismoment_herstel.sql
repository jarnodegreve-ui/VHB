-- Draai dit in de Supabase SQL Editor (productie), NA de deploy van de fix in
-- PATCH /api/swaps/:id. Geen schemawijziging, alleen een dataherstel.
--
-- swaps.decidedat van afgehandelde ruilen terugzetten naar het beslismoment.
--
-- Wat er mis was: de knop "Afhandelen" (approved -> completed, sinds 17-09)
-- schreef het afhandelmoment over decidedat heen. Dat veld is het
-- beslismoment (goedkeuren of weigeren) en bepaalt de volgorde waarin de
-- heropbouw-replay, de maandplanning-overlay, de dekking en de ruil-badge
-- goedgekeurde en afgehandelde ruilen afspelen. Bij een doorgeefketting
-- (A -> B, daarna B -> C) belandde de eerste schakel na het afhandelen
-- achteraan, en viel de dienst na "Planning opnieuw opbouwen" terug op B.
-- De code overschrijft het veld sinds deze PR niet meer; dit script zet de
-- rijen recht die al overschreven waren.
--
-- Bron van het oorspronkelijke moment: het activiteitenlog. Elke doorvoer
-- logt precies een van de drie acties hieronder met de swap-id als
-- entity_id (zelfde lijst als SWAP_UITVOERING_ACTIES in api/helpers.ts). De
-- logregel wordt vlak NA het opslaan van de ruil geschreven en ligt dus een
-- fractie van een seconde na het echte beslismoment (op productie gemeten op
-- 20-09: 0,26 tot 1,07 s); voor de volgorde tussen ruilen is dat verwaarloosbaar.
--
-- Een rij wordt ALLEEN aangeraakt als alles hieronder klopt:
--   1. status = 'completed';
--   2. er is precies EEN doorvoer-logregel voor die ruil (eenduidig);
--   3. decidedat ligt meer dan een minuut na dat gelogde moment (dus het is
--      aantoonbaar niet meer het beslismoment);
--   4. er bestaat een logregel "Dienstruil voltooid" binnen een minuut van
--      de huidige decidedat (dus het is aantoonbaar het afhandelmoment).
-- Alleen de kolom decidedat wijzigt; status, planning en al de rest blijven
-- ongemoeid.
--
-- Idempotent: na het herstel is decidedat gelijk aan het gelogde moment,
-- waardoor voorwaarde 3 niet meer geldt. Een tweede run raakt niets aan, en
-- ruilen die na de fix worden afgehandeld vallen er ook buiten (hun
-- decidedat ligt voor de logregel van de goedkeuring, niet erna).
--
-- Dry-run op productie (20-09-2026, alleen gelezen): 11 rijen, allemaal
-- handmatige wissels ("Dienst handmatig overgezet") die op 17-09 tussen
-- 19:23 en 19:24 UTC zijn afgehandeld; geen enkele zit vandaag in een
-- ketting. De select onderaan (blok "Vooraf") toont ze met oud en nieuw
-- moment.

begin;

-- to_char en de casts hieronder los van de sessiezone van de SQL Editor.
set local timezone = 'UTC';

with beslismoment as (
  select a.entity_id as swap_id, min(a.created_at) as gelogd
  from public.activity_log a
  where a.entity_type = 'swap'
    and a.action in ('Dienstruil goedgekeurd', 'Diensten handmatig gewisseld', 'Dienst handmatig overgezet')
  group by a.entity_id
  having count(*) = 1
)
update public.swaps s
set decidedat = to_char(b.gelogd at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
from beslismoment b
where b.swap_id = s.id
  and s.status = 'completed'
  -- De kolom is text: alleen ISO-waarden casten, de rest overslaan in plaats
  -- van het hele script te laten klappen.
  and case when s.decidedat ~ '^\d{4}-\d{2}-\d{2}T' then s.decidedat::timestamptz end
        > b.gelogd + interval '1 minute'
  and exists (
    select 1
    from public.activity_log v
    where v.entity_type = 'swap'
      and v.entity_id = s.id
      and v.action = 'Dienstruil voltooid'
      and case when s.decidedat ~ '^\d{4}-\d{2}-\d{2}T' then s.decidedat::timestamptz end
            between v.created_at - interval '1 minute' and v.created_at + interval '1 minute'
  );

commit;

-- Post-conditie. Verwacht na de run op productie: afgehandeld = 11 (of meer
-- als er intussen zijn bijgekomen), nog_op_afhandelmoment = 0. Staat daar
-- iets anders dan 0, dan heeft die ruil geen eenduidige doorvoer-logregel en
-- is ze bewust niet aangeraakt: bekijk ze met de hand.
select
  count(*) as afgehandeld,
  count(*) filter (where exists (
    select 1
    from public.activity_log v
    where v.entity_type = 'swap'
      and v.entity_id = s.id
      and v.action = 'Dienstruil voltooid'
      and case when s.decidedat ~ '^\d{4}-\d{2}-\d{2}T' then s.decidedat::timestamptz end
            between v.created_at - interval '1 minute' and v.created_at + interval '1 minute'
  )) as nog_op_afhandelmoment
from public.swaps s
where s.status = 'completed';

-- Vooraf (dry-run, wijzigt niets): welke rijen zou de update raken en naar
-- welke waarde? Draai dit blok los VOOR het script hierboven.
--
-- with beslismoment as (
--   select a.entity_id as swap_id, min(a.created_at) as gelogd, min(a.action) as actie
--   from public.activity_log a
--   where a.entity_type = 'swap'
--     and a.action in ('Dienstruil goedgekeurd', 'Diensten handmatig gewisseld', 'Dienst handmatig overgezet')
--   group by a.entity_id
--   having count(*) = 1
-- )
-- select s.id, s.shift_date, s.shift_line, b.actie,
--        s.decidedat as decidedat_oud,
--        to_char(b.gelogd at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as decidedat_nieuw
-- from public.swaps s
-- join beslismoment b on b.swap_id = s.id
-- where s.status = 'completed'
--   and case when s.decidedat ~ '^\d{4}-\d{2}-\d{2}T' then s.decidedat::timestamptz end
--         > b.gelogd + interval '1 minute'
--   and exists (
--     select 1 from public.activity_log v
--     where v.entity_type = 'swap' and v.entity_id = s.id and v.action = 'Dienstruil voltooid'
--       and case when s.decidedat ~ '^\d{4}-\d{2}-\d{2}T' then s.decidedat::timestamptz end
--             between v.created_at - interval '1 minute' and v.created_at + interval '1 minute'
--   )
-- order by b.gelogd;
