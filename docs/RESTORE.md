# Restore-runbook VHB Portaal

## Versleutelde mail-bijlage ontsleutelen (sinds 30-07-2026)

De wekelijkse off-site mail bevat een `.json.enc`-bijlage (AES-256). Ontsleutelen op een Mac:

```bash
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000   -in vhb-backup-JJJJ-MM-DD.json.enc -out vhb-backup-JJJJ-MM-DD.json
```

OpenSSL vraagt om de wachtwoordzin: die staat in Jarno's wachtwoordmanager
(en als `BACKUP_PASSPHRASE` in Vercel). Zonder die zin is de bijlage
onbruikbaar, dat is precies de bedoeling. Daarna verdergaan met de gewone
restore-stappen hieronder.

Hoe je een back-up terugzet, en hoe dat pad geoefend wordt zonder risico.
Alles hieronder bestaat al in het portaal; dit document is de handleiding voor
het moment waarop je het onder stress nodig hebt.

## Waar staan de back-ups?

1. **Nachtelijke cron** (`/api/cron/backup`, 02:00 UTC, zie vercel.json):
   bewaart `vhb-backup-YYYY-MM-DD.json` in de **private Supabase-bucket
   `backups`** en ruimt oude exemplaren op. Te vinden in Supabase → Storage →
   backups.
2. **Wekelijkse off-site mail** (zondag, dezelfde cron): dezelfde JSON,
   versleuteld als `.json.enc`-bijlage, naar `ALERT_EMAIL` (of alle actieve
   admins). Vereist `BACKUP_PASSPHRASE` (zonder die zin wordt er bewust NIET
   gemaild) en de SMTP-gegevens in Vercel (zonder SMTP wordt de mail alleen
   gelogd).
3. **Handmatig, altijd actueel**: Beheer › Systeemstatus → back-up downloaden
   (`GET /api/backup`, admin).

## Wat zit erin (version 2)

- `collections`: users, planning, services (alle versies van het
  dienstoverzicht, elke rij met haar versie), dienstregelingen (de versies met
  hun geldig-vanaf-datum), diversions, updates, leave, swaps, planningCodes,
  planningMatrixRows, coverageExpectations, activityLog.
- `authUsers`: referentielijst id + e-mail van de Auth-accounts (wordt NIET
  automatisch teruggezet; nodig om te weten welk e-mailadres bij een
  verwijderde gebruiker hoorde).
- `ocpiRegistration`: Token C + endpoints van de ChargEye-koppeling
  (referentie; na een totaalverlies de handshake opnieuw draaien of deze rij
  handmatig terugzetten in `ocpi_registration`).
- `userDocuments`, `ritblaadje` en `ritbladen`: metadata van de
  per-chauffeur-documenten en van de ritbladbundels (`ritblaadje` is de oude
  rij `current`, `ritbladen` alle bundels, sinds 13-10 één per
  dienstregelingversie): filename, categorie, `storage_path`, wie/wanneer. De
  bestánden zelf staan in de Storage-buckets `user-documents` en `ritblaadjes`
  (niet in deze JSON). Referentie: hiermee weet je na projectverlies wélk
  document bij wie hoorde en kun je de rijen + bucket-inhoud handmatig
  terugkoppelen.

## Herstellen

1. Log in als **admin** → Beheer › Systeemstatus → kies het back-upbestand bij
   herstel. Het scherm stuurt alleen de herstelbare collecties mee (het
   activiteitenlog niet) en vraagt eerst een droge run
   (`POST /api/restore?droog=1`): het herstelplan toont per collectie wat
   terugkomt, wat verdwijnt en wat overschreven wordt, plus blokkades en
   waarschuwingen. Pas na de bevestiging volgt het echte herstel
   (`POST /api/restore`), dat hetzelfde plan opnieuw rekent.
2. Vangrails die automatisch gelden:
   - Weigert een back-up zonder admin-account (je kan jezelf niet buitensluiten).
   - Een blokkade in het plan (dubbele of ontbrekende id's, een collectie in de
     verkeerde vorm) houdt het echte herstel tegen (400).
   - `activityLog` en de import-historiek worden bewust NIET overschreven
     (geschiedenis blijft; de restore wist zijn eigen spoor niet).
   - Lege collectie in de back-up = bewust leegmaken; ontbrekende sleutel =
     onaangeroerd laten. Uitzondering: een lege planningsmatrix wordt niet
     teruggezet (de save weigert een lege set).
   - Het herstel is niet transactioneel. Strandt het halverwege, dan noemt het
     antwoord in `appliedSoFar` wat al teruggezet is en komt er een logregel
     "Back-up gedeeltelijk hersteld".
