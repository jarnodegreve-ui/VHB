# Toelichting bij twee niet-goedgekeurde voorstellen

Read-only onderzoek in `~/VHB/portaal`, stand 22-09-2026. Elke bewering verwijst naar bestand:regel. Klikaantallen zijn geteld door de code te volgen, niet geschat. Uitgangspunten van Jarno zijn overgenomen als vaststaand: Dashboard blijft hoofdpagina en startscherm, Updates en Meldingen blijven apart, chauffeurs melden zich nooit via het portaal ziek.

---

## Onderdeel 1: rechtstreeks naar het record vanuit Dashboard, Vandaag, Overzicht en meldingen

### 1.1 Kortste antwoord

Het voordeel is haalbaar zonder Overzicht te hernoemen en zonder er een inbox van te maken. De router kan het al, de meldingen kunnen het al, en drie doelschermen hebben vandaag al een paneel of modal per record dat alleen nog een id uit de URL moet lezen. Wat ontbreekt is uitsluitend het id in de link: de rijen in Dashboard, Overzicht, Vandaag en de pushes van de API sturen naar het scherm, niet naar het record.

### 1.2 Wat er vandaag al staat (bewijs)

**De router kent record-URL's als patroon.** `useRecordParam(index, { view })` leest en schrijft het geselecteerde record als extra padsegment (src/app/router.ts:261-284). Het commentaar erboven noemt het doel letterlijk: "kan een melding rechtstreeks naar één item wijzen" (src/app/router.ts:239-243). Elk pad wordt geparsed als langste bekende prefix plus rest-segmenten (src/app/router.ts:28-38), dus `/verlof/abc123` levert vandaag al `{ view: 'verlof', params: ['abc123'] }` op zonder dat de routetabel verandert. Schrijven is altijd `replace`, en een voorselectie schrijft niet, alleen een klik (src/app/router.ts:245-255). De SlideOver van het DetailPaneel pusht zelf een history-entry via `useHistoryDismiss`, dus de terugknop op de telefoon sluit het paneel en landt weer op de lijst (src/app/router.ts:246-250).

**Bestaande record-routes** (alle aanroepen van `useRecordParam` buiten de router):

| Route | Bestand | Wat opent |
|---|---|---|
| `/omleidingen/<id>` | src/views/DiversionsView.tsx:35 | DetailPaneel |
| `/updates/<id>` | src/views/UpdatesView.tsx:31 | DetailPaneel |
| `/beheer/omleidingen/<id>` | src/views/admin/ManageDiversionsView.tsx:101 | bewerkpaneel |
| `/beheer/updates/<id>` | src/views/admin/ManageUpdatesView.tsx:135 | bewerkpaneel |
| `/maandplanning/<yyyy-mm>/<dag>` | src/views/CapacityView.tsx:302 (index 1) | dagselectie |
| `/beheer/vervaldata/<userId>` | src/views/admin/VervaldataView.tsx:153-171 | bewerkmodal, met het patroon "onbekend id doet niets" |

**Ontbrekende record-routes**, met wat het doelscherm nu al heeft:

| Record | Doelscherm | Bestaat er een paneel per record? | Wat een deeplink moet doen |
|---|---|---|---|
| Verlofaanvraag | `/verlof` | Ja: `reviewLeave` (src/views/LeaveManagementView.tsx:397) voedt `VerlofBeoordeling`, dat het gedeelde DetailPaneel is (src/components/VerlofBeoordeling.tsx:366-385). Op lg+ een paneel bovenaan de linkerkolom dat "in beeld scrolt bij openen", op mobiel een SlideOver (src/views/LeaveManagementView.tsx:641-645). | `/verlof/<id>` → `setReviewLeave(leaveRequests.find(id))` zodra de data er is; onbekend id: niets. |
| Dienstruil | `/dienstruil` | Ja: `reviewSwap` (src/views/SwapRequestsView.tsx:76) opent een SlideOver met Goedkeuren/Afwijzen in de footer (src/views/SwapRequestsView.tsx:1281-1359). De rijknop "Details bekijken" doet vandaag precies dat (src/views/SwapRequestsView.tsx:745-750 desktop, 828-833 mobiel). | `/dienstruil/<id>` → planner: `setReviewSwap`; chauffeur: de kaart in "Openstaande dienstruilen" in beeld scrollen en markeren (daar staan Accepteren/Weigeren al inline, src/views/SwapRequestsView.tsx:627-634). |
| Ziekmelding | `/beheer/ziekte` | Ja: `detail` (src/views/admin/ZiekteView.tsx:238) opent een Modal per melding met herverdeel-knoppen (src/views/admin/ZiekteView.tsx:379-470); de rij roept `openDetail(r)` aan (src/components/ZiekteMeldingen.tsx:108, 132). | `/beheer/ziekte/<leaveId>` → `openDetail`. Let op: de werkvoorraad groepeert per chauffeur op `driverId`, niet op melding-id (src/lib/werkvoorraad.ts:82-92, 274-284), en de dagbriefing kent alleen `userId` (src/lib/dagBriefing.ts:14-20). Eenvoudigste: `/beheer/ziekte/<userId>` en het scherm opent de lopende melding van die chauffeur. |
| Toestel | `/beheer/toestellen` | Ja: `gekozenKey` + DetailPaneel met Goedkeuren (src/views/admin/DevicesView.tsx:42, 286-304). Op desktop kiest `useStandaardKeuze` al automatisch het eerste item, en wachtende toestellen staan vooraan (src/views/admin/DevicesView.tsx:160-176). | `/beheer/toestellen/<userId>` → groep openklappen en het wachtende toestel van die gebruiker kiezen. Nooit de huidige sleutel in de URL: die bevat `deviceToken` (src/views/admin/DevicesView.tsx:51). De werkvoorraad kent bewust geen tokens (src/lib/werkvoorraad.ts:14). |
| Vervaldatum | `/beheer/vervaldata` | Ja, mét route (zie boven). | Alleen `doelParams: [e.userId]` toevoegen aan het werkvoorraad-item (src/lib/werkvoorraad.ts:330-339 heeft `userId`, zet geen `doelParams`) en aan de dashboardrij (src/views/PlannerDashboardWidgets.tsx:701). Nul risico, meteen winst. |
| Open dienst | `/openstaande-diensten` | Half: de maand staat in de URL (`useRouteParam(0)`, src/views/CoverageView.tsx:65); de dagrijen hebben geen anker (`key={d.date}`, src/views/CoverageView.tsx:1023) en de toewijs-flow start met `openBatch(d)` (src/views/CoverageView.tsx:119). | `/openstaande-diensten/<yyyy-mm>/<dag>` (index 1, zelfde patroon als maandplanning) → naar de dagrij scrollen en die markeren, of meteen `openBatch`. Vandaag geeft al de maand mee (src/views/VandaagView.tsx:156), de werkvoorraad ook (src/lib/werkvoorraad.ts:291). |

