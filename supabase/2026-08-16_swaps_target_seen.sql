-- "Gezien"-bevestiging op dienstwijzigingen.
--
-- Waarom: pushmeldingen bereiken vrijwel niemand (2 van de 39 chauffeurs
-- geabonneerd), dus na een dienstwissel weet de planner niet óf de nieuwe
-- rijder de wijziging gezien heeft — en belt hij toch maar. De chauffeur
-- die een dienst toegeschoven kreeg (targetdriverid) kan de wijziging nu in
-- de app bevestigen; dit veld draagt dat moment. NULL = nog niet bevestigd.
--
-- Eén kolom op swaps, geen aparte tabel: er is precies één te bevestigen
-- partij per wissel (de ontvanger), en de bevestiging hoort bij de wissel
-- zelf — zelfde klasse als decidedat. Server-side alleen schrijfbaar via
-- het eigen bevestig-endpoint (de array-route behoudt altijd de opgeslagen
-- waarde, net als de bevroren ruilvoorwaarden).
--
-- Idempotent; plak in de Supabase SQL Editor en draai één keer.
-- LET OP: draaien vóór de bijbehorende deploy — toDatabaseSwap schrijft deze
-- kolom bij elke swap-upsert (zelfde klasse als het shift_info-patroon).

alter table public.swaps
  add column if not exists target_seen_at text;

-- Controle na afloop: kolom bestaat en is overal leeg (nog niets bevestigd).
--   select count(*) filter (where target_seen_at is not null) as bevestigd,
--          count(*) as totaal
--   from public.swaps;
