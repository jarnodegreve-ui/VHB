create table if not exists public.planning_matrix_import_history (
  id text primary key,
  created_at timestamptz not null default timezone('utc', now()),
  imported_days integer not null default 0,
  detected_drivers integer not null default 0,
  generated_shifts integer not null default 0,
  matched_services integer not null default 0,
  skipped_absences integer not null default 0,
  unknown_codes text[] not null default '{}',
  unmatched_drivers text[] not null default '{}'
);

alter table public.planning_matrix_import_history enable row level security;
-- Sinds 30-10-2026 niet meer vanzelf (zie de kop van setup_security.sql): de API leest en schrijft via service_role.
grant all on table public.planning_matrix_import_history to service_role;

drop policy if exists "planning_matrix_import_history_select_authenticated" on public.planning_matrix_import_history;
create policy "planning_matrix_import_history_select_authenticated"
on public.planning_matrix_import_history
for select
to authenticated
using (true);
