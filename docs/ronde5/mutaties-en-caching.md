# Mutaties-classificatie VHB-portaal (vóór optimistic UI)

Datum: 2026-09-22. Read-only onderzoek in `/Users/jarnodegreve/VHB/portaal`, niets gewijzigd. Alle paden zijn relatief aan die map; regelnummers zijn van de huidige werkkopie.

## 0. Kerncijfers

- 107 regels met een schrijf-aanroep vanuit de client (grep op `method: 'POST|PUT|PATCH|DELETE'` en de `json('POST'|'PUT'|…)`-helpers in `src/`, zonder tests): 25 in de datalaag `src/app/data/*.ts`, 35 helperfuncties in `src/lib/{techniek,loon,dienst,coverage,herverdeel,updateReads,ruilBekeken,push,dashboardVoorkeuren,monitoring}.ts`, 47 rechtstreeks in views, componenten en `App.tsx`.
- 103 tabelrijen (genummerd 1 t/m 102 hieronder, nummer 54 gesplitst in a/b), waarvan 5 rijen systeem-, preview- of diagnostiekcalls zijn die geen UI-classificatie nodig hebben.
- Vandaag al optimistisch: 5 mechanismen (`perRecord` kern.ts:285-348, meldingen gelezen/verwijderen meldingen.ts:100-164, update-lezen UpdatesView:58-64, dashboardvoorkeuren dashboardVoorkeuren.ts:196-215, startscherm/meldingssoorten InstellingenView:328-395).
- Schermvullende dimmer (`beginLoading`): 8 aanroepplekken in `src/app/data/planning.ts`, `mensen.ts` en `communicatie.ts`; overlay in `src/App.tsx:1339-1355`.
- Uitkomst: 14 rijen A, 17 rijen B, 67 rijen C, 5 rijen n.v.t.

Legenda in de tabellen:
- **RT** = aantal server-round-trips vóór de UI de definitieve staat toont (0 = optimistisch, 1 = na het antwoord, 2 = antwoord plus refetch).
- **Feedback** = wat de gebruiker ziet tijdens het wachten: `knop-bezig` (lokale `bezig`/`isSubmitting`-vlag op de knop), `dimmer` (schermvullende overlay), `geen` (niets tot de toast).
- **Cat.** = voorgestelde categorie: A volledig optimistisch, B optimistisch met pending-state en rollback, C server-confirmed (pressed-state plus lokale spinner op de actie, nooit een dimmer).

Gedeelde kern die overal terugkomt:
- `perRecord` (`src/app/data/kern.ts:285-348`): optimistisch `setList` op :296, canoniek record terug via `applySaved` op :310, rollback door `refetch` bij 409/404 (:316-330), veldfouten (:333-338) en elke andere fout (:339-347). Er is géén zichtbare pending-toestand op het record tussen :296 en :310.
- `decideViaPatch` (`kern.ts:353-386`): wacht op de server, past `data.leave`/`data.swap` lokaal toe (:370), 409/404 → info-toast plus refetch (:374-378). Geen pending-state; de aanroepende knoppen hebben ook geen `bezig` (zie 5, 14, 15).
- Collectie-savers (`saveLeave` verlof.ts:36, `saveSwaps` ruil.ts:36, `savePlanning` planning.ts:74, `saveServices` planning.ts:129, `savePlanningCodes` planning.ts:221, `saveUsers` mensen.ts:85, `saveUpdates` communicatie.ts:32, `saveDiversions` communicatie.ts:102): POST van de hele lijst met `x-collection-revision`, 409/428 → refetch. Vier ervan zetten de dimmer.
- `apiFetch` (`src/lib/api.ts:20-21`): één stille herkansing alleen voor GET; een POST/PUT wordt nooit automatisch herhaald. Belangrijk voor rollback-ontwerp: een netwerkfout op een schrijfactie is écht onbeslist (de server kan hem wél verwerkt hebben).

## 1. Classificatie per domein

### 1.1 Verlof

| # | Actie | Waar (client → route) | Huidig gedrag | Cat. | Motivering | Wat moet veranderen |
|---|---|---|---|---|---|---|
| 1 | Aanvraag indienen (chauffeur) | `src/views/LeaveManagementView.tsx:276` → `saveLeave` `src/app/data/verlof.ts:36-69` → `POST /api/leave` `api/_lib/verlofRoutes.ts:472` | Wacht op server; `isSubmitting` (:80) op de knop; 1 RT (`setLeaveRequests(newLeave)` :50, dekking stil :54); modal sluit pas na ok (:277); toast :58. Geen dimmer. | C | Personeelsdossier en saldo; server weigert plausibel: 403/400 (:531-591), volzet-limieten, 409/428 revisie (:44). | Voldoet al aan C. Toe te voegen: pressed-state op de knop (primitives.tsx:74-77 `bezig` bestaat, gebruik hem), en na ok het record in de lijst even markeren als "ingediend". |
| 2 | Registreren door staf (namens, status `approved`) | `LeaveManagementView.tsx:272-276` (zelfde route) | Als 1; formulier blijft open bij registratie (:279-285). | C | Directe goedkeuring zonder beoordeling, raakt saldo en dekking. | Als 1. |
| 3 | Eigen openstaande aanvraag intrekken (verwijderen) | `LeaveManagementView.tsx:511` → `saveLeave` (lijst zonder record) | Bevestigingsmodal, dan wacht; geen knop-bezig; 1 RT; toast :512. | B | Eigen record, omkeerbaar (opnieuw aanvragen); server kan 409 geven als de planner net besliste (:562). | Optimistisch uit de lijst met "wordt ingetrokken…"-pil; rollback via `fetchLeave` bij fout; tweede pad: aparte `DELETE /api/leave/:id` zodat niet de hele lijst gePOST wordt. |
| 4 | Goedgekeurd verlof annuleren | `LeaveManagementView.tsx:487` → `decideLeave(..,'cancelled')` verlof.ts:100 → `PATCH /api/leave/:id` verlofRoutes.ts:700 | Bevestigingsmodal, dan PATCH; 1 RT; geen bezig; toast bij ok (:384 pad niet, hier geen toast). | C | Verandert dekking (`refreshCoverageGaps` :114) en het dossier. | Knop in de modal `bezig`; toast na bevestiging. |
| 5 | Beoordelen (goedkeuren/afwijzen met reden) | `src/components/VerlofBeoordeling.tsx:305,340`, `LeaveManagementView.tsx:383`, `src/views/admin/VerlofKalenderView.tsx:201` → `decideLeave` → `decideViaPatch` kern.ts:353 → `PATCH /api/leave/:id` | Wacht op server; **geen** `bezig`/`disabled` op de beslisknoppen (grep VerlofBeoordeling: 0 treffers); dubbelklik = tweede PATCH = 409-toast; 1 RT (`applyLocal` :370); toast :384. | C | Beslissing over personeel, stuurt push, raakt dekking; 409 bij gelijktijdige beoordelaar is een echt scenario (seenStatus-guard :109). | Pressed-state plus lokale spinner op de gekozen knop, andere knop uit; toast pas na ok (is zo). Geen dimmer (is zo). |
| 6 | Bulk beoordelen | `LeaveManagementView.tsx:426` → `bulkUitvoeren` `src/lib/bulk.ts:60` (sequentieel) → n × PATCH | n RT's na elkaar; geen zichtbare voortgang per rij; één samenvattende toast (:427). | C | Als 5, keer n. | Per geselecteerde rij een pending-pil die op "klaar" springt; teller "3/7" op de selectiebalk; selectie pas leegmaken na afloop. |
| 7 | Ziekte: einddatum bijstellen / intrekken | `src/views/admin/ZiekteView.tsx:246,253` → `saveLeave` | `isOpslaan` (:240); 1 RT; detail sluit na ok. | C | Ziekte-einddatum stuurt dekking en loon (ziektecodes). | Voldoet; pressed-state toevoegen. |
| 8 | Verloflimieten | `src/components/VerlofLimietenModal.tsx:61` → `PUT /api/verlof/limieten` verlofRoutes.ts:325 | `bezig` (:59); 1 RT; `onSaved` met serverwaarde (:65); toast :66. | C | Beleidsinstelling die alle beoordelingen kleurt; zeldzaam. | Voldoet al. |
| 9 | Extra feestdagen | `src/components/VerlofFeestdagenModal.tsx:63` → `PUT /api/verlof/feestdagen` verlofRoutes.ts:361 | Idem (:61-74). | C | Raakt de saldo-telling van iedereen (`stelExtraFeestdagenIn` verlof.ts:159). | Voldoet al. |
| 10 | Beslissingen "gezien" | `verlof.ts:119-131` → `PATCH /api/me/voorkeuren` `api/_lib/accountRoutes.ts:428` | Optimistisch: state + localStorage eerst (:122-127), PATCH fire-and-forget (:130). 0 RT. | A | Persoonlijke badge, geen enkel gevolg voor anderen; localStorage vangt een mislukte PATCH op. | Niets. Blauwdruk voor A. |

### 1.2 Ziekte

