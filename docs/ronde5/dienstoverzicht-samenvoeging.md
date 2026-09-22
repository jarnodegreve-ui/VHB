# Dienstoverzicht en Beheer dienstoverzicht: één scherm met rolafhankelijke laag

Ontwerpnota, 22-09-2026. Alleen onderzoek en ontwerp, niets gebouwd. Alle regelnummers verwijzen naar de stand van `~/VHB/portaal` op het moment van lezen.

## 0. Samenvatting in vijf regels

1. **Chauffeurs zien vandaag géén dienstoverzicht.** Beide routes staan op `STAF` (`src/app/routes.tsx:69-70`, `STAF = ['planner', 'admin']` op regel 40). De samenvoeging is dus in eerste instantie een staf-verhaal: planner (lezen + bewerken) versus admin (lezen + bewerken + importeren + verwijderen). Een chauffeursweergave is een aparte beslissing, beschreven in §3.6.
2. De twee schermen tonen dezelfde acht gegevens per dienst (`Service`, `src/types.ts:158-172`), uit dezelfde collectie (`services` in `src/app/data/planning.ts:20`, GET `/api/services`), met dezelfde zoek-, zijvak- en CSV-logica. Ongeveer 120 regels zijn inhoudelijk dubbel (§1.4).
3. De échte rechtengrens ligt server-side en is vandaag correct: GET voor elke aangemelde rol, POST voor planner/admin, bulk-import alleen admin, wijzigingsgeschiedenis planner/admin (§2). De samenvoeging raakt geen enkele server-regel.
4. Doel: één route `/dienstoverzicht` met view `dienstoverzicht`; `/beheer/dienstoverzicht` wordt een `OUDE_PADEN`-alias. Eén gedeelde kern (tabel, kaartlijst, zoeken, sorteren, zijvak, lege staten) plus een **beheerlaag in een aparte lazy chunk** die alleen laadt als de schil er om vraagt (§3, §4).
5. Vier kleine, omkeerbare PR's: kern extraheren, beheerlaag in het leesscherm, oude view verwijderen met alias, verfijning (DetailPaneel, undo-verwijderen). Een vijfde, optionele PR voor de chauffeursweergave zodra Jarno daarover beslist (§5).

## 1. Wat beide schermen vandaag doen

### 1.1 Routes, rollen, laden

| | Dienstoverzicht | Beheer dienstoverzicht |
|---|---|---|
| View | `dienstoverzicht` | `beheer-dienstoverzicht` |
| Pad | `dienstoverzicht` | `beheer/dienstoverzicht` |
| Route-regel | `src/app/routes.tsx:69` | `src/app/routes.tsx:70` |
| Rollen | `STAF` (planner, admin) | `STAF` (planner, admin) |
| Sectie | `planning` (topbar "Beheer · Planning", `routes.tsx:138`) | `planning` |
| Icoon | `Bus` | `ClipboardList` |
| Bestand | `src/views/ServicesView.tsx` (256 regels) | `src/views/admin/ManageServicesView.tsx` (629 regels) |
| Loader | `src/app/viewLoaders.ts:44` | `src/app/viewLoaders.ts:45`; staat in `ZWAAR` (`viewLoaders.ts:88`), dus geen prefetch bij hover |
| Lazy-declaratie | `src/app/lazyViews.tsx:83` | `src/app/lazyViews.tsx:44` |
| Schermkeuze | `src/app/SchermInhoud.tsx:76` | `src/app/SchermInhoud.tsx:140` |
| Props | `services` | `services`, `onSave={saveServices}`, `canAdminOverride={isAdmin}` |
| Poort | `services` uitgesteld voor staf (`src/app/data/poort.ts:20-23`), start meteen bij openen (`poort.ts:30-31`, `src/app/useAppData.ts:141` en `203-207`) | idem |
| Skelet | `Verwissel laden={isInitialLoad \|\| !servicesGeladen}` (`SchermInhoud.tsx:76`) | idem (`SchermInhoud.tsx:140`) |
| Meldingen-doel | `api/_lib/meldingen.ts:33` | `api/_lib/meldingen.ts:34` (drifttest `src/lib/meldingDoel.test.ts:12-15` eist gelijkheid met `ROUTES`) |

`View`-unie: `src/types.ts:250` bevat beide sleutels. Beide schermen staan in `ADMIN_VIEWS` van `scripts/mobile-audit.mjs:29`; alleen `dienstoverzicht` staat in de donkere-modus-e2e (`e2e/donker.spec.ts:60`) en de poort-e2e (`e2e/poort.spec.ts:51-61`); alleen `beheer-dienstoverzicht` heeft een lay-out-e2e op zes breedtes (`e2e/beheer-dienstoverzicht-layout.spec.ts:12-80`).

Interne links: de planningsmatrix biedt "Open dienstoverzicht" aan en navigeert naar `beheer-dienstoverzicht` (`src/app/SchermInhoud.tsx:105`, `src/views/admin/PlanningMatrixView.tsx:365` en `569`). Tekstverwijzingen: `src/app/watIsNieuw.ts:35`, `src/views/admin/DebugView.tsx:539`, `src/views/admin/ManageSchedulesView.tsx:636` en `1200`, `shared/roosterMelding.ts:5`.

### 1.2 Dienstoverzicht (`ServicesView.tsx`)

