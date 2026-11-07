-- 2026-11-07, beveiligingstest keuze 2: het live-updates-kanaal van de app
-- wordt een privé Realtime-kanaal, zodat het project daarna publieke kanalen
-- helemaal kan weigeren.
--
-- PROBLEEM
--   Het aanwezigheidskanaal `vhb-aanwezigheid` is sinds 2026-09-07 privé en
--   weigert chauffeurs (CHANNEL_ERROR), maar Realtime laat een publieke join
--   op een kanaal met dezelfde naam gewoon toe. Zolang publieke kanalen aan
--   staan is dat een omweg rond de policy. De echte slot is de instelling
--   "Private channels only" van het project, en die weigert dán ook het
--   publieke kanaal `vhb-realtime` waarop de app de postgres_changes volgt
--   (src/lib/realtime.ts). Dat kanaal moet dus eerst privé kunnen.
--
-- OPLOSSING
--   Een privé join toetst Realtime aan de policies op realtime.messages voor
--   dat onderwerp. Deze leespolicy laat elke actieve portaalgebruiker het
--   onderwerp `vhb-realtime` joinen (geen extension-filter: de join-controle
--   kijkt naar broadcast en presence; de postgres_changes-rijen zelf blijven
--   aan de RLS van hun tabellen onderworpen, zoals nu). Schrijven mag niemand:
--   de app zendt niets op dat kanaal.
--
-- VOLGORDE (het portaal mag onderweg niet breken)
--   1. Deze migratie, eerst staging, dan productie. Zolang de client publiek
--      joint verandert er niets.
--   2. De client met `private: true` (PR beveiliging/realtime-prive). Hij valt
--      één keer terug op een publieke join als de privé-join geweigerd wordt,
--      dus ook een deploy vóór stap 1 breekt de live-updates niet.
--   3. Pas daarna in het Supabase-dashboard: Realtime › Settings › "Private
--      channels only" aan (productie én staging). Vanaf dan is de omweg dicht.
--
-- NA HET DRAAIEN
--   Policies op realtime.messages zitten in public.security_snapshot():
--   node --env-file=.env.local scripts/beleid-drift.mjs --update en
--   supabase/beleid-snapshot.json committen.
--
-- IDEMPOTENT: drop policy if exists + create policy, in één transactie.
-- Geen tabellen, kolommen of data. RLS op realtime.messages staat al aan
-- (Supabase zelf); geen `alter table` hier, de SQL-Editor-rol is geen eigenaar
-- (zie 2026-09-07_realtime_presence_private.sql).

begin;

do $$
begin
  if to_regprocedure('public.is_active_app_user()') is null then
    raise exception 'voorwaarde faalt: public.is_active_app_user() ontbreekt (draai eerst 2026-09-05_users_authid.sql)';
  end if;
  if to_regclass('realtime.messages') is null then
    raise exception 'voorwaarde faalt: realtime.messages bestaat niet in dit project';
  end if;
end
$$;

drop policy if exists "vhb_realtime_lezen" on realtime.messages;
create policy "vhb_realtime_lezen"
  on realtime.messages for select
  to authenticated
  using (
    realtime.topic() = 'vhb-realtime'
    and (select public.is_active_app_user())
  );

-- Post-conditie: de policy staat er en alleen deze twee onderwerpen hebben er een.
do $$
declare n int;
begin
  select count(*) into n from pg_catalog.pg_policies
   where schemaname = 'realtime' and tablename = 'messages' and policyname = 'vhb_realtime_lezen' and cmd = 'SELECT';
  if n <> 1 then
    raise exception 'post-conditie faalt: policy vhb_realtime_lezen ontbreekt';
  end if;
end
$$;

insert into public.schema_migraties (bestand) values ('2026-11-07_realtime_prive_kanaal.sql') on conflict (bestand) do nothing;

commit;

-- Post-conditie (handmatig, na stap 2): als chauffeur geeft een abonnement op
-- 'vhb-realtime' met private: true SUBSCRIBED; na stap 3 geeft een publiek
-- abonnement op 'vhb-aanwezigheid' een CHANNEL_ERROR.