| # | Actie | Waar | Huidig gedrag | Cat. | Motivering | Wat moet veranderen |
|---|---|---|---|---|---|---|
| 11 | Ziek melden (staf) | `ZiekteView.tsx:208`, `src/views/PlannerDashboardWidgets.tsx:1247`, `ZiekteView.tsx:232` (uit Excel) → `reportSick` verlof.ts:73-96 → `POST /api/leave/sick-report` verlofRoutes.ts:457; rechtstreeks: `src/views/admin/ManageSchedulesView.tsx:254` | `isMelden` / `excelZiekteBusy` / `ziekteRegBusy`; **2 RT**: POST en daarna `await Promise.all([fetchLeave(), refreshCoverageGaps()])` (:84) vóór de toast (:85). Geen dimmer. | C | Slaat een gat in de dekking, start het herverdeel-proces, loon-relevant. | Server geeft het aangemaakte record terug → lokaal invoegen (1 RT), `fetchLeave`/dekking stil op de achtergrond. Pressed-state op "Ziek melden". |
| 12 | Dienst overzetten / herverdelen (ook 1-op-1 wissel) | `ZiekteView.tsx:93` (één), `:160` (bulk via `bulkUitvoeren`), `PlannerDashboardWidgets.tsx:330`, `src/views/CapacityView.tsx:245` (met `returnLine`) → `POST /api/admin/shift-swap` `api/_lib/ruilRoutes.ts:1061` | `wisselBezig`/`verdeelBezig`/`isWisselen` per rij; wacht op server; daarna `onShiftSwapped` = `fetchPlanning(silent)` + `fetchSwaps` + `refreshCoverageGaps` (`src/app/SchermInhoud.tsx:170-174`, `PlannerDashboardWidgets.tsx:86`) = **2 RT (3 calls)**; CapacityView herlaadt de hele maand (`setReloadTick` :262). Geen dimmer. | C | Verplaatst een dienst van chauffeur A naar B, stuurt beide een push, rusttijd- en dubbele-inplanningchecks; de server geeft veel plausibele 409's (:1097, :1114, :1121, :1126, :1136, :1158, :1184, :1190). | Pressed-state en spinner op de rij-knop (bestaat); antwoord `{swap, carry}` (:1217) gebruiken om de shift lokaal te verplaatsen en de refetch stil te doen (1 RT zichtbaar). |

### 1.3 Dienstruil

| # | Actie | Waar | Huidig gedrag | Cat. | Motivering | Wat moet veranderen |
|---|---|---|---|---|---|---|
| 13 | Ruil/overname aanvragen (chauffeur) | `src/views/SwapRequestsView.tsx:358` → `saveSwaps` `src/app/data/ruil.ts:36-72` → `POST /api/swaps` ruilRoutes.ts:408 | `isSubmitting` (:41); **2 RT**: POST plus `await fetchSwaps()` (:58) omdat de server `shiftDate/shiftLine` aanvult; toast :61; modal sluit na ok (:359-365). | C | Planningsverzoek met rusttijdwaarschuwing (`shared/ruilRust.ts`), 409 "loopt al" (:485), 403-regels (:503-520). | Server geeft het verrijkte record terug (`POST …/one`-patroon zoals updates) → 1 RT; pressed-state. |
| 14 | Accepteren / weigeren door collega | `SwapRequestsView.tsx:425,435` → `handleStatusUpdate` :368-398 → `decideSwap` ruil.ts:74 → `PATCH /api/swaps/:id` ruilRoutes.ts:1017 | Bevestigingsmodal, dan PATCH; 1 RT (`applyLocal` met `data.swap` :370); toast :384; **geen** bezig op de knoppen. | C | Accepteren is een verbintenis tot een andere dienst; 409 bij intussen ingetrokken verzoek. | Modal-knop `bezig`; kaart krijgt pending-pil tot het antwoord. |
| 15 | Goedkeuren / afwijzen door planner (incl. admin-override) | `SwapRequestsView.tsx:789-801`, `:860-880`, override `:410` → zelfde pad | Directe knoppen zonder modal (:789/790), zonder `bezig`; 1 RT; toast :384. De planning zelf komt pas binnen via het realtime-event `planning_version` (`src/lib/realtime.ts:187-200`), niet uit dit antwoord. | C | Goedkeuring voert de wissel in de planning door (server), stuurt push, rusttijd-check; conflict tussen twee planners is het ontwerpgeval van de `seenStatus`-guard (:369-374). | Pressed-state plus spinner op de gekozen knop, zusterknop uit; na ok stil `fetchPlanning` starten i.p.v. op het socket-event te wachten. |
| 16 | Intrekken door aanvrager | `SwapRequestsView.tsx:542` → PATCH `cancelled` | Modal, dan PATCH; geen bezig. | B | Eigen verzoek, omkeerbaar (opnieuw indienen); 409 plausibel als de collega net accepteerde. | Kaart optimistisch naar "ingetrokken" met pending-pil, rollback via `fetchSwaps` bij fout. |
| 17 | Afhandelen (`completed`) | `handleStatusUpdate` :381 (toast) → PATCH | Als 15. | B | Administratieve eindstatus, geen planningseffect; server bewaakt dat alleen `approved` → `completed` mag (memory 20-09). | Optimistisch naar tab "Afgehandeld" met pending-pil; rollback bij 409. |
| 18 | Wissel terugdraaien | `CapacityView.tsx:279` → `PATCH /api/swaps/:id` `{status:'cancelled', ifStatus:'approved'}` | `isTerugdraaien` (:274); 1 RT; herlaadt de maand (:287). | C | Draait de planning terug (`revertSwapFromPlanning` server-side), raakt twee chauffeurs. | Pressed-state (bestaat); stil herladen i.p.v. `reloadTick` over het hele scherm. |
| 19 | Wissel "gezien" bevestigen (ontvangende chauffeur) | `SwapRequestsView.tsx:322` → `confirmSwapSeen` ruil.ts:85-104 → `POST /api/swaps/:id/gezien` ruilRoutes.ts:1229 | Wacht op ok, dan lokaal `targetSeenAt` (:96) plus stille `fetchSwaps` (:97); `isConfirmingSeen` (:317, disabled :646). | B | Bevestiging is bewijs voor de planner (memory: push bereikt bijna niemand); omkeerbaar-loos maar laag risico; server idempotent. | Vinkje meteen tonen met pending-pil, rollback bij fout (bestaat al deels: refetch :91). |
| 20 | Aanvraag "bekeken" (waarneming) | `src/lib/ruilBekeken.ts:22` → `POST /api/swaps/:id/bekeken` ruilRoutes.ts:1272, `stil: true` | Fire-and-forget, eenmaal per sessie, nooit een fout. | A | Registratie van een waarneming, geen handeling. | Niets. |
| 21 | Afgewezen/ingetrokken wissel wissen uit geschiedenis (staf) | `SwapRequestsView.tsx:192` → `saveSwaps` (lijst zonder record) | Bevestigingsmodal; 2 RT; geen bezig. | C | Onomkeerbaar (comment :182-184: server weigert heraanmaken). | Modal-knop `bezig`; aparte `DELETE /api/swaps/:id` i.p.v. de hele lijst posten. |

### 1.4 Planning

