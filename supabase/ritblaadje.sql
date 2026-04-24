-- Ritblaadjes feature: a single PDF with all shift details that planners
-- replace every few months and chauffeurs download from the portal.
--
-- Storage: Supabase Storage bucket 'ritblaadjes' (public read). Backend
-- writes via service role so we don't need RLS on storage.objects.
-- Metadata lives in public.ritblaadje (always exactly one row with id='current').
--
-- Paste into the Supabase SQL editor and run once.

-- 1. Metadata table
create table if not exists public.ritblaadje (
  id text primary key default 'current',
  filename text not null,
  storage_path text not null,
  uploaded_at timestamptz not null default now(),
  uploaded_by text,
  size_bytes integer,
  constraint only_one_row check (id = 'current')
);

alter table public.ritblaadje enable row level security;

drop policy if exists "Authenticated can read ritblaadje" on public.ritblaadje;
create policy "Authenticated can read ritblaadje" on public.ritblaadje
  for select using (auth.role() = 'authenticated');

-- The backend writes via service role, which bypasses RLS.

-- 2. Storage bucket (public read)
insert into storage.buckets (id, name, public)
values ('ritblaadjes', 'ritblaadjes', true)
on conflict (id) do nothing;
