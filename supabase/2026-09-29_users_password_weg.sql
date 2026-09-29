-- Controle-ronde 29-09, nummer 8: de oude kolom public.users.password weg.
-- Beslissing Jarno, 29-09-2026.
--
-- Waarom: de kolom bewaarde oude beginwachtwoorden in platte tekst (op
-- productie 30 van 45 rijen gevuld). Zodra 2026-09-29_rls_tweede_factor.sql
-- gedraaid is, kan alleen de server (service_role) de tabel nog lezen; deze
-- migratie haalt de kolom ook uit de database zelf.
--
-- Nagekeken vóór het schrijven (29-09, productie, alleen lezen):
--  - geen enkele van de 30 oude waarden is nog een geldig wachtwoord
--    (vergeleken met crypt() tegen auth.users; een proef met een zelfgemaakt
--    wachtwoord bevestigde dat de vergelijking werkt); niemand hoeft dus een
--    nieuw wachtwoord te kiezen;
--  - geen code leest of schrijft de kolom: een back-up komt uit toPublicUser
--    en een herstel schrijft via toDatabaseUser (api/helpers.ts), en geen van
--    beide kent de kolom; api/schemaProbes.ts evenmin;
--  - geen view, index, policy, kolomrecht of trigger hangt eraan (de enige
--    trigger, users_set_updated_at, gebruikt ze niet), en geen functie in
--    public noemt ze.
-- Op staging bestaat de kolom niet: daar doet deze migratie niets.
--
-- Destructief: de 30 oude waarden zijn daarna niet meer leesbaar. De bytes
-- blijven in de bestaande rijen staan tot die herschreven worden; wie ze ook
-- uit de databestanden wil, draait daarna apart `vacuum full public.users;`
-- (kan niet in deze transactie). De dagelijkse back-ups van Supabase houden
-- ze tot hun bewaartermijn verloopt.
-- Uitwijk (herstelt de vorm, niet de waarden), mocht er toch een onbekende
-- lezer opduiken: alter table public.users add column if not exists password text;
--
-- Idempotent: een tweede keer draaien doet niets. Raakt geen RLS, policies of
-- grants, dus geen snapshot-update.

begin;
set local lock_timeout = '5s';

do $$
declare
  nr int2;
begin
  if to_regclass('public.users') is null then
    raise exception 'voorwaarde faalt: public.users bestaat niet';
  end if;
  -- Verkeerd project? Dan stopt het hier, vóór er iets verdwijnt.
  if (
    select count(*) from pg_catalog.pg_attribute
    where attrelid = 'public.users'::regclass and not attisdropped
      and attname in ('id', 'name', 'role', 'email', 'isactive', 'authid')
  ) <> 6 then
    raise exception 'voorwaarde faalt: dit is niet de users-tabel van het portaal';
  end if;
  select attnum into nr from pg_catalog.pg_attribute
  where attrelid = 'public.users'::regclass and attname = 'password' and not attisdropped;
  if nr is null then
    raise notice 'public.users.password bestond al niet (meer), niets te doen';
    return;
  end if;
  -- DROP COLUMN neemt indexen, constraints en statistieken op de kolom stil
  -- mee; een view, policy of trigger laat hem falen. Hangt er iets aan, dan
  -- weigeren we zelf, zodat niets stil meegaat.
  if exists (
    select 1 from pg_catalog.pg_depend
    where refclassid = 'pg_class'::regclass and refobjid = 'public.users'::regclass
      and refobjsubid = nr and classid <> 'pg_attrdef'::regclass
  ) then
    raise exception 'voorwaarde faalt: er hangt nog iets aan public.users.password (zie pg_depend)';
  end if;
  alter table public.users drop column password;
  raise notice 'public.users.password verwijderd';
end
$$;

-- Post-condities: de kolom is weg en de hulpfuncties van de beveiliging
-- bestaan nog.
do $$
begin
  if exists (
    select 1 from pg_catalog.pg_attribute
    where attrelid = 'public.users'::regclass and attname = 'password' and not attisdropped
  ) then
    raise exception 'post-conditie faalt: public.users.password bestaat nog';
  end if;
  if to_regprocedure('public.current_app_user_role()') is null
     or to_regprocedure('public.current_app_user_id()') is null then
    raise exception 'post-conditie faalt: een hulpfunctie van de beveiliging ontbreekt';
  end if;
end
$$;

commit;