| # | Actie | Waar | Huidig gedrag | Cat. | Motivering | Wat moet veranderen |
|---|---|---|---|---|---|---|
| 22 | Matrix-preview | `ManageSchedulesView.tsx:204` → `POST /api/planning-matrix/preview` `api/_lib/planningRoutes.ts:780` | Leest alleen (berekening); `isPreviewVerversen`. | n.v.t. | Geen mutatie. | Niets. |
| 23 | Matrix importeren | `ManageSchedulesView.tsx:350` → `POST /api/planning-matrix/import` planningRoutes.ts:576 | `isMatrixImporting`; na ok `onMatrixImported` (`SchermInhoud.tsx:84-93`) = `fetchPlanningMatrix` + **`fetchPlanning()` niet-stil → dimmer** (planning.ts:43) + historiek + dekking = 2 RT; toast :379. | C | Vervangt dagen in de planning van iedereen, stuurt meldingen. | `fetchPlanning(undefined, undefined, {silent:true})` op SchermInhoud:89; voortgang in de import-modal zelf ("planning wordt herladen…"). |
| 24 | Import terugzetten (snapshot) | `ManageSchedulesView.tsx:326` → `POST /api/planning-matrix/restore` planningRoutes.ts:744 | `isRestoring`; daarna `onMatrixImported` → dimmer (als 23). | C | Herstelt een oudere planning voor iedereen. | Als 23. |
| 25 | Sync vanuit matrix (admin) | `ManageSchedulesView.tsx:406` → `POST /api/planning/sync-from-matrix` planningRoutes.ts:935 | `isSyncing`; 1 RT; geen dimmer. | C | Herbouwt de planning. | Voldoet; pressed-state. |
| 26 | Planning wissen (admin) | `ManageSchedulesView.tsx:453` → `savePlanning([])` planning.ts:74 → `POST /api/planning` planningRoutes.ts:266 | `isClearingPlanning` én **dimmer** (planning.ts:77). | C | Destructief voor iedereen (server: alleen admin :274). | Dimmer weg; knop in de bevestigingsmodal `bezig`. |
| 27 | Fictieve testdienst toevoegen/wissen (debug) | `src/views/admin/DebugView.tsx:556,566` → `savePlanning` (hele lijst) | **Dimmer**; toast pas na `await` (:557/567), ook bij `false`-resultaat (bug: toast "toegevoegd" na 409). | C | Post de volledige planningscollectie voor één testdienst. | Dimmer weg; resultaat van `onSaveShifts` controleren vóór de toast; liever `assign-service`-achtige per-record route. |
| 28 | Dienst toewijzen (dekking) | `src/views/CoverageView.tsx:271` (één), `:162` (batch) → `POST /api/planning/assign-service` planningRoutes.ts:1061 (antwoord `{rows}` :1068) | `assignBusy`/`batchBezig` per kandidaat; daarna `refetchGaps()` = `zl.ververs()` stil (:246) → 2 RT; toast :277; geen dimmer. | C | Schrijft een dienst op naam, stuurt push; 409 mogelijk (dienst intussen gedekt). | `rows` uit het antwoord gebruiken om het gat lokaal te sluiten (1 RT); pressed-state per kandidaatknop (bestaat). |
| 29 | Dienstnotitie (planner → chauffeur) | `CapacityView.tsx:131` → `PUT /api/planning-notes` planningRoutes.ts:520 | `isSavingNote`; 1 RT; lokaal na ok (:137-143); toast :144 ("chauffeur krijgt een melding"). | B | Tekst is omkeerbaar, maar het opslaan stuurt een push; serverfout is onwaarschijnlijk maar niet nul. | Notitie meteen in de cel met pending-pil; rollback naar de vorige tekst bij fout. |
| 30 | Planningscodes | `src/views/admin/PlanningCodesView.tsx:106` → `savePlanningCodes` planning.ts:221 → `POST /api/planning-codes` planningRoutes.ts:1019 | `isSaving` én **dimmer** (planning.ts:224); 409/428-guard (:230). | C | Hele collectie vervangen; codes sturen de import-mapping. | Dimmer weg; `isSaving` volstaat op de knop. |
| 31 | Dienstoverzicht bewerken / verwijderen / Excel-import | `src/views/admin/ManageServicesView.tsx:253` (await), `:273` en `:287` (**`void onSave`, modal sluit meteen**) → `saveServices` planning.ts:129 → `POST /api/services` `api/_lib/communicatieRoutes.ts:314` | **Dimmer** (planning.ts:132); server herbouwt de planning en meldt dat in de toast (:154-163); stille `fetchPlanning` bij `bijgewerkt` (:166). Verwijderen/import sluiten de dialoog vóór het antwoord zonder rollback. | C | Dienstinhoud (tijden) stuurt loonparameters én de planning-heropbouw; 409/428 bij gelijktijdige bewerking. | Dimmer weg; `isSaving` op de dialoogknop; `:273`/`:287` laten wachten op het resultaat (zoals :253). |
| 32 | Dekking-verwachtingen (dagtypes, weekdagen, uitzonderingen) | `CoverageView.tsx:514` → `saveCoverageConfig` `src/lib/coverage.ts:44` → `PUT /api/coverage-expectations` `api/coverageRoutes.ts:402`; daarna `refetchGaps` + `appData.refreshCoverageGaps` (:515-518) | Wacht; 2 RT; toast alleen bij fout (:521). | C | Bepaalt wat "openstaande dienst" betekent voor de hele cockpit. | Pressed-state; succes-toast; geen verdere wijziging. |
| 33 | Herverdeel-advies (batch) | `src/lib/herverdeel.ts:35` → `POST /api/coverage-advisor/batch` coverageRoutes.ts:574 | Berekening, schrijft niets. | n.v.t. | Geen mutatie. | Niets. |

### 1.5 Dagadministratie, looncontrole, dienstopbouw

| # | Actie | Waar | Huidig gedrag | Cat. | Motivering | Wat moet veranderen |
|---|---|---|---|---|---|---|
| 34 | Dag openen | `src/views/admin/DagafsluitingView.tsx:84` → `openDag` `src/lib/loon.ts:56` → `POST /api/dagafsluiting/:datum/openen` `api/_lib/loonRoutes.ts:229` | `bezig`; 1 RT (detail uit antwoord); toast. | C | Start de loonregistratie van die dag. | Voldoet. |
| 35 | Prestatierij bewerken (inline) | `DagafsluitingView.tsx:73-80` → `bewaarRij` loon.ts:57 → `PUT …/rijen/:id` loonRoutes.ts:252 | **Geen bezig**; 1 RT (`vervang` met serverrij); bij fout toast plus `load()`. | C | Loonregels (overuren, premies), controle vóór Easypay-export. | Rij-pending-pil tijdens de PUT; invoerveld pas "af" na het antwoord. Geen dimmer (is zo). |
| 36 | Rij toevoegen | `DagafsluitingView.tsx:372` → `voegRijToe` loon.ts:58 → `POST …/rijen` loonRoutes.ts:267 | `bezig` in modal; 1 RT. | C | Loon. | Voldoet. |
| 37 | Rij verwijderen | `DagafsluitingView.tsx:101` → `verwijderRij` loon.ts:59 → `DELETE …/rijen/:id` loonRoutes.ts:283 | **Geen bezig**; lokaal na ok. | C | Loon, onomkeerbaar. | Rij-pending-pil; knop uit tijdens de call. |
| 38 | Planning overnemen | `DagafsluitingView.tsx:96` → `neemPlanningOver` loon.ts:60 → `POST …/planning-overnemen` loonRoutes.ts:296 | `bezig`; **2 RT** (POST plus `load()`). | C | Overschrijft gereden codes met de planning. | Antwoord met de gewijzigde rijen teruggeven → 1 RT. |
| 39 | Dag afsluiten | `DagafsluitingView.tsx:90` → `sluitDag` loon.ts:61 → `POST …/afsluiten` loonRoutes.ts:326 | `bezig`; 1 RT; toast. | C | Juridisch/loon: vergrendelt de dag voor export. | Voldoet. |
| 40 | Dag heropenen (met reden) | `DagafsluitingView.tsx:348` → `heropenDag` loon.ts:62 → `POST …/heropenen` loonRoutes.ts:336 | `bezig` (:359 toont "Bezig…"); veldfout `reden` (:349). | C | Als 39; reden gaat in het activiteitenlog. | Voldoet; goed voorbeeld van C. |
| 41 | Looncode bewaren / verwijderen | `src/views/admin/LooncontroleView.tsx:316` (`bezig`), `:249` (**geen bezig**) → `bewaarLoonCode`/`verwijderLoonCode` loon.ts:65-66 → `PUT`/`DELETE /api/loon/codes/:code` loonRoutes.ts:78/90 | 1 RT; lokaal na ok. | C | Definitie van de loonberekening. | Verwijderen: pending-pil op de rij plus bevestiging. |
| 42 | Matricule per medewerker | `LooncontroleView.tsx:363` → `bewaarMedewerker` loon.ts:70 → `PUT /api/loon/medewerkers/:userId` loonRoutes.ts:114 | **Geen bezig**; inline; lokaal na ok. | C | Koppeling naar Easypay (loon). | Cel-pending-pil; invoer bevriezen tot antwoord. |
| 43 | Matricules importeren | `LooncontroleView.tsx:368` → `importeerMedewerkers` loon.ts:71 → `POST …/import` loonRoutes.ts:128 | `bezig`; 2 RT (`load()`). | C | Bulk-loonkoppeling. | Voldoet; antwoord kan de rijen teruggeven (1 RT). |
| 44 | Easypay-lidnummer | `LooncontroleView.tsx:112` → `bewaarInstellingen` loon.ts:74 → `PUT /api/loon/instellingen` loonRoutes.ts:161 | **Geen bezig**; 2 RT. | C | Exportinstelling. | Knop `bezig`. |
| 45 | Dienstopbouw-bestand importeren | `src/views/admin/DienstopbouwView.tsx:73` → `importeerBestand` `src/lib/dienst.ts:29` → `POST /api/dienstopbouw/imports` `api/_lib/dienstRoutes.ts:61` | `bezig`; 2 RT (`onChanged`). | C | Basis van diensten en loonparameters. | Voldoet. |
| 46 | Import activeren | `DienstopbouwView.tsx:83` → `activeerImport` dienst.ts:30 → `POST …/activeren` dienstRoutes.ts:98 | `bezig`; 2 RT. | C | Zet de actieve dienstdefinities om. | Voldoet. |
| 47 | Import verwijderen | `DienstopbouwView.tsx:88` → `verwijderImport` dienst.ts:31 → `DELETE …/imports/:id` dienstRoutes.ts:111 | **Geen bezig**; 2 RT. | C | Onomkeerbaar. | Rij-pending plus bevestiging. |
| 48 | Looncodes afleiden | `DienstopbouwView.tsx:94` → `leidLooncodesAf` dienst.ts:40 → `POST …/afleiden-looncodes` dienstRoutes.ts:177 | `bezig`; 1 RT; toast met telling. | C | Schrijft looncodes op diensten. | Voldoet. |
| 49 | Dagtype koppelen (select per rij) | `DienstopbouwView.tsx:340` → `bewaarDagtype` dienst.ts:42 → `PUT /api/dienstopbouw/dagtypes/:code` dienstRoutes.ts:216 | **Geen bezig**; select toont pas na antwoord de nieuwe waarde (:340 `setRijen` na `await`). | B | Mapping, omkeerbaar, lage frequentie; serverfout zeldzaam. | Select meteen op de nieuwe waarde met pending-pil, rollback naar de oude bij fout. |

### 1.6 Updates (nieuws)

