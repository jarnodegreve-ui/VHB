-- 2026-10-05 — Register van gedraaide migraties (audit-opvolging, punt 1).
--
-- Migraties draaien met de hand in de SQL Editor, op productie en op staging.
-- Tot nu toe stond nergens welke er waar gedraaid waren: een vergeten
-- migratie viel pas op wanneer een scherm brak (28-09, Omleidingen). Deze
-- tabel houdt het bij: één rij per bestand, met het moment van draaien.
--
-- Afspraak vanaf nu: ELKE nieuwe migratie schrijft zichzelf in, als laatste
-- statement vóór de commit:
--
--   insert into public.schema_migraties (bestand)
--   values ('<bestandsnaam zoals in supabase/volgorde.json, zonder supabase/>')
--   on conflict (bestand) do nothing;
--
-- De CI-job `database` bouwt een lege database op uit supabase/volgorde.json
-- en faalt wanneer een bestand uit die lijst hier daarna niet in staat.
-- GET /api/health/schema (Systeemstatus) meldt per omgeving welke bestanden
-- ontbreken.
--
-- Basislijn: de 76 bestanden hieronder gelden als gedraaid. Dat is op
-- 05-10 nagekeken tegen een lege database die uit deze lijst is opgebouwd:
-- kolommen gelijk aan staging en aan productie (op `client_errors.id` na: daar
-- bigint, hier uuid), RLS, policies en grants gelijk aan het productiesnapshot
-- (supabase/beleid-snapshot.json), functies gelijk op commentaar na. Eén
-- uitzondering, verderop apart behandeld: active_sessions_rpc.sql. Hun
-- `gedraaid_op` is dus het moment van deze basislijn, niet van toen.
--
-- Server-only tabel: RLS aan, geen policies, grants voor anon/authenticated
-- ingetrokken (zelfde patroon als mail_log). Raakt dus RLS en grants: na het
-- draaien op productie `node --env-file=.env.local scripts/beleid-drift.mjs
-- --update` en supabase/beleid-snapshot.json mee committen.
--
-- Idempotent: veilig om opnieuw te draaien.

begin;

create table if not exists public.schema_migraties (
  bestand text primary key,
  gedraaid_op timestamptz not null default now()
);

comment on table public.schema_migraties is
  'Register van gedraaide migraties: elk bestand uit supabase/volgorde.json schrijft zichzelf hier in.';

alter table public.schema_migraties enable row level security;
revoke all on table public.schema_migraties from anon, authenticated;
grant all on table public.schema_migraties to service_role;

