-- Per-gebruiker verlofbudget. Default 24 dagen (VHB-standaard). Per
-- chauffeur kan een afwijkend aantal worden ingesteld (anciënniteit-
-- toeslag, deeltijdse contracten, jonge medewerker met minder dagen).
-- NULL = val terug op de globale BETAALD_VERLOF_BUDGET in de app.
--
-- Run once in de Supabase SQL editor.

alter table public.users
  add column if not exists verlofbudget integer;
