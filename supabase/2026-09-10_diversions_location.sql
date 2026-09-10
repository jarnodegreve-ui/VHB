-- Omleidingen: apart veld voor de plaats (Jarno 10-09: "Eeklo verdwijnt nu in
-- de titel, en dat is juist één van de belangrijkste factoren voor chauffeurs").
-- De chauffeurslijst toont de plaats vet vóór de titel; het beheer krijgt een
-- veld "Plaats". Optioneel: bestaande omleidingen blijven werken zonder.
--
-- Kolomnaam is bewust lowercase én ongequoot: één woord, dus geen
-- camelCase-kwestie (de andere kolommen van deze tabel zijn quoted camelCase:
-- "startDate", "endDate", "pdfUrl"). api/helpers.ts schrijft `location`.
--
-- Idempotent: twee keer draaien is veilig. Geen RLS/policy-wijziging.

begin;

alter table public.diversions
  add column if not exists location text;

comment on column public.diversions.location is
  'Plaats/locatie van de omleiding (bv. "Eeklo, Markt"); optioneel, vrij tekstveld.';

commit;