**Waar de links vandaan komen en wat ze nu doen:**

- Overzicht: elke rij doet `onNavigate(it.doel, it.doelParams)` (src/views/WerkvoorraadView.tsx:113, tabelrij 257, mobiele OpsRow 302). `WerkItem` heeft de velden `doel` en `doelParams` al (src/lib/werkvoorraad.ts:190-193); alleen `dekking` vult `doelParams` (maand). Verlof, ruil, toestel, vervaldata en herverdelen gaan zonder id (src/lib/werkvoorraad.ts:302, 314, 325, 337, 282).
- Dashboardpaneel "Open taken": zelfde rijen, zelfde doelen zonder id (src/views/PlannerDashboardWidgets.tsx:701, 714, 725, 737, 749, 763). Het paneel blijft bewust top-N met "Volledig overzicht" naar Overzicht (src/views/PlannerDashboardWidgets.tsx:650-655).
- Topbarmenu: één samenvattingsrij per soort, naar het scherm (src/components/WerkvoorraadMenu.tsx:107-147, 150). Dat blijft zo: een samenvatting heeft geen record.
- Vandaag: afwezig → `ziekte` zonder id (src/views/VandaagView.tsx:112), ruil → `ruil-verzoeken` zonder id terwijl `r.swap.id` in de rij beschikbaar is (src/views/VandaagView.tsx:176, 185), open diensten → `dekking` met maand (156). Omleidingen gaan wél al naar het record: `onNavigate('omleidingen', [String(d.id)])` (src/views/VandaagView.tsx:215). Het patroon bestaat dus al binnen hetzelfde scherm.
- Meldingen (app): de rij leest `doel`, navigeert naar de view en zet daarna de record-segmenten via `navigeer(..., { params, replace: true })` (src/views/MeldingenView.tsx:48-57). Een doel `verlof/<id>` landt vandaag al op `/verlof/<id>`; alleen leest het verlofscherm dat nog niet.
- Meldingen (API): `recordUrl(view, id)` bouwt `/updates/u2` (api/_lib/meldingen.ts:129-133) en `doelUitPushUrl` laat de record-segmenten meereizen (api/_lib/meldingen.ts:115-122); elke push wordt via `meldingUitPayload` een rij in het meldingencentrum (api/push.ts:210). Vandaag gebruiken alleen updates `recordUrl` (api/_lib/recordWrites.ts:304, api/_lib/communicatieRoutes.ts:626). De pushes die een beslissing vragen sturen naar het scherm: "Nieuwe verlofaanvraag" met `viewUrl("verlof")` terwijl `next.id` in scope is (api/_lib/verlofRoutes.ts:638-644), "Dienstruil wacht op validatie" met `viewUrl("ruil-verzoeken")` (api/_lib/ruilRoutes.ts:291, 996), "Ziekmelding" met `viewUrl("ziekte")` (api/_lib/verlofRoutes.ts:158-163), "Nieuwe dienstruil-aanvraag" aan de collega met `viewUrl("ruil-verzoeken")` (api/_lib/ruilRoutes.ts:955-960). `PAD_PER_VIEW` spiegelt de routetabel en wordt bewaakt door src/lib/meldingDoel.test.ts; die tabel hoeft niet te veranderen, want het pad van het scherm blijft gelijk.

### 1.3 Drie concrete gevallen, geteld

