# VHB Portaal — Projectkennis & geschiedenis

> **Wat dit document is (en wat niet).** Dit is een zo volledig mogelijk overzicht van alles wat
> er over dit project bekend is op basis van het *duurzame spoor* van de samenwerking: de
> git-historie, alle 101 pull requests, de codebase, migraties en configuratie. De letterlijke
> chatgesprekken zelf zijn niet leesbaar vanuit een nieuwe sessie — elke Claude-sessie start
> blanco — maar omdat vrijwel al het werk via PR's is verlopen, is dit een getrouwe reconstructie
> van wat er samen gebouwd is en waarom.
>
> Laatst bijgewerkt: 11 juli 2026.

---

## 1. Wat is dit project?

**VHB Portaal** — "Een centraal portaal voor VHB-buschauffeurs met omleidingen, werkroosters en
beheerfuncties" (uit `metadata.json`). Het is een webapp (PWA) voor een Belgisch busbedrijf (VHB)
met drie rollen:

| Rol | Kan o.a. |
|---|---|
| `chauffeur` | Eigen rooster bekijken, verlof aanvragen (en intrekken), diensten ruilen, omleidingen en updates lezen, ritblaadjes offline raadplegen, agenda-abonnement (.ics), push-notificaties |
| `planner` | Planning-matrix beheren (XLSX-import), openstaande diensten ("dekking") opsporen, verlof- en ruilaanvragen beoordelen, rij- en rusttijdcontrole, rapportage |
| `admin` | Alles van planner + gebruikersbeheer, systeemstatus, back-up/herstel, activiteitenlog, debug-tools, OCPI-laadpaalmonitoring |

Productie draait op **Vercel** (`https://vhb-five.vercel.app`), data in **Supabase**.

## 2. Tech stack & architectuur

- **Frontend:** React 19 + TypeScript + Vite 6, Tailwind CSS 4, lucide-react (iconen), motion
  (animaties), react-leaflet (omleidingskaarten), Inter als huisstijlfont. PWA met service worker
  (`public/sw.js`), installeerbaar, offline ritblaadjes/rooster.
- **Backend:** Express-API in `api/` (draait via `tsx`, gedeployed als Vercel-functies).
  Belangrijke modules: `api/index.ts` (routes, ~2400 regels), `middleware.ts`, `rateLimit.ts`,
  `userCache.ts`, `push.ts` (web-push), `email.ts` (nodemailer/SMTP), `storage.ts` (back-ups),
  `ics.ts` (agendafeed), `ocpi.ts` (laadpalen).
