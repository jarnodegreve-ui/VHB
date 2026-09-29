# Controle 29-09-2026, nummer 35: terugvallen op een ontbrekende kolom of tabel

Inventaris van alle aanroepen van `isMissingColumnError` en `isMissingTableError` in `api/`, op de stand van `origin/main` 3926fee. Regelnummers verwijzen naar die commit.

## Telling

De audit sprak van 68 aanroepen over 17 bestanden. Dat getal is het aantal regels waarop een van de twee namen voorkomt. Uitgesplitst:

| Wat | Aantal |
|---|---|
| Echte aanroepen (een terugval) | 47 |
| Importregels | 16 |
| Definities (`api/deviceGate.ts:29`, `api/deviceGate.ts:46`, `api/storage.ts:2178`) | 3 |
| Vermeldingen in commentaar (`api/deviceGate.ts:43`, `api/storage.ts:2740`) | 2 |
| **Totaal regels** | **68** |

De 47 aanroepen staan in 16 bestanden; het zeventiende bestand is `api/deviceGate.ts`, dat alleen de definities draagt.

## Drie soorten

- **Luid**: de route antwoordt met een duidelijke melding die de migratie noemt (een 503 met het .sql-bestand, of een veld `migratie` dat het scherm toont). Blijft altijd staan.
- **Stil, schrijven**: de schrijfactie gaat opnieuw zonder de kolom en de save lijkt gelukt. Een veld wordt ongemerkt niet bewaard. Alleen deze soort komt in aanmerking voor verwijdering.
- **Stil, vangnet**: bij het lezen of bij bijzaak (log, toestelpoort) valt de code terug op een lege lijst, de standaardwaarde of "doorlaten". Er gaat geen ingevuld veld verloren. Dit is niet de soort die Jarno bedoelde; verwijderen zou bestaand gedrag veranderen (bijvoorbeeld een kalender die een fout toont in plaats van de standaardlimiet). Blijft staan.

| Soort | Aantal |
|---|---|
| Luid | 21 |
| Stil, schrijven | 6 |
| Stil, vangnet | 20 |
| **Totaal** | **47** |

## Wat als bewijs telt

