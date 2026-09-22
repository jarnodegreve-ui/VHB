-- 2026-09-22 — Reden bij het weigeren van verlof (wens Jarno 22-09).
--
-- Als de planner een verlofaanvraag afwijst, kan hij daar voortaan een vrije
-- tekst bij zetten. Die komt op het record (kolom `beslisreden`), in het
-- activiteitenlog, in de beslissingsmail en in de pushmelding naar de
-- chauffeur, en de chauffeur ziet hem bij zijn aanvraag onder Verlof.
--
-- De tabel `leave` gebruikt lowercase kolomnamen (userid, decidedat), dus
-- ook hier lowercase: `beslisreden`. De API schrijft de kolom alleen bij een
-- afwijzing mét reden (api/helpers.ts toDatabaseLeave), zodat elke andere
-- verlof-save blijft werken zolang deze migratie nog niet gedraaid is;
-- weigeren mét reden geeft dan een duidelijke 503 in plaats van een kale
-- fout. GET /api/health/schema signaleert de missende kolom via
-- api/schemaProbes.ts.
--
-- Idempotent: veilig om opnieuw te draaien.

begin;

alter table public.leave add column if not exists beslisreden text;

comment on column public.leave.beslisreden is
  'Vrije tekst van de beslisser bij een afwijzing (status rejected); leeg bij elke andere status.';

-- Bovengrens, spiegel van BESLISREDEN_MAX in api/_lib/verlofRoutes.ts: het
-- is een vrij tekstvak, geen opstel, en de tekst gaat ook mee in mail en
-- pushmelding.
alter table public.leave drop constraint if exists leave_beslisreden_check;
alter table public.leave add constraint leave_beslisreden_check check (
  beslisreden is null or char_length(beslisreden) <= 500
);

-- Post-conditie: `add column if not exists` slaat stil over als de kolom al
-- bestond in een andere vorm. Dan willen we het weten.
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'leave'
      and column_name = 'beslisreden' and data_type = 'text' and is_nullable = 'YES'
  ) then
    raise exception 'post-conditie faalt: public.leave.beslisreden hoort een nullable text-kolom te zijn';
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.leave'::regclass and conname = 'leave_beslisreden_check'
  ) then
    raise exception 'post-conditie faalt: check-constraint leave_beslisreden_check ontbreekt';
  end if;
end
$$;

commit;

-- Raakt geen RLS, policies, grants of definer-functies: supabase/beleid-
-- snapshot.json blijft gelijk, een drift-update is niet nodig. Wel ook op
-- staging draaien en bijschrijven in supabase/staging/README.md.
