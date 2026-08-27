-- =============================================================================
-- Import-historiek uitgebreid: bestand, periode en herstelpunt per import
-- =============================================================================
-- PROBLEEM
--   planning_matrix_import_history bevat alleen tellers. Toen op 19-08 gezocht
--   werd wat er wanneer geïmporteerd was, viel er niets terug te vinden: geen
--   bestandsnaam, geen periode, geen wie. En sinds de periode-import (#381/#382)
--   is "welk deel van welk bestand" juist de kerninformatie.
--
-- OPLOSSING (verbeterronde 20-08, nrs. 3/9/10)
--   Zeven nullable kolommen erbij — bestaande rijen blijven geldig, de API
--   schrijft ze vanaf de volgende deploy:
--     filename      naam van het geüploade Excel-bestand
--     imported_by   naam van de planner/admin die importeerde
--     period_start/period_end   vervangen periode (ISO-datumstrings, zoals
--                               planning."date" — de app vergelijkt als tekst)
--     file_start/file_end       volledig bereik van het bestand (voor de
--                               horizon-tegel: "je bestand liep t/m ...")
--     snapshot_path             pad in de backups-bucket naar het herstelpunt
--                               (stand van matrix + planning vóór deze import)
--
-- Idempotent (add column if not exists). De select-policy wordt meteen
-- aangescherpt tot planner/admin (reviewer-punt): met plannernaam en
-- snapshot-pad erbij is dit staf-informatie — de oude policy liet élke
-- ingelogde gebruiker de tabel lezen via PostgREST. De app zelf leest de
-- historiek via de server (service-role), dus die merkt hier niets van.
-- =============================================================================

begin;

alter table public.planning_matrix_import_history add column if not exists filename text;
alter table public.planning_matrix_import_history add column if not exists imported_by text;
alter table public.planning_matrix_import_history add column if not exists period_start text;
alter table public.planning_matrix_import_history add column if not exists period_end text;
alter table public.planning_matrix_import_history add column if not exists file_start text;
alter table public.planning_matrix_import_history add column if not exists file_end text;
alter table public.planning_matrix_import_history add column if not exists snapshot_path text;

drop policy if exists "planning_matrix_import_history_select_authenticated" on public.planning_matrix_import_history;
drop policy if exists "planning_matrix_import_history_select_staff" on public.planning_matrix_import_history;
create policy "planning_matrix_import_history_select_staff"
on public.planning_matrix_import_history
for select
to authenticated
using (public.current_app_user_role() in ('planner', 'admin'));

commit;
