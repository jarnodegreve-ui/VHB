-- Automatische planning-doorvoer van goedgekeurde dienstruilen.
--
-- De server voert een goedgekeurde ruil/overname voortaan zelf door in de
-- planning-tabel (en draait hem terug bij annulering). Daarvoor moet de swap
-- wéten om welke dienst-dag het ging, onafhankelijk van de planning-rij-id:
-- die id's worden bij elke heropbouw opnieuw gevormd, dus shiftid alleen is
-- niet stabiel genoeg. shift_date + shift_line worden bij het indienen
-- server-side ingevuld (niet client-trusted) en zijn de sleutel waarmee de
-- heropbouw goedgekeurde ruilen opnieuw toepast.
--
-- Idempotent; plak in de Supabase SQL Editor en draai één keer.
-- LET OP: draaien vóór de bijbehorende deploy — toDatabaseSwap schrijft deze
-- kolommen bij elke swap-upsert (zelfde klasse als het wantssystemmail- en
-- swap_type-patroon).

alter table public.swaps
  add column if not exists shift_date text;

alter table public.swaps
  add column if not exists shift_line text;

-- Backfill voor bestaande ruilen zolang hun planning-rij nog bestaat.
-- (Na een heropbouw bestaat de oude rij-id niet meer; die swaps blijven
-- leeg en worden bij goedkeuring met een logmelding overgeslagen.)
update public.swaps s
set shift_date = p.date,
    shift_line = p.line
from public.planning p
where p.id = s.shiftid
  and (s.shift_date is null or s.shift_line is null);

-- Controle na afloop: hoeveel swaps hebben (nog) geen dienst-info?
--   select count(*) filter (where shift_date is null) as zonder_info,
--          count(*) as totaal
--   from public.swaps;