Telling: één klik of tik per handeling; "scroll" apart vermeld. Bevestigingen zijn meegeteld waar de code ze heeft. Goedkeuren van verlof gaat zonder bevestiging (`onDecide` rechtstreeks, src/components/VerlofBeoordeling.tsx:335-343); goedkeuren van een geaccepteerde ruil ook (`handleStatusUpdate` rechtstreeks, src/views/SwapRequestsView.tsx:789; alleen "Direct goedkeuren" door een admin vraagt "Toch goedkeuren", 405-411).

**Geval A: verlofaanvraag beoordelen vanuit het dashboard (planner)**

| | Vandaag | V1 deeplinks | V2 inbox |
|---|---|---|---|
| Desktop | 1 rij in Open taken → `/verlof` (src/views/PlannerDashboardWidgets.tsx:749). 2 de juiste rij zoeken in "Wachtend op goedkeuring" (rechterkolom, lg:col-span-5, src/views/LeaveManagementView.tsx:745, 777) en aanklikken → paneel (805-808). 3 Goedkeuren. **3 klikken + zoeken op naam** (de rij toont naam en periode, geen id; bij twee aanvragen van dezelfde persoon vergelijk je de periode). | 1 rij → `/verlof/<id>`, paneel staat open met saldo, dekking, conflicten en toelichting (src/components/VerlofBeoordeling.tsx:109-110). 2 Goedkeuren. **2 klikken, geen zoeken.** | 1 "Volledig overzicht" → Overzicht (of 1 rij). 2 Goedkeuren in de rij. **2 klikken**, maar zonder de context van het beoordelingspaneel, tenzij die context in de rij herbouwd wordt. |
| Telefoon | 1 tik rij → `/verlof`. De DOM zet de linkerkolom eerst: paneel-slot plus de volledige maandkalender (src/views/LeaveManagementView.tsx:640-745), de wachtlijst staat daaronder (763). **Scroll.** 2 tik rij → SlideOver. 3 Goedkeuren. **3 tikken + scroll.** | 1 tik rij → `/verlof/<id>`, SlideOver opent. 2 Goedkeuren. **2 tikken, geen scroll.** | 1 Overzicht-rij is zelf een OpsRow-knop, een knop in een knop kan niet (src/views/WerkvoorraadView.tsx:290-292); dus rij → detail of een apart actiemenu. Geen winst op de telefoon zonder het rijrecept te breken. |

**Geval B: ruil goedkeuren vanuit een melding (planner)**

| | Vandaag | V1 deeplinks | V2 inbox |
|---|---|---|---|
| Desktop | 1 bel (src/App.tsx:1584) → `/meldingen`. 2 melding → `/dienstruil` (doel zonder id). De pagina: kop, dan het tweekolomsblok Mijn verzoeken / Openstaande dienstruilen (src/views/SwapRequestsView.tsx:493-576), dan pas "Beheer dienstruilen" met `pt-8` (678-720). **Scroll + de rij zoeken.** 3 Goedkeuren-icoon in de rij (789). **3 klikken + scroll + zoeken.** Via de push zelf: 2 klikken + scroll. | 1 bel. 2 melding → `/dienstruil/<id>`, SlideOver opent met verloop, rust en Goedkeuren in de footer (1281-1335). 3 Goedkeuren. **3 klikken, geen scroll, geen zoeken.** Via push: 2. | Melding zou naar Overzicht moeten wijzen: 1 bel, 2 melding → Overzicht, 3 Goedkeuren in de rij. **3 klikken**, en de rusttijdwaarschuwing (`RuilRust`) en het verloop (`RuilVerloop`) moeten dan ook in Overzicht komen. |
| Telefoon | Zelfde 3 tikken; de scroll is langer omdat elke plannerkaart verloop en rust uitschrijft (src/views/SwapRequestsView.tsx:820-871). | 3 tikken, SlideOver meteen open. | Zie geval A: OpsRow is een knop. |

V1 wint hier geen klik, wel het zoeken en scrollen. Dat is eerlijk gezegd de echte last: de "Beheer dienstruilen"-tabel staat onder twee andere lijsten.

**Geval C: toestel goedkeuren vanuit Vandaag of Overzicht (admin)**

Vandaag heeft geen toestellenpaneel: het scherm bestaat uit Afwezig, Open diensten, Dienstruilen en Omleidingen (src/views/VandaagView.tsx:94-220). Dit geval start dus in Overzicht.

| | Vandaag | V1 deeplinks | V2 inbox |
|---|---|---|---|
| Desktop | Overzicht heeft al een Goedkeuren-knop in de rij voor admins, zonder bevestiging (src/views/WerkvoorraadView.tsx:269-283). **1 klik.** Via de rij: 1 rij → `/beheer/toestellen`; `useStandaardKeuze` kiest het eerste item en wachtende staan vooraan (src/views/admin/DevicesView.tsx:160-176). Is dat het juiste toestel: 2 Goedkeuren. Anders 2 klik toestel, 3 Goedkeuren. **2 of 3.** | 1 rij → `/beheer/toestellen/<userId>`, groep open, toestel gekozen. 2 Goedkeuren. **2 klikken, altijd.** | Al gebouwd: 1 klik. |
| Telefoon | Geen knop in de rij (src/views/WerkvoorraadView.tsx:290-292), alleen de bulkknop vanaf 2 toestellen (214-228). 1 tik rij → toestellen; geen voorselectie op mobiel. 2 tik toestel → SlideOver. 3 Goedkeuren (302). **3 tikken.** | 1 tik rij → SlideOver van dat toestel. 2 Goedkeuren. **2 tikken.** | Kan niet in de rij (OpsRow). |