| # | Actie | Waar | Huidig gedrag | Cat. | Motivering | Wat moet veranderen |
|---|---|---|---|---|---|---|
| 50 | Publiceren / bewerken | `src/views/admin/ManageUpdatesView.tsx:104-107` → `createUpdate`/`saveUpdate` `src/app/data/communicatie.ts:175-188` → `perRecord` → `POST /api/updates/one` communicatieRoutes.ts:421 / `PUT /api/updates/:id` :443 | **Optimistisch** (kern.ts:296), canoniek record via `applySaved` (:310), rollback door refetch bij 409/404/400; `isPublishing`; toast in view na `success` (:116). 0 RT zichtbaar, maar zonder pending-markering. Server stuurt push naar alle chauffeurs. | B | Lijst is direct correct voor de planner, maar publiceren = push naar iedereen en 409-revisie is reëel (twee planners). | Record in de lijst een "wordt gepubliceerd…"-pil geven tussen :296 en :310 (bv. `pendingIds` in de datalaag), toast pas na `applySaved`. |
| 51 | Verwijderen | `ManageUpdatesView.tsx:210` → `deleteUpdate` communicatie.ts:192-208 → `DELETE /api/updates/:id` :536, herstel = `POST …/one` met `X-Herstel` (:184) | Optimistisch plus 6 s "Ongedaan maken" (`src/lib/ongedaan.ts:28-60`); 409/404 → refetch. | A | Omkeerbaar binnen de toast, geen push bij herstel. | Niets; blauwdruk voor A met ongedaan. |
| 52 | PDF-bijlage toevoegen / verwijderen | `src/components/UpdateBijlagen.tsx:61,83` → `POST`/`DELETE /api/updates/:id/bijlage[/:slot]` communicatieRoutes.ts:465/509 | `bezig`; 2 RT (`onGewijzigd` refetch). | B | Bestandsbytes moeten fysiek aankomen; tot dan is "toegevoegd" niet waar, maar de impact is klein. | Placeholder-rij "uploaden…" in de bijlagenlijst; na ok vervangen door het antwoord i.p.v. refetch. |
| 53 | Dringende e-mail | `communicatie.ts:63-82` → `POST /api/send-urgent-update-email` communicatieRoutes.ts:606 | Wacht; toast :74/:76; geen knop-bezig (loopt in `handleSubmit` na publiceren). | C | Externe verzending naar alle chauffeurs, rate-limited. | Stap tonen in de publiceer-knop ("mail versturen…"). |
| 54a | Gewoon bericht gelezen (bij openen) | `src/views/UpdatesView.tsx:58-74` → `markUpdatesRead` `src/lib/updateReads.ts:16` → `POST /api/updates/read` communicatieRoutes.ts:556 | Optimistisch (:59), rollback bij fout (:62). | A | Leesbevestiging, geen gevolg voor anderen dan de teller. | Niets. |
| 54b | "Gelezen en begrepen" (dringend) | `UpdatesView.tsx:76-80` → zelfde call, `bevestigBezig` | Wacht op ok voor de knop vrijkomt. | B | Bewijsstuk voor de planner (leesteller); moet dus zeker aankomen, maar mag alvast vinkje tonen. | Vinkje met pending-pil; bestaande rollback :62 behouden. |
| 55 | Collectie-save updates (terugval) | `communicatie.ts:32-61` → `POST /api/updates` :397 | Alleen als de per-record-props ontbreken (ManageUpdatesView:107); in de app nooit actief (SchermInhoud:113 geeft alle props). | C (legacy) | Hele lijst. | Terugvalpad schrappen zodra optimistic UI er is. |

### 1.7 Omleidingen

| # | Actie | Waar | Huidig gedrag | Cat. | Motivering | Wat moet veranderen |
|---|---|---|---|---|---|---|
| 56 | Toevoegen / bewerken | `src/views/admin/ManageDiversionsView.tsx:250,232` → `createDiversion`/`saveDiversion` communicatie.ts:138-151 → `POST /api/diversions/one` :189 / `PUT /api/diversions/:id` :209 | Optimistisch via `perRecord`; `refetch` stil (:142); `successToast`; paneel blijft open bij fout (:230-232). | B | Chauffeurs zien ze live via realtime; 400-veldfouten en 409-revisie zijn reëel. | Pending-pil op het record tot `applySaved`; toast daarna (nu: toast op ok, dat is al goed). |
| 57 | Verwijderen | `ManageDiversionsView.tsx:265` → `deleteDiversion` communicatie.ts:154-171 → `DELETE` :232, herstel `POST …/one` `X-Herstel` | Optimistisch plus ongedaan-toast. | A | Omkeerbaar. | Niets. |
| 58 | PDF uploaden (vóór opslaan) | `ManageDiversionsView.tsx:78` → `POST /api/diversions/pdf` :250 | `isUploading` (:59); URL nodig vóór de save. | B | Bytes moeten aankomen; daarna pas 56. | Voortgang in het formulier; blijft server-first van aard. |
| 59 | Collectie-save omleidingen (terugval) | `communicatie.ts:102-134` → `POST /api/diversions` :162, **dimmer** (:105) | Alleen terugval (:234/:252/:267), niet actief. | C (legacy) | Hele lijst. | Schrappen. |

### 1.8 Documenten en ritbladen

| # | Actie | Waar | Huidig gedrag | Cat. | Motivering | Wat moet veranderen |
|---|---|---|---|---|---|---|
| 60 | Document uploaden bij gebruiker | `src/views/admin/UserDocumentsModal.tsx:51` → `POST /api/documents` `api/_lib/documentRoutes.ts:215` | `uploading`; 2 RT (`load()`); toast. | B | Bestand naar personeelsdossier; bytes moeten aankomen. | Placeholder-rij "uploaden…"; antwoord gebruiken i.p.v. refetch. |
| 61 | Document verwijderen | `UserDocumentsModal.tsx:68` → `DELETE /api/documents/:id` :321 | **Geen bezig, geen bevestiging**; lokaal na ok (:70). | C | Personeelsdossier, onomkeerbaar (bestand weg). | Bevestiging plus rij-pending; geen optimistische verwijdering. |
| 62 | Document naar alle chauffeurs | `src/views/admin/BroadcastDocumentModal.tsx:43` → `POST /api/documents/broadcast` :268 | `sending`; toast met aantal (:49). | C | Naar iedereen, met push. | Voldoet. |
| 63 | Document geopend (leesbevestiging) | `src/views/DocumentsView.tsx:71` → `POST /api/documents/:id/opened` :314 | Fire-and-forget. | A | Waarneming. | Niets. |
| 64 | Ritblad uploaden / verwijderen (admin) | `src/views/RitblaadjesView.tsx:210` (`isUploading`), `:239` (**geen bezig**) → `POST`/`DELETE /api/ritblaadje` documentRoutes.ts:72/151 | 1 RT; localStorage-meta bijgewerkt (:226-227, :248-249). | C | Operationeel document voor alle chauffeurs, offline gecachet (sw.js:198). | Verwijderen: knop `bezig` plus bevestiging. |

### 1.9 Gebruikers

| # | Actie | Waar | Huidig gedrag | Cat. | Motivering | Wat moet veranderen |
|---|---|---|---|---|---|---|
| 65 | Aanmaken | `src/views/admin/ManageUsersView.tsx:305` → `createUser` `src/app/data/mensen.ts:142` → `perRecord` → `POST /api/users/one` `api/_lib/gebruikersRoutes.ts:226` | **Optimistisch in de lijst** (kern.ts:296, zichtbaar achter de modal), `isSubmittingUser`; veldfouten via `setNieuwFouten`; credentials-modal na ok. | C | Account met wachtwoord en rol; 400/409 (naam, e-mail) reëel; server maakt een auth-user aan. | Optimistische invoeging vervangen door "wordt aangemaakt…"-rij óf pas invoegen na `applySaved`; modal-knop `bezig` (bestaat). |
| 66 | Bewerken (incl. vervaldata) | `ManageUsersView.tsx:345` → `saveUser` mensen.ts:135 → `PUT /api/users/:id` :251 (revisie); daarna per soort `PUT /api/user-expiries` (`ManageUsersView.tsx:354`, gebruikersRoutes.ts:139) | Optimistisch (kern.ts:296); `isSubmittingUser`; vervaldata sequentieel ná de save (:347-360) zonder gebundelde foutmelding. | C | Rol, actief, matricule, rijbewijs-/medische data: personeels- en toegangsdossier. | Rij-pending tot `applySaved`; vervaldata in één PUT of met `bulkUitvoeren`-samenvatting. |
| 67 | Snel pauzeren/activeren | `ManageUsersView.tsx:404` → `saveUser` | Optimistisch; **geen bezig**. | C | Blokkeert of opent de login. | Toggle met pending-pil; niet optimistisch. |
| 68 | Verwijderen | `ManageUsersView.tsx:380` → `deleteUser` mensen.ts:149 → `DELETE /api/users/:id` :278 | **Optimistisch weg** (kern.ts:296) na bevestiging; 409/404 → refetch (comment :317-319). | C | Onomkeerbaar; laatste-admin-guard client én server. | Rij blijft staan met "verwijderen…"-pil tot het antwoord. |
| 69 | Bulk pauzeren / verwijderen / Excel-import | `ManageUsersView.tsx:398,410,642` → `saveUsers` mensen.ts:85 → `POST /api/users` :192 (hele lijst) | **Dimmer** (mensen.ts:88); 2 RT (`await fetchUsers()` :100); geen knop-bezig. | C | Replace-all-semantiek (DebugView:522-525 waarschuwt er zelf voor). | Dimmer weg; bulkbalk-knop `bezig` met teller; op termijn per-record-calls via `bulkUitvoeren`. |
| 70 | Uit dienst | `ManageUsersView.tsx:483` → `POST /api/users/:id/uitdienst` :307 | `isUitDienstBezig`; 2 RT (`fetchUsers` :498); samenvattende toast. | C | Deactiveert account, trekt toestellen in, wist push. | Voldoet; antwoord bevat al de samenvatting, refetch mag stil. |
| 71 | Wachtwoord reset (admin) | `ManageUsersView.tsx:440` → `POST /api/admin/users/reset-password` :73 | `isResettingPassword`; credentials-modal na ok. | C | Auth. | Voldoet. |
| 72 | 2FA reset (admin) | `ManageUsersView.tsx:424` → `POST /api/admin/users/:id/mfa-reset` :50 | **Geen bezig**, modal sluit vóór het antwoord (:422). | C | Auth. | Modal open houden met `bezig` tot het antwoord. |
| 73 | Vervaldata (scherm) | `src/views/admin/VervaldataView.tsx:181` → `PUT /api/user-expiries` per soort via `bulkUitvoeren` | `isSaving`; samenvattende toast; `zl.ververs()` (2 RT). | C | Rijbewijs, medische keuring: juridisch. | Voldoet; refetch mag lokaal vervangen worden door de eigen draft. |

