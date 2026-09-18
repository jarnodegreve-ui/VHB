-- 2026-09-18 — Aanwezigheid: wie was wanneer actief op het portaal.
--
-- Waarom een eigen tabel. Het scherm Activiteit leidde "wie was actief" af
-- uit het auditlogboek (activity_log, categorie 'auth'), en daar stond per
-- persoon hoogstens één regel per dag: de server dedupliceerde het
-- 'Actief'-event op de Brusselse kalenderdag. Je zag dus alleen het éérste
-- moment van iemands dag, nooit het verloop, en wie de PWA dagenlang open
-- liet stuurde na de eerste keer helemaal niets meer. "Wanneer" zat simpelweg
-- niet in de data.
--
-- public.user_presence bewaart aaneengesloten sessies: één rij per periode
-- waarin iemand het portaal in de voorgrond had. De API werkt last_seen_at
-- bij zolang er tekenen van leven zijn (hoogstens één schrijfactie per
-- gebruiker per 5 minuten) en begint een nieuwe rij zodra het langer dan
-- 15 minuten stil was. Eén rij per sessie dus, niet één per hartslag. Reken
-- op grofweg 60 tot 100 rijen per dag: 45 gebruikers, en een gesplitste
-- dienst levert per definitie meer dan 15 minuten stilte tussen de delen op,
-- dus meerdere sessies. Richting 30.000 rijen per jaar, klein, maar genoeg
-- om de retentie hieronder een echte vereiste te maken en geen formaliteit.
--
-- Bewust NIET in activity_log: dat logboek staat al op ±5.500 rijen, wordt
-- door andere schermen integraal ingelezen, en gaat over beheeracties. Wie
-- daar hartslagen bij gooit, maakt precies het portaal traag dat hij wil
-- meten.
--
-- Idempotent: veilig om opnieuw te draaien. De code faalt zonder deze
-- migratie zacht — het registreren is best-effort (een ontbrekende tabel
-- wordt stil genegeerd, geen enkele request breekt erop) en
-- GET /api/activity/presence antwoordt dan met een lege lijst plus de naam
-- van deze migratie. GET /api/health/schema signaleert de missende tabel
-- (api/schemaProbes.ts).

begin;

create table if not exists public.user_presence (
  id uuid primary key default gen_random_uuid(),
  -- users.id is text (zelfde conventie als meldingen.user_id en
  -- push_subscriptions.user_id).
  user_id text not null,
  -- De rol op het moment van de sessie. Wie later van rol wisselt, houdt zijn
  -- oude sessies met de rol van toen; anders herschrijft een promotie stil de
  -- geschiedenis. Kolomnaam 'role', gelijk aan users.role, client_errors.role
  -- en activity_log.actor_role — daar bestaat al een woord voor.
  role text,
  -- Begin en laatste teken van leven van deze aaneengesloten sessie.
  started_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

-- Verwijderde gebruiker = zijn aanwezigheid weg. saveUsersData doet een harde
-- delete op public.users, dus zonder cascade blijft de registratie van wie
-- wanneer werkte eeuwig staan voor mensen die allang uit dienst zijn. Zelfde
-- patroon als user_devices, dat óók een server-only tabel op user_id is.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'user_presence_user_id_fkey') then
    alter table public.user_presence
      add constraint user_presence_user_id_fkey
      foreign key (user_id) references public.users(id) on delete cascade;
  end if;
end
$$;

-- Invariant: een sessie loopt vooruit. Vangt een bug in de sessielogica (bv.
-- de verkeerde rij bijwerken) meteen af, in plaats van stilletjes een sessie
-- met negatieve duur in het overzicht te laten belanden.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'user_presence_periode_check') then
    alter table public.user_presence
      add constraint user_presence_periode_check check (last_seen_at >= started_at);
  end if;
end
$$;

-- Dé schrijf-query: "de jongste sessie van deze gebruiker" (bijwerken of een
-- nieuwe rij beginnen).
create index if not exists user_presence_user_laatst_idx
  on public.user_presence (user_id, last_seen_at desc);

-- Dé lees-query van het aanwezigheidsoverzicht en van de retentie-delete:
-- alles sinds een tijdstip, nieuwste eerst. Niet redundant tegenover de index
-- hierboven: zonder user_id-predicaat is een samengestelde index niet
-- bruikbaar voor deze range scan. Het admin-endpoint moet dus filteren op
-- last_seen_at en niet op started_at, want daar ligt geen index op.
create index if not exists user_presence_laatst_idx
  on public.user_presence (last_seen_at desc);

-- Twee sloten, niet één.
--
-- (1) RLS aan zonder policies = deny by default voor 'authenticated'; de API
--     leest en schrijft met de service-role en slaat RLS over. Voeg hier géén
--     select-policy aan toe "voor Realtime": deze tabel heeft dat niet nodig,
--     en een eigen-rijen-policy zou het admin-only karakter alsnog niet
--     halen.
-- (2) De grants expliciet intrekken. De default ACL van rol postgres in
--     schema public geeft nieuwe tabellen nog altijd 'authenticated=r' mee
--     (2026-08-02_anon_rechten_intrekken.sql haalde alleen anon eruit). Elke
--     tabel die sinds 13-09 is aangemaakt draagt daarom dit drieluik; zonder
--     de revoke zou user_presence als enige met een authenticated:SELECT in
--     beleid-snapshot.json opduiken.
--
-- De eis is hard: een chauffeur mag nooit kunnen uitlezen wanneer zijn
-- collega's op het portaal zaten.
alter table public.user_presence enable row level security;
revoke all on table public.user_presence from anon, authenticated;
grant all on table public.user_presence to service_role;

-- Post-conditie: liever hier stuk dan stil half gedraaid. Dekt élk onderdeel
-- dat hierboven iets afsluit, niet alleen het bestaan van de tabel. Wie dit
-- bestand in stukken in de SQL Editor plakt en per ongeluk een blok overslaat,
-- krijgt hier een fout in plaats van een "geslaagde" migratie met een gat.
do $$
begin
  if to_regclass('public.user_presence') is null then
    raise exception 'post-conditie faalt: public.user_presence ontbreekt';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'user_presence_user_id_fkey') then
    raise exception 'post-conditie faalt: FK user_presence_user_id_fkey ontbreekt';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'user_presence_periode_check') then
    raise exception 'post-conditie faalt: check-constraint user_presence_periode_check ontbreekt';
  end if;
  if not exists (
    select 1 from pg_class where oid = 'public.user_presence'::regclass and relrowsecurity
  ) then
    raise exception 'post-conditie faalt: RLS staat uit op public.user_presence';
  end if;
  -- Het tweede slot: de revoke moet écht gewerkt hebben. Zonder deze check zou
  -- een vergeten revoke pas bij de nachtelijke beleid-drift opvallen.
  if exists (
    select 1 from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'user_presence'
      and grantee in ('anon', 'authenticated')
  ) then
    raise exception 'post-conditie faalt: anon/authenticated hebben nog rechten op public.user_presence';
  end if;
end
$$;

commit;

-- Na het draaien (conventie uit CLAUDE.md, deze migratie raakt RLS én grants):
--   node --env-file=.env.local scripts/beleid-drift.mjs --update
-- en supabase/beleid-snapshot.json mee committen. Ook op staging draaien en
-- onderaan supabase/staging/README.md bijschrijven.
--
-- Retentie: pruneOldRecords in de nachtelijke back-up-cron ruimt sessies ouder
-- dan RETENTION_AANWEZIGHEID_DAYS (standaard 90) op.