Toestellen is het enige geval waar V2 al bestaat, en precies daar is het bewust zo gedaan: "omdat dat schrijfpad geen extra context nodig heeft; verlof en ruil bewust niet in bulk" (src/views/WerkvoorraadView.tsx:28-29, CLAUDE.md regel 65).

### 1.4 Variant V1: alleen deeplinks

**Wat verandert**

1. `src/lib/werkvoorraad.ts`: `doelParams` vullen voor verlof (`[req.id]`), ruil (`[swap.id]`), toestel (`[dev.userId]`), vervaldata (`[e.userId]`), herverdelen (`[g.driverId]`), dekking (`[maand, dag]`). Dat zijn zes regels; Overzicht en zijn `open()` veranderen niet.
2. `src/views/PlannerDashboardWidgets.tsx` en `src/views/VandaagView.tsx`: dezelfde params meegeven op de rijen die er al zijn (701-763, 112, 185).
3. Vijf doelschermen lezen `useRecordParam(0, { view })` en zetten hun bestaande selectiestaat: `setReviewLeave`, `setReviewSwap`, `openDetail`, `setGekozenKey` + `openUsers`, `openBatch` of scroll. Bij een klik in de lijst schrijven ze het id terug (zoals VervaldataView.tsx:158-160), bij sluiten wissen ze het (161). Onbekend id doet niets (165-171).
4. API: `viewUrl("verlof")` → `recordUrl("verlof", next.id)` op api/_lib/verlofRoutes.ts:642; `viewUrl("ruil-verzoeken")` → `recordUrl("ruil-verzoeken", id)` op api/_lib/ruilRoutes.ts:291, 960, 996; `viewUrl("ziekte")` → `recordUrl("ziekte", target.id)` op api/_lib/verlofRoutes.ts:162. Al verstuurde meldingen zonder id blijven werken (ze landen op de lijst).
5. CLAUDE.md, sectie Routing (regel 63): de nieuwe record-routes opsommen.

**Wat NIET verandert**

- Naam, pad, tegels, chips, sortering, zoekveld en de toestel-bulk van Overzicht (src/views/WerkvoorraadView.tsx blijft functioneel identiek).
- Het dashboardpaneel blijft top-N met "Volledig overzicht"; het topbarmenu blijft een samenvatting.
- Vandaag schrijft nog steeds niets (CLAUDE.md regel 66).
- Meldingen en Updates blijven aparte schermen; het meldingencentrum hoeft niet aangepast (src/views/MeldingenView.tsx:48-57 kan het al).
- De routetabel (src/app/routes.tsx) en `PAD_PER_VIEW` (api/_lib/meldingen.ts:15-57) blijven gelijk.

**Waarom beter**

- Eén patroon overal: Omleidingen en Updates werken al zo, Vandaag doet het al voor omleidingen. De planner hoeft geen tweede beslisplek te leren.
- De beslissing gebeurt waar de context staat: saldo, dekking en conflicten voor verlof; verloop en rusttijd voor ruil; herverdeelknoppen voor ziekte. Niets wordt gedupliceerd.
- Deelbaar en herlaadbaar: "kijk deze eens na" met een link, en een refresh houdt het paneel open (dezelfde reden als bij vervaldata, src/views/admin/VervaldataView.tsx:149-152).
- De push wordt nuttig: vandaag is een push "Dienstruil wacht op validatie" een sprong naar een pagina waar je vervolgens moet zoeken.

**Risico's**

- Data-timing: het paneel kan pas openen als de lijst geladen is; VervaldataView lost dat op met `zl.laatstGeladen` (165-166). Voor verlof en ruil komt de data uit de app-context, dus een `useEffect` op `[param, leaveRequests]` volstaat.
- Verlof is voor iedereen (`rollen: IEDEREEN`, src/app/routes.tsx:63). Een chauffeur die een planner-link opent mag niets zien: `leaveRequests` bevat voor hem alleen wat de server hem geeft, dus `find` levert niets op. Toch expliciet `isPlanner` checken vóór `setReviewLeave`.
- Ruil op desktop is een SlideOver, geen inline paneel (src/views/SwapRequestsView.tsx:1281). V1 maakt dat niet anders dan "Details bekijken" vandaag; het is geen reden om de ruilpagina te herbouwen.
- Toestel-sleutel bevat het token (src/views/admin/DevicesView.tsx:51). URL op `userId`, nooit op de sleutel.
- Meldingen: `markeerMeldingenGelezenVoorScherm` vergelijkt op view-niveau en verdraagt een record-segment al (src/app/data/meldingen.ts:124-128).
- Tests: e2e `meldingen.spec.ts` en `ruil.spec.ts` kunnen op de URL na een klik asserteren; `src/lib/meldingDoel.test.ts` hoeft niet te wijzigen.

**Target state, desktop (verlof vanuit Open taken)**

