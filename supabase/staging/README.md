# Staging-omgeving — VHB Portaal

Een tweede, gratis Supabase-project (`vhb-portaal-staging`) met geanonimiseerde
testdata, gekoppeld aan de **Vercel-Preview-omgeving** van het project
`vhb-portaal`. Zo kan een PR-preview met echte accounts en een echt rooster
getest worden zonder dat productiedata (of chauffeurs) erbij betrokken zijn.

Wat hier staat:

| Bestand | Doel |
|---|---|
| `000_tabellen_buiten_repo.sql` | tabellen/kolommen/bucket die productie buiten de repo om kreeg (push_subscriptions, client_errors, coverage_expectations, swaps.return_*, bucket `backups`) |
| `seed.sql` | idempotente testdata: 1 admin, 2 planners, 10 chauffeurs, 25 diensten, 3 weken planning rond vandaag, verlof/ziekte, ruilen, omleidingen, updates, codes, instellingen |
| `../../scripts/staging-accounts.mjs` | maakt de Supabase-Auth-accounts voor de seed-gebruikers en koppelt `users.authid` |

## 1. Supabase-project aanmaken

Supabase → New project → naam `vhb-portaal-staging`, regio zoals productie
(eu-central), Free plan. Noteer uit *Project Settings → API*: Project URL,
anon key, service_role key. Zet in *Authentication → Providers → Email*
"Confirm email" **uit** (de seed-accounts worden zonder mail bevestigd) en
laat het wachtwoordminimum op ≥ 10 (zelfde regel als het portaal).

## 2. Schema: SQL-bestanden in deze volgorde

Alles in de **SQL Editor** van het staging-project plakken en draaien, één
bestand per keer, in exact deze volgorde. Elk bestand is idempotent; loopt
iets fout, dan rolt dat bestand terug en kan je het na de fix opnieuw
draaien. De volgorde is op 06-09-2026 volledig doorlopen op een verse
`supabase/postgres:17`-instantie (alle 54 bestanden + seed 2×).

**Basis (setup en de ongedateerde migraties, in afhankelijkheidsvolgorde)**

1. `supabase/setup_security.sql` — users, planning, diversions, services, updates, swaps, leave, RLS, `set_updated_at()`, `current_app_user_role()`
2. `supabase/add_show_in_contacts.sql`
3. `supabase/add_user_section.sql`
4. `supabase/add_user_start_date.sql`
5. `supabase/users_verlofbudget.sql`
6. `supabase/active_sessions_rpc.sql`
7. `supabase/planning_matrix_schema.sql`
8. `supabase/planning_matrix_history.sql`
9. `supabase/planning_code_mapping.sql`
10. `supabase/transactional_replace.sql` — `replace_planning_matrix_rows` (nodig vóór 11)
11. `supabase/replace_planning_and_matrix.sql` — `replace_planning` + revokes
12. `supabase/activity_log.sql`
13. `supabase/activity_log_entity_columns.sql`
14. `supabase/activity_log_system_category.sql`
15. `supabase/swaps_decided_at.sql`
16. `supabase/swaps_swap_type.sql`
17. `supabase/leave_decided_at.sql`
18. `supabase/diversions_bucket.sql`
19. `supabase/diversions_drop_severity_notnull.sql`
20. `supabase/ritblaadje.sql`
21. `supabase/ritblaadje_private.sql`
22. `supabase/update_reads.sql` — FK naar updates
23. `supabase/user_documents.sql`
24. `supabase/user_devices.sql` — FK naar users
25. `supabase/ocpi_registration.sql`
26. `supabase/ocpi_data.sql`
27. **`supabase/staging/000_tabellen_buiten_repo.sql`** — vóór 28, anders slaat die deze tabellen over
28. `supabase/enable_rls_gaps.sql`

**Gedateerde migraties (chronologisch)**

