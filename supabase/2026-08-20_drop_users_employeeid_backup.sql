-- =============================================================================
-- Opruimen: backup-tabel users_employeeid_backup_20260802 verwijderen
-- =============================================================================
-- CONTEXT
--   Op 2026-08-02 is vóór de employeeid/phone-migratie een momentopname van
--   users bewaard (id, name, oud_employeeid, oud_phone, bewaard_op; 44 rijen).
--   Die migratie is al weken live en de backup bevat niets unieks meer —
--   gecontroleerd op 2026-08-20 vóór het schrijven van deze migratie:
--     · alle 44 backup-rijen bestaan nog als user;
--     · géén user mist een employeeid of phone waarvoor alleen de backup
--       nog een waarde heeft.
--   De tabel bevat wel persoonsgegevens (namen + telefoonnummers), dus
--   opruimen is ook privacy-hygiëne, geen louter esthetiek.
--
-- Idempotent: DROP IF EXISTS — nogmaals draaien is een no-op.
-- Plakken/draaien in de Supabase SQL Editor.
-- =============================================================================

-- Vangnet (reviewer-punt): weiger te droppen zolang de backup nog een waarde
-- bevat die in users ontbreekt — een drop is onomkeerbaar en dit bestand kan
-- ook later nog met de hand geplakt worden.
do $$
begin
  if to_regclass('public.users_employeeid_backup_20260802') is not null
     and exists (
       select 1
       from public.users_employeeid_backup_20260802 b
       join public.users u on u.id = b.id
       where (coalesce(u.employeeid, '') = '' and coalesce(b.oud_employeeid, '') <> '')
          or (coalesce(u.phone, '')      = '' and coalesce(b.oud_phone, '')      <> '')
     ) then
    raise exception 'Backup bevat nog unieke employeeid/phone-waarden — niet droppen.';
  end if;
end $$;

drop table if exists public.users_employeeid_backup_20260802;