### 1.10 Toestellen en sessies

| # | Actie | Waar | Huidig gedrag | Cat. | Motivering | Wat moet veranderen |
|---|---|---|---|---|---|---|
| 74 | Toestel goedkeuren / blokkeren / schrappen | `src/views/admin/DevicesView.tsx:98` → `POST /api/devices/{approve,revoke,delete}` `api/deviceRoutes.ts:309/330/353`; ook `src/views/WerkvoorraadView.tsx:136` (approve, per rij) | `busyKey` per toestel; 2 RT (`load()`); toast. | C | Toegang tot het portaal (security). | Voldoet; rij-pending bestaat. |
| 75 | Toestel hernoemen | `DevicesView.tsx:124` → `POST /api/devices/rename` :384 | `isRenaming`; 2 RT. | A | Cosmetisch, omkeerbaar, alleen admin ziet het. | Naam meteen tonen, rollback bij fout, geen refetch. |
| 76 | Toestel-poort aan/uit | `DevicesView.tsx:83` → `POST /api/devices/gate` :278 | `isTogglingGate`; state na ok (:84). | C | Security-instelling voor iedereen. | Voldoet. |
| 77 | Eigen toestel uitloggen / andere sessies beëindigen | `src/views/InstellingenView.tsx:59,75` → `POST /api/me/toestellen/:id/uitloggen` deviceRoutes.ts:136, `…/uitloggen-anderen` :104 plus `supabase.auth.signOut({scope:'others'})` (:76) | `bezig` per toestel; 2 RT (`laad()`). | C | Beëindigt sessies. | Voldoet. |
| 78 | Toestel registreren (boot) | `src/App.tsx:902` → `POST /api/devices/register` deviceRoutes.ts:162 | Systeem, parallel met `/api/me`. | n.v.t. | Geen gebruikersactie. | Niets. |

### 1.11 Meldingen en voorkeuren

| # | Actie | Waar | Huidig gedrag | Cat. | Motivering | Wat moet veranderen |
|---|---|---|---|---|---|---|
| 79 | Melding(en) gelezen (één, alles, bij schermwissel) | `src/components/MeldingenPaneel.tsx:44,71`, `src/views/MeldingenView.tsx:49,65`, `src/app/data/meldingen.ts:126` → `markeerMeldingenGelezen` meldingen.ts:100-118 → `POST /api/meldingen/gelezen` accountRoutes.ts:391 | Optimistisch (rij plus teller :103-108), refetch bij fout (:114-117). | A | Persoonlijk, omkeerbaar. | Niets. |
| 80 | Melding verwijderen | `src/lib/meldingVerwijderen.ts:22` → `verwijderMelding` meldingen.ts:139-150 → uitgestelde `DELETE /api/meldingen` accountRoutes.ts:407 na de ongedaan-termijn, `keepalive` bij `pagehide` (:50-65) | Optimistisch met wachtende DELETE. | A | Persoonlijk; eerlijkste ongedaan-implementatie in de app. | Niets. |
| 81 | Dashboard-tegels (volgorde/verbergen) | `src/lib/dashboardVoorkeuren.ts:196-215` → `PATCH /api/me/voorkeuren` :206 | Lokaal plus localStorage eerst, PATCH gebundeld 400 ms, info-toast bij fout, lokale kopie blijft tot een geslaagde save. | A | Persoonlijke indeling. | Niets. |
| 82 | Startscherm | `InstellingenView.tsx:328-341` → `bewaarVoorkeurDeel` dashboardVoorkeuren.ts:166 | Optimistisch met rollback (:336-337) en `bezig`. | A | Persoonlijk. | Niets. |
| 83 | Meldingssoorten uit | `InstellingenView.tsx:380-395` → idem | Optimistisch met rollback. | A | Persoonlijk. | Niets. |
| 84 | Documenten "gezien" | `mensen.ts:181-189` → `PATCH /api/me/voorkeuren` | Optimistisch, localStorage-terugval. | A | Badge. | Niets. |
| 85 | Thema | `src/app/useThema.ts:67` (localStorage) | Geen server. | n.v.t. | Lokaal. | Niets. |
| 86 | Push aan/uit | `src/App.tsx:517-535` → `subscribeToPush`/`unsubscribeFromPush` `src/lib/push.ts:87,146` → `POST /api/push/subscribe` accountRoutes.ts:326 / `…/unsubscribe` :363 | Wacht op browser-permissie én server; `setPushEnabled` na resultaat; toast; geen pending op de schakelaar. | B | Schakelaar mag meteen omklappen, maar de permissiedialoog en de serverregistratie beslissen; `denied` moet zichtbaar terugklappen. | Schakelaar met pending-pil, terugklappen bij `denied`/fout. |

### 1.12 Techniek

| # | Actie | Waar | Huidig gedrag | Cat. | Motivering | Wat moet veranderen |
|---|---|---|---|---|---|---|
| 87 | Defect melden (gele boek) | `src/components/DefectMeldenModal.tsx:81` → `meldDefect` `src/lib/techniek.ts:64` → `POST /api/defecten` `api/_lib/techniekRoutes.ts:199` | `bezig`; 1 RT; `onGemeld` voegt lokaal in (VoertuigenView:272); veldfouten (:88). | C | Boordboek-melding voor de garage, meldingen naar techniek. | Voldoet. |
| 88 | Defect status (open/geannuleerd/heropenen) | `src/views/techniek/GeleBoekView.tsx:97-106` → `wijzigDefect` techniek.ts:65 → `PATCH /api/defecten/:id` :237 | **Geen bezig**; 1 RT (`vervang` :100); bij filter `open` verdwijnt de rij pas na ok (:102). | B | Statusflip, omkeerbaar ("Melding staat weer open"). | Rij meteen naar de nieuwe status met pending-pil; rollback via `vervang(d)` bij fout. |
| 89 | Defect afhandelen (uitgevoerd, manuren, prestatie) | `GeleBoekView.tsx:306-309` → `PATCH` plus `maakWerkprestatie` techniek.ts:86 → `POST /api/werkprestaties` :347 | `bezig`; 2 sequentiële calls; aparte fout-toast voor de prestatie (:311). | C | Schrijft uren (rapport/loon) en sluit de melding. | Voldoet; op termijn één server-transactie. |
| 90 | Defect bewerken (werktype, omschrijving) | `GeleBoekView.tsx:360` → `PATCH` | `bezig`. | B | Tekst, omkeerbaar. | Pending-pil op de kaart. |
| 91 | Voertuig aanmaken / bewerken | `src/views/techniek/VoertuigenView.tsx:420` → `maakVoertuig`/`bewaarVoertuig` techniek.ts:42-43 → `POST /api/vehicles` :76 / `PUT …/:id` :89 | `bezig`; veldfouten; 409 dubbel busnummer (TechniekFout :14). | B | Stamdata, omkeerbaar; 409 op busnummer is de enige realistische afwijzing. | Record optimistisch in de lijst met pending-pil; rollback bij 409/400. |
| 92 | Voertuig verwijderen | `VoertuigenView.tsx:432` → `verwijderVoertuig` techniek.ts:44 → `DELETE …/:id` :103 | `bezig`. | C | Onomkeerbaar; hangt aan defecten, werken, vervaldata. | Voldoet; bevestiging behouden. |
| 93 | Voertuig-vervaldatum (keuring, verzekering…) | `VoertuigenView.tsx:266` → `zetVoertuigVervaldatum` techniek.ts:48 → `PUT …/:id/vervaldata` :151 | Lokaal na ok (:267-270); bezig zit in het detailpaneel. | C | Juridische data (keuring/verzekering). | Pending in het detailveld; voldoet verder. |
| 94 | Werkprestatie registreren / bewerken | `src/views/techniek/WerkprestatiesView.tsx:438` → `maakWerkprestatie`/`bewaarWerkprestatie` techniek.ts:86-87 → `POST /api/werkprestaties` :347 / `PUT …/:id` :362 | `bezig`; 1 RT (`naOpslaan` met serverrecord). | C | Uren voor rapport en (op termijn) loon; technieker schrijft eigen rijen. | Voldoet. |
| 95 | Werkprestatie verwijderen | `WerkprestatiesView.tsx:98-104,241` → `metOngedaan` met `verwijderWerkprestatie` (DELETE :380) en herstel `maakWerkprestatie` | `uitvoeren` wacht op de DELETE (ongedaan.ts:43), dan toast met herstel. | B | Server-first verwijderen, daarna ongedaan: goede middenweg; lokaal weg na ok. | Rij-pending tijdens de DELETE. |

### 1.13 Account, instellingen, laadpalen, beheer