29. `supabase/2026-07-26_diversions_private.sql`
30. `supabase/2026-07-26_rls_hardening.sql`
31. `supabase/2026-07-26_services_loopnr.sql`
32. `supabase/2026-07-29_wantssystemmail.sql`
33. `supabase/2026-07-30_app_settings.sql`
34. `supabase/2026-07-30_planning_notes.sql`
35. `supabase/2026-07-30_rls_initplan.sql`
36. `supabase/2026-07-30_user_documents_opened.sql`
37. `supabase/2026-07-31_matrix_staff_only.sql`
38. `supabase/2026-08-01_current_app_user_role_definer.sql`
39. `supabase/2026-08-01_swaps_shift_info.sql`
40. `supabase/2026-08-02_anon_rechten_intrekken.sql`
41. `supabase/2026-08-02_drop_subscriptions.sql` (no-op op een verse omgeving)
42. `supabase/2026-08-02_planning_version.sql`
43. `supabase/2026-08-02_realtime_publicatie.sql`
44. `supabase/2026-08-05_ocpi_power_snapshots.sql`
45. `supabase/2026-08-06_ocpi_power_snapshots_revoke.sql`
46. `supabase/2026-08-07_user_expiries.sql`
47. `supabase/2026-08-08_lastlogin_iso.sql`
48. `supabase/2026-08-16_swaps_target_seen.sql`
49. `supabase/2026-08-19_periode_import.sql`
50. `supabase/2026-08-20_import_historiek.sql`
51. `supabase/2026-08-22_drop_dubbele_import_history_policy.sql`
52. `supabase/2026-08-28_rls_inactieve_gebruikers.sql`
53. `supabase/2026-09-05_users_authid.sql` — RLS-helpers op `authid`; de seed en het accounts-script rekenen hierop

**Bewust overgeslagen** (alleen zinvol op het historische productieschema; ze
falen op een verse database):

- `supabase/consolidate_users_columns.sql` — leest camelCase-kolommen die er nooit waren
- `supabase/2026-08-20_drop_users_employeeid_backup.sql` — verwijst naar een backup-tabel die alleen productie had
- `supabase/_seed_services_from_excel.sql` — de échte dienstenlijst; staging krijgt de fictieve set uit `seed.sql`

## 3. Testdata

54. **`supabase/staging/seed.sql`** — één transactie, herhaalbaar. Weigert
    te draaien zodra de database gebruikers bevat die niet uit de seed komen
    (vangrail tegen productie). Alles wat relatief aan "vandaag" ligt
    (Belgische tijd) wordt bij elke run opnieuw opgebouwd, dus draai hem
    gerust opnieuw als het rooster "verouderd" is.

Wat erin zit: gebruikers `stg-admin`, `stg-planner-1/2`, `stg-chauffeur-01…10`
(e-mail `voornaam.achternaam@staging.vhb.test`); 25 diensten met loopnummers
(1–3 delen, nachtdiensten met uren > 24:00); 21 dagen planning (−7 … +13) met
weekends, nacht- en gesplitste diensten; matrixrijen met codes (`bv`, `ziek`,
`opl`, `tk`, `vrij`); 5 verlofaanvragen (pending/approved/rejected/cancelled +
ziekte); 3 ruilen (pending ruil, goedgekeurde overname — al doorgevoerd in de
planning —, afgewezen ruil); 3 omleidingen (lopend, voorbij, aankomend);
4 updates; dekking-config; vervaldata; dienstnotities; activiteitenlog;
`device_gate` **uit** (toestel-whitelist stoort bij gedeelde testaccounts).

## 4. Auth-accounts

```bash
STAGING_SUPABASE_URL=https://<staging-ref>.supabase.co \
STAGING_SERVICE_ROLE_KEY=… \
STAGING_WACHTWOORD='kies-een-testwachtwoord' \
  node scripts/staging-accounts.mjs
```

