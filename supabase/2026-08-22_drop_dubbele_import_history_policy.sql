-- =============================================================================
-- Dubbele SELECT-policy op planning_matrix_import_history opruimen
-- =============================================================================
-- Uit de Supabase performance-advisor (22-08, verbeterronde nr. 7): de tabel
-- heeft twéé permissieve SELECT-policies voor authenticated met exact dezelfde
-- voorwaarde (planner/admin) — elke query evalueert ze allebei.
--
--   · planning_matrix_import_history_select_staff  (ouder; functie-aanroep
--     per rij)
--   · planning_matrix_import_history_staff_only    (nieuwer; initplan-vorm
--     `(select current_app_user_role())`, één evaluatie per query)
--
-- De nieuwere, snellere blijft; de oude dubbelganger vervalt. Geen
-- gedragswijziging: zelfde rol-voorwaarde, en de app leest deze tabel sowieso
-- via de server (service-role).
--
-- Idempotent (drop policy if exists). Plakken/draaien in de SQL Editor.
-- =============================================================================

drop policy if exists planning_matrix_import_history_select_staff on public.planning_matrix_import_history;
