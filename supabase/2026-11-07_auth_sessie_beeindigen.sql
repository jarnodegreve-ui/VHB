-- 2026-11-07, beveiligingstest keuze 9 (= keuzelijst 20-10, nr. 1): een
-- toestel uitloggen, blokkeren of schrappen beëindigt ook de Supabase-sessie.
--
-- PROBLEEM
--   "Toestel uitloggen" (Instellingen › Toestellen en sessies), Blokkeren en
--   Schrappen (Beheer › Toestellen) en de intrekking bij uit dienst raakten
--   alleen de toestelrij in public.user_devices. De API weigert die sessie
--   daarna (controle op de session_id-claim sinds 2026-09-09), maar het
--   refresh-token van het toestel bleef werken: via PostgREST en Realtime las
--   dat toestel zijn eigen verlof, ruilen, omleidingen, updates en meldingen
--   gewoon verder, zonder einde.
--
-- OPLOSSING
--   Eén hulpfunctie die één rij uit auth.sessions verwijdert op id. Supabase
--   verwijdert de refresh-tokens van die sessie mee (cascade), dus verversen
--   mislukt en de client meldt zich af. Het toegangstoken zelf loopt nog
--   hoogstens zijn looptijd (standaard 60 minuten) en wordt in de API al
--   geweigerd. Alleen service_role (de API) mag de functie aanroepen; de API
--   roept ze best-effort aan (api/_lib/opslag/toestellen.ts): ontbreekt ze,
--   dan werkt alles zoals vóór deze migratie.
--
-- VOORWAARDE
--   De rol die deze migratie draait moet auth.sessions mogen verwijderen, want
--   de functie draait als haar eigenaar (security definer). In de SQL Editor is
--   dat postgres. Faalt de voorwaarde, dan rolt alles terug en is er niets
--   gewijzigd.
--
-- NA HET DRAAIEN
--   De functie is security definer en komt dus in public.security_snapshot():
--   node --env-file=.env.local scripts/beleid-drift.mjs --update en
--   supabase/beleid-snapshot.json committen, anders is de nachtelijke
--   driftcheck rood. Geen tabellen, kolommen of data gewijzigd.
--
-- IDEMPOTENT: create or replace, revoke en grant zijn herhaalbaar. Eén
-- transactie; plakken en draaien in de Supabase SQL Editor (eerst staging).

begin;

do $$
begin
  if to_regclass('auth.sessions') is null then
    raise exception 'voorwaarde faalt: auth.sessions bestaat niet in dit project';
  end if;
  if not pg_catalog.has_table_privilege(current_user, 'auth.sessions', 'delete') then
    raise exception 'voorwaarde faalt: rol % mag auth.sessions niet verwijderen; de functie zou bij elke aanroep falen', current_user;
  end if;
end
$$;

-- Bewust zonder commentaar binnen de functietekst: de driftcheck vergelijkt
-- pg_get_functiondef letterlijk (zie 2026-09-29_rls_tweede_factor.sql).
create or replace function public.beeindig_auth_sessie(p_session_id uuid)
  returns boolean
  language plpgsql
  security definer
  set search_path = ''
as $function$
declare
  n integer;
begin
  if p_session_id is null then
    return false;
  end if;
  delete from auth.sessions where id = p_session_id;
  get diagnostics n = row_count;
  return n > 0;
end
$function$;

comment on function public.beeindig_auth_sessie(uuid) is
  'Beëindigt één Supabase-sessie (rij in auth.sessions; de refresh-tokens cascaderen). Alleen service_role: de API roept ze aan bij toestel uitloggen, blokkeren, schrappen en uit dienst.';

revoke all on function public.beeindig_auth_sessie(uuid) from public, anon, authenticated;
grant execute on function public.beeindig_auth_sessie(uuid) to service_role;

-- Post-condities, binnen de transactie.
do $$
begin
  if pg_catalog.has_function_privilege('anon', 'public.beeindig_auth_sessie(uuid)', 'execute')
     or pg_catalog.has_function_privilege('authenticated', 'public.beeindig_auth_sessie(uuid)', 'execute') then
    raise exception 'post-conditie faalt: anon of authenticated mag beeindig_auth_sessie() uitvoeren';
  end if;
  if not pg_catalog.has_function_privilege('service_role', 'public.beeindig_auth_sessie(uuid)', 'execute') then
    raise exception 'post-conditie faalt: service_role mag beeindig_auth_sessie() niet uitvoeren, de API zou falen';
  end if;
  -- Een onbekende sessie geeft false en verwijdert niets.
  if public.beeindig_auth_sessie('00000000-0000-0000-0000-000000000000'::uuid) is distinct from false then
    raise exception 'post-conditie faalt: een onbekende sessie moet false geven';
  end if;
end
$$;

insert into public.schema_migraties (bestand) values ('2026-11-07_auth_sessie_beeindigen.sql') on conflict (bestand) do nothing;

commit;
