-- Sectie/ploeg per chauffeur (Reguliere / Nacht / Flexi / Schoolvervoer).
-- Bepaalt de groepering + volgorde in de Maandplanning. Staat bewust LOS van de
-- Excel-import: de praktijk-tab bevat geen sectie-info, dus die zetten we per
-- chauffeur in het gebruikersbeheer.
--
-- Idempotent (veilig meermaals te draaien). Net als de andere users-kolommen
-- bewust UNQUOTED/lowercase → de echte kolomnaam wordt "section", consistent
-- met isactive/employeeid en matchend met api/helpers.ts (toDatabaseUser
-- schrijft "section", toPublicUser leest het). NULL = geen sectie.

begin;

alter table public.users
  add column if not exists section text;

commit;