- Toestand: zoekterm, sorteersleutel `number | time`, richting, uitgeklapte id's (`ServicesView.tsx:15-18`).
- Zoeken op dienstnummer én loopnummers 1-3 (`ServicesView.tsx:33-38`); sorteren via `Segmented` in de kop, nogmaals klikken keert de richting (`ServicesView.tsx:48-55`, `75-83`).
- Zijvak "Overzicht" met kerncijfers uit `dienstStatistiek` (`ServicesView.tsx:63`, `116-119`) en de CSV-knop in de voet (`ServicesView.tsx:110-114`); `ZijvakLayout breekpunt="xl"` (`ServicesView.tsx:105`).
- Desktop (`md:`): tabel met zeven kolommen Dienst, Loop 1, Deel 1, Loop 2, Deel 2, Loop 3, Deel 3 (`ServicesView.tsx:125-156`). Telefoon: kaart per dienst die met `Uitklap` opengaat (`ServicesView.tsx:159-215`).
- Lege staat: `EmptyState` met `NietGevonden` bij een zoekterm, anders `LegeLijst` (`ServicesView.tsx:217-225`).
- Geen schrijfacties, geen modals, geen import, geen API-aanroep in de view zelf (alle data via props).
- Hulpcomponenten `LoopChip`, `LoopCell`, `TimeCell` (`ServicesView.tsx:234-256`).

### 1.3 Beheer dienstoverzicht (`ManageServicesView.tsx`)

- Toestand: modal open, `isSaving`, `importRef`, `editingId`, `confirmDeleteId`, `historyService`, `pendingImportedServices` + telling, `formData` met tien velden, `isImporting`, zoekterm (`ManageServicesView.tsx:27-52`).
- Sorteren met `useSort<'volgorde' | 'dienst' | 'loop1' | 'start'>` op kolomkoppen (`ManageServicesView.tsx:53`, `61-68`, `395-397`), rijdichtheid via `useTabelVoorkeur('dienstoverzicht')` (`ManageServicesView.tsx:55`; localStorage-sleutel, blijft bruikbaar in de samengevoegde view).
- `TableToolbar` met zoekveld, telling "x van y" en dichtheid (`ManageServicesView.tsx:378-385`).
- Kop (`ManageServicesView.tsx:320-366`): `AanwezigOpScherm`, verborgen `<input type="file">`, `ActieMenu` met "Excel importeren" (alleen `canAdminOverride`) en "CSV downloaden", plus één gouden knop "Nieuwe dienst". Dit volgt al het kop-recept van CLAUDE.md regel 79.
- Rij-acties in één `ActieMenu` per rij: Bewerken, Wijzigingsgeschiedenis, Verwijderen (alleen admin, `gevaarlijk`) (`ManageServicesView.tsx:73-83`).
- Tabel vanaf 42 rem containerbreedte (`@[42rem]`, `ManageServicesView.tsx:389`) met `StickyThead`, acht kolommen incl. Acties (`391-404`); daaronder kaartlijst met de drie delen naast elkaar vanaf 30 rem (`433-472`). Zijvak pas vanaf `2xl` naast de tabel (`372`, `493`).
- Excel-import volledig client-side: `await import('xlsx')` (dus xlsx is al een eigen lazy chunk, `ManageServicesView.tsx:98`; bevestigd door `scripts/check-bundle-size.mjs:119-121`), kolomherkenning op patronen (`123-172`), bevestigingsmodal "De huidige lijst wordt vervangen" (`598-609`), opslaan met `bulkReplace: true` (`277-290`).
- Formulier in `Modal` (`496-596`): dienstnummer, per deel start/eind/loop, busvak-validatie tot 47:59 via `isValidBusvakTime` + `normalizeTimeString` (`239-249`), sluit pas na een geslaagde save (`250-257`).
- Verwijderen: `ConfirmationModal` (`611-617`), daarna `onSave(services.filter(...))` (`271-275`). Let op CLAUDE.md regel 70: één item verwijderen hoort meteen te gebeuren met undo-toast, geen modal; dit scherm is daar nog niet op aangepast.
- Wijzigingsgeschiedenis: `EntityHistoryModal entityType="service"` (`619-625`), die `GET /api/activity/service/<id>` doet (`src/components/EntityHistoryModal.tsx:45`).
- Zijvak met dezelfde kerncijfers plus een `InfoTip` over de automatische planning-heropbouw (`299-316`) en een voettekst voor niet-admins (`309`).
- Lege staat: "Nog geen diensten" met knop Nieuwe dienst, of "Geen resultaten" met Zoekterm wissen (`474-490`).

### 1.4 Dubbele code

Al gedeeld: `dienstoverzichtCsv` (`src/lib/dienstoverzichtExport.ts`, 15 regels, commentaar op regel 4-6 zegt letterlijk dat kop en rijen vroeger twee keer stonden) en `dienstStatistiek`/`formatDienstDuur` (`src/lib/dienstStatistiek.ts`, 69 regels).

Nog dubbel (inhoudelijk hetzelfde, twee keer geschreven):

| Stuk | Dienstoverzicht | Beheer | ± regels |
|---|---|---|---|
| `hasValidTime` | `ServicesView.tsx:28-29` | `ManageServicesView.tsx:23-24` | 2 |
| Zoeken op dienst + loops | `33-38` | `56-59` | 6 |
| `stat` + `uiterste` | `63-65` | `293-295` | 3 |
| Zijvak-rijen Diensten/Loops/Langste/Kortste | `116-119` | `311-314` | 4 |
| CSV-download (alleen bestandsnaam verschilt) | `57-60` | `191-196` | 5 |
| Tabelkop zeven kolommen | `130-138` | `392-403` | 10 |
| Tabelrijen loop/deel per deel | `141-153` | `406-425` | 15 |
| Kaart per dienst, deel 1-3 met `Clock` en `MicroLabel` | `181-210` | `441-469` | 30 |
| Lege staat | `217-225` | `474-490` | 12 |
| Sorteren (twee verschillende mechanismen voor hetzelfde doel) | `39-55`, `75-83` | `53`, `60-68` | 25 |

Totaal ongeveer 110 tot 120 regels dubbel, plus twee verschillende sorteer-UI's (Segmented in de kop tegenover klikbare kolomkoppen) en twee verschillende breekpunten voor tabel versus kaart (`md:` tegenover `@[42rem]`). Zichtbaar gevolg voor de gebruiker: hetzelfde scherm gedraagt zich anders naargelang via welk menu-item je binnenkomt.

### 1.5 Datalaag en API