Maakt per seed-gebruiker een Auth-account (e-mail bevestigd), zet het
wachtwoord op `STAGING_WACHTWOORD` en schrijft `users.authid`. Idempotent.
Het script weigert de productie-ref en raakt alleen adressen op
`@staging.vhb.test`. Daarna inloggen als bv. `jef.claes@staging.vhb.test`
(chauffeur), `els.peeters@staging.vhb.test` (planner) of
`bram.vermeulen@staging.vhb.test` (admin).

## 5. Vercel: Preview-omgeving

Vercel → project `vhb-portaal` → Settings → Environment Variables. Zet de
volgende variabelen met **alleen** het vinkje *Preview* (Production blijft
op het productieproject):

| Variabele | Waarde (staging) |
|---|---|
| `SUPABASE_URL` | Project URL van `vhb-portaal-staging` |
| `SUPABASE_ANON_KEY` | anon key staging |
| `SUPABASE_SERVICE_ROLE_KEY` | service_role key staging |
| `VITE_SUPABASE_URL` | zelfde als `SUPABASE_URL` (build-time, komt in de bundel) |
| `VITE_SUPABASE_ANON_KEY` | zelfde als `SUPABASE_ANON_KEY` |
| `VITE_OMGEVING` | `staging` — toont het stille "Staging"-label in topbar en login |
| `APP_URL` | de preview-URL is per deploy anders; zet hier de vaste branch-alias (bv. `https://vhb-portaal-git-<branch>-<team>.vercel.app`) of laat `https://vhbportaal.com` staan — alleen gebruikt in maillinks, en mail staat op staging uit |
| `CRON_SECRET` | een eigen willekeurige string (Vercel draait crons niet op previews, maar de endpoints eisen hem) |
| `CALENDAR_FEED_SECRET` | eigen willekeurige string (agenda-feed-tokens) |

**Bewust leeg op staging** (de code valt netjes terug):

- `SMTP_*`, `ALERT_EMAIL`, `BACKUP_PASSPHRASE` — geen mail; verlofbeslissingen en digests worden alleen gelogd, de back-upmail slaat over (fail-closed).
- `TELEGRAM_*` — geen bot; meldingen staan standaard al uit.
- `OCPI_*` — geen laadpalen-koppeling; het OCPI-dashboard blijft leeg.
- `VAPID_*` — geen web-push; de meldingen-knop verdwijnt.
- `ANTHROPIC_API_KEY` — de assistent geeft een nette 503.
- `UPSTASH_*`, `RATE_LIMIT_*`, `RETENTION_*`, `ROSTERING_EXPORT_SECRET` — defaults.

Let op: `vercel.json` stuurt een CSP mee met de **productie**-Supabase-host
in `connect-src`/`frame-src`. Op een preview met een ander project blokkeert
de browser de Supabase-calls tot die host erbij staat — voeg de staging-host
toe aan die twee directives (naast de productiehost; dat is onschadelijk).

## 6. Een preview herkennen

- URL eindigt op `.vercel.app` en bevat de branchnaam of een deploy-hash;
  `vhbportaal.com` is altijd productie.
- Het stille **Staging**-label (oker puntje) staat links in de topbar en
  onder het logo op het loginscherm — zie je dat niet, dan zit je op
  productie of is `VITE_OMGEVING` niet gezet voor Preview.
- Alle gebruikers heten zoals in `seed.sql` en mailen op `@staging.vhb.test`.
- `GET /api/health/schema` (ingelogd als admin) hoort "ok" te melden: hij
  vergelijkt het schema met `api/schemaProbes.ts`.

## Onderhoud

- Nieuwe migratie in `supabase/` → ook op staging draaien (onderaan de lijst
  hierboven bijschrijven).
- Rooster verlopen → `seed.sql` opnieuw draaien.
- Wachtwoord vergeten → `staging-accounts.mjs` opnieuw draaien met een nieuw
  `STAGING_WACHTWOORD`.
- Free-plan-projecten pauzeren na een week zonder verkeer; even openen in het
  Supabase-dashboard (Restore) volstaat.