| # | Actie | Waar | Huidig gedrag | Cat. | Motivering | Wat moet veranderen |
|---|---|---|---|---|---|---|
| 96 | Wachtwoord wijzigen | `src/components/ChangePasswordModal.tsx:75,86` (Supabase `signInWithPassword` + `updateUser`) | `isSubmitting`; succes-scherm na 2e call. | C | Auth. | Voldoet. |
| 97 | 2FA inschrijven / bevestigen / uitschakelen | `src/lib/tweeStaps.ts:56,66,72` via `src/components/TweeStapsInschrijving.tsx:29-49` (`bezig`) en `InstellingenView.tsx:194-207` (`bezig`) | Wacht op Supabase. | C | Auth. | Voldoet. |
| 98 | Onderhoudsmodus | `src/views/instellingen/OnderhoudBeheer.tsx:37` → `PUT /api/onderhoud` `api/_lib/onderhoudRoutes.ts:32` | `bezig`; serverwaarde overgenomen (:38). | C | Blokkeert schrijfacties van iedereen. | Voldoet. |
| 99 | OCPI registreren / synchroniseren | `src/views/admin/OcpiCard.tsx:50,70` → `POST /api/ocpi/register` `api/ocpi.ts:1071` / `…/sync` :1096 | `isRegistering`/`isSyncing`; toast met telling. | C | Externe koppeling (ChargEye), lang lopend, deels-gelukt-scenario (:79). | Voldoet. |
| 100 | Foutgroep-status (opgelost/genegeerd/heropend) | `DebugView.tsx:208` → `POST /api/client-errors/status` `api/_lib/systeemRoutes.ts:377` | `bezig` per groep; 2 RT (`laad()`). | A | Admin-boekhouding, omkeerbaar (heropenen), niemand anders ziet het. | Groep optimistisch verplaatsen, rollback bij fout, refetch schrappen. |
| 101 | Back-up herstellen (droog + echt) | `DebugView.tsx:397,422` → `POST /api/restore[?droog=1]` `api/_lib/cronRoutes.ts:755` | `planLaden`/`isRestoring`; herstelplan-modal; 413-afhandeling. | C | Destructief voor alle collecties. | Voldoet. |
| 102 | Sessie start/einde/hervatten, testmail, health-echo, client-errors, CSP-report | `App.tsx:1137,1160,1018`; `DebugView.tsx:477,512`; `src/lib/monitoring.ts:119` | Systeem/diagnostiek. | n.v.t. | Geen gebruikersmutatie op data. | Niets. |

## 2. Schermvullende dimmer: wie hem vandaag triggert en wat ervoor in de plaats komt

Overlay: `src/App.tsx:1339-1355` (`isLoading && !isInitialLoad`, `fixed inset-0 z-[110] bg-ink/20`, kaart "Bezig / Gegevens verwerken…"). Teller: `beginLoading`/`endLoading` `App.tsx:183-190`, doorgegeven via `src/app/useAppData.ts:64` naar de datalaag.

Alle `beginLoading()`-aanroepen (grep, zonder tests: 8):

| Plek | Functie | Wordt bereikt vanuit | Zichtbaar? | Vervangende lokale pending-state |
|---|---|---|---|---|
| `src/app/data/planning.ts:43` | `fetchPlanning` zonder `silent` | `useAppData.ts:150` (poort; verborgen door `!isInitialLoad`), **`App.tsx:894` pull-to-refresh en `App.tsx:606` "Opnieuw proberen"** via `refreshAll` → `loadAppData` (zichtbaar bovenop de PTR-indicator), `SchermInhoud.tsx:89` na matrix-import/restore (zichtbaar), `planning.ts:85` na 409 op `savePlanning` (zichtbaar) | Ja (3 paden) | PTR: alleen de bestaande PTR-indicator; import/restore: voortgangsregel in de import-modal; 409-pad: info-toast plus stil verversen (`silent: true`). Concreet: `fetchPlanning` standaard stil maken en de poort de spinner van `isInitialLoad` laten gebruiken. |
| `planning.ts:77` | `savePlanning` | `ManageSchedulesView.tsx:453` (planning wissen), `DebugView.tsx:556,566` | Ja | `isClearingPlanning` op de modalknop (bestaat al); DebugView: knop `bezig`. |
| `planning.ts:110` | `fetchServices` (altijd) | `useAppData.ts:101` als **uitgestelde** lading voor staf: `setIsInitialLoad(false)` staat op `useAppData.ts:177`, de uitgestelde fetch start op :182, dus de dimmer flitst ná het openen van de poort; `planning.ts:143` na 409 op `saveServices`; `laadUitgesteld` bij schermwissel (`useAppData.ts:188-190`) | Ja (flits na de poort, bij elke opening van `beheer-dienstoverzicht` tijdens de poort en na een 409) | Geen: de views tonen al een skelet op `!servicesGeladen` (`SchermInhoud.tsx:76,140`). `beginLoading` hier schrappen. |
| `planning.ts:132` | `saveServices` | `ManageServicesView.tsx:253,273,287` | Ja | `isSaving` op de dialoogknop (bestaat, :28); voor verwijderen en import: modalknop `bezig` en wachten op het resultaat. |
| `planning.ts:224` | `savePlanningCodes` | `PlanningCodesView.tsx:106` | Ja | `isSaving` (:37) op de knop, bestaat al. |
| `src/app/data/mensen.ts:88` | `saveUsers` | `ManageUsersView.tsx:398,410,642` | Ja | Bulkbalk-knop `bezig` met teller "n gebruikers…"; import-modalknop `bezig`. |
| `src/app/data/communicatie.ts:86` | `fetchDiversions` zonder `silent` | `useAppData.ts:151` (poort, verborgen) en via `refreshAll` bij pull-to-refresh (zichtbaar) | Ja (PTR) | Als bij `fetchPlanning`: standaard stil. |
| `communicatie.ts:105` | `saveDiversions` | alleen terugvalpad `ManageDiversionsView.tsx:234,252,267` (in de app niet actief) | Nee | Pad schrappen. |

Samengevat: na het schrappen van de dimmer blijven er nul plekken over waar een lokale bezig-staat ontbreekt, behalve `DebugView.tsx:556/566` (knop `bezig` toevoegen) en de twee `void onSave`-paden in `ManageServicesView.tsx:273/287` (laten wachten). De `Button`-primitive heeft al een `bezig`-prop met spinner en `aria-busy` (`src/components/primitives.tsx:74-77`).

## 3. Caching-classificatie

### 3.1 Waar data gecachet of hergebruikt wordt (inventaris)

