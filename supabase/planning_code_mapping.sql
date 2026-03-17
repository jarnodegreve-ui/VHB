begin;

create table if not exists public.planning_codes (
  code text primary key,
  category text not null check (category in ('service', 'absence', 'leave', 'training', 'unknown')),
  description text not null,
  counts_as_shift boolean not null default false,
  is_paid_absence boolean not null default false,
  is_day_off boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists planning_codes_set_updated_at on public.planning_codes;
create trigger planning_codes_set_updated_at
before update on public.planning_codes
for each row
execute function public.set_updated_at();

alter table public.planning_codes enable row level security;

drop policy if exists "planning_codes_read_authenticated" on public.planning_codes;
create policy "planning_codes_read_authenticated"
on public.planning_codes
for select
to authenticated
using (true);

insert into public.planning_codes (
  code,
  category,
  description,
  counts_as_shift,
  is_paid_absence,
  is_day_off
)
values
  ('bv', 'leave', 'Betaald verlof', false, true, false),
  ('ta', 'absence', 'Toegestane afwezigheid', false, false, false),
  ('opl', 'training', 'Opleiding', false, false, false),
  ('tk', 'leave', 'Tijdskrediet', false, false, false),
  ('ov', 'leave', 'Ouderschapsverlof', false, false, false),
  ('vrij', 'absence', 'Geen dienst', false, false, true)
on conflict (code) do update
set
  category = excluded.category,
  description = excluded.description,
  counts_as_shift = excluded.counts_as_shift,
  is_paid_absence = excluded.is_paid_absence,
  is_day_off = excluded.is_day_off,
  updated_at = now();

commit;