- **Database:** Supabase (Postgres + Auth + Storage). Versie `@supabase/supabase-js` is **gepind
  op 2.98.0** voor reproduceerbare Vercel-builds (PR #91).
- **Monitoring:** Sentry (client), eigen client-foutmonitoring met dagelijkse e-maildigest bij
  foutenpieken.
- **Tests:** Vitest — unit-tests per lib-module, 25+ API-integratietests, render-smoke-test voor
  de hele app, en een CI-vangrail die divergentie tussen gedeelde `src`/`api`-kopieën detecteert
  (`sharedCopies.test.ts`). Commands: `npm run test`, `npm run lint` (tsc --noEmit).
- **Domeinmodel** (`src/types.ts`): `User`, `Shift`, `Service`, `Diversion`, `Update`,
  `SwapRequest`, `LeaveRequest`, `PlanningMatrixRow`, `PlanningCode`, `ActivityLogEntry`;
  26 views in de app-navigatie.

## 3. Functionaliteit in detail

### Planning & rooster
- **Planning-matrix**: maandplanning zoals de papieren print, met directe **XLSX-import**
  (PR #2, #39), import-historie, en planningscodes met mapping. Dag-types worden desnoods uit de
  datum afgeleid als een import "zonder kopjes" is (PR #53).
- **Openstaande diensten** (eerst "Dekking" genoemd, hernoemd in PR #49): niet-ingevulde diensten
  per dag; klik op een gat toont wie die dag vrij is (PR #48). Dag-types, weekdag-map en
  uitzonderingen zijn volledig zelf instelbaar (PR #55/#64).
- **Rij- en rusttijdcontrole** op de planning volgens **EU-verordening 561** en het KB geregeld
  vervoer (PR #77), met een aparte Compliance-view.
- **Maandprint** met week-groepering (PR #4) en `PrintMonthlyScheduleView`.

### Verlof & dienstruil
- **Verlofsaldo**: jaarrecht en saldoberekening per chauffeur (PR #1, #13), verlofbudget-kolom in
  de database, verlofkalender voor beheer.
- **Dienstruil**: volledige flow — collega accepteert → planner valideert (PR #45), echte
  1-op-1-ruil waarbij je kiest wat je in ruil neemt (PR #50), admin mag rechtstreeks goedkeuren
  (PR #54). Chauffeur kan een eigen aanvraag "in behandeling" intrekken (PR #37).
- **Beoordeel-flows** lopen via **delta-endpoints** zodat twee beoordelaars elkaar niet stil
  overschrijven (PR #78), plus PII-scoping zodat chauffeurs alleen zien wat hen aangaat (PR #63).

### Communicatie
- **Omleidingen** met kaartweergave (Leaflet) en een eigen storage-bucket voor bijlagen.
- **Updates/mededelingen**, urgente updates gaan ook per **SMTP-e-mail** uit.
- **Push-notificaties** voor chauffeurs (web-push + PWA, PR #76).
- **Agenda-abonnement**: diensten als .ics-feed in Google/Apple Agenda, auto-updatend (PR #44).

### Beheer & robuustheid
- **Nachtelijke automatische back-up** (Vercel-cron → Supabase Storage, PR #74) én
  herstellen-vanuit-back-up met upload → preview → bevestig (PR #79).
- **Management-rapportage**: uren/verlof/rusttijd per chauffeur, export naar Excel/PDF (PR #80).
- **Activiteitenlog** per entiteit (audit-trail, PR #14), inclusief aanmeldingen en per-dag
  actieve gebruikers (PR #89).
- **Hardening**: rate-limiting + auth-user-lookup-cache (PR #81), optimistic concurrency met
  `X-Collection-Revision` op dienstoverzicht/omleidingen/updates/planningscodes (PR #83/#84),
  foutmelding-digest per e-mail bij een piek in client-fouten (PR #82).
- **Vangrails tegen dataverlies**: write-model guards die lege-import-wipes blokkeren +
  transactionele SQL (PR #58), extra bulk-wipe-vangrails (PR #71).

### OCPI — laadpaalmonitoring (juni/juli 2026)
Read-only monitoring van de **Kempower-laadpalen** via **OCPI 2.2.1**: ChargEye is de CPO, het
portaal is eMSP (party `BE/VHB`). Gebouwd in vijf stappen (PR #90–#98):
1. Credentials-handshake (Token A uit ChargEye → Token C terug; Token B moet opgeslagen worden
   vóór de credentials-POST, anders handshake-fout 3001 — PR #94).
2. Admin-kaart "OCPI-koppeling" in Systeem Status met 1-klik registreren (PR #93).
3. Datatabellen + type-veilige client voor Locations/Sessions/CDRs (PR #96).
4. Sync-laag (client → upsert) met crons en handmatige sync-knop (PR #97).
5. Monitoring-dashboard met status/sessies/verbruik (PR #98, `OcpiDashboardView`).

## 4. Huisstijl & designgeschiedenis

Dit is een groot deel van de samenwerkingsgeschiedenis geweest:

- Begin juni 2026 zijn meerdere **demo-UI-stijlen** naast elkaar gezet (Linear/Notion-clean,
  Bento, premium dark sidebar — PR #5–#10) voordat een richting gekozen werd.
- De **login-pagina** heeft een lange redesign-saga gekend (PR #17–#28): bus-mascotte erin en
  weer eruit, mesh/editorial/iridescent-varianten, uiteindelijk een light-variant met
  oker-iridescent randje; app-default werd light mode.
- **Officiële VHB-huisstijl** kwam binnen via `brand/VHB-huisstijl` (logo's, iconen, favicon —
  PR #29), later "VHB Black op amber" als kleursysteem met een eigen waarschuwings-oranje
  (PR #70).
- Grote **design-refresh** in PR #60: Inter, kalme oppervlakken, rail-sidebar, ⌘K
  command-palette. Daarna een **componentbibliotheek** + beoordeel-drawers + herontwerp van alle
  ~20 beheerviews (PR #65).
- Er is een rijdend **bus-mascotte-element** (`BrandBus`) op het dashboard, met respect voor
  `prefers-reduced-motion` (PR #40, #43, #52).
- Juli 2026: **"chauffeur-eenvoud"** in drie batches (PR #99–#101) — eenvoudiger taal &
  vangrails, versimpelde mobiele navigatie, rust & consistentie. Doelgroep is chauffeurs, niet
  techneuten.

## 5. Kwaliteitsgeschiedenis — de grote reviews

Er zijn meerdere systematische code-reviewrondes geweest, telkens in fasen opgeleverd:

- **Juni-review (fase 1–4, PR #58–#69):** 12 HOOG-bugs (PR #67), ±28 middel/laag-bevindingen
  (PR #69), dode code verwijderd (PR #68), a11y/WCAG-AA-contrast op primitives (PR #59).
- **Hotfixes onderweg:** chauffeurs kregen 403 op verlof/ruil door scoped GET vs volledige-diff
  (PR #66); stack-overflow (oneindige recursie) in `beginLoading`/`endLoading` (PR #71); kapotte
  login op productie door API-lokale imports (PR #47).
- **Volledige review medio juni:** 4 hoog-bugs rond import/rusttijden/storage/push (PR #87) en
  17 middel-bugs rond concurrency, auth, integriteit, planning en UI (PR #88).

Terugkerende les: PR's #55/#56 moesten als #63/#64 **herbouwd** worden op de redesign — grote
UI-refactors en parallelle feature-branches botsen.

## 6. Database (Supabase)

Migraties/SQL in `supabase/`: `setup_security.sql` (basis + RLS), `planning_matrix_schema.sql` +
`planning_matrix_history.sql` + `planning_code_mapping.sql`, `activity_log.sql` (+
entity-kolommen), `users_verlofbudget.sql`, `leave_decided_at.sql` / `swaps_decided_at.sql`,
`ritblaadje.sql`, `diversions_bucket.sql`, `transactional_replace.sql` (veilige
replace-semantiek), `active_sessions_rpc.sql`, `consolidate_users_columns.sql`, en voor OCPI:
`ocpi_registration.sql` + `ocpi_data.sql`. Er is een seed-script vanuit Excel
(`_seed_services_from_excel.sql`, gegenereerd door `gen_services_sql.cjs`).

## 7. Deploy & operationele wetenswaardigheden

- **Vercel Hobby-plan**: crons mogen maximaal dagelijks — de error-digest-cron moest daarom van
  uurlijks naar dagelijks (PR #86). Nachtelijke back-up en OCPI-sync draaien ook via crons.
- De Vercel-Git-koppeling is ooit hersteld geweest (PR #85 was een lege deploy-trigger).
- De Vercel-builder typeerde `listUsers().data.users` als `never[]`, waarvoor een cast nodig was
  (PR #92); mede daarom is supabase-js gepind (PR #91).
- Omgevingsvariabelen: zie `.env.example` — Supabase (server + `VITE_`-varianten voor de
  browser), SMTP, `APP_URL`, en de OCPI-set (`OCPI_CPO_VERSIONS_URL`, `OCPI_TOKEN_A`,
  `OCPI_COUNTRY_CODE=BE`, `OCPI_PARTY_ID=VHB`, `OCPI_PUBLIC_BASE_URL`).
- Wachtwoord-reset kan via `scripts/reset-password.mjs`; planning-matrix-conversie via
  `npm run convert:planning-matrix`.

## 8. Conventies in dit project

- Commitberichten en PR-titels zijn **Nederlandstalig**, in conventional-commit-stijl
  (`feat(...)`, `fix(...)`, `chore(...)`), vaak met een korte motivatie in de titel zelf.
- Werk gaat in **kleine, thematische PR's**; grote features in genummerde stappen ("stap 1…5")
  of batches ("batch 1…3").
- Bij elk write-pad horen vangrails (geen stille wipes, transacties, optimistic concurrency) en
  bij elke bugklasse een test die hem voortaan vangt.

## 9. Tijdlijn in vogelvlucht

| Periode | Zwaartepunt |
|---|---|
| eind mei – begin juni 2026 | Basisfuncties: planning-import, verlofsaldo, audit, UI-stijlverkenning |
| 3–9 juni | Login-redesign-saga, huisstijl, PWA/offline, maandplanning, agenda-feed, dienstruil, dekking |
| 10–13 juni | Grote design-refresh + componentbibliotheek, code-review fase 1–4, back-ups, push, EU-561, tests |
| 14–24 juni | Hardening: rate-limiting, concurrency, digests, rapportage, tweede reviewronde, activiteit |
| 30 juni – 1 juli | OCPI-laadpaalintegratie in 5 stappen |
| 11 juli | Chauffeur-eenvoud batch 1–3 |
