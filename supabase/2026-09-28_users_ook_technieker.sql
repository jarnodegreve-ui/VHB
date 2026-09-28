-- 2026-09-28 — "Ook technieker": een chauffeur die ook in de garage werkt
-- (wens Jarno 28-09).
--
-- Een schoolchauffeur die ook technieker is, moet het techniekgedeelte kunnen
-- gebruiken (gele boek, werkprestaties, werken per bus, voertuigen) zonder
-- zijn plaats als chauffeur te verliezen. Het portaal kent één rol per
-- account, en de rol op technieker zetten haalde hem uit de planning, de
-- dienstruil, de loonexport en de verlofbezetting. Daarom een schakelaar naast
-- de rol: alleen een admin zet hem (Gebruikers), en hij telt alleen bij de rol
-- chauffeur (shared/toegang.ts, sanitizeIncomingUser in api/helpers.ts).
--
-- De tabel `users` gebruikt lowercase kolomnamen (isactive, showincontacts),
-- dus ook hier lowercase: `ooktechnieker`. De API schrijft de kolom bij elke
-- gebruikers-save (toDatabaseUser), maar valt terug op een save zonder zolang
-- deze migratie niet gedraaid is; wie de schakelaar dan aanzet, krijgt een
-- duidelijke 503 in plaats van een stil verlies. GET /api/health/schema
-- signaleert de missende kolom via api/schemaProbes.ts.
--
-- Idempotent: veilig om opnieuw te draaien.

begin;

alter table public.users add column if not exists ooktechnieker boolean not null default false;

comment on column public.users.ooktechnieker is
  'Chauffeur die ook technieker is: krijgt het techniekgedeelte erbij (schakelaar in Gebruikers). Telt alleen bij rol chauffeur.';

-- Post-conditie: `add column if not exists` slaat stil over als de kolom al
-- bestond in een andere vorm. Dan willen we het weten.
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'users'
      and column_name = 'ooktechnieker' and data_type = 'boolean'
      and is_nullable = 'NO' and column_default = 'false'
  ) then
    raise exception 'post-conditie faalt: public.users.ooktechnieker hoort een boolean not null default false te zijn';
  end if;
end
$$;

commit;

-- Raakt geen RLS, policies, grants of definer-functies: authenticated mag
-- users alleen lezen (policy users_select_self_or_staff), alleen de API
-- schrijft. supabase/beleid-snapshot.json blijft gelijk, een drift-update is
-- niet nodig. Wel ook op staging draaien en bijschrijven in
-- supabase/staging/README.md.
