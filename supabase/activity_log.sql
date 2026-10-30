create table if not exists public.activity_log (
  id text primary key,
  created_at timestamptz not null default now(),
  actor_name text not null,
  actor_role text not null check (actor_role in ('chauffeur', 'planner', 'admin')),
  category text not null check (category in ('users', 'planning', 'planning_codes', 'services', 'diversions', 'updates', 'auth')),
  action text not null,
  details text not null
);

create index if not exists activity_log_created_at_idx on public.activity_log (created_at desc);
-- Sinds 30-10-2026 niet meer vanzelf (zie de kop van setup_security.sql): de API leest en schrijft via service_role.
grant all on table public.activity_log to service_role;