3. Controleer daarna:
   - De schema-controle in Systeemstatus (`GET /api/health/schema`: kolommen en
     RPC's waar de code op rekent, plus migraties die deze omgeving nog niet
     kent; ook op te vragen met curl en `Authorization: Bearer <CRON_SECRET>`)
     → alles ok.
   - Steekproef: Maandplanning, verlofaanvragen, gebruikerslijst.
   - Laadpalen-dashboard: werkt OCPI nog? Zo niet → registratie opnieuw
     uitvoeren via Systeemstatus › OCPI-koppeling.

## Totaalverlies (Supabase-project weg)

1. Nieuw Supabase-project; draai de migraties in de SQL Editor in de volgorde
   van `supabase/volgorde.json` (dezelfde lijst waarmee de CI-job `database`
   een lege database opbouwt; de drie bestanden onder `overgeslagen` niet).
   Toelichting per bestand: `supabase/staging/README.md`.
2. **Controleer het schema vóór je data terugzet**: de schema-controle in
   Systeemstatus of `GET /api/health/schema` met curl (Bearer `CRON_SECRET`).
   Die vergelijkt tegen `api/schemaProbes.ts` en meldt elke ontbrekende kolom.
   Doe je dit niet, dan merk je een gat pas als een save faalt met `42703`, en
   dan zit je al met halve data. `setup_security.sql` is de basis, niet het
   volledige schema: de losse migratiebestanden vullen hem aan.
3. Zet de nieuwe URL/keys in Vercel-env-vars; deploy.
4. Maak één admin-account aan (Auth + users-rij) om te kunnen inloggen.
5. Upload de laatste back-up via Systeemstatus (stap "Herstellen" hierboven).
6. Auth-accounts van de rest: opnieuw aanmaken; e-mailadressen staan in
   `authUsers` in de back-up. OCPI: handshake opnieuw (Token A uit ChargEye).
7. Realtime: `supabase_realtime`-publicatie bevat in een vers project geen
   tabellen. `2026-08-02_realtime_publicatie.sql` zit in de volgorde; werkt de
   auto-verversing nergens, controleer dan of dat bestand gedraaid is.

## De oefening

**Automatisch, elke maand**: de cron `/api/cron/restore-proef` (vercel.json:
de 1e van de maand, 04:23 UTC) leest de laatste back-up uit de bucket terug,
parseert hem, draait dezelfde integriteitscheck als bij het maken, controleert
dat een back-up met 0 gebruikers niet naast een gevulde live tabel staat, en
doet de droge herstelrun tegen de live stand. Alleen blokkades alarmeren: dan
gaat de mail "restore-proef" naar de systeemmail-ontvangers en staat de
cron-hartslag op GEFAALD; anders meldt de hartslag hoeveel records over hoeveel
collecties herstelbaar zijn. Die hartslag staat niet in de cron-lijst van
Systeemstatus (die toont backup, error-digest, ocpi-sync en
rooster-meldingen); de mail is het signaal.

**Handmatig, het echte pad** (±5 min, zonder risico): een restore van de
huidige staat is een no-op, en daarmee test je ook het schrijfpad:

1. Systeemstatus → download de back-up van nu.
2. Open de JSON en controleer: recente `exportedAt`, aannemelijke aantallen
   per collectie, `authUsers` gevuld.
3. Kies datzelfde bestand meteen weer bij herstel → het plan toont overal
   "blijft" en geen blokkades; na de bevestiging een succes-samenvatting met
   dezelfde aantallen.
4. Controleer de schema-controle + één view. Klaar, noteer de datum.

Laatste handmatige oefening: niet genoteerd in dit document (vul de datum aan
na de volgende keer).

## Break-glass: wachtwoord resetten als het portaal plat ligt

Normaal reset je een wachtwoord in **Gebruikersbeheer** ("Wachtwoord
resetten"). Ligt het portaal zelf plat, dan kan het rechtstreeks tegen
Supabase met `scripts/reset-password.mjs`:

```
SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… TARGET_EMAIL=iemand@vhb.be \
  NEW_PASSWORD=… node scripts/reset-password.mjs
```

De service-role-key staat in Vercel (Production-env). Gebruik een `.env` of een
subshell, nooit echte secrets in je shell-history.