Client (`src/app/data/planning.ts`):
- `fetchServices` (`108-125`): `GET /api/services`, zet de collectie, revisie en `servicesGeladen` (ook bij een fout, regel 122, zodat "leeg" nooit "nog niet geladen" betekent). Laadfout → `meldLaadfout('het dienstoverzicht')` (toast, regel 120); er is geen aparte foutvlag voor de view.
- `saveServices` (`129-179`): `POST /api/services` met de hele lijst; header `x-bulk-replace: 1` bij import, anders `X-Collection-Revision` (`138`); 409/428 → toast + herladen (`141-145`); na succes de toast uit `dienstoverzichtToast` met eventueel de knop "Naar Beheer planning" (`155-163`) en een stille `fetchPlanning` als de planning bijgewerkt werd (`166`).

Server (`api/_lib/communicatieRoutes.ts`):
- `GET /api/services` (`303-312`): alleen `authenticate`, dus élke aangemelde rol (ook chauffeur en technieker) mag lezen. Antwoord = `toPublicService` (`api/helpers.ts:652-668`): `id`, `serviceNumber`, `startTime`, `endTime`, `startTime2/3`, `endTime2/3`, `loopnr/2/3`. Geen loonvelden, geen opmerkingen, geen persoonsgegevens.
- `POST /api/services` (`314-388`): `authenticate` + `requireRole("planner", "admin")`. Daarbinnen: `x-bulk-replace` alleen voor admin, anders 403 (`321-325`); zonder bulk: revisiecheck en `detectMassDelete` (meer dan de helft weg → 409, `326-332`); activiteitenlog globaal en per dienst (`339-359`); planning-heropbouw bij inhoudelijk verschil (`366-370`).
- `GET /api/activity/:entityType/:entityId` (`api/_lib/systeemRoutes.ts:229-245`): `requireRole("planner", "admin")` + allowlist van entiteitstypes.
- `requireRole` (`api/middleware.ts:413-424`): 401 zonder gebruiker, 403 bij een rol buiten de lijst.
- Niet relevant maar ter volledigheid: `api/_lib/dienstRoutes.ts` is de **dienstopbouw** (ritdelen uit de ET-export), een ander domein met eigen scherm `dienstopbouw`; staf-only behalve lezen van segmenten en ritblad (`dienstRoutes.ts:52`, `122`, `132`). Het dienstoverzicht raakt die routes niet.

## 2. Rechtenmodel nu

### 2.1 Endpoints

| Endpoint | Lezen/schrijven | Rollen (server) | Plek van de check |
|---|---|---|---|
| `GET /api/services` | lezen | chauffeur, technieker, planner, admin | `communicatieRoutes.ts:303` (alleen `authenticate`) |
| `POST /api/services` (gewone bewerking) | schrijven | planner, admin | `communicatieRoutes.ts:314` (`requireRole`) |
| `POST /api/services` + `x-bulk-replace: 1` | schrijven, hele collectie vervangen | admin | `communicatieRoutes.ts:321-325` (expliciete rolcheck in de handler) |
| `POST /api/services` die meer dan de helft verwijdert zonder bulk-header | schrijven | geweigerd voor iedereen (409) | `communicatieRoutes.ts:330-332` |
| `GET /api/activity/service/:id` | lezen | planner, admin | `systeemRoutes.ts:232` |

Bestaande bewijzen: `src/apiIntegration.test.ts:869-874` (chauffeur mag lezen, POST geeft 403), `1855-1872` (planner met bulk-header 403, admin 200), `1849-1853` (bulk-wipe-vangrail 409), `1601-1840` (planning-heropbouw na een save). `src/recordWritesToegang.test.ts` gaat over het deactiveren van gebruikers via de schrijfkern, niet over diensten; het is hier geen bewijs.

Eén bestaande nuance, los van de samenvoeging: de UI laat een planner geen dienst verwijderen (`ManageServicesView.tsx:80`, `263-269`), maar de server keurt een POST van een planner die één of enkele diensten weglaat goed zolang het onder de helft blijft. Dat is vandaag zo en verandert niet door de samenvoeging; §4.3 beschrijft een optionele aanscherping.

### 2.2 Client-side guard

- `magView(rol, view)` (`src/app/routes.tsx:127`) leest de `rollen` van de route. `App.tsx:807-810` stuurt een rol die de view niet mag naar het dashboard met de toast "Dit scherm is niet beschikbaar voor jouw rol"; `App.tsx:1284` berekent `resolvedCurrentView` opnieuw met dezelfde check, zodat er nooit een ongeoorloofd scherm gerenderd wordt, ook niet één frame.
- De sidebar en de bottom-nav lezen dezelfde tabel (`sidebarRoutes`, `routes.tsx:152-153`; `BottomNav.tsx:64-83`); het dienstoverzicht zit in geen enkele dock, dus daar verandert niets.
- `isAdmin` komt uit `effectiveRole` (`App.tsx:1281-1283`), dus in de voorbeeldmodus "bekijk als chauffeur" krijgt een admin `canAdminOverride=false`. Dat is UX, geen beveiliging.
- Poort per rol (`src/app/data/poort.ts:20-23`): `services` wordt alleen voor planner en admin opgehaald; een chauffeur of technieker vraagt de collectie nooit op (`useAppData.ts:141` filtert op `uitgesteldVoor(rol)`). Bewaakt door `src/app/data/poort.test.ts:6-18`.

### 2.3 Gevoelige velden

Geen. Het `Service`-record (`src/types.ts:158-172`, `api/helpers.ts:652-668`) bevat uitsluitend dienstnummer, tijden en loopnummers. Loonparameters zitten in `loon_codes` (`api/_lib/dienstRoutes.ts:164-173`, staf-only) en komen nergens in het dienstoverzicht. Het zijvak toont afgeleide cijfers uit dezelfde publieke velden. De enige staf-gebonden informatie in het beheerscherm is `AanwezigOpScherm` (wie kijkt mee) en de wijzigingsgeschiedenis; beide horen in de beheerlaag.

