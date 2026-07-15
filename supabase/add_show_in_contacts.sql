-- Contactlijst-zichtbaarheid per gebruiker.
-- Voegt een schakelaar toe waarmee een beheerder iemand uit de contactlijst
-- kan houden zonder het account te pauzeren of te verwijderen.
--
-- Idempotent: veilig meermaals te draaien.
-- Let op: net als de andere users-kolommen (isactive, employeeid, ...) is dit
-- bewust een UNQUOTED identifier, die Postgres naar lowercase vouwt →
-- de echte kolomnaam is "showincontacts". Dat matcht api/helpers.ts
-- (toDatabaseUser schrijft `showincontacts`, toPublicUser leest het).
--
-- Bestaande rijen krijgen automatisch de default (true = zichtbaar), dus geen
-- aparte backfill nodig.

alter table public.users
  add column if not exists showInContacts boolean not null default true;