| Laag | Waar | Wat | Gedrag |
|---|---|---|---|
| Service worker, API-antwoorden | `public/sw.js:265-278`, lijst `OFFLINE_API` in `public/sw-ritbladen.js:29-32` (`/api/me`, `/api/planning`, `/api/diversions`, `/api/planning-notes`, `/api/ritblaadje`, `/api/users`, `/api/updates`, `/api/swaps`, `/api/leave`, `/api/meldingen`) | Network-first, cache alleen als fallback bij netwerkfout; gecacht antwoord krijgt `X-VHB-Bron: cache` (`sw-ritbladen.js:61-66`). Overige API: nooit gecachet (`sw.js:281`). | Geen stale-while-revalidate; comment `sw.js:241-248` legt uit waarom SWR voor de planning is afgeschaft. |
| Service worker, ritblad-PDF | `sw.js:198`, `sw-ritbladen.js:20-22,74-83` | Cache-first zonder revalidate, max 6 PDF's; nieuwe upload = nieuw pad. | Veilig, want inhoud-geadresseerd. |
| Datalaag, versheid | `src/app/data/kern.ts:70-77,217-233` (`noteerAntwoord`, `BronMeting`), `useAppData.ts:166-172` (`lastSyncedAt` = nu, of de datum van het oudste gecachte antwoord) | Bepaalt "Bijgewerkt om"/"gegevens van". | Alleen voor de poort-collecties. |
| Datalaag, gelijkheidscheck | `kern.ts:114-129` `useCollectieState` (ETag/afdruk) | Overslaan van een setState bij ongewijzigde inhoud; geen cache van data. | n.v.t. |
| Realtime | `src/lib/realtime.ts:144-217`: tabellen `leave`, `meldingen` (eigen rijen), `swaps`, `diversions`, `updates`, `planning_version` (dekt `planning` en `planning_matrix_rows`); debounce 400 ms (:96-106) | Push-signaal → refetch per collectie (`App.tsx:296-336`). | Geen polling; catch-up bij reconnect (`:206-216`) en bij terugkeer naar het tabblad (`:219-235`, drempel 60 s, volledige ronde hooguit per 5 min, `kiesCatchUp` :64). |
| Catch-up-sets | `App.tsx:337-359` volledig (notities, meldingen, verlof, ruilen, omleidingen, updates, planning; staf ook dekking, matrix, historiek, gebruikers), `App.tsx:364-379` licht (meldingen, verlof, ruilen; planning alleen bij gewijzigde `planning_version`), `App.tsx:385-400` bij terug-online | Vangnet voor gemiste socket-events. | **Niet** in enige catch-up: `services` (dienstoverzicht), `planningCodes`, `activityLog`, gebruikers voor chauffeurs. |
| Rustige poll | `src/lib/rustigePoll.ts:15-56` (10 min zichtbaar tabblad, focus hooguit per 5 min) via `mensen.ts:39` (vervaldata, `/api/user-expiries`) en `:58` (wachtende toestellen, `/api/devices`) | Werkvoorraad-badge staf. | Enige tijdgestuurde poll op operationele data. |
| `useZelfLadend` | `src/lib/zelfLadend.ts:80-163`: laad bij mount/deps, focus-refresh hooguit per 60 s (:134-149), stil bij terug-online (:151-158), `versheid` voor `VersheidRegel` | 13 schermen: `CapacityView.tsx:314` (maandplanning, plus `vhb-planning-changed` :363), `CoverageView.tsx:233` (dekking), `VoertuigWerkenView.tsx:46`, `VoertuigenView.tsx:62`, `GeleBoekView.tsx:58`, `DagafsluitingView.tsx:47`, `WerkprestatiesView.tsx:80,217`, `VervaldataView.tsx:46`, `LooncontroleView.tsx:79,241,356`, `RapportenView.tsx:296` | "Bijgewerkt om hh:mm" via `versheidTekst` (:74-78) op de meeste van die schermen (grep `VersheidRegel`: GeleBoekView:139, VoertuigenView:151, VoertuigWerkenView:88, WerkprestatiesView:113/258, VervaldataView:225, LooncontroleView:134-135, DagafsluitingView:123, RapportenView:366). |
| Eigen effect-polls | `src/app/data/activiteit.ts:84-91` aanwezigheid elke 5 min op het activiteitenscherm; `src/app/useOnderhoud.ts:21` onderhoudsstatus elke 60 s; `VandaagView.tsx:44`, `MijnDagView.tsx:88`, `WerkvoorraadView.tsx:73` alleen een klok-tik (geen data). | | |
| Server-side SWR | `api/_lib/swrCache.ts:23-60` alleen voor de auth-gebruikerscache (`api/middleware.ts:12,31`) en de onderhoudsstatus (`api/_lib/onderhoud.ts:5`), met epoch-invalidatie. | Geen operationele data. | n.v.t. voor deze vraag. |
| localStorage-kopieën | `dashboardVoorkeuren.ts:143-160` (tot een geslaagde save), `src/lib/startscherm.ts:25-36`, `verlof.ts:124/144` en `mensen.ts:167/185` (gezien-tijdstippen), `useThema.ts:27/67`, `ScheduleView.tsx:124/131` (weergave), `src/components/Table.tsx:46/69` (kolomvoorkeuren), `Navigation.tsx:83/89` (secties), `push.ts:70/78` (sync-stempel), `router.ts:55/82` (laatste view), `watIsNieuw.ts:231/239`, `device.ts:24/27`, `App.tsx:1002-1006` (laatste gebruiker/rol), `RitblaadjesView.tsx:150-166,226-227` (ritblad-meta plus `syncedAt`), `src/lib/ritbladPaginas.ts:134/157` (paginacache) | Allemaal persoonlijke voorkeuren of afgeleide meta; geen operationele collecties. | `RitblaadjesView` toont zijn `syncedAt` en `fromCache` (:222) zelf. |
| Live-signaal | `src/lib/liveSignaal.ts:26-42`: "… bijgewerkt"-toast hooguit per 10 s per collectie, onderdrukt 4 s na een eigen schrijfactie | Zichtbaar teken dat realtime binnenkwam. | |

### 3.2 Per databron: veranderlijkheid, maximaal aanvaardbare versheid, SWR, indicator

Uitgangspunt (regel Jarno): planning, aanwezigheid, openstaande diensten en andere operationeel veranderlijke informatie mogen niet ongemerkt langdurig stale worden. "Ongemerkt" is het sleutelwoord: stale mag, zolang het scherm zegt hoe oud de gegevens zijn en er een automatische weg naar vers is.

| Databron | Operationeel veranderlijk? | Vandaag vers door | Max. aanvaardbare versheid (motivering) | SWR toegestaan? | Vereiste zichtbare regel/indicator |
|---|---|---|---|---|---|
| Planning (`/api/planning`, shifts) | Zeer: wissels, ziekte, imports, heropbouw | Realtime `planning_version` (realtime.ts:187-200); catch-up licht/volledig; SW network-first; eigen acties refetchen stil | **60 s** in een zichtbaar tabblad met bereik (een goedgekeurde wissel moet vóór de chauffeur vertrekt zichtbaar zijn; de catch-up-drempel is al 60 s). Offline: onbeperkt, mits gedateerd. | Nee (bewust afgeschaft, sw.js:241-248). Offline-fallback wel. | `ScheduleView.tsx:291` "Bijgewerkt om" en `MijnDagView.tsx:236` offline-chip bestaan. Ontbreekt: een gedateerde regel op `VandaagView` en de planner-cockpit (`PlannerDashboardWidgets`), en een tijdgestuurde versiecheck bij een levend maar stil socket: voorstel `planning_version` elke 2 min lezen in een zichtbaar tabblad (goedkope Supabase-read, `realtime.ts:71-81` bestaat al) en bij afwijking stil verversen. |
| Maandplanning (`/api/month-planning`, CapacityView) | Zeer | `useZelfLadend` focus 60 s (:314-320) plus `vhb-planning-changed` (:363) | 60 s | Nee | `zl.versheid` is beschikbaar; controleren of `VersheidRegel` er getoond wordt (grep vindt geen treffer in `CapacityView.tsx`): toevoegen. |
| Openstaande diensten / dekking (`/api/coverage-gaps`, `coverageDays`) | Zeer: elk verlof, ziekte, wissel | `refreshCoverageGaps` bij eigen acties en bij realtime-events verlof/planning (`App.tsx:303,326`), catch-up; `CoverageView` via `useZelfLadend` focus 60 s | **60 s** (dit is de werklijst van de planner). | Nee | `coverageDays` heeft geen tijdstempel: `planning.ts:254-267` bewaart geen `laatstGeladen`. Toevoegen en tonen in de cockpit-tegel "Open diensten" ("stand hh:mm"); `CoverageView` heeft `zl.versheid`. |
| Aanwezigheid (`/api/activity/presence`) | Matig (hartslag per 5 min) | Interval 5 min op het scherm (activiteit.ts:84-91) | **5 min** (de bron zelf is per 5 min; vaker meten heeft geen zin, zie comment :81-83). | Ja, tot 5 min | "Nu online, stand hh:mm" op het scherm; nu ontbreekt de stempel. |
| Dienstruilen (`/api/swaps`) | Hoog | Realtime `swaps`, lichte en volledige catch-up, SW offline-fallback | 60 s zichtbaar; offline gedateerd | Nee | Live-toast bestaat (`meldLive('ruil')`); kaartenlijst heeft geen "Bijgewerkt om": overweeg de topbar-regel van `lastSyncedAt` ook hier. |
| Verlof (`/api/leave`) | Hoog | Realtime `leave`, catch-ups, SW fallback | 60 s zichtbaar | Nee | Als ruilen. |
| Meldingen (`/api/meldingen`) | Hoog | Realtime eigen rijen, lichte catch-up, SW fallback | 60 s | Nee (bel telt ongelezen) | Badge is de indicator; geen extra regel nodig. |
| Omleidingen (`/api/diversions`) | Matig (dagelijks) | Realtime `diversions`, volledige catch-up (niet de lichte), SW fallback | **5 min** (een nieuwe omleiding is relevant vóór de volgende rit, niet binnen de minuut). | Ja, tot 5 min, met datum | `DiversionsView` krijgt `lastSyncedAt` (SchermInhoud:74): al aanwezig. |
| Updates (`/api/updates`) | Laag-matig | Realtime `updates`, volledige catch-up | 5 min (dringend: push plus realtime dekken het) | Ja, tot 5 min | Geen extra regel nodig; dringende update vraagt bevestiging (54b). |
| Gebruikers (`/api/users`) | Laag (rol/actief/matricule); voor chauffeurs enkel contacten | Staf: volledige catch-up (`App.tsx:357`); chauffeurs: alleen initial load plus SW fallback | **15 min** (toegang wordt server-side afgedwongen; de lijst dient voor namen en contacten). | Ja, tot 15 min | Geen indicator nodig; wel: gebruikers ook voor chauffeurs in de volledige catch-up zetten (nu alleen staf). |
| Dienstoverzicht (`/api/services`) | Laag (per dienstregeling) | Alleen initial/uitgesteld; **geen** realtime, **geen** catch-up | 30 min, mits 409-guard blijft (`planning.ts:141`) | Ja | Geen indicator nodig; wel opnemen in de volledige catch-up zodat twee planners niet op 409 lopen na een import. |
| Planningscodes, matrix, importhistoriek | Laag | Matrix/historiek via `planning_version` en catch-up; codes alleen initial | 30 min (codes), 60 s (matrix na import) | Ja (codes) | Geen. |
| Werkvoorraad-bronnen: vervaldata (`/api/user-expiries`), wachtende toestellen (`/api/devices`) | Laag-matig (dagelijks) | `rustigePoll` 10 min, focus per 5 min | **10 min** (deadline-data verandert per dag; de poll is al zo). | Ja | Badge; geen regel nodig. |
| Gele boek, voertuigen, werkprestaties, voertuig-vervaldata | Matig (garage werkt er de hele dag in) | `useZelfLadend` focus 60 s | **60 s** bij focus; tussen focus-momenten mag het staan (één persoon per scherm) | Ja, gedateerd | `VersheidRegel` staat op deze schermen (GeleBoekView:139, VoertuigenView:151, WerkprestatiesView:113/258, VoertuigWerkenView:88). Voldoet. |
| Dagafsluiting, looncontrole | Matig (twee stafleden kunnen dezelfde dag bewerken) | `useZelfLadend` focus 60 s; geen revisie op rijen (`bewaarRij` stuurt geen `If-Match`) | 60 s bij focus | Ja, gedateerd | `VersheidRegel` (DagafsluitingView:123, LooncontroleView:134-135). Aandachtspunt los van caching: gelijktijdige bewerking van dezelfde rij wordt niet gedetecteerd. |
| Rapporten | Laag (afgeleid) | `useZelfLadend` (RapportenView:296) | **15 min** | Ja | `VersheidRegel` RapportenView:366. Voldoet. |
| Laadpalen (OCPI-dashboard, tabs) | Laag-matig (sync per cron) | Handmatige knop (`OcpiDashboardView.tsx:102`), tabs laden bij mount | **Tot de volgende sync** (de bron is de sync zelf) | Ja | "Laatste sync hh:mm" tonen (OcpiCard:78 kent `lastSync`); nu geen stempel op het dashboard. |
| Documenten (eigen), ritblad-meta | Laag | Mount; ritblad `syncedAt` in localStorage | 15 min / tot nieuwe upload | Ja (ritblad cache-first is inhoud-geadresseerd) | Ritblad toont `syncedAt`/`fromCache` (RitblaadjesView:150-166). Voldoet. |
| Profiel (`/api/me`) | Laag, maar security-relevant | Network-first, cache alleen offline (sw.js:237-248) | Elke opening online | Nee | Geen. |
| Onderhoudsstatus | Laag | Poll 60 s (useOnderhoud.ts:21) | 60 s | Ja (server-SWR bestaat) | Banner. Voldoet. |