## 3. Doelontwerp

### 3.1 Route en naam

- **Blijft:** view `dienstoverzicht`, pad `dienstoverzicht`, label "Dienstoverzicht", sectie `planning`, icoon `Bus`. Reden: korter pad, al het doel van de poort-e2e en de donkere-modus-e2e, en niet gebonden aan `/beheer/` mocht een chauffeursweergave er ooit komen.
- **Wordt alias:** `['beheer/dienstoverzicht', 'dienstoverzicht']` in `OUDE_PADEN` (`src/app/routes.tsx:108-114`). `routeVanPad` (`117-122`) lost de alias op en de router kiest de langste bekende prefix (`src/app/router.ts:31-36`), dus ook `/beheer/dienstoverzicht/<id>` blijft werken en levert het record als parameter.
- **Verdwijnt:** view `beheer-dienstoverzicht` uit `View` (`src/types.ts:250`), `ROUTES`, `VIEWS` (`viewLoaders.ts:45`), `ZWAAR` (`viewLoaders.ts:88`), `lazyViews.tsx:44`, `SchermInhoud.tsx:140`, `poort.ts:31`, `PAD_PER_VIEW` (`api/_lib/meldingen.ts:34`), `mobile-audit.mjs:29`.
- Omschrijving in de routetabel wordt één zin die beide kanten dekt: "Alle diensten, uren en loopnummers; planners onderhouden ze hier."

### 3.2 Informatiearchitectuur

Eén `ServicesView` (bestandsnaam blijft, zodat `check-bundle-size.mjs:184-189` en de chunk-kaart niet hoeven te wijzigen; hernoemen naar `DienstoverzichtView` kan in PR 4) met drie lagen:

```
ServicesView (schil, lazy chunk 'views/ServicesView')
├─ PageHeader view="dienstoverzicht"  ← kop: acties hangen af van de beheerlaag
├─ DienstTabel (gedeelde kern, src/components/dienstoverzicht/)
│    zoeken · sorteren op kolom · dichtheid · tabel ≥ 42 rem · kaartlijst < 42 rem · lege staten
│    slots: rijActies?(dienst), onKies?(dienst), gekozenId?
├─ DienstZijvak (gedeelde kern): Diensten · Loops · Langste · Kortste (+ aside-slot voor de InfoTip)
└─ DienstoverzichtBeheer (aparte lazy chunk, alleen gerenderd als `beheer` prop niet null is)
     kop-acties (ActieMenu + gouden knop) · rij-acties · DetailPaneel met formulier ·
     import-bevestiging · undo-verwijderen · EntityHistoryModal · AanwezigOpScherm
```

Contract van de schil (`SchermInhoud.tsx`, vervanger van regel 76 en 140):

```tsx
<LazyServicesView
  services={services}
  beheer={isPlanner ? { onSave: saveServices, canAdminOverride: isAdmin } : null}
/>
```

`isPlanner` en `isAdmin` komen zoals nu uit `App.tsx:1282-1283` (effectieve rol, dus de voorbeeldmodus levert `beheer={null}`). De view zelf leest geen rol; ze krijgt een capability-object of niets. Dat sluit aan bij hoe `canAdminOverride`, `canAdminDelete` en `onDecide={isStaf(...) ? decideLeave : undefined}` vandaag werken (`SchermInhoud.tsx:110`, `144`, `152`).

Gedeelde kern in `src/components/dienstoverzicht/` (geen import tussen twee lazy views, CLAUDE.md regel 63):
- `dienstDelen.ts`: `hasValidTime`, `tijdvak(van, tot)` (en-dash zoals `ManageServicesView.tsx:70`), `delenVan(service)` → lijst van `{ nr, loop, start, eind }` met alleen geldige delen. Zuiver, unit-testbaar.
- `DienstTabel.tsx`: `TableToolbar` + `useSort` + `useTabelVoorkeur('dienstoverzicht')` + `StickyThead` + kaartlijst + `EmptyState`. Neemt de `@container`-aanpak van het beheerscherm over (die is gemeten op zes breedtes in de e2e), en de sorteersleutels `volgorde | dienst | loop1 | start`. De `Segmented`-sortering uit de kop van `ServicesView` vervalt: kolomkoppen doen hetzelfde en de kop houdt ruimte voor de acties.
- `DienstZijvak.tsx`: de vier `ZijvakRij`'s, met `aside` en `voet` als slots.
- CSV: `dienstoverzichtCsv` blijft in `src/lib/`; de bestandsnaam wordt overal `dienstoverzicht_<datum>.csv` (de `beheer_`-variant vervalt, `ManageServicesView.tsx:195`).

Beheerlaag in `src/views/admin/DienstoverzichtBeheer.tsx`, geladen met `lazyWithRetry(() => import('../admin/DienstoverzichtBeheer'))` vanuit `ServicesView`. Ze exporteert één component die drie dingen teruggeeft via een render-prop of hooks: `kopActies`, `rijActies(dienst)` en `panelen` (DetailPaneel, bevestiging, geschiedenis). De vorm mag bij de bouw nog gekozen worden; de eis is dat `ServicesView` de laag alleen mount als `beheer !== null`, en dat de import van de laag dynamisch is (anders trekt Rollup ze statisch mee in de chunk van de schil).

### 3.3 De kop

Kop-recept (CLAUDE.md regel 79): één gouden knop, hoogstens één gewone ernaast, de rest in `ActieMenu`.

| Rol | Links | Rechts |
|---|---|---|
| Planner | eyebrow "Beheer · Planning", h1 "Dienstoverzicht" | `AanwezigOpScherm` · `ActieMenu` [CSV downloaden] · **Nieuwe dienst** (goud) |
| Admin | idem | `AanwezigOpScherm` · `ActieMenu` [Excel importeren, CSV downloaden] · **Nieuwe dienst** (goud) |
| Leesweergave (toekomstige chauffeur, of staf in voorbeeldmodus) | h1 "Dienstoverzicht", zonder eyebrow als de route in `algemeen` zou komen | `ActieMenu` [CSV downloaden] of één gewone knop "CSV", géén gouden knop |

