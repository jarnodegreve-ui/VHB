-- 2026-10-09 — Verlofbudget per jaar (verbeterronde 09-10, punt 11, keuze Jarno).
--
-- users.verlofbudget is één getal dat voor elk jaar geldt. Wie in januari
-- iemands budget aanpast (anciënniteit, deeltijds, een nieuwe collega met een
-- gedeeltelijk recht) verandert daarmee ook het saldo-overzicht en het rapport
-- Verlofsaldo van het vorige jaar. Daarom een afwijkend budget per jaar:
--
--   verlofbudgetten jsonb, bv. {"2026": 24, "2027": 22}
--
-- Leesregel (shared/verlofSaldo.ts, verlofBudgetVoorJaar): eerst het jaar in
-- verlofbudgetten, anders verlofbudget, anders de standaard van 24 dagen.
-- De bestaande kolom blijft dus het standaardbudget van de persoon; niets in
-- de bestaande data verandert van betekenis. De API schrijft alleen jaren van
-- vier cijfers met een geheel aantal dagen van nul of meer.
--
-- Raakt geen RLS, policies of grants: geen snapshot-update.
-- Idempotent: veilig om opnieuw te draaien.

begin;

alter table public.users
  add column if not exists verlofbudgetten jsonb;

comment on column public.users.verlofbudgetten is
  'Afwijkend verlofbudget per jaar, {"2027": 22}; leeg = verlofbudget (of de standaard van 24 dagen).';

-- === register ===
insert into public.schema_migraties (bestand)
values ('2026-10-09_users_verlofbudgetten.sql')
on conflict (bestand) do nothing;

commit;
