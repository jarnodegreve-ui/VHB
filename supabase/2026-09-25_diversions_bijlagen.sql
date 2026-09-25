-- 2026-09-25 — Tot vijf PDF's bij een omleiding (keuze Jarno 23-09).
--
-- Een omleiding (Beheer › Omleidingen) droeg tot nu hoogstens één PDF, op de
-- vaste sleutel `<id>.pdf` in de privé bucket 'diversions', met de kolom
-- "pdfUrl" als marker "er hangt er een". Voortaan hangen er tot vijf, met
-- hetzelfde patroon als de bijlagen bij een update (2026-09-21):
--
-- 1) Kolom public.diversions.bijlagen (jsonb): de lijst met wat er hangt,
--    per stuk { "slot": 1..5, "filename": "…", "sizeBytes": 12345 }. De URL
--    staat er bewust NIET in: die wordt bij elk ophalen ondertekend vanuit de
--    bucket (`<id>-<slot>.pdf`). Zo kan een planner nooit een externe link
--    als "de PDF van deze omleiding" laten doorgaan, en vervalt een gelekte
--    link vanzelf.
-- 2) De bucket 'diversions' bestaat al en is privé sinds
--    2026-07-26_diversions_private.sql; het statement onderaan zet hem
--    desnoods opnieuw dicht.
--
-- Bestaande PDF's hoeven niet verplaatst te worden: zolang een rij geen
-- `bijlagen` heeft en "pdfUrl" gevuld is, leest de API `<id>.pdf` als slot 1.
-- De eerste upload of verwijdering op zo'n omleiding schrijft de lijst en zet
-- "pdfUrl" op null. De kolom "pdfUrl" blijft dus bestaan (quoted camelCase,
-- zoals "startDate"/"endDate"); `bijlagen` is één woord en ongequoot.
--
-- Idempotent: veilig om opnieuw te draaien. Zonder deze migratie werkt het
-- portaal gewoon door: uploaden meldt dat de migratie nog moet lopen (503) en
-- bestaande omleidingen (ook hun oude PDF) blijven bereikbaar.
-- GET /api/health/schema signaleert de missende kolom (api/schemaProbes.ts).

begin;

alter table public.diversions add column if not exists bijlagen jsonb;

comment on column public.diversions.bijlagen is
  'PDF-bijlagen: [{slot:1..5, filename, sizeBytes}]. Het bestand zelf staat in de bucket diversions als <id>-<slot>.pdf; de URL wordt per request ondertekend. Null met "pdfUrl" gevuld = één PDF van vóór 25-09 op <id>.pdf (slot 1).';

-- Vormcheck op de lijst: hoogstens vijf bijlagen, en altijd een array. De
-- bestandsnaam is plannerinvoer en elke lezer van /api/diversions krijgt
-- deze kolom mee, dus liever hier al een grens dan alleen in de API.
alter table public.diversions drop constraint if exists diversions_bijlagen_check;
alter table public.diversions add constraint diversions_bijlagen_check check (
  bijlagen is null
  or (jsonb_typeof(bijlagen) = 'array' and jsonb_array_length(bijlagen) <= 5)
);

-- Post-conditie: `add column if not exists` slaat stil over als de kolom al
-- bestond in een ándere vorm. Dan willen we het weten.
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'diversions'
      and column_name = 'bijlagen' and data_type = 'jsonb'
  ) then
    raise exception 'post-conditie faalt: public.diversions.bijlagen hoort jsonb te zijn';
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'diversions_bijlagen_check' and conrelid = 'public.diversions'::regclass
  ) then
    raise exception 'post-conditie faalt: check-constraint diversions_bijlagen_check ontbreekt';
  end if;
end
$$;

commit;

-- Storage buiten de transactie: een statement op storage.buckets dat faalt
-- mag de kolom hierboven niet terugdraaien. `do update` i.p.v. `do nothing`:
-- één statement dat ook een bucket die ooit publiek is aangemaakt weer
-- dichtzet (zelfde patroon als 2026-09-21_updates_bijlagen.sql).
insert into storage.buckets (id, name, public)
values ('diversions', 'diversions', false)
on conflict (id) do update set public = false;

-- Post-conditie op de bucket: een publieke bucket betekent PDF-links die
-- eeuwig blijven werken (de les van 2026-07-26_diversions_private.sql).
do $$
begin
  if not exists (select 1 from storage.buckets where id = 'diversions' and public = false) then
    raise exception 'post-conditie faalt: bucket diversions bestaat niet of staat publiek';
  end if;
end
$$;

-- Raakt geen RLS, policies, grants of definer-functies: supabase/beleid-
-- snapshot.json blijft gelijk, een drift-update is niet nodig. Wel ook op
-- staging draaien en bijschrijven in supabase/staging/README.md.
