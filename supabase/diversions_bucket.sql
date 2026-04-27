-- Diversions: PDF-bijlagen werden voorheen als base64 data URL in de
-- diversions-tabel bewaard. Nu uploaden we naar Supabase Storage en
-- bewaren we enkel de publieke URL in `pdfUrl`.
--
-- Storage: bucket 'diversions' (public read). Backend schrijft via
-- service role; geen RLS op storage.objects nodig.
--
-- Paste into the Supabase SQL editor and run once.

insert into storage.buckets (id, name, public)
values ('diversions', 'diversions', true)
on conflict (id) do nothing;
