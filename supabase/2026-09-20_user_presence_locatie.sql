-- 2026-09-20: aanwezigheid, van waar iemand aanmeldt (stad, regio, land).
--
-- Vraag van Jarno: "kan ik ook zien van waar ze inloggen, om ongewenste
-- gebruikers tegen te gaan?" De toestel-goedkeuring houdt een doorgegeven
-- login al tegen bij chauffeurs; de plaats maakt daarnaast zichtbaar wanneer
-- een (goedgekeurd) account plots van een onverwachte plek komt.
--
-- Privacy-zuinig, met opzet:
--   * GEEN IP-adres. De API leest de geo-headers die Vercel op elk verzoek
--     zet (x-vercel-ip-country, -country-region, -city) en bewaart alleen die
--     drie afgeleide waarden. Een stad wijst naar een streek, een IP-adres
--     naar één aansluiting.
--   * Eén plaats per sessie, de laatst geziene. Geen spoor van verplaatsingen
--     binnen een sessie.
--   * Zelfde retentie als de rest van de tabel: pruneOldRecords ruimt sessies
--     ouder dan RETENTION_AANWEZIGHEID_DAYS (standaard 90) op, de plaats gaat
--     mee weg.
--   * Zelfde sloten: RLS aan zonder policies, alleen service_role heeft
--     rechten. Deze migratie wijzigt daar niets aan en rekent het onderaan na.
--
-- Nauwkeurigheid: de plaats is afgeleid van het IP-adres. Op mobiel internet
-- is dat vaak de stad van de provider (Brussel, Antwerpen), niet waar iemand
-- staat. Het land klopt vrijwel altijd; daar dient dit voor.
--
-- Alle drie nullable: oude rijen, lokaal ontwikkelen en elk verzoek zonder
-- bruikbare header blijven null.
--
-- Idempotent: veilig om opnieuw te draaien. De code faalt zonder deze
-- migratie zacht: noteerAanwezigheid schrijft dan zonder plaats verder
-- (api/storage.ts, schrijfMetLocatie) en GET /api/activity/presence meldt in
-- `locatieMigratie` dat dit bestand nog moet. GET /api/health/schema
-- signaleert de missende kolommen (api/schemaProbes.ts). De volgorde van
-- deploy en migratie maakt dus niet uit.

begin;

-- ISO 3166-1 alpha-2 in hoofdletters ("BE").
alter table public.user_presence add column if not exists land text;
-- Het regiodeel van ISO 3166-2, zonder landprefix ("VOV", "BRU").
alter table public.user_presence add column if not exists regio text;
-- Plaatsnaam zoals Vercel hem aanlevert, al gedecodeerd ("Gent").
alter table public.user_presence add column if not exists stad text;

-- Lengte-checks: de API valideert al (api/_lib/aanwezigheid.ts,
-- locatieUitHeaders en LOCATIE_MAX), dit is het tweede slot. Een header is
-- invoer van buitenaf; zonder grens kan één scheef verzoek een rij van
-- kilobytes achterlaten in een tabel die elk beheerscherm integraal inleest.
-- Weigert de database een waarde, dan schrijft de API dezelfde sessie meteen
-- opnieuw zonder plaats: de aanwezigheid zelf gaat nooit verloren.
--
-- Vlakke DDL: weghalen als ze er staat en opnieuw toevoegen, in dezelfde
-- transactie. Zo draait het bestand elke keer naar exact dezelfde definitie
-- toe, ook wanneer een eerdere versie van de check anders was. De tabel is
-- klein (enkele duizenden rijen), het hervalideren kost niets.
alter table public.user_presence drop constraint if exists user_presence_land_check;
alter table public.user_presence
  add constraint user_presence_land_check check (land is null or land ~ '^[A-Z]{2}$');

alter table public.user_presence drop constraint if exists user_presence_regio_check;
alter table public.user_presence
  add constraint user_presence_regio_check check (regio is null or char_length(regio) between 1 and 3);

alter table public.user_presence drop constraint if exists user_presence_stad_check;
alter table public.user_presence
  add constraint user_presence_stad_check check (stad is null or char_length(stad) between 1 and 80);

-- Geen index: het overzicht leest per periode (user_presence_laatst_idx) en
-- telt "buiten België" in het geheugen over hoogstens enkele duizenden rijen.

-- Post-conditie: liever hier stuk dan stil half gedraaid. Dekt elke kolom en
-- elke constraint van hierboven, én de twee sloten van de tabel zelf. Die
-- laatste raakt deze migratie niet aan, maar nu er een plaats bij komt is dit
-- het moment om zeker te zijn dat ze er nog staan.
do $$
begin
  if (
    select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'user_presence'
      and column_name in ('land', 'regio', 'stad')
      and data_type = 'text' and is_nullable = 'YES'
  ) <> 3 then
    raise exception 'post-conditie faalt: land, regio en stad horen alle drie als nullable text op public.user_presence te staan';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'user_presence_land_check' and conrelid = 'public.user_presence'::regclass) then
    raise exception 'post-conditie faalt: check-constraint user_presence_land_check ontbreekt';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'user_presence_regio_check' and conrelid = 'public.user_presence'::regclass) then
    raise exception 'post-conditie faalt: check-constraint user_presence_regio_check ontbreekt';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'user_presence_stad_check' and conrelid = 'public.user_presence'::regclass) then
    raise exception 'post-conditie faalt: check-constraint user_presence_stad_check ontbreekt';
  end if;
  if not exists (
    select 1 from pg_class where oid = 'public.user_presence'::regclass and relrowsecurity
  ) then
    raise exception 'post-conditie faalt: RLS staat uit op public.user_presence';
  end if;
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'user_presence') then
    raise exception 'post-conditie faalt: public.user_presence heeft een policy; de tabel hoort deny-by-default te zijn';
  end if;
  if exists (
    select 1 from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'user_presence'
      and grantee in ('anon', 'authenticated')
  ) then
    raise exception 'post-conditie faalt: anon/authenticated hebben rechten op public.user_presence';
  end if;
  -- Kolomrechten staan los van tabelrechten: een grant op één kolom zou de
  -- check hierboven passeren.
  if exists (
    select 1 from information_schema.column_privileges
    where table_schema = 'public' and table_name = 'user_presence'
      and grantee in ('anon', 'authenticated')
  ) then
    raise exception 'post-conditie faalt: anon/authenticated hebben kolomrechten op public.user_presence';
  end if;
  if not exists (
    select 1 from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'user_presence'
      and grantee = 'service_role' and privilege_type = 'UPDATE'
  ) then
    raise exception 'post-conditie faalt: service_role mist rechten op public.user_presence';
  end if;
end
$$;

commit;

-- Na het draaien: niets extra. Nieuwe kolommen wijzigen geen RLS, policies of
-- grants, dus supabase/beleid-snapshot.json blijft gelijk. Ook op staging
-- draaien en onderaan supabase/staging/README.md bijschrijven.
