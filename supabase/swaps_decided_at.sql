-- Voeg decidedat-kolom toe aan swaps zodat we kunnen achterhalen wanneer
-- een dienstruil door planner/admin werd beslist (goedgekeurd, afgewezen,
-- geannuleerd). Wordt gebruikt door het 'wijzigingen sinds laatste import'
-- rapport in de planning-import-flow.
--
-- Paste into the Supabase SQL editor and run once.

alter table public.swaps
  add column if not exists decidedat text;
