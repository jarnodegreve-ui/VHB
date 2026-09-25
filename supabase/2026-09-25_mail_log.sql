-- 2026-09-25 — Verzendlog van de portaalmails (mailtranche PR 2).
--
-- Elke mail die het portaal verstuurt (verlofbeslissing, welkom, dringende
-- update, ziekmelding, digest, back-up, …) laat één regel achter: wat voor
-- mail, wanneer, naar hoeveel ontvangers, gelukt of niet, en door wie
-- (gebruiker of Systeem). BEWUST GEEN INHOUD en geen adressen: het log is een
-- bewijs dat er verstuurd is, geen kopie van de mailbox (Beheer › Mails,
-- PR 3, toont per mailsoort "laatst verstuurd naar hoeveel").
--
-- Server-only tabel (service role via de API): RLS aan, geen policies, en de
-- grants voor anon/authenticated expliciet ingetrokken, zelfde patroon als
-- user_presence (2026-09-18). Raakt dus RLS en grants: na het draaien
-- `node --env-file=.env.local scripts/beleid-drift.mjs --update` en
-- supabase/beleid-snapshot.json mee committen (CLAUDE.md › Beleidsdrift).
--
-- Idempotent: veilig om opnieuw te draaien. Zonder deze migratie werkt het
-- mailen gewoon door; alleen het log blijft leeg (sendEmail slikt de
-- ontbrekende tabel stil).

begin;

create table if not exists public.mail_log (
  id uuid primary key default gen_random_uuid(),
  verzonden_op timestamptz not null default now(),
  -- Sleutel van de mailsoort zoals de code ze kent (bv. 'verlof-beslissing',
  -- 'dringende-update', 'welkom'); geen vrije tekst.
  soort text not null,
  -- Aantal ontvangers waar de mail naartoe ging (bij BCC-bulk: de hele lijst).
  aantal integer not null default 0,
  gelukt boolean not null default true,
  -- Serverfout bij een mislukte verzending (alleen voor admins zichtbaar).
  fout text,
  -- Wie de mail veroorzaakte: naam van de gebruiker, of 'Systeem'.
  door text
);

comment on table public.mail_log is
  'Verzendlog van de portaalmails: soort, moment, aantal, gelukt/mislukt, door wie. Bewust zonder inhoud of adressen.';

create index if not exists mail_log_verzonden_op_idx on public.mail_log (verzonden_op desc);
create index if not exists mail_log_soort_idx on public.mail_log (soort, verzonden_op desc);

alter table public.mail_log enable row level security;
revoke all on table public.mail_log from anon, authenticated;
grant all on table public.mail_log to service_role;

-- Post-condities: de tabel bestaat met RLS aan, en er is écht geen toegang
-- voor anon/authenticated (anders was dit log voor elke ingelogde leesbaar).
do $$
begin
  if not exists (
    select 1 from pg_tables where schemaname = 'public' and tablename = 'mail_log' and rowsecurity
  ) then
    raise exception 'post-conditie faalt: public.mail_log bestaat niet of heeft RLS uit';
  end if;
  if exists (
    select 1 from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'mail_log' and grantee in ('anon', 'authenticated')
  ) then
    raise exception 'post-conditie faalt: anon/authenticated hebben nog rechten op public.mail_log';
  end if;
end
$$;

commit;
