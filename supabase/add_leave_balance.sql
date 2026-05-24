-- VHB portaal
-- Voegt het jaarlijkse verlofrecht (leavebalancetotal) toe aan de users-tabel.
-- De kolomnaam volgt de bestaande lowercase-conventie die de API gebruikt
-- (zie toDatabaseUser in api/index.ts: employeeid, isactive, ...).
--
-- Additief en veilig om meermaals uit te voeren. De API tolereert een
-- ontbrekende kolom, maar het verlofrecht wordt pas bewaard nadat dit draait.

begin;

alter table public.users add column if not exists leavebalancetotal integer;

commit;
