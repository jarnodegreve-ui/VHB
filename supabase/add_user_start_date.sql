-- Startdatum ("in dienst sinds") per werknemer → basis voor anciënniteit-
-- sortering binnen een sectie in de Maandplanning (zo matcht de volgorde exact
-- de Excel). Wordt per gebruiker ingegeven in het gebruikersbeheer.
--
-- Idempotent (veilig meermaals te draaien), in begin/commit. Net als de andere
-- users-kolommen bewust UNQUOTED/lowercase → de echte kolomnaam wordt
-- "startdate", consistent met isactive/employeeid en matchend met
-- api/helpers.ts (toDatabaseUser schrijft "startdate", toPublicUser leest het).
-- Type date (pure kalenderdatum, geen tijdzone). NULL = onbekend.

begin;

alter table public.users
  add column if not exists startDate date;

commit;