De verborgen `<input type="file">` en het Excel-menu-item zitten in de beheerlaag; een planner ziet het item niet en kan het ook niet aanroepen (de laag rendert het niet, en de server weigert de bulk-header sowieso met 403).

### 3.4 Tabel en lijst

Desktop (container ≥ 42 rem): acht kolommen, waarvan de laatste ("Acties") alleen bestaat als `rijActies` meegegeven is. Kolomkoppen Dienst, Loop 1 en Deel 1 sorteerbaar (zoals nu, `ManageServicesView.tsx:395-397`). Rij-klik in de beheerlaag = bewerken (zelfde als menu-item Bewerken); zonder beheerlaag is een rij niet klikbaar (alle gegevens staan al in de rij).

Telefoon en smalle kolom (< 42 rem): kaart per dienst, titel = dienstnummer, daaronder de delen (op tablet drie naast elkaar). Met beheerlaag staat het `…`-menu rechts in de kaartkop; zonder beheerlaag klapt de kaart uit zoals de huidige `ServicesView` (`Uitklap`, `ServicesView.tsx:165-211`) zodat een lange lijst compact blijft.

Bewerken en aanmaken: `DetailPaneel` in plaats van de `Modal` (lijst-en-detail vanaf `lg`, SlideOver op mobiel; CLAUDE.md regel 81; voorbeeld `src/views/admin/ManageDiversionsView.tsx:42-44`, `101`, `334-343`). Het gekozen record komt in de URL via `useRecordParam(0, { view: 'dienstoverzicht' })` (`src/app/router.ts:261`): `/dienstoverzicht/<id>` is deelbaar en een refresh houdt het formulier open. Rij-titel krijgt `data-vt-record={id}` voor de titelovergang. Het formulier zelf (tien velden, busvak-validatie) verhuist ongewijzigd uit `ManageServicesView.tsx:498-595`.

Zijvak: op `2xl` naast de tabel (zoals het beheerscherm, `ManageServicesView.tsx:372`), daaronder eronder. Met beheerlaag krijgt het de `InfoTip` over de planning-heropbouw als `aside`.

Verwijderen (beheerlaag, admin): meteen uitvoeren met undo-toast via `metOngedaan` (CLAUDE.md regel 70) in plaats van de `ConfirmationModal`; de import houdt zijn bevestiging (bulk).

### 3.5 Laad-, lege en foutstaten

- Laden: `Verwissel laden={isInitialLoad || !servicesGeladen} skelet={<ViewLoader />}` blijft (`SchermInhoud.tsx:76`); de poort-e2e (`e2e/poort.spec.ts:51-61`) bewaakt dat "Geen diensten gevonden" nooit tijdens het laden verschijnt.
- Leeg zonder zoekterm: `EmptyState illustratie={<LegeLijst />}` "Nog geen diensten"; met beheerlaag de actie "Nieuwe dienst" (secundair), anders de tekst "De planning heeft nog geen diensten klaargezet."
- Leeg met zoekterm: `NietGevonden`, "Geen resultaten voor “…”", knop "Zoekterm wissen".
- Fout: vandaag alleen een toast (`planning.ts:120`) en daarna een lege lijst. Voorstel voor PR 4: een `servicesFout`-vlag naast `servicesGeladen` in `planning.ts`, zodat de view een `Foutkaart` met "Opnieuw proberen" toont in plaats van een valse lege staat. Niet nodig voor de samenvoeging zelf.
- Opslaan bezig: de gouden knop in het paneel krijgt `bezig={isSaving}` (zoals `ManageServicesView.tsx:592`); het paneel sluit pas na een geslaagde save.

### 3.6 Wireframes

Desktop, planner (≥ 2xl, met beheerlaag):

```
Beheer · Planning
Dienstoverzicht                       [👥 2] [ … ] [ + Nieuwe dienst ]
┌──────────────────────────────────────────────┐ ┌──────────────────┐
│ 🔍 Zoek op dienst- of loopnummer…  42 van 42 ⚙│ │ Overzicht     ⓘ │
├───────┬───────┬────────────┬──────┬──────┬───┤ │ Diensten     42 │
│Dienst↕│Loop 1↕│Deel 1     ↕│Loop 2│Deel 2│ … │ │ Loops        19 │
├───────┼───────┼────────────┼──────┼──────┼───┤ │ Langste 2515    │
│ 2101  │ 4500  │04:36–07:52 │ 4611 │13:39–│ ⋯ │ │        9u 28min │
│ 2515  │ 4505  │07:08–08:34 │ 4510 │15:13–│ ⋯ │ │ Kortste 2607    │
│ 2607  │ 4500  │15:41–26:16 │  -   │      │ ⋯ │ │       10u 35min │
└───────┴───────┴────────────┴──────┴──────┴───┘ └──────────────────┘
   ⋯ = ActieMenu: Bewerken · Wijzigingsgeschiedenis
   Rij-klik of Bewerken → DetailPaneel rechts (lg+), URL /dienstoverzicht/<id>
```

Desktop, admin: identiek, plus in het kop-menu "Excel importeren" bovenaan en in het rij-menu "Verwijderen" (rood, na een scheiding).

Desktop, leesweergave (toekomstige chauffeur, of admin in voorbeeldmodus):

```
Dienstoverzicht                                        [ ⬇ CSV ]
┌──────────────────────────────────────────────┐ ┌──────────────────┐
│ 🔍 Zoek op dienst- of loopnummer…  42 van 42  │ │ Overzicht        │
├───────┬───────┬────────────┬──────┬──────┬───┤ │ Diensten     42 │
│Dienst↕│Loop 1↕│Deel 1     ↕│Loop 2│Deel 2│L3 │ │ …               │
│ 2101  │ 4500  │04:36–07:52 │ 4611 │13:39–│   │ └──────────────────┘
└───────┴───────┴────────────┴──────┴──────┴───┘
   Geen Acties-kolom, geen aanwezigheid, geen gouden knop, rijen niet klikbaar.
```

