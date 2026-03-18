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

drop policy if exists "planning_matrix_import_history_select_authenticated" on public.planning_matrix_import_history;
create policy "planning_matrix_import_history_select_authenticated"
on public.planning_matrix_import_history
for select
to authenticated
using (true);