```
Dashboard                                   /verlof/lr_8f2  (na één klik)
┌ Open taken ──────────────── 6 items ┐    ┌─ Verlof ─────────────────────────────────────────┐
│ ● Verlofaanvraag · Sofie De Wilde   │    │ ┌ Beoordeling: Sofie De Wilde ────┐ ┌ Wachtend ──┐│
│   ma 5 → wo 7 okt · betaald   2 u ─┼──▶ │ │ Aangevraagd op 20/09/2026        │ │ ☐ Sofie … ││
│ ● Dienstruil · Kris → Tom     3 u  │    │ │ saldo 8 d · dekking ok · 1 conflict│ │ ☐ Bram …  ││
│ ● Toestel · Bram Peeters      1 d  │    │ │ toelichting: "…"                 │ │            ││
│           Volledig overzicht →      │    │ │ [Historiek]  [Afwijzen] [Goedkeuren]│           ││
└─────────────────────────────────────┘    │ └──────────────────────────────────┘ └────────────┘│
                                           │ ┌ Kalender september ─────────────┐                │
                                           └──────────────────────────────────────────────────┘
```

**Target state, telefoon (ruil vanuit melding)**

```
/meldingen                       /dienstruil/sw_31c            SlideOver (zelfde URL)
┌──────────────────────┐        ┌──────────────────────┐      ┌──────────────────────┐
│ Vandaag              │        │ Dienstruil     [+]   │      │ ‹  Kris Maes         │
│ ● Dienstruil wacht   │  tik   │ Mijn verzoeken       │ auto │    Aangevraagd 21/09 │
│   op validatie  2 u ─┼──────▶ │ …                    │ ───▶ │ Dienst 2515 · vr 26  │
│ ○ Nieuwe verlof…     │        │ Openstaande ruilen   │      │ Kris geeft 2515      │
│                      │        │ …                    │      │ Tom geeft vrij       │
│                      │        │ Beheer dienstruilen  │      │ Rust: ok             │
│                      │        │ …                    │      │ [Afwijzen][Goedkeuren]│
└──────────────────────┘        └──────────────────────┘      └──────────────────────┘
Overzicht: ongewijzigd (tegels · chips · zoeken · lijst; een rij opent voortaan het record).
```

### 1.5 Variant V2: beslissen in Overzicht zelf (alleen ter vergelijking)

**Wat het zou zijn:** per rij in Overzicht knoppen Goedkeuren/Weigeren (verlof, ruil), Herverdelen (ziekte) en Toewijzen (open dienst), naast de bestaande toestelknop. Op mobiel kan dat niet in de rij (OpsRow is zelf een knop), dus daar een uitklap of actiemenu per rij.

**Wat het oplost:** op desktop één klik minder dan V1 voor verlof (2 → 1 vanuit Overzicht) en gelijk voor ruil. Vanuit Dashboard, Vandaag of een melding wint het niets, want die brengen je eerst naar Overzicht (of het dashboardpaneel krijgt óók knoppen, en dan het topbarmenu ook: drie plekken).

**Wat het kost:**