Telefoon, planner/admin (390 px):

```
┌────────────────────────────────┐
│ ‹ VHB   Dienstoverzicht        │  topbar
│ Beheer · Planning              │
│ Dienstoverzicht   [ … ] [ + ]  │  … = Excel (admin) · CSV ; + = Nieuwe dienst
│ 🔍 Zoek op dienst- of loopnr…  │
│ 42 van 42                  ⚙  │
├────────────────────────────────┤
│ 2515                       ⋯   │  ⋯ = Bewerken · Geschiedenis · (Verwijderen)
│ DEEL 1 · LOOP 4505             │
│ 🕓 07:08–08:34                 │
│ DEEL 2 · LOOP 4510             │
│ 🕓 15:13–21:55                 │
│ DEEL 3 · LOOP 4515             │
│ 🕓 24:10–25:10                 │
├────────────────────────────────┤
│ 2101                       ⋯   │
│ …                              │
├────────────────────────────────┤
│ Overzicht (zijvak onder lijst) │
└────────────────────────────────┘
   Bewerken opent een SlideOver van onder; terugknop sluit (useHistoryDismiss).
```

Telefoon, leesweergave:

```
┌────────────────────────────────┐
│ Dienstoverzicht         [⬇CSV] │
│ 🔍 Zoek op dienst- of loopnr…  │
├────────────────────────────────┤
│ 2515                  Dienst ˅ │  tik = uitklappen (Uitklap)
│   DEEL 1 · 07:08–08:34 loop 4505
│   DEEL 2 · 15:13–21:55 loop 4510
├────────────────────────────────┤
│ 2101                  Dienst › │
└────────────────────────────────┘
```

### 3.7 Wat een chauffeursweergave zou mogen tonen (aparte beslissing)

Vandaag uitgesloten: `rollen: STAF` op beide routes. Mocht Jarno chauffeurs een dienstoverzicht willen geven (de vraag "welke dienst bevat loop 4515?" is volgens `ServicesView.tsx:31-32` een dagelijkse vraag), dan is dit de afbakening:

- **Mag:** dienstnummer, de drie delen met tijden en loopnummers, zoeken, sorteren, de kerncijfers, CSV. Dat is exact wat `GET /api/services` vandaag al aan elke aangemelde rol geeft (`communicatieRoutes.ts:303`), dus er komt geen nieuwe data vrij.
- **Niet:** de beheerlaag (ze wordt niet eens gedownload), `AanwezigOpScherm`, wijzigingsgeschiedenis (server geeft toch 403), de InfoTip over heropbouw, "Nieuwe dienst".
- **Technisch nodig:** `rollen: RIJDEND_EN_STAF` in `routes.tsx` (technieker heeft geen diensten, `routes.tsx:41-43`), `'services'` toevoegen aan de chauffeurslijst van `uitgesteldVoor` (`poort.ts:23`; anders laadt `useAppData.ts:141` de collectie nooit) plus `poort.test.ts:15-18` bijwerken, `CHAUFFEUR_VIEWS` in `mobile-audit.mjs:28`, en de kop zonder eyebrow als de route naar sectie `algemeen` verhuist. De bottom-nav blijft ongemoeid (het scherm hoort achter "Meer", zoals Ritbladen).
- **Eyebrow-vraag:** blijft de route in sectie `planning`, dan ziet een chauffeur "Beheer · Planning" boven een leesscherm. Beter: sectie `algemeen` en de planner vindt het scherm via de sidebar bovenaan, of een tweede vermelding is niet mogelijk zonder dubbele route. Dit is een IA-keuze voor Jarno.

## 4. Security-ontwerp

### 4.1 De grens is de server; de client verbergt alleen

Regel: **de client beslist nooit over rechten.** Alles wat de beheerlaag doet, bestaat uit aanroepen die de server zelf al toetst:

| Client-actie | Server-toets | Blijft |
|---|---|---|
| Nieuwe dienst / Bewerken | `requireRole("planner","admin")` op POST (`communicatieRoutes.ts:314`) + revisiecheck (`326`) | ja |
| Verwijderen (admin in UI) | POST + `detectMassDelete` (`330-332`) | ja; optionele aanscherping in §4.3 |
| Excel importeren (admin in UI) | `x-bulk-replace` alleen admin (`321-325`) | ja |
| Wijzigingsgeschiedenis | `requireRole("planner","admin")` (`systeemRoutes.ts:232`) | ja |
| Lezen | `authenticate` (`303`) | ja |

De samenvoeging verandert geen enkele van deze regels, voegt geen endpoint toe en verruimt geen rol. `ROUTES` blijft `STAF` voor `dienstoverzicht`, dus `magView` (`routes.tsx:127`) en de redirect in `App.tsx:807-810` blijven chauffeurs weren zolang de chauffeursweergave niet gebouwd is.

### 4.2 De beheerlaag als aparte chunk

- `DienstoverzichtBeheer.tsx` wordt alleen via een dynamische `import()` geladen vanuit `ServicesView`, en alleen wanneer `beheer !== null`. Voor een rol zonder beheer gaat de code nooit over de lijn. De xlsx-bibliotheek blijft daaronder nog een eigen lazy chunk (`ManageServicesView.tsx:98`, `check-bundle-size.mjs:119-121`).
- Dit is een **bundel- en UX-maatregel, geen beveiliging**: een chunk is een publiek bestand op Vercel en elke gebruiker kan `/api/services` met een POST proberen. Dat de server dat afwijst is de enige echte grens (bewezen door `apiIntegration.test.ts:869-874`).
- De schil geeft de laag een capability-object (`beheer: { onSave, canAdminOverride } | null`), nooit de rol als string. Zo kan de view niet per ongeluk zelf `role === 'admin'` gaan vergelijken en kan de voorbeeldmodus (`App.tsx:1281`) de laag netjes uitzetten.