1. De kolom of tabel staat in `api/schemaProbes.ts` op commit `bc65372` (#655, 28-09). Op die dag is op productie en staging nagegaan dat alle 299 kolommen uit dat bestand bestaan.
2. `users.ooktechnieker` (`supabase/2026-09-28_users_ook_technieker.sql`), op 28-09 gedraaid op staging en productie met groene post-condities.

Alles daarbuiten is niet bewezen, ook als de migratie oud is. De tabellen `user_devices`, `client_errors` en `client_error_status` staan niet in de schemaProbes en zijn dus niet bewezen.

## Inventaris

### Stil, schrijven (6)

| Nr | Bestand en regel | Kolom | Migratie | Wat de gebruiker merkt | Welk veld gaat verloren | Bewijs | Voorstel |
|---|---|---|---|---|---|---|---|
| S1 | `api/storage.ts:1477` | `users.ooktechnieker` | `2026-09-28_users_ook_technieker.sql` | Niets, zolang niemand de schakelaar aan heeft: de save gaat opnieuw zonder de kolom. Met de schakelaar aan al een 503 met het .sql-bestand. | De schakelaar "Ook technieker" (alleen de waarde uit) | 2 | **Verwijderd** (8479680, 6f1cfd9): elke ontbrekende kolom `ooktechnieker` geeft de bestaande 503 |
| S2 | `api/storage.ts:1787` (met `zonderLocation`, regel 1762) | `diversions.location` | `2026-09-10_diversions_location.sql` | Niets: de omleiding wordt bewaard, de plaats niet | Plaats van de omleiding | 1 | **Verwijderd** (ba77bf6): 503 met het .sql-bestand |
| S3 | `api/storage.ts:2217` | `client_errors`: `fingerprint`, `release`, `view`, `role`, `online`, `breadcrumbs`, `top_frame` | `2026-09-06_client_errors_groepen.sql` | Niets: het foutrapport komt binnen zonder context. De stand wordt per warme instantie onthouden zonder houdbaarheid, hetzelfde patroon dat bij de plaats van de omleidingen misliep. | Context van het foutrapport (release, scherm, rol, broodkruimels, vingerafdruk) | geen | Laten staan |
| S4 | `api/storage.ts:2798` | `user_devices.session_id` (update) | `2026-09-09_user_devices_sessie.sql` | Niets; er komt wel een regel in het serverlog | Sessiebinding van het toestel | geen | Laten staan |
| S5 | `api/storage.ts:2823` | `user_devices.session_id` (insert) | `2026-09-09_user_devices_sessie.sql` | Niets; er komt wel een regel in het serverlog | Sessiebinding van het toestel | geen | Laten staan |
| S6 | `api/storage.ts:3696` | `user_presence.land`, `regio`, `stad` | `2026-09-20_user_presence_locatie.sql` | Niets bij het schrijven. Het scherm Activiteit meldt bij het lezen wel welke migratie nog moet (`locatieMigratie`). | Plaats van aanmelden | 1 | Laten staan, zie "Stil met bewijs, niet verwijderd" |

### Stil, vangnet (20)

| Nr | Bestand en regel | Tabel of kolom | Migratie | Wat de gebruiker merkt | Bewijs | Voorstel |
|---|---|---|---|---|---|---|
| V1 | `api/middleware.ts:320` | `user_devices` | `user_devices.sql` | Niets: de sessiecontrole laat door, alleen de logregel valt weg | geen | Laten staan |
| V2 | `api/middleware.ts:342` | `user_devices` | `user_devices.sql` | Niets: de toestelpoort wordt overgeslagen (regel in het serverlog) | geen | Laten staan |
| V3 | `api/deviceRoutes.ts:95` | `user_devices` | `user_devices.sql` | Instellingen toont "niet beschikbaar" in plaats van de toestellen | geen | Laten staan |
| V4 | `api/deviceRoutes.ts:128` | `user_devices` | `user_devices.sql` | "0 toestellen uitgelogd" | geen | Laten staan |
| V5 | `api/deviceRoutes.ts:156` | `user_devices` | `user_devices.sql` | 404 "Toestel niet gevonden." | geen | Laten staan |
| V6 | `api/storage.ts:2873` | `user_devices.session_id` | `2026-09-09_user_devices_sessie.sql` | Niets: de lijst van ingetrokken sessies is leeg (regel in het serverlog) | geen | Laten staan |
| V7 | `api/storage.ts:3446` | `mail_log` | `2026-09-25_mail_log.sql` | Niets: de logregel van de mail wordt niet geschreven en de waarschuwing blijft weg | 1 | Laten staan (bijzaak, geen veld van de gebruiker) |
| V8 | `api/storage.ts:3448` | `mail_log` | `2026-09-25_mail_log.sql` | Zelfde als V7, in de catch | 1 | Laten staan |
| V9 | `api/storage.ts:3477` | `mail_log` | `2026-09-25_mail_log.sql` | Beheer › Mails toont een leeg verzendlog | 1 | Laten staan |
| V10 | `api/_lib/accountRoutes.ts:92` | `user_devices` | `user_devices.sql` | Niets: `/api/me` geeft toestelstatus "onbekend" | geen | Laten staan |
| V11 | `api/_lib/accountRoutes.ts:145` | `user_devices` | `user_devices.sql` | Niets: het toestel telt als goedgekeurd | geen | Laten staan |
| V12 | `api/_lib/cronRoutes.ts:139` | `user_presence` | `2026-09-18_user_presence.sql` | Weekoverzicht telt 0 actieve gebruikers | 1 | Laten staan |
| V13 | `api/_lib/cronRoutes.ts:594` | `vehicle_expiries` | `2026-09-13_techniek_voertuigen.sql` | De sectie voertuigen ontbreekt in het dagoverzicht | 1 | Laten staan |
| V14 | `api/_lib/planningRoutes.ts:514` | `planning_notes` | `2026-07-30_planning_notes.sql` | Geen dienstnotities te zien | 1 | Laten staan |
| V15 | `api/_lib/verlofRoutes.ts:335` | `app_settings` | `2026-07-30_app_settings.sql` | De kalender rekent met de standaardlimiet | 1 | Laten staan |
| V16 | `api/_lib/verlofRoutes.ts:371` | `app_settings` | `2026-07-30_app_settings.sql` | Geen extra vrije dagen in de verloftelling | 1 | Laten staan |
| V17 | `api/_lib/verlofRoutes.ts:455` | `app_settings` | `2026-07-30_app_settings.sql` | Verlofbezetting rekent met de standaardlimiet | 1 | Laten staan |
| V18 | `api/_lib/rapporten/ladersZiekteVerlof.ts:22` | `app_settings` | `2026-07-30_app_settings.sql` | Rapport telt zonder extra vrije dagen | 1 | Laten staan |
| V19 | `api/_lib/rapporten/ladersZiekteVerlof.ts:32` | `app_settings` | `2026-07-30_app_settings.sql` | Rapport rekent met de standaardlimiet | 1 | Laten staan |
| V20 | `api/_lib/recordWrites.ts:106` | `user_devices` | `user_devices.sql` | Niets: bij het deactiveren valt er geen toestel in te trekken | geen | Laten staan |

Bij V15 tot en met V19 vangt de code elke fout op, niet alleen een ontbrekende tabel; de aanroep bepaalt alleen of er een regel in het serverlog komt.

### Luid (21), blijven allemaal staan

| Nr | Bestand en regel | Tabel of kolom | Migratie | Wat de gebruiker merkt |
|---|---|---|---|---|
| L1 | `api/deviceRoutes.ts:301` | `app_settings` | `2026-07-30_app_settings.sql` | 503 met het .sql-bestand |
| L2 | `api/_lib/onderhoudRoutes.ts:53` | `app_settings` | `2026-07-30_app_settings.sql` | 503 met het .sql-bestand |
| L3 | `api/_lib/techniekRoutes.ts:41` | techniek-tabellen | `2026-09-13_techniek_voertuigen.sql` | 503 met het .sql-bestand (alle techniekroutes) |
| L4 | `api/_lib/dienstRoutes.ts:34` | dienstopbouw-tabellen | `2026-09-13_service_segments.sql` | 503 met het .sql-bestand (alle dienstopbouwroutes) |
| L5 | `api/_lib/loonRoutes.ts:33` | loon-tabellen | `2026-09-13_loon_dagafsluiting.sql` | 503 met het .sql-bestand (alle loonroutes) |
| L6 | `api/_lib/accountRoutes.ts:382` | `meldingen` | `2026-09-06_meldingen.sql` | Lege lijst met het veld `migratie` |
| L7 | `api/_lib/accountRoutes.ts:398` | `meldingen` | `2026-09-06_meldingen.sql` | 503 met het .sql-bestand |
| L8 | `api/_lib/accountRoutes.ts:414` | `meldingen` | `2026-09-06_meldingen.sql` | 503 met het .sql-bestand |
| L9 | `api/_lib/accountRoutes.ts:442` | `users.dashboardvoorkeuren` | `2026-09-06_meldingen.sql` | 503 met het .sql-bestand |
| L10 | `api/_lib/planningRoutes.ts:548` | `planning_notes` | `2026-07-30_planning_notes.sql` | 503 met het .sql-bestand |
| L11 | `api/_lib/verlofRoutes.ts:279` | `leave.beslisreden` | `2026-09-22_leave_beslisreden.sql` | 503 "weiger voorlopig zonder reden", niets bewaard |
| L12 | `api/_lib/verlofRoutes.ts:355` | `app_settings` | `2026-07-30_app_settings.sql` | 503 met het .sql-bestand |
| L13 | `api/_lib/verlofRoutes.ts:392` | `app_settings` | `2026-07-30_app_settings.sql` | 503 met het .sql-bestand |
| L14 | `api/_lib/systeemRoutes.ts:233` | `user_presence` | `2026-09-18_user_presence.sql` | Scherm Activiteit toont welke migratie nog moet |
| L15 | `api/_lib/systeemRoutes.ts:402` | `client_error_status` | `2026-09-06_client_errors_groepen.sql` | 503 met het .sql-bestand |
| L16 | `api/_lib/communicatieRoutes.ts:321` | `diversions.bijlagen` | `2026-09-25_diversions_bijlagen.sql` | 503 met het .sql-bestand |
| L17 | `api/_lib/communicatieRoutes.ts:349` | `diversions.bijlagen` | `2026-09-25_diversions_bijlagen.sql` | 503 met het .sql-bestand |
| L18 | `api/_lib/communicatieRoutes.ts:556` | `updates.bijlagen`, `bijlagen_tonen` | `2026-09-21_updates_bijlagen.sql` | 503 met het .sql-bestand |
| L19 | `api/_lib/communicatieRoutes.ts:583` | `updates.bijlagen`, `bijlagen_tonen` | `2026-09-21_updates_bijlagen.sql` | 503 met het .sql-bestand |
| L20 | `api/_lib/mailRoutes.ts:178` | `app_settings` | `2026-07-30_app_settings.sql` | 503 met het .sql-bestand |
| L21 | `api/_lib/mailRoutes.ts:200` | `app_settings` | `2026-07-30_app_settings.sql` | 503 met het .sql-bestand |

## Uitkomst van de ronde

Twee stille terugvallen verwijderd, elk met bewijs. De aanroep van `isMissingColumnError` blijft op beide plaatsen staan, maar is nu luid: ze herkent de ontbrekende kolom en gooit `MigratieOntbreektError` in plaats van opnieuw te schrijven.

| Nr | Na de ronde | Wat de gebruiker ziet als de kolom zou ontbreken | Test |
|---|---|---|---|
| S1 | `api/storage.ts`, `saveUsersData` | 503 "De kolom users.ooktechnieker bestaat nog niet: draai supabase/2026-09-28_users_ook_technieker.sql in de SQL Editor." In de app: "Opslaan is mislukt. Dit onderdeel is op de server nog niet ingesteld, er moet nog een migratie draaien. Meld het aan de beheerder." | `src/storageOokTechnieker.test.ts`, `src/apiIntegration.test.ts` (Ook technieker) |
| S2 | `api/storage.ts`, `saveDiversionsData` | 503 "De kolom diversions.location bestaat nog niet: draai supabase/2026-09-10_diversions_location.sql in de SQL Editor." In de app dezelfde melding als bij S1. | `src/storageOmleidingPlaats.test.ts`, `src/apiIntegration.test.ts` (omleidingen) |

Stand na de ronde: 47 aanroepen, waarvan 23 luid, 4 stil bij het schrijven (S3 tot en met S6) en 20 stil als vangnet.

Twee kanttekeningen, beide alleen van belang in een omgeving waar de kolom echt ontbreekt (productie en staging hebben ze):

- `saveUsersData` verwijdert eerst de rijen van verwijderde gebruikers en schrijft dan pas de rest. Die volgorde bestond al en is niet gewijzigd. Wie in zo'n omgeving een gebruiker verwijdert, krijgt de 503 terwijl de rij al weg is. Bij de omleidingen speelt dit niet: daar komt de upsert eerst.
- Het herstel uit een back-up (`POST /api/restore`) schrijft via dezelfde opslag en geeft bij een ontbrekende kolom zijn bestaande 500 "Herstellen is mislukt"; de tekst met het .sql-bestand staat dan in het serverlog en in de logregel "Back-up gedeeltelijk hersteld".

De melding in de app noemt het .sql-bestand bewust niet (keuze van 28-09, `src/lib/fouten.ts`). De beheerder vindt het bestand in het antwoord van de server en in Systeemstatus, waar `/api/health/schema` de ontbrekende kolom toont.

## Stil met bewijs, niet verwijderd

**S6, plaats van aanmelden (`api/storage.ts:3696`).** Het bewijs is er, maar de terugval is niet veilig luid te maken:

- De schrijfactie loopt op de achtergrond vanuit de aanmeldcontrole (`api/middleware.ts:408`), en de aanroeper smoort elke fout. Er is geen gebruiker aan wie een melding getoond kan worden.
- De tweede poging zonder plaats dient ook een ander doel: een waarde die de database weigert (check-constraint) mag de plaats kosten, niet de aanwezigheid. Die poging moet dus blijven.
- Zonder de terugval zou een ontbrekende kolom de hele sessierij kosten in plaats van alleen de plaats, en nog altijd zonder melding.
- Het luide pad bestaat al aan de leeskant: het scherm Activiteit meldt `supabase/2026-09-20_user_presence_locatie.sql` zolang geen enkele rij de kolommen draagt.

De geheugenstand heeft hier een houdbaarheid van tien minuten, dus het probleem van de omleidingen (plaats blijft weg na het draaien van de migratie) doet zich hier niet voor.

## Verwant, buiten de telling

Deze terugvallen gebruiken de twee functies niet en vallen dus buiten het nummer. Niets aan gewijzigd; genoteerd als vervolgpunt.

| Bestand en regel | Wat | Soort | Opmerking |
|---|---|---|---|
| `api/storage.ts:2632` | `updates.bijlagen_tonen`: de upsert gaat opnieuw zonder het vinkje | Stil, schrijven | Zelfde soort als S2, en de kolom staat in de schemaProbes van `bc65372`. Kandidaat voor een volgende ronde. |
| `api/storage.ts:2652` | `updates.isurgent`: beste poging, eerst lowercase, dan camelCase | Stil, schrijven | Bewust: de kolom bestaat live niet (zie commentaar in `api/schemaProbes.ts`) |
| `api/storage.ts:3244` | `coverage_expectations`: lege instelling als de tabel ontbreekt | Stil, vangnet | Tabel staat niet in de schemaProbes |
| `api/ocpi.ts:921` | OCPI-dagpieken: lege kaart als de tabel ontbreekt | Stil, vangnet | Tabel staat niet in de schemaProbes |
| `api/storage.ts:317`, `399`, `430`, `1637` | `isMissingDbFunction`: terugval als een RPC ontbreekt | Stil, vangnet | De RPC's worden door `/api/health/schema` gecontroleerd |

## Vervolgpunten

1. `isMissingColumnError` is twee keer gedefinieerd (`api/deviceGate.ts:46` en `api/storage.ts:2178`), met dezelfde inhoud. Samenvoegen raakt bestanden van openstaande PR's en is daarom niet in deze ronde gedaan.
2. `user_devices`, `client_errors` en `client_error_status` staan niet in `api/schemaProbes.ts`. Zolang dat zo is, ziet `/api/health/schema` een ontbrekende migratie op die tabellen niet en is er geen bewijs om S3, S4, S5 of V6 te verwijderen.
3. `updates.bijlagen_tonen` (zie hierboven) is een stille schrijfterugval met bewijs, buiten de telling van dit nummer.

## Nagaan om later meer te mogen verwijderen

Eén leesquery in de SQL Editor, op productie en op staging. Ze leest alleen kolomnamen, geen data:

```sql
select table_name, column_name
from information_schema.columns
where table_schema = 'public'
  and (
    (table_name = 'user_devices' and column_name = 'session_id')
    or (table_name = 'client_errors' and column_name in
        ('fingerprint', 'release', 'view', 'role', 'online', 'breadcrumbs', 'top_frame'))
  )
order by table_name, column_name;
```

Verwacht: 8 rijen per omgeving (1 voor `user_devices`, 7 voor `client_errors`). Komen ze er alle 8 uit op beide omgevingen, dan is er bewijs voor S3, S4 en S5. Zet de kolommen dan ook in `api/schemaProbes.ts`, zodat `/api/health/schema` ze voortaan bewaakt.