- De beslissing verhuist weg van haar context. Verlof heeft saldo, dekking per dag, verlofconflict met diensten, limiet en toelichting (src/components/VerlofBeoordeling.tsx:109-110); ruil heeft het verloop en de rusttijdwaarschuwing die bewust géén blokkade is (memory "Rusttijd bij dienstruil", src/views/SwapRequestsView.tsx:626, 856, 1391). Ofwel bouw je die blokken opnieuw in de Overzicht-rij (dan is Overzicht het verlofscherm geworden), ofwel beslis je blind.
- Tweede schrijfpad. Verlof heeft er nu al twee (paneel en bulkselectie) en dat kostte op 22-09 een dubbele fix (#595/#596, memory handoff). Een derde plek verdriedubbelt dat.
- Het breekt de eigen regel: "Bulk alleen waar geen context nodig is (toestellen goedkeuren)" (CLAUDE.md regel 65) en "Elke rij die een beslissing vraagt brengt je naar het scherm waar je beslist" (regel 66, over Vandaag).
- Overzicht wordt inhoudelijk een inbox, ook zonder naamsverandering; het dashboardpaneel en het topbarmenu tonen dezelfde rijen zonder knoppen en gaan er anders uitzien dan het scherm waar ze naar verwijzen.

**Wireframe V2 (desktop, ter vergelijking)**

```
┌ Overzicht ────────────────────────────────────────────────────────────┐
│ Soort      Wat                                  Wanneer   Actie       │
│ Verlof     Verlofaanvraag · Sofie De Wilde      2 u      [✗] [✓]      │
│            ma 5 → wo 7 okt · betaald verlof               (blind: geen │
│ Dienstruil Dienstruil · Kris → Tom              3 u      [✗] [✓] saldo/rust)│
│ Toestel    Toestel wacht · Bram Peeters         1 d      [Goedkeuren] │
└───────────────────────────────────────────────────────────────────────┘
```

### 1.6 Aanbeveling Onderdeel 1

V1. Het is klein (zes regels in werkvoorraad.ts, drie regels API, vijf schermen die een bestaande zetter aan de URL hangen), het raakt de naam noch de rol van Overzicht, en het haalt per geval één klik en het zoeken/scrollen weg. Begin met de twee die niets kosten: vervaldata (route bestaat, alleen `doelParams`) en Vandaag → ruil (`r.swap.id` ligt klaar). Toestellen op desktop is met de rijknop al één klik; daar verandert V1 alleen de telefoon (3 → 2). V2 niet doen: het wint hooguit één klik op desktop en betaalt met gedupliceerde beslislogica en een derde schrijfpad voor verlof.

---

## Onderdeel 2: Dienstruil in het chauffeursdock

### 2.1 Wat er vandaag is

- Dock chauffeur: Dashboard · Mijn dag · Rooster · Omleidingen · Verlof, plus Meer (src/components/BottomNav.tsx:76, 155-178). Verlof draagt `unseenLeaveCount` (beslissingen); Meer draagt een dot zonder getal wanneer een ruil op het antwoord van de chauffeur wacht (`moreDot`, src/App.tsx:1054-1058, 1681; src/components/BottomNav.tsx:171-173, 8×8 px).
- In de Meer-sheet krijgt Dienstruil het getal wél (`targetedSwapsCount`, src/App.tsx:1437).
- Ruilen vanuit het rooster bestaat: in de lijstweergave (standaard, tenzij de chauffeur "maand" koos, src/views/ScheduleView.tsx:121-126) heeft elke komende dienst een knop "Deze dienst ruilen" (mobiele kaart, src/views/ScheduleView.tsx:809) of "Ruilen" (desktoptabel, 727); in de maandweergave staat de knop in de dagkaart onder het grid (631-633). De knop verdwijnt zodra er al een ruil loopt (`g.openSwap`) en wordt bij een verlofconflict de uitweg "Open dienstruil" (88-103, 693, 768). De klik zet `swapPreselectShiftId` en gaat naar Dienstruil (src/app/SchermInhoud.tsx:75), waar de wizard meteen op stap 2 opent (src/views/SwapRequestsView.tsx:243-257).
- De wizard heeft na stap 1 nog drie verplichte tikken: collega (stap 2 → 3 op 1070-1076), tegenprestatie (`returnPick` verplicht, 1258, met de uitleg "Kies eerst wat je van … overneemt" op 1268) en "Ruilverzoek versturen" (1263).
- Mijn dag heeft geen ruilactie: de acties zijn Ritblad en Defect melden (src/views/MijnDagView.tsx:290, 295), Omleidingen (429) en Rooster (440, 452). Het toont wel de badge "Geruild met X" (265-266). Mijn week-cellen zijn bewust geen knoppen (src/components/MijnWeek.tsx:14-16).
- Dashboard heeft de snelactie "Dienstruil" naar het scherm (src/views/DashboardView.tsx:474); `QuickAction` kent geen badge (src/components/ops.tsx:254-264). Geen paneel of tegel toont een inkomend verzoek.
- Rooster toont alleen de eigen lopende ruil (`openSwapByShiftId`, src/views/ScheduleView.tsx:153-164), niet een verzoek van een collega.
- Signaal van een inkomend verzoek: push "Nieuwe dienstruil-aanvraag" naar de collega (api/_lib/ruilRoutes.ts:955-960), dezelfde tekst als rij in het meldingencentrum (api/push.ts:210) met teller op de bel (src/components/MeldingenBel.tsx:46-51, ook op de telefoon: de topbar is sticky op alle maten, src/App.tsx:1494-1495), app-icoonbadge = ongelezen meldingen (src/App.tsx:1091-1095), en de dot op Meer. Uit de code zelf: "push bereikt bijna niemand" (src/views/SwapRequestsView.tsx:303).
- Antwoorden: op `/dienstruil` staat "Openstaande dienstruilen" met Accepteren/Weigeren inline (src/views/SwapRequestsView.tsx:577, 627-634), gevolgd door een bevestiging (`confirmText: 'Accepteren'`, 423). Op de telefoon staat de kolom "Mijn verzoeken" eerst (493-495); die is tot 420 px hoog als de chauffeur eigen verzoeken heeft (499) en één regel als hij er geen heeft (560-565).

### 2.2 Tikken vandaag (telefoon, chauffeur)

**Ruil aanvragen**

| Vertrekpunt | Tikken | Telling |
|---|---|---|
| Rooster, lijstweergave | Rooster · Deze dienst ruilen · collega · tegenprestatie · versturen | **5** |
| Rooster, maandweergave | Rooster · dag · Deze dienst ruilen · collega · tegenprestatie · versturen | **6** |
| Dashboard-snelactie | Dienstruil · Dienstruil aanvragen · dienst · collega · tegenprestatie · versturen | **6** |
| Meer | Meer · Dienstruil · Dienstruil aanvragen · dienst · collega · tegenprestatie · versturen | **7** |
| Mijn dag | geen pad | n.v.t. |

De ondergrens is 4 (ingang + collega + tegenprestatie + versturen), zolang de wizard drie verplichte keuzes houdt. Het rooster zit op 5. Het dock is dus niet de bottleneck voor aanvragen.

**Inkomend verzoek beantwoorden**

| Vertrekpunt | Tikken | Telling |
|---|---|---|
| Push aantikken | push · Accepteren · bevestigen | **3** |
| Bel | bel · melding · Accepteren · bevestigen | **4** |
| Meer | Meer · Dienstruil · (scroll voorbij Mijn verzoeken) · Accepteren · bevestigen | **4 + scroll** |
| Dashboard | Dienstruil-snelactie · (scroll) · Accepteren · bevestigen | **3 + scroll**, maar niets op het dashboard zegt dat er iets wacht |
| Rooster / Mijn dag | geen signaal, geen pad | n.v.t. |

Het echte probleem zit hier: buiten de push (die "bijna niemand bereikt") en een dot van 8 px op Meer is er geen zichtbaar signaal op de vier schermen waar een chauffeur wél komt.

### 2.3 Optie O1: Dienstruil permanent in het dock

**Wat:** vijfde tab wordt Dienstruil met badge `targetedSwapsCount`. Vervangen kan alleen Omleidingen of Verlof; Dashboard, Mijn dag en Rooster zijn de kern. Zes tabs plus Meer is geen optie: het dock is ontworpen op vijf (src/components/BottomNav.tsx:17), de labels "Omleidingen" en "Vervaldata" drukten op smalle toestellen al de Meer-tab uit de kaart (118-123) en onder 340 px verdwijnen labels nu al in `sr-only` (155).

Kandidaat 1: Omleidingen eruit. Omleidingen staan ook in Mijn dag (src/views/MijnDagView.tsx:429) en op het dashboard als tegel en paneel (src/views/DashboardView.tsx:292, 349). Maar het is veiligheidsinformatie die een chauffeur meerdere keren per dag opent, en een dienstruil is een handeling van een paar keer per maand.
Kandidaat 2: Verlof eruit. Verlof kwam bewust in de plaats van Updates omdat de badge daar verlofbeslissingen telt (src/components/BottomNav.tsx:80). Verlof aanvragen is frequenter dan ruilen.

**Tikken straks:** aanvragen via de tab = Dienstruil · Dienstruil aanvragen · dienst · collega · tegenprestatie · versturen = **6**, dus slechter dan het rooster (5). Beantwoorden = Dienstruil · Accepteren · bevestigen = **3**, en de badge met getal is altijd in beeld.

**Wat verandert:** BottomNav-slots (src/components/BottomNav.tsx:76), de rolcommentaar in CLAUDE.md regel 69, e2e `dock.spec.ts`, `mobiele-navigatie.spec.ts` en `a11y.spec.ts` die de tabs benoemen.

**Waarom beter:** één plek, altijd zichtbaar, getal in plaats van dot.
**Risico's:** je ruilt dagelijkse informatie (omleidingen) of een frequentere handeling (verlof) in voor een zeldzame; de aanvraagflow wordt er niet korter van; het dock wordt drukker zonder dat de wizard korter wordt.

```
O1 dock:  [Dashboard] [Mijn dag] [Rooster] [Dienstruil ①] [Verlof] [Meer]
                                            ▲ Omleidingen naar Meer
```

### 2.4 Optie O2: contextueel, plus een duidelijk inkomend-signaal

**Wat:**

1. Aanvragen blijft vanuit de dienst zelf. Het rooster heeft het al (5 tikken). Toevoegen in Mijn dag: een derde, stille actie "Ruilen" bij de dienst van de getoonde dag (naast Ritblad en Defect melden, src/views/MijnDagView.tsx:281-297), met dezelfde `onRequestSwap(shiftId)` als het rooster (src/app/SchermInhoud.tsx:75). Alleen tonen als er delen zijn, geen ruil loopt en er geen conflict is, precies de voorwaarden van het rooster (src/views/ScheduleView.tsx:631). Mijn week blijft zonder knoppen (dat is een bewuste keuze van 22-09); voor een dienst verder dan morgen ga je naar het rooster, dat op Mijn dag al één tik is (440).
2. Inkomend signaal waar de chauffeur komt:
   - Dashboard: een paneel "Wacht op jouw antwoord" dat alleen bestaat als `targetedSwapsCount > 0`, met per verzoek één OpsRow ("Kris wil dienst 2515 met je ruilen · vr 26 sep") die naar `/dienstruil/<id>` gaat (de deeplink uit Onderdeel 1, die de kaart met Accepteren/Weigeren in beeld scrolt). Het paneel verdwijnt zodra het beantwoord is: rusttoestand is stilte, zoals bij Open taken (src/views/PlannerDashboardWidgets.tsx:767-769).
   - Dashboard-snelactie "Dienstruil" krijgt een badge (`QuickAction` uitbreiden met `badge?: number`, src/components/ops.tsx:254-264).
   - Meer-tab: het getal in plaats van de dot (`moreDot` → `moreBadge`, src/components/BottomNav.tsx:171-173), hetzelfde getal dat de sheet al toont (src/App.tsx:1437).
   - Rooster: geen badge op de tab (een ruilverzoek is geen roostergebeurtenis) en geen markering in de lijst, tenzij de gevraagde dag een eigen dienst raakt; dat is een verfijning voor later.

**Tikken straks:**
- Aanvragen voor vandaag/morgen vanuit Mijn dag: Mijn dag · Ruilen · collega · tegenprestatie · versturen = **5**, gelijk aan het rooster, maar vanuit het broekzakscherm en zonder de dienst te zoeken. Voor andere dagen blijft het rooster op 5.
- Beantwoorden vanuit Dashboard (startscherm): rij in "Wacht op jouw antwoord" · Accepteren · bevestigen = **3**, en de app opent al op het dashboard, dus de eerste tik is meteen de rij. Via Meer: Meer · Dienstruil · Accepteren · bevestigen blijft 4, maar nu met getal.

**Wat verandert:** MijnDagView (één knop, één prop `onRequestSwap` via SchermInhoud), DashboardView (één conditioneel paneel + badge op de snelactie), ops.tsx (badge-prop), BottomNav (getal i.p.v. dot), App.tsx (targetedSwapsCount doorgeven i.p.v. boolean). SwapRequestsView leest `/dienstruil/<id>` (Onderdeel 1). Het dock zelf, de routetabel en de wizard veranderen niet.

**Waarom beter:** de handeling staat bij de dienst (waar de chauffeur de ruil bedenkt), het verzoek staat op het startscherm (waar hij het niet kan missen), en het dock blijft de vijf dagelijkse schermen. Het is ook wat de ontwerpregel al zegt: elementen tonen wat er speelt en brengen je naar de plek waar je handelt.

**Risico's:** ontdekbaarheid van de aanvraagknop voor wie nooit in Mijn dag of Rooster kijkt (maar die tikt dan ook geen Dienstruil-tab). Een paneel dat verschijnt en verdwijnt kan het dashboard laten verspringen; het paneel bovenaan zetten, vóór de tegels, voorkomt dat de tegels schuiven. De bevestigingsstap (4e tik) blijft; die is een productkeuze, geen navigatiekwestie.

```
O2, telefoon

Dashboard (start)                    Mijn dag
┌──────────────────────────┐         ┌──────────────────────────┐
│ Goeiemorgen, Tom         │         │ Vandaag | Morgen         │
│ ┌ Wacht op jouw antwoord ┐│         │ ┌ 2515 ┐ 06:12–14:40      │
│ │ ● Kris wil 2515 ruilen ││ ─▶ /dienstruil/sw_31c             │
│ │   vr 26 sep · jij: vrij ││         │ [Ritblad]  [Defect melden]│
│ └────────────────────────┘│         │            [⇄ Ruilen]    │  ─▶ wizard stap 2
│ ┌ Vandaag ┐ ┌ Volgende ┐  │         │ ── tijdlijn ──           │
│ …                         │         │ Mijn week  (geen knoppen)│
│ [Rooster] [Verlof]        │         └──────────────────────────┘
│ [Defect]  [Dienstruil ①]  │
└──────────────────────────┘
Dock ongewijzigd: [Dashboard] [Mijn dag] [Rooster] [Omleidingen] [Verlof] [Meer ①]
```

### 2.5 Optie O3: hybride

**Wat:** O2 volledig, plus Dienstruil in het dock in de plaats van Omleidingen, met Omleidingen als tegel/paneel op Dashboard en Mijn dag (waar het al staat).

**Tikken:** beantwoorden 3 vanuit Dashboard én 3 vanuit de tab; aanvragen 5 (Mijn dag/Rooster) of 6 (tab). Winst tegenover O2: nul tikken, één extra ingang.
**Kost:** alles van O1 (omleidingen naar de tweede rij, dock-tests, CLAUDE.md-regel) bovenop O2. Het levert een tweede plek voor hetzelfde signaal op, terwijl O2 het signaal al op het startscherm zet.

### 2.6 Aanbeveling Onderdeel 2

O2 volstaat, en dat is meetbaar: aanvragen is met 5 tikken vanuit het rooster al op één tik van de ondergrens (4) en een docktab maakt het 6; beantwoorden zakt met O2 van 4 (+ scroll) naar 3 vanaf het startscherm, hetzelfde als O1 zou geven. Het gat vandaag is niet de plek in het dock maar het ontbreken van een zichtbaar verzoek op Dashboard, Mijn dag en Rooster en een dot zonder getal op Meer. Doe O2 in deze volgorde: (1) getal op Meer, (2) paneel "Wacht op jouw antwoord" op het dashboard met de `/dienstruil/<id>`-deeplink, (3) badge op de snelactie, (4) knop Ruilen op Mijn dag. Zet O1/O3 pas op tafel als na een paar weken blijkt dat chauffeurs verzoeken toch laten liggen, en kies dan Omleidingen als slachtoffer, nooit Verlof.

---

## Samenvatting voor Jarno

- Overzicht hoeft niet hernoemd en niet omgebouwd. De winst zit in het id in de link: rijen en pushes wijzen vandaag naar het scherm, terwijl router, meldingencentrum en drie doelschermen een record-URL al kunnen dragen. Verlof vanuit dashboard: 3 → 2 klikken en geen scroll op de telefoon; ruil vanuit melding: geen klik minder, wel geen zoeken en scrollen; toestel op de telefoon: 3 → 2.
- Beslissen in Overzicht zelf (V2) wint hooguit één klik op desktop en kost gedupliceerde beoordelingscontext en een derde schrijfpad voor verlof. Niet doen.
- Dienstruil in het dock lost het verkeerde probleem op: aanvragen zit al op 5 tikken vanuit het rooster (ondergrens 4), een tab maakt dat 6. Beantwoorden is het probleem (4 tikken, signaal is een dot zonder getal). O2 brengt dat naar 3 vanaf het startscherm zonder een dagelijkse tab op te offeren.
