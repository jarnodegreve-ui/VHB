-- Documenten per chauffeur (verbeterronde 2026-07): attesten, reglement,
-- loonbrieven e.d. Planner/admin uploadt; de chauffeur ziet en downloadt
-- alleen zijn eigen documenten via ondertekende URL's uit de API.
--
-- Zelfde patroon als het ritblad ná ritblaadje_private.sql: privé bucket,
-- alle lees/schrijf-verkeer loopt via de API met de service role — er zijn
-- dus bewust GEEN select/insert-policies (RLS aan = alles dicht voor de
-- anon/authenticated rollen; de service role passeert RLS).
--
-- Idempotent; plakken en draaien in de Supabase SQL Editor.

begin;

-- Defensief, zoals setup_security.sql: gen_random_uuid() zit in PG-core,
-- maar de extensie aanzetten is gratis en consistent.
create extension if not exists pgcrypto;

-- 1. Metadata-tabel (snake_case, zoals ritblaadje/client_errors)
create table if not exists public.user_documents (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  filename text not null,
  storage_path text not null,
  category text,
  size_bytes integer,
  uploaded_at timestamptz not null default now(),
  uploaded_by text
);

create index if not exists user_documents_user_id_idx
  on public.user_documents (user_id);

alter table public.user_documents enable row level security;

-- 2. Privé storage-bucket (lezen via signed URLs, schrijven via service role)
-- do update i.p.v. do nothing: herstelt de public-vlag ook als de bucket al
-- (per ongeluk publiek) bestond — de les van ritblaadje_private.sql.
insert into storage.buckets (id, name, public)
values ('user-documents', 'user-documents', false)
on conflict (id) do update set public = false;

commit;
