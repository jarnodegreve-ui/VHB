-- Draai dit in de Supabase SQL Editor.
--
-- users.lastlogin normaliseren naar ISO-8601 (UTC).
--
-- De API schrijft dit veld al als `new Date().toISOString()`, maar er staan
-- nog twee rijen uit een oudere versie in het Belgische weergaveformaat
-- ("16/6/2026, 09:22:54"). De kolom is `text`, dus die mengeling valt niet op
-- tot je erop sorteert of filtert: `nullif(lastlogin,'')::timestamptz` klapt
-- eruit met "date/time field value out of range", en "Laatst actief" in
-- Gebruikersbeheer sorteert die rijen op de verkeerde plek.
--
-- Idempotent: de where-clausule matcht alléén het oude formaat, dus een
-- tweede run raakt niets meer aan. Geen dataverlies — de waarde wordt
-- omgezet, niet gewist; rijen die niet matchen blijven ongemoeid.

begin;

-- Deterministisch los van de sessiezone: zonder dit gebruikt de cast naar
-- `timestamp` de zone van de SQL Editor, wat rond een DST-sprong een uur kan
-- schelen (review-punt).
set local timezone = 'UTC';

-- Interpretatie: het oude formaat is lokale Belgische tijd (het kwam van
-- toLocaleString in de browser van de planner). We lezen het als naïeve
-- timestamp, plakken er de zone Europe/Brussels op en schrijven het terug in
-- UTC — exact het formaat dat de API vandaag ook produceert.
--
-- DD/MM vs MM/DD is bij een dagnummer ≤ 12 in principe ambigu. Vooraf
-- gecontroleerd op de live database (08-08): het gaat om exact twee rijen,
-- "29/4/2026, 13:54:15" en "16/6/2026, 09:22:54" — allebei dag > 12, dus
-- eenduidig Belgisch. Ze worden 2026-04-29T11:54:15.000Z resp.
-- 2026-06-16T07:22:54.000Z.
--
-- Het patroon staat bewust ruim (optionele komma, uur zonder voorloopnul):
-- sommige locales padden het uur niet, en zo'n rij zou anders in het oude
-- formaat blijven staan. ISO-waarden matchen nooit (streepjes + T).
update public.users
set lastlogin = to_char(
      ((to_timestamp(lastlogin, 'DD/MM/YYYY, HH24:MI:SS')::timestamp) at time zone 'Europe/Brussels') at time zone 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    )
where lastlogin ~ '^\d{1,2}/\d{1,2}/\d{4},? \d{1,2}:\d{2}:\d{2}$';

commit;

-- Controlequery — moet 0 teruggeven (geen enkele rij meer in het oude
-- formaat), en de tweede kolom telt de rijen die wél een geldige ISO-waarde
-- hebben:
--
-- select
--   count(*) filter (where lastlogin ~ '^\d{1,2}/\d{1,2}/\d{4},? \d{1,2}:\d{2}:\d{2}$') as nog_oud_formaat,
--   count(*) filter (where lastlogin ~ '^\d{4}-\d{2}-\d{2}T') as iso
-- from public.users;
