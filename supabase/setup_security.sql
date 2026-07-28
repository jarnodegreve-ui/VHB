-- VHB portaal: basis users-tabel + RLS policies
-- Uitvoeren in Supabase SQL Editor

begin;

create extension if not exists pgcrypto;

create table if not exists public.users (
  id text primary key,
  name text not null,
  role text not null check (role in ('chauffeur', 'planner', 'admin')),
  employeeId text not null,
  lastLogin text,
  activeSessions integer not null default 0,
  isActive boolean not null default true,
  phone text,
  email text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.users add column if not exists name text;
alter table public.users add column if not exists role text;
alter table public.users add column if not exists employeeId text;
alter table public.users add column if not exists lastLogin text;
alter table public.users add column if not exists activeSessions integer not null default 0;
alter table public.users add column if not exists isActive boolean not null default true;
alter table public.users add column if not exists phone text;
alter table public.users add column if not exists email text;
alter table public.users add column if not exists created_at timestamptz not null default now();
alter table public.users add column if not exists updated_at timestamptz not null default now();

update public.users
set
  name = coalesce(nullif(trim(name), ''), 'Onbekende gebruiker'),
  role = coalesce(nullif(trim(role), ''), 'chauffeur'),
  employeeId = coalesce(nullif(trim(employeeId), ''), 'MIGRATED-' || left(id, 8)),
  activeSessions = coalesce(activeSessions, 0),
  isActive = coalesce(isActive, true)
where
  name is null
  or trim(name) = ''
  or role is null
  or trim(role) = ''
  or employeeId is null
  or trim(employeeId) = ''
  or activeSessions is null
  or isActive is null;

alter table public.users alter column name set not null;
alter table public.users alter column role set not null;
alter table public.users alter column employeeId set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'users_role_check'
  ) then
    alter table public.users
      add constraint users_role_check
      check (role in ('chauffeur', 'planner', 'admin'));
  end if;
end
$$;

create unique index if not exists users_email_unique_idx
on public.users (lower(email))
where email is not null;
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists users_set_updated_at on public.users;
create trigger users_set_updated_at
before update on public.users
for each row
execute function public.set_updated_at();

alter table public.users enable row level security;

create or replace function public.current_app_user_role()
returns text
language sql
stable
as $$
  select role
  from public.users
  where lower(email) = lower(auth.email())
  limit 1
$$;

drop policy if exists "users_select_self_or_staff" on public.users;
create policy "users_select_self_or_staff"
on public.users
for select
to authenticated
using (
  lower(email) = lower(auth.email())
  or public.current_app_user_role() in ('planner', 'admin')
);

drop policy if exists "users_insert_admin_only" on public.users;
create policy "users_insert_admin_only"
on public.users
for insert
to authenticated
with check (
  public.current_app_user_role() = 'admin'
);

-- UPDATE is admin-only. De vroegere "self or admin"-variant liet een
-- chauffeur zijn eigen rij bewerken — inclusief `role` — en dus zichzelf
-- tot admin promoveren via PostgREST met de publieke anon-key. De app
-- schrijft altijd via de service-role, dus zelf-update is nergens nodig.
-- (De oude policy wordt expliciet gedropt: permissive policies stapelen
-- met OR, dus laten staan = het gat weer openzetten.)
drop policy if exists "users_update_self_or_admin" on public.users;
drop policy if exists "users_update_admin_only" on public.users;
create policy "users_update_admin_only"
on public.users
for update
to authenticated
using (public.current_app_user_role() = 'admin')
with check (public.current_app_user_role() = 'admin');

drop policy if exists "users_delete_admin_only" on public.users;
create policy "users_delete_admin_only"
on public.users
for delete
to authenticated
using (
  public.current_app_user_role() = 'admin'
);

-- Zorg dat de overige tabellen minstens bestaan en RLS aan hebben.
-- Je API gebruikt de service role key, dus servercalls blijven werken.

create table if not exists public.planning (
  id text primary key,
  date text not null,
  startTime text not null,
  endTime text not null,
  line text not null,
  busNumber text not null,
  loopnr text not null,
  driverId text not null
);

create table if not exists public.diversions (
  id text primary key,
  line text not null,
  title text not null,
  description text not null,
  startDate text not null,
  endDate text,
  severity text not null,
  pdfUrl text,
  mapCoordinates text
);

-- LET OP: quoted camelCase identifiers — anders vouwt Postgres ze naar
-- lowercase en mismatcht de mapper (toDatabaseService schrijft camelCase).
create table if not exists public.services (
  id text primary key,
  "serviceNumber" text not null,
  "startTime" text not null,
  "endTime" text not null,
  "startTime2" text,
  "endTime2" text,
  "startTime3" text,
  "endTime3" text
);

create table if not exists public.updates (
  id text primary key,
  date text not null,
  title text not null,
  content text not null,
  category text not null,
  isUrgent boolean default false
);

create table if not exists public.swaps (
  id text primary key,
  shiftId text not null,
  requesterId text not null,
  targetDriverId text,
  status text not null,
  createdAt text not null,
  reason text
);

create table if not exists public.leave (
  id text primary key,
  userId text not null,
  startDate text not null,
  endDate text not null,
  type text not null,
  status text not null,
  comment text,
  createdAt text not null
);

alter table public.planning enable row level security;
alter table public.diversions enable row level security;
alter table public.services enable row level security;
alter table public.updates enable row level security;
alter table public.swaps enable row level security;
alter table public.leave enable row level security;

drop policy if exists "planning_read_authenticated" on public.planning;
create policy "planning_read_authenticated"
on public.planning
for select
to authenticated
using (true);

drop policy if exists "diversions_read_authenticated" on public.diversions;
create policy "diversions_read_authenticated"
on public.diversions
for select
to authenticated
using (true);

drop policy if exists "services_read_authenticated" on public.services;
create policy "services_read_authenticated"
on public.services
for select
to authenticated
using (true);

drop policy if exists "updates_read_authenticated" on public.updates;
create policy "updates_read_authenticated"
on public.updates
for select
to authenticated
using (true);

-- Ruilen zijn alleen leesbaar voor de betrokkenen (aanvrager of aangezochte
-- collega) en voor planner/admin. `using (true)` gaf elke chauffeur alle
-- ruil-toelichtingen van collega's via een rechtstreekse PostgREST-query.
drop policy if exists "swaps_read_authenticated" on public.swaps;
drop policy if exists "swaps_read_involved_or_staff" on public.swaps;
create policy "swaps_read_involved_or_staff"
on public.swaps
for select
to authenticated
using (
  public.current_app_user_role() in ('planner', 'admin')
  or exists (
    select 1 from public.users u
    where lower(u.email) = lower(auth.email())
      and (
        u.id::text = swaps.requesterid::text
        or u.id::text = swaps.targetdriverid::text
      )
  )
);

-- Verlof idem: eigen records + planner/admin. Met `using (true)` kon elke
-- chauffeur de ziekte-/verlofredenen (vrije tekst) van collega's lezen.
drop policy if exists "leave_read_authenticated" on public.leave;
drop policy if exists "leave_read_involved_or_staff" on public.leave;
create policy "leave_read_involved_or_staff"
on public.leave
for select
to authenticated
using (
  public.current_app_user_role() in ('planner', 'admin')
  or exists (
    select 1 from public.users u
    where lower(u.email) = lower(auth.email())
      and u.id::text = leave.userid::text
  )
);

commit;
