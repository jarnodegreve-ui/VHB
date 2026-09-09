-- Laadtijd per maand voor de historiek (controle-ronde 09-09, nr. 1)
--
-- Probleem: de historiek laadt "alle sessies ooit" bewust zonder
-- raw->charging_periods (±10.000 rijen per jaar, te zwaar om over de lijn te
-- sturen). Daardoor was de laadtijd van elke sessie onbekend en telde de
-- kolom, de jaartotaalrij en de Excel-export op tot 0 — een fout getal in een
-- rapport, terwijl de Maand-tab voor dezelfde maand wél een reële laadtijd gaf.
--
-- Oplossing: de optelling in de database doen. Deze functie spiegelt exact wat
-- sessieDetail() in api/_lib/ocpiOverzicht.ts doet:
--   * per laadperiode de eerste dimensie van type TIME (volume in uren),
--   * alleen positieve waarden tellen mee,
--   * per sessie afronden naar hele minuten (zoals Math.round(laadUren * 60)),
--   * sessies met status INVALID tellen niet mee (zoals `ongeldig` in de app),
--   * sessies zonder charging_periods leveren geen rij op, zodat "onbekend"
--     onbekend blijft in plaats van 0 te worden.
-- Maand = kalendermaand in Brusselse tijd, gelijk aan dagVan() in de app.
--
-- Server-only: alleen de API (service role) roept dit aan, dus geen execute
-- voor anon/authenticated.
--
-- Idempotent; plakken en draaien in de Supabase SQL Editor.

begin;

-- Drop-en-heropbouw: een latere versie met een gewijzigd returntype kan niet
-- via `create or replace` (zelfde patroon als 2026-08-19_periode_import.sql).
drop function if exists public.ocpi_laadminuten_per_maand();

create function public.ocpi_laadminuten_per_maand()
returns table (maand text, laad_min bigint)
language sql
stable
security invoker
set search_path = public
as $$
  select x.maand, sum(x.laad_min)::bigint
  from (
    select
      to_char(s.start_date_time at time zone 'Europe/Brussels', 'YYYY-MM') as maand,
      round(
        coalesce((
          select sum(p.uren)
          from (
            select (
              select case
                -- Zoals num() in de TypeScript: onbruikbare waarden worden null
                -- in plaats van een cast-fout. Eén rotte rij zou anders de hele
                -- functie laten falen, waarna de laadtijd stil op "onbekend"
                -- blijft staan voor élke maand.
                when jsonb_typeof(d.waarde -> 'volume') = 'number'
                  then (d.waarde ->> 'volume')::numeric
                when jsonb_typeof(d.waarde -> 'volume') = 'string'
                  and d.waarde ->> 'volume' ~ '^\s*[-+]?(\d+(\.\d*)?|\.\d+)([eE][-+]?\d+)?\s*$'
                  then (d.waarde ->> 'volume')::numeric
              end
              from jsonb_array_elements(
                -- `dimensions` als object of scalar zou jsonb_array_elements
                -- laten crashen; de TypeScript vangt dat met Array.isArray.
                case when jsonb_typeof(cp -> 'dimensions') = 'array'
                  then cp -> 'dimensions' else '[]'::jsonb end
              ) as d(waarde)
              where d.waarde ->> 'type' = 'TIME'
              limit 1
            ) as uren
            from jsonb_array_elements(s.raw -> 'charging_periods') as cp
          ) as p
          where p.uren > 0
        ), 0) * 60
      ) as laad_min
    from public.ocpi_sessions s
    where s.start_date_time is not null
      and coalesce(upper(s.status), '') <> 'INVALID'
      and jsonb_typeof(s.raw -> 'charging_periods') = 'array'
      and jsonb_array_length(s.raw -> 'charging_periods') > 0
  ) as x
  group by x.maand;
$$;

-- Alleen de API (service role) roept dit aan. De grant expliciet zetten in
-- plaats van op de default privileges van Supabase te leunen: gaat dat ooit
-- mis, dan faalt dit stil als "laadtijd onbekend".
revoke all on function public.ocpi_laadminuten_per_maand() from public, anon, authenticated;
grant execute on function public.ocpi_laadminuten_per_maand() to service_role;

comment on function public.ocpi_laadminuten_per_maand() is
  'Laadminuten per kalendermaand (Brusselse tijd) uit raw->charging_periods, INVALID-sessies uitgezonderd. Spiegelt sessieDetail() in api/_lib/ocpiOverzicht.ts; gebruikt door /api/ocpi/historiek.';

commit;