### 4.3 Server-checks die blijven of erbij mogen

Blijven: alles uit §2.1.

Optioneel, sterker dan nu (aparte kleine PR, los van de samenvoeging): in `POST /api/services` na `diffServiceChanges` (`communicatieRoutes.ts:350`) een 403 voor een planner wanneer `diff.removed.length > 0` zonder bulk-header. De UI beloofde dat al ("Diensten verwijderen is alleen beschikbaar voor admins", `ManageServicesView.tsx:265`); de server maakt de belofte dan waar. Test erbij in `apiIntegration.test.ts`: planner POST met één dienst minder → 403, admin → 200.

### 4.4 Bewijs dat niets verzwakt

Bestaand en blijvend:
- `src/apiIntegration.test.ts:869-874`: chauffeur GET 200, POST 403.
- `src/apiIntegration.test.ts:1855-1872`: planner met `x-bulk-replace` 403, admin 200.
- `src/apiIntegration.test.ts:1849-1853`: bulk-wipe-vangrail 409.
- `src/app/data/poort.test.ts:15-18`: chauffeur laadt `services` niet.
- `src/lib/meldingDoel.test.ts:12-15`: `PAD_PER_VIEW` gelijk aan `ROUTES` (faalt als de view wél uit de ene en niet uit de andere verdwijnt).
- `e2e/poort.spec.ts:51-61` en `e2e/beheer-dienstoverzicht-layout.spec.ts` (verhuist naar het nieuwe pad).

Toe te voegen:
1. `src/apiIntegration.test.ts`: chauffeur `GET /api/activity/service/<id>` → 403; technieker `POST /api/services` → 403; chauffeur POST mét `x-bulk-replace` → 403 (de rolcheck van `requireRole` komt vóór de bulk-check, dus dit bewijst de volgorde).
2. Nieuwe `src/app/routes.test.ts` (of uitbreiding van `src/app/router.test.tsx`): `magView('chauffeur', 'dienstoverzicht') === false`, `magView('technieker', 'dienstoverzicht') === false`, `magView('planner', 'dienstoverzicht') === true`; `routeVanPad('beheer/dienstoverzicht')?.view === 'dienstoverzicht'`; `'beheer-dienstoverzicht'` komt niet meer voor in `ROUTES`.
3. Chunk-scheiding: een vitest die de broncode van `src/views/ServicesView.tsx` leest en faalt op een statische `import … from '…/admin/DienstoverzichtBeheer'` (alleen `import(` toegestaan), plus een controle in `scripts/check-bundle-size.mjs` dat de chunk-kaart van `views/ServicesView` geen bestand bevat waarvan de sourcemap `views/admin/DienstoverzichtBeheer` noemt (zelfde techniek als de zod-controle op regel 175-186).
4. e2e: (a) `e2e/dienstoverzicht-rollen.spec.ts`: als `CHAUFFEUR` naar `/dienstoverzicht` → landt op `/` met de toast "Dit scherm is niet beschikbaar voor jouw rol"; als planner: geen menu-item "Excel importeren", geen "Verwijderen", wel "Nieuwe dienst" en "Wijzigingsgeschiedenis"; als admin: alle vier. (b) De lay-out-spec op zes breedtes verhuist naar `/dienstoverzicht` en verwacht h1 "Dienstoverzicht". (c) Eén test die `/beheer/dienstoverzicht` opent en de URL en h1 van het nieuwe scherm ziet.
5. Unit-test op `dienstDelen.ts` (geldige delen, busvak-tijden, lege loops).

## 5. Migratieplan

Elke stap is een eigen PR vanaf `origin/main` in een aparte worktree (memory "Portaal altijd worktree"), klein en terugdraaibaar. Checks per PR: `npm run lint`, `npm test`, `npm run lint:design`, `node scripts/check-bundle-size.mjs` na een build, `npm run test:e2e`; bij visuele wijzigingen `VISUEEL_DESKTOP=1 node scripts/mobile-audit.mjs` + `scripts/screenshot-diff.py` tegen main.

### PR 1: gedeelde kern, geen zichtbare wijziging

- Nieuw: `src/components/dienstoverzicht/dienstDelen.ts`, `DienstTabel.tsx`, `DienstZijvak.tsx` (uit `ManageServicesView.tsx:23-24`, `56-68`, `378-490`, `299-316` en `ServicesView.tsx:28-29`, `33-55`, `105-227`).
- `ServicesView.tsx` en `ManageServicesView.tsx` renderen de kern; de beheerview houdt haar `rijActies`, `Modal` en menu's. De leesview stapt over op kolomsortering en `TableToolbar` (de enige zichtbare wijziging, en wel dezelfde als het beheerscherm nu heeft).
- Ongewijzigd: `routes.tsx`, `viewLoaders.ts`, `lazyViews.tsx`, `SchermInhoud.tsx`, `BottomNav`, `mobile-audit.mjs`, `types.ts`.
- Tests: bestaande e2e's moeten groen blijven (`poort.spec.ts`, `donker.spec.ts`, `beheer-dienstoverzicht-layout.spec.ts` op zes breedtes bewaken de tabelmaten). Nieuwe unit-test `dienstDelen.test.ts`. Design-lint (`scripts/design-lint.mjs:32`) let op `pattern="\d"` in het formulier.
- Risico: de lay-out-e2e meet dat alle acht kolommen binnen de kaart passen (`beheer-dienstoverzicht-layout.spec.ts:30-59`); een andere celpadding breekt dat. Mitigatie: de kern neemt de klassen van het beheerscherm letterlijk over.

### PR 2: beheerlaag in het leesscherm

