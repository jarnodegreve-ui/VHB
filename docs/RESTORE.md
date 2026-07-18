# Restore-runbook — VHB Portaal

Hoe je een back-up terugzet, en hoe je dat pad periodiek oefent zónder risico.
Alles hieronder bestaat al in het portaal; dit document is de handleiding voor
het moment waarop je het onder stress nodig hebt.

## Waar staan de back-ups?

1. **Nachtelijke cron** (`/api/cron/backup`, zie vercel.json): bewaart
   `vhb-backup-YYYY-MM-DD.json` in de **private Supabase-bucket `backups`**
   en ruimt oude exemplaren op. Te vinden in Supabase → Storage → backups.
2. **Wekelijkse off-site mail** (zondag): dezelfde JSON als bijlage naar
   ALERT_EMAIL (of alle admins). ⚠️ Werkt pas zodra de SMTP-env-vars in
   Vercel staan — zonder SMTP wordt de mail alleen gelogd (mock).
3. **Handmatig, altijd actueel**: portaal → Systeem Status (Debug) →
   back-up downloaden (`GET /api/backup`, admin).

## Wat zit erin (version 2)

- `collections`: users, planning, services, diversions, updates, leave,
  swaps, planningCodes, planningMatrixRows, coverageExpectations, activityLog.
- `authUsers`: referentielijst id + e-mail van de Auth-accounts (wordt NIET
  automatisch teruggezet; nodig om te weten welk e-mailadres bij een
  verwijderde gebruiker hoorde).
- `ocpiRegistration`: Token C + endpoints van de ChargEye-koppeling
  (referentie; na een totaalverlies de handshake opnieuw draaien of deze rij
  handmatig terugzetten in `ocpi_registration`).
- `userDocuments` + `ritblaadje`: metadata van de per-chauffeur-documenten en
  het ritblad (filename, categorie, `storage_path`, wie/wanneer). De bestánden
  zelf staan in de Storage-buckets `user-documents`/`ritblaadjes` (niet in deze
  JSON). Referentie: hiermee weet je na projectverlies wélk document bij wie
  hoorde en kun je de rijen + bucket-inhoud handmatig terugkoppelen.

## Herstellen

1. Log in als **admin** → Systeem Status (Debug) → upload het
   back-up-bestand bij herstel (`POST /api/restore`).
2. Vangrails die automatisch gelden:
   - Weigert een back-up zonder admin-account (je kan jezelf niet buitensluiten).
   - `activityLog` en de import-historiek worden bewust NIET overschreven
     (geschiedenis blijft; de restore wist zijn eigen spoor niet).
   - Lege collectie in de back-up = bewust leegmaken; ontbrekende sleutel =
     onaangeroerd laten.
3. Controleer daarna:
   - `GET /api/health/schema` (Debug-view of curl met CRON_SECRET) → alles ok.
   - Steekproef: Maandplanning, verlofaanvragen, gebruikerslijst.
   - Laadpalen-dashboard: werkt OCPI nog? Zo niet → registratie opnieuw
     uitvoeren via de Debug-view.

## Totaalverlies (Supabase-project weg)

1. Nieuw Supabase-project; draai alle migraties uit `supabase/` in de SQL
   Editor (volgorde: setup_security eerst, daarna de rest; alles is idempotent).
2. Zet de nieuwe URL/keys in Vercel-env-vars; deploy.
3. Maak één admin-account aan (Auth + users-rij) om te kunnen inloggen.
4. Upload de laatste back-up via de Debug-view (stap "Herstellen" hierboven).
5. Auth-accounts van de rest: opnieuw aanmaken; e-mailadressen staan in
   `authUsers` in de back-up. OCPI: handshake opnieuw (Token A uit ChargEye).

## De oefening (halfjaarlijks, ~5 min, zonder risico)

Een restore van de huidige staat is een no-op — daarmee test je het volledige
pad zonder iets te veranderen:

1. Debug-view → download de back-up van nu.
2. Open de JSON en controleer: recente `exportedAt`, aannemelijke aantallen
   per collectie, `authUsers` gevuld.
3. Upload datzelfde bestand meteen weer via herstel → verwacht een
   succes-samenvatting met dezelfde aantallen.
4. Controleer `GET /api/health/schema` + één view. Klaar — noteer de datum.

Laatste oefening: _nog niet uitgevoerd_ (vul aan na de eerste keer).