-- Basislijn (zie kop).
insert into public.schema_migraties (bestand) values
  ('setup_security.sql'),
  ('add_show_in_contacts.sql'),
  ('add_user_section.sql'),
  ('add_user_start_date.sql'),
  ('users_verlofbudget.sql'),
  ('planning_matrix_schema.sql'),
  ('planning_matrix_history.sql'),
  ('planning_code_mapping.sql'),
  ('transactional_replace.sql'),
  ('replace_planning_and_matrix.sql'),
  ('activity_log.sql'),
  ('activity_log_entity_columns.sql'),
  ('activity_log_system_category.sql'),
  ('swaps_decided_at.sql'),
  ('swaps_swap_type.sql'),
  ('leave_decided_at.sql'),
  ('diversions_bucket.sql'),
  ('diversions_drop_severity_notnull.sql'),
  ('ritblaadje.sql'),
  ('ritblaadje_private.sql'),
  ('update_reads.sql'),
  ('user_documents.sql'),
  ('user_devices.sql'),
  ('ocpi_registration.sql'),
  ('ocpi_data.sql'),
  ('staging/000_tabellen_buiten_repo.sql'),
  ('enable_rls_gaps.sql'),
  ('2026-07-26_diversions_private.sql'),
  ('2026-07-26_rls_hardening.sql'),
  ('2026-07-26_services_loopnr.sql'),
  ('2026-07-29_wantssystemmail.sql'),
  ('2026-07-30_app_settings.sql'),
  ('2026-07-30_planning_notes.sql'),
  ('2026-07-30_rls_initplan.sql'),
  ('2026-07-30_user_documents_opened.sql'),
  ('2026-07-31_matrix_staff_only.sql'),
  ('2026-08-01_current_app_user_role_definer.sql'),
  ('2026-08-01_swaps_shift_info.sql'),
  ('2026-08-02_anon_rechten_intrekken.sql'),
  ('2026-08-02_drop_subscriptions.sql'),
  ('2026-08-02_planning_version.sql'),
  ('2026-08-02_realtime_publicatie.sql'),
  ('2026-08-05_ocpi_power_snapshots.sql'),
  ('2026-08-06_ocpi_power_snapshots_revoke.sql'),
  ('2026-08-07_user_expiries.sql'),
  ('2026-08-08_lastlogin_iso.sql'),
  ('2026-08-16_swaps_target_seen.sql'),
  ('2026-08-19_periode_import.sql'),
  ('2026-08-20_import_historiek.sql'),
  ('2026-08-22_drop_dubbele_import_history_policy.sql'),
  ('2026-08-28_rls_inactieve_gebruikers.sql'),
  ('2026-09-05_users_authid.sql'),
  ('2026-09-06_client_errors_groepen.sql'),
  ('2026-09-06_meldingen.sql'),
  ('2026-09-07_planning_rls_eigen_chauffeur.sql'),
  ('2026-09-07_realtime_presence_private.sql'),
  ('2026-09-08_security_snapshot.sql'),
  ('2026-09-08_ocpi_dagpieken.sql'),
  ('2026-09-09_rol_technieker.sql'),
  ('2026-09-10_diversions_location.sql'),
  ('2026-09-13_techniek_voertuigen.sql'),
  ('2026-09-13_loon_dagafsluiting.sql'),
  ('2026-09-13_service_segments.sql'),
  ('2026-09-13_vehicles_categorie.sql'),
  ('2026-09-16_rls_loops_voertuigen_oud.sql'),
  ('2026-09-18_user_presence.sql'),
  ('2026-09-20_swaps_beslismoment_herstel.sql'),
  ('2026-09-09_user_devices_sessie.sql'),
  ('2026-09-20_user_presence_locatie.sql'),
  ('2026-09-21_updates_bijlagen.sql'),
  ('2026-09-22_leave_beslisreden.sql'),
  ('2026-09-25_diversions_bijlagen.sql'),
  ('2026-09-25_mail_log.sql'),
  ('2026-09-28_users_ook_technieker.sql'),
  ('2026-09-29_rls_tweede_factor.sql'),
  ('2026-09-29_users_password_weg.sql')
on conflict (bestand) do nothing;

-- active_sessions_rpc.sql telt alleen als gedraaid waar de functie bestaat: op
-- productie ontbrak `bump_active_sessions` op 05-10 (de code valt daar terug
-- op een niet-atomaire teller), op staging stond ze er. Dat bestand schrijft
-- zichzelf sindsdien ook in, dus opnieuw draaien volstaat.
insert into public.schema_migraties (bestand)
select 'active_sessions_rpc.sql'
where exists (
  select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'bump_active_sessions'
)
on conflict (bestand) do nothing;

-- Post-condities.
do $$
begin
  if not exists (
    select 1 from pg_tables where schemaname = 'public' and tablename = 'schema_migraties' and rowsecurity
  ) then
    raise exception 'post-conditie faalt: public.schema_migraties bestaat niet of heeft RLS uit';
  end if;
  if exists (
    select 1 from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'schema_migraties' and grantee in ('anon', 'authenticated')
  ) then
    raise exception 'post-conditie faalt: anon/authenticated hebben nog rechten op public.schema_migraties';
  end if;
  if (select count(*) from public.schema_migraties) < 76 then
    raise exception 'post-conditie faalt: de basislijn is onvolledig';
  end if;
end
$$;

insert into public.schema_migraties (bestand)
values ('2026-10-05_schema_migraties.sql')
on conflict (bestand) do nothing;

commit;

-- Ook op staging draaien (de beleidssnapshot is alleen van productie) en
-- bijschrijven in supabase/staging/README.md.