- Nieuw: `src/views/admin/DienstoverzichtBeheer.tsx` (kop-acties, rij-acties, formulier, import, geschiedenis, aanwezigheid, allemaal uit `ManageServicesView.tsx`). `ServicesView` krijgt de prop `beheer` en laadt de laag met `lazyWithRetry` + `Suspense` alleen als `beheer` gezet is.
- `SchermInhoud.tsx:76` geeft `beheer={isPlanner ? { onSave: saveServices, canAdminOverride: isAdmin } : null}` mee. Regel 140 blijft voorlopig bestaan (twee ingangen naar dezelfde ervaring, tijdelijk).
- `viewLoaders.ts`: geen nieuwe view; de beheerlaag is geen route. Overweeg `dienstoverzicht` níét in `ZWAAR` te zetten: de zware xlsx-import is al dynamisch, en `check-bundle-size` meet de warmup-set (het scherm zit daar niet in, `viewLoaders.ts:116-119`).
- Tests: rollen-e2e (§4.4 punt 4a) op `/dienstoverzicht`; chunk-scheidingstest (§4.4 punt 3); `apiIntegration`-aanvullingen (§4.4 punt 1).
- Risico: een statische import van de beheerlaag maakt de scheiding ongedaan zonder dat iemand het ziet. Mitigatie: de broncodetest uit §4.4 punt 3.

### PR 3: oude view weg, alias erbij

- `routes.tsx`: regel 70 verwijderen; `['beheer/dienstoverzicht', 'dienstoverzicht']` in `OUDE_PADEN` (`108-114`); omschrijving op regel 69 bijwerken.
- `types.ts:250`: `'beheer-dienstoverzicht'` uit `View`. De typecheck (`npm run lint`) wijst dan elk overgebleven gebruik aan.
- `viewLoaders.ts:45` en `:88`, `lazyViews.tsx:44`, `SchermInhoud.tsx:140` en de import op regel 19, `poort.ts:31`, `SchermInhoud.tsx:105` (link vanuit de matrix → `'dienstoverzicht'`).
- `api/_lib/meldingen.ts:34` verwijderen (drifttest `meldingDoel.test.ts:12-15` dwingt dit af).
- `scripts/mobile-audit.mjs:29`: `'beheer-dienstoverzicht'` eruit. `e2e/beheer-dienstoverzicht-layout.spec.ts` hernoemen naar `dienstoverzicht-layout.spec.ts`, seed op `view: 'dienstoverzicht'`, `goto('/dienstoverzicht')`, h1 "Dienstoverzicht"; één extra test die via `/beheer/dienstoverzicht` binnenkomt.
- `src/views/admin/ManageServicesView.tsx` verwijderen. Teksten bijwerken: `watIsNieuw.ts:35` mag blijven (historisch changelog-item), `DebugView.tsx:539` en `ManageSchedulesView.tsx:636` zeggen "Dienstoverzicht"; `ActieMenu.tsx:21` en `design-lint.mjs:32` zijn commentaar en mogen blijven.
- `BottomNav.tsx`: geen wijziging (niet in een dock). `SidebarNav.tsx`: geen wijziging (leest `ROUTES`; het tweede item verdwijnt vanzelf).
- Oude paden die blijven werken: `/beheer/dienstoverzicht`, `/beheer/dienstoverzicht/<id>`, `/?view=dienstoverzicht`. Niet meer: `/?view=beheer-dienstoverzicht` (de `?view=`-vorm gaat via `ALLE_VIEWS`, `router.ts:44-45`). Dat oude query-formaat wordt alleen door oude push-meldingen gebruikt en er wordt nergens naar `view=beheer-dienstoverzicht` gepusht (grep in `api/` leverde niets op), dus geen breuk in de praktijk.
- Tests: `routes.test` (§4.4 punt 2); `poort.test.ts:25-32` (view-kaart tegen `ROUTES`) blijft groen zodra `poort.ts:31` weg is.
- Risico: `localStorage` `vhb-current-view` van een staflid kan nog `beheer-dienstoverzicht` bevatten; `router.ts:83` controleert tegen `ALLE_VIEWS` en valt terug op het dashboard. Geen crash, hoogstens één keer het dashboard.

### PR 4: verfijning (optioneel, na PR 3)

- `Modal` → `DetailPaneel` met `useRecordParam(0, { view: 'dienstoverzicht' })`, `MasterDetail` op `lg+`, `data-vt-record` op de rij-titel (patroon `ManageDiversionsView.tsx`).
- Verwijderen met undo-toast (`metOngedaan`) in plaats van `ConfirmationModal`.
- `servicesFout`-vlag in `planning.ts` + `Foutkaart` in de view.
- Eventueel hernoemen `ServicesView.tsx` → `DienstoverzichtView.tsx` (dan ook `viewLoaders.ts:44`, `lazyViews.tsx:83`, `check-bundle-size` leest het pad automatisch uit de regex op regel 184-189).
- Tests: e2e "bewerken via URL /dienstoverzicht/<id> opent het paneel", undo-test.

### PR 5: chauffeursweergave (alleen na beslissing van Jarno)

Zie §3.7. Wijzigingen: `routes.tsx:69` rollen en eventueel sectie; `poort.ts:23` + `poort.test.ts`; `mobile-audit.mjs:28`; `WARMUP_VIEWS` níét (blijft achter "Meer"); e2e: chauffeur ziet het scherm zonder kopknoppen en zonder Acties-kolom; `apiIntegration` blijft ongewijzigd want de server gaf de data al.

## 6. Open keuzes voor Jarno

1. Blijft de route in "Beheer · Planning" (huidig) of gaat ze naar "Algemeen"? Alleen relevant als de chauffeursweergave er komt.
2. Wil hij de optionele server-aanscherping uit §4.3 (planner mag geen dienst verwijderen, ook niet via een handgemaakte POST)?
3. Wil hij PR 4 (DetailPaneel + undo) meteen na PR 3, of blijft de `Modal` voorlopig?
