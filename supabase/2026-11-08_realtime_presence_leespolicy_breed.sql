-- 2026-11-08, vervolg op 2026-09-07_realtime_presence_private.sql: de
-- leespolicy van het aanwezigheidskanaal laat naast presence ook broadcast toe.
--
-- PROBLEEM
--   Op staging (nieuwere Realtime-versie) kregen een planner én een admin
--   CHANNEL_ERROR "Unauthorized" bij het joinen van het privé-kanaal
--   `vhb-aanwezigheid`, terwijl de policies van 07-09 er stonden en
--   current_app_user_role() 'planner'/'admin' gaf (gemeten 08-11 met de
--   staging-testlogins). Oorzaak: de join-controle van Realtime toetst het
--   leesrecht op extension 'broadcast'; een policy die alleen
--   extension = 'presence' toelaat laat de join mislukken. Productie draait
--   nog een oudere Realtime en werkt; na een upgrade door Supabase zou de
--   aanwezigheidslijst daar stilvallen.
--
-- OPLOSSING
--   Dezelfde policy, maar met `extension in ('broadcast', 'presence')`. Op
--   staging bewezen (08-11): planner/admin join SUBSCRIBED en track ok,
--   chauffeur blijft Unauthorized. De schrijfpolicy
--   `vhb_aanwezigheid_staf_schrijven` (insert, presence) blijft ongewijzigd:
--   de app zendt geen broadcast op dit onderwerp.
--
-- VEILIGHEID
--   Het onderwerp blijft beperkt tot actieve planners en admins; er komt
--   alleen leesrecht op broadcast-berichten bij die niemand verstuurt.
--
-- NA HET DRAAIEN
--   Policies op realtime.messages zitten in public.security_snapshot():
--   node --env-file=.env.local scripts/beleid-drift.mjs --update en
--   supabase/beleid-snapshot.json committen.
--
-- IDEMPOTENT: drop policy if exists + create policy, in één transactie.
-- Geen tabellen, kolommen of data. RLS op realtime.messages staat al aan
-- (Supabase zelf); geen `alter table` hier (zie 2026-09-07).

begin;

do $$
begin
  if to_regprocedure('public.current_app_user_role()') is null then
    raise exception 'voorwaarde faalt: public.current_app_user_role() ontbreekt (draai eerst 2026-09-05_users_authid.sql)';
  end if;
  if to_regclass('realtime.messages') is null then
    raise exception 'voorwaarde faalt: realtime.messages bestaat niet in dit project';
  end if;
end
$$;

drop policy if exists "vhb_aanwezigheid_staf_lezen" on realtime.messages;
create policy "vhb_aanwezigheid_staf_lezen"
  on realtime.messages for select
  to authenticated
  using (
    realtime.topic() = 'vhb-aanwezigheid'
    and extension in ('broadcast', 'presence')
    and (select public.current_app_user_role()) in ('planner', 'admin')
  );

-- Post-conditie: de leespolicy staat er en noemt broadcast.
do $$
declare n int;
begin
  select count(*) into n from pg_catalog.pg_policies
   where schemaname = 'realtime' and tablename = 'messages'
     and policyname = 'vhb_aanwezigheid_staf_lezen' and cmd = 'SELECT'
     and qual like '%broadcast%';
  if n <> 1 then
    raise exception 'post-conditie faalt: policy vhb_aanwezigheid_staf_lezen ontbreekt of zonder broadcast';
  end if;
end
$$;

insert into public.schema_migraties (bestand) values ('2026-11-08_realtime_presence_leespolicy_breed.sql') on conflict (bestand) do nothing;

commit;

-- Post-conditie (handmatig): als planner toont het portaal de aanwezige
-- collega's; als chauffeur geeft een privé-abonnement op 'vhb-aanwezigheid'
-- een CHANNEL_ERROR.