Concrete gaten t.o.v. de regel van Jarno (samengevat):
1. Geen tijdgestuurde controle op de planning zolang het tabblad zichtbaar blijft en de socket stil is: catch-up hangt aan `visibilitychange` en `SUBSCRIBED` (`realtime.ts:201-235`). Voorstel: versiecheck op `planning_version` elke 2 min in een zichtbaar tabblad.
2. `coverageDays` (open diensten) draagt geen tijdstempel (`planning.ts:254-267`); de cockpit kan "0 open" tonen zonder te zeggen van wanneer.
3. `VandaagView` en `PlannerDashboardWidgets` tonen geen "Bijgewerkt om"; `lastSyncedAt` verschijnt alleen offline (`App.tsx:1617-1626`) en op het rooster (`ScheduleView.tsx:291`).
4. `services` en `planningCodes` zitten in geen enkele catch-up; het 409-vangnet (`planning.ts:141,230`) voorkomt schade maar niet verrassing.
5. Gebruikers voor chauffeurs worden na de start nooit meer ververst (`App.tsx:351-357` alleen staf).

## 4. Slot

### (a) A-mutaties die nu al veilig optimistisch kunnen (14)

Al optimistisch en goed: 10 (verlof gezien), 20 (ruil bekeken), 51 (update verwijderen met ongedaan), 54a (update gelezen), 57 (omleiding verwijderen met ongedaan), 63 (document geopend), 79 (meldingen gelezen), 80 (melding verwijderen), 81 (dashboard-tegels), 82 (startscherm), 83 (meldingssoorten), 84 (documenten gezien).
Nog om te bouwen: 75 (toestel hernoemen: naam meteen, rollback bij fout, refetch weg), 100 (foutgroep-status: groep meteen verplaatsen, rollback bij fout).

### (b) B-mutaties met de vereiste pending-visualisatie (17)

| # | Actie | Vereiste pending-state |
|---|---|---|
| 3 | Eigen pending verlof intrekken | Rij grijs met pil "wordt ingetrokken…", rollback via `fetchLeave`. |
| 16 | Ruilverzoek intrekken | Kaart naar "ingetrokken" met pil, rollback via `fetchSwaps`. |
| 17 | Ruil afhandelen | Kaart naar tab Afgehandeld met pil, rollback bij 409. |
| 19 | Wissel gezien bevestigen | Vinkje met pil tot `targetSeenAt` van de server. |
| 29 | Dienstnotitie | Tekst meteen in de cel met pil, rollback naar de vorige tekst. |
| 49 | Dagtype koppelen | Select meteen op de nieuwe waarde met pil, rollback naar de oude. |
| 50 | Update publiceren/bewerken | Record met pil "wordt gepubliceerd…" tot `applySaved`; toast daarna. |
| 52 | Update-bijlage | Placeholder-rij "uploaden…", vervangen door het antwoord. |
| 54b | Gelezen en begrepen | Vinkje met pil, bestaande rollback. |
| 56 | Omleiding toevoegen/bewerken | Record met pil tot `applySaved`. |
| 58 | Omleiding-PDF | Voortgang in het formulier (blijft server-first van aard). |
| 60 | Document uploaden | Placeholder-rij "uploaden…". |
| 86 | Push aan/uit | Schakelaar klapt meteen om met pil, terug bij `denied`/fout. |
| 88 | Defect status | Rij meteen in nieuwe status met pil, rollback via `vervang`. |
| 90 | Defect bewerken | Kaart met pil. |
| 91 | Voertuig aanmaken/bewerken | Record met pil, rollback bij 409 busnummer. |
| 95 | Werkprestatie verwijderen | Rij-pil tijdens de DELETE (server-first, daarna ongedaan). |

Gemeenschappelijk mechanisme: een `pendingIds: Set<string>` naast elke `useCollectieState`-collectie (of een `_pending`-veld dat `RecordRij`/kaart als pil toont), gezet vóór `opts.setList(opts.optimistic)` in `kern.ts:296` en gewist bij `applySaved` (:310) of bij de refetch in het foutpad (:328/:336/:340/:345). Rollback is dan altijd "refetch", nooit een lokale inverse; dat sluit aan bij hoe `perRecord` vandaag al werkt.

### (c) C-mutaties (67)

1, 2, 4, 5, 6, 7, 8, 9 (verlof, 8), 11, 12 (ziekte, 2), 13, 14, 15, 18, 21 (ruil, 5), 23, 24, 25, 26, 27, 28, 30, 31, 32 (planning, 9), 34 t/m 48 (loon en dienstopbouw, 15), 53, 55, 59 (communicatie, 3), 61, 62, 64 (documenten, 3), 65 t/m 73 (gebruikers, 9), 74, 76, 77 (toestellen, 3), 87, 89, 92, 93, 94 (techniek, 5), 96, 97, 98, 99, 101 (account en beheer, 5).

Voor elk van deze geldt: pressed-state en lokale spinner op de knop (`Button bezig`), zusterknoppen uit, dialoog blijft open tot het antwoord, toast pas na bevestiging, nooit de dimmer. Plekken waar dat vandaag ontbreekt: 5 en 15 (beslisknoppen zonder `bezig`), 14 en 16 (modalknop), 21 (wissen), 35, 37, 41-verwijderen, 42, 44, 47 (inline loon- en dienstopbouwacties zonder `bezig`), 61 (verwijderen zonder bevestiging), 64-verwijderen, 67, 72 (modal sluit te vroeg), 27 (toast vóór resultaatcontrole). Plekken waar het al klopt: 1, 2, 7, 8, 9, 11, 12, 13, 18, 23-25, 28, 34, 36, 38-40, 43, 45, 46, 48, 62, 70, 71, 73, 74, 76, 77, 87, 89, 92-94, 96-99, 101.

Round-trips die zonder verlies naar 1 kunnen: 11 (sick-report geeft record terug), 12 (`{swap, carry}` lokaal toepassen), 13 (`POST /api/swaps/one` met verrijkt record), 28 (`rows` uit het antwoord), 38, 43, 69, 70 (antwoord i.p.v. `fetchUsers`), 74 (rij bijwerken i.p.v. `load()`), 23/24 (`fetchPlanning` stil).

### (d) Drie principes voor nieuwe mutaties

1. **Eén record per call, en de server geeft het canonieke record terug.** Nieuwe schrijfacties volgen het `…/one`/`PUT :id`/`PATCH :id`-patroon met revisie-header en antwoord `{ <naam>: record }` (`kern.ts:285-348`). Geen collectie-POST's meer (`saveLeave`, `saveSwaps`, `savePlanning`, `saveUsers`, `saveServices` zijn de erfenis); elke nieuwe route die een hele lijst vervangt, is een ontwerpfout.
2. **De categorie bepaalt het UI-contract, niet de developer ter plekke.** A = `setList` vóór de call, rollback door refetch, geen toast nodig. B = `setList` vóór de call plus `pendingIds`, toast na `applySaved`. C = niets lokaal vóór het antwoord, knop `bezig` (primitives.tsx:74-77), dialoog open, toast na ok. In alle drie: nooit `beginLoading`; de dimmer verdwijnt uit de datalaag. Bij twijfel C, en alles wat planning, dekking, loon, personeelsdossier, auth of een push naar anderen raakt, is C tenzij de actie omkeerbaar is binnen een ongedaan-toast.
3. **Verse data heeft een leeftijd die je kunt zien, en een weg naar vers die niet van de gebruiker afhangt.** Elke collectie draagt een `laatstGeladen` (zoals `useZelfLadend` en `lastSyncedAt`), elk operationeel scherm toont hem, en operationele bronnen (planning, dekking, ruilen, verlof, meldingen) hebben naast realtime een tijdgestuurd vangnet in een zichtbaar tabblad (versiecheck op `planning_version`, hooguit per 2 min). Stale-while-revalidate mag alleen voor bronnen met een aanvaardbare versheid van 5 min of meer (omleidingen, updates, gebruikers, rapporten, laadpalen), en alleen met datumregel.
