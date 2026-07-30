-- Leesbevestiging op documenten (verbeterronde 30-07-2026): wanneer opende
-- de chauffeur zijn document voor het eerst? Gezet door de API (service
-- role) bij de eerste keer openen; NULL = nog niet geopend.
-- Idempotent; plakken en draaien in de Supabase SQL Editor.

alter table public.user_documents
  add column if not exists opened_at timestamptz;
