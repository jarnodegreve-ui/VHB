-- 2026-09-21 — PDF-bijlagen bij een update (puntje Jarno 8).
--
-- Een update (Beheer › Communicatie › Updates) kan voortaan hoogstens twee
-- PDF's dragen, bijvoorbeeld een dienstmededeling of een formulier. De
-- bestanden zelf gaan naar Storage, niet naar de database.
--
-- 1) Kolom public.updates.bijlagen (jsonb): de lijst met wat er hangt, per
--    stuk { "slot": 1|2, "filename": "…", "sizeBytes": 12345 }. De URL staat
--    er bewust NIET in: die wordt bij elk ophalen ondertekend vanuit de
--    bucket (`<update-id>-<slot>.pdf`), zelfde afspraak als bij de
--    omleidingen. Zo kan een planner nooit een externe link als "de PDF van
--    deze update" laten doorgaan, en vervalt een gelekte link vanzelf.
-- 2) Kolom public.updates.bijlagen_tonen (boolean): staat het vinkje "PDF
--    meteen tonen" aan, dan staat de eerste pagina ingebed onder de tekst
--    zodra je de update openklapt (desktop); anders alleen een knop.
-- 3) Bucket 'update-bijlagen', privé — zoals ritbladen, documenten en
--    omleidingen. De API schrijft en ondertekent met de service-role, dus er
--    zijn geen policies op storage.objects nodig.
--
-- Idempotent: veilig om opnieuw te draaien. Zonder deze migratie werkt het
-- portaal gewoon door: het uploaden meldt dat de migratie nog moet lopen en
-- bestaande updates blijven ongemoeid. GET /api/health/schema signaleert de
-- missende kolommen: `updates` is bij deze migratie aan TABLE_PROBES
-- toegevoegd (api/schemaProbes.ts), daar stond de tabel nog niet in.

begin;

alter table public.updates add column if not exists bijlagen jsonb;
alter table public.updates add column if not exists bijlagen_tonen boolean not null default false;

comment on column public.updates.bijlagen is
  'PDF-bijlagen: [{slot:1|2, filename, sizeBytes}]. Het bestand zelf staat in de bucket update-bijlagen als <update-id>-<slot>.pdf; de URL wordt per request ondertekend.';
comment on column public.updates.bijlagen_tonen is
  'Toon de bijlage(n) meteen ingebed bij het openklappen van de update.';

-- Vormcheck op de lijst: hoogstens twee bijlagen, en altijd een array. De
-- bestandsnaam is plannerinvoer en elke lezer van /api/updates krijgt deze
-- kolom mee, dus liever hier al een grens dan alleen in de API.
alter table public.updates drop constraint if exists updates_bijlagen_check;
alter table public.updates add constraint updates_bijlagen_check check (
  bijlagen is null
  or (jsonb_typeof(bijlagen) = 'array' and jsonb_array_length(bijlagen) <= 2)
);

-- Post-conditie: `add column if not exists` slaat stil over als de kolom al
-- bestond in een ándere vorm (nullable, ander type). Dan willen we het weten.
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'updates'
      and column_name = 'bijlagen' and data_type = 'jsonb'
  ) then
    raise exception 'post-conditie faalt: public.updates.bijlagen hoort jsonb te zijn';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'updates'
      and column_name = 'bijlagen_tonen' and data_type = 'boolean'
      and is_nullable = 'NO' and column_default = 'false'
  ) then
    raise exception 'post-conditie faalt: public.updates.bijlagen_tonen hoort not null default false te zijn';
  end if;
end
$$;

commit;

-- Storage buiten de transactie: een insert in storage.buckets die faalt mag
-- de kolommen hierboven niet terugdraaien. `do update` in plaats van
-- `do nothing` + een losse update: één statement dat ook een bucket die ooit
-- publiek is aangemaakt weer dichtzet (zelfde patroon als user_documents.sql).
insert into storage.buckets (id, name, public)
values ('update-bijlagen', 'update-bijlagen', false)
on conflict (id) do update set public = false;

-- Post-conditie op de bucket: hier doet stil falen het meeste pijn, want een
-- publieke bucket betekent PDF-links die eeuwig blijven werken (de les van
-- ritblaadje_private.sql en 2026-07-26_diversions_private.sql).
do $$
begin
  if not exists (select 1 from storage.buckets where id = 'update-bijlagen' and public = false) then
    raise exception 'post-conditie faalt: bucket update-bijlagen bestaat niet of staat publiek';
  end if;
end
$$;

-- Raakt geen RLS, policies, grants of definer-functies: supabase/beleid-
-- snapshot.json blijft gelijk, een drift-update is niet nodig. Wel ook op
-- staging draaien (inclusief de bucket) en bijschrijven in
-- supabase/staging/README.md.
