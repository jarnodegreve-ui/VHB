begin;

create extension if not exists pgcrypto;

create table if not exists public.planning_matrix_rows (
  id text primary key,
  source_date date not null,
  day_type text,
  assignments jsonb not null default '{}'::jsonb,
  raw_row text,
  created_at timestamptz not null default now()
);

create index if not exists planning_matrix_rows_source_date_idx
on public.planning_matrix_rows (source_date);

alter table public.planning_matrix_rows enable row level security;
-- Sinds 30-10-2026 niet meer vanzelf (zie de kop van setup_security.sql): de API leest en schrijft via service_role.
grant all on table public.planning_matrix_rows to service_role;

drop policy if exists "planning_matrix_rows_read_authenticated" on public.planning_matrix_rows;
create policy "planning_matrix_rows_read_authenticated"
on public.planning_matrix_rows
for select
to authenticated
using (true);

commit;
