# E2E (Playwright)

Rooktests en flow-tests op de **échte gebouwde app**, zonder testaccount of
backend: de sessie wordt vóór het laden in localStorage gezet en elke
`/api/**`-call wordt met fixtures beantwoord (`page.route`). Draait lokaal én
in de GitHub-CI (`.github/workflows/ci.yml`, job `checks`).

## Draaien

```bash
npx playwright install chromium webkit   # eenmalig, lokaal
npm run test:e2e                  # bouwt + serveert (poort 4173) + test
npm run test:e2e:ui               # interactieve UI-modus
npx playwright test e2e/desktop.spec.ts e2e/a11y.spec.ts   # alleen desktop + a11y
```

De config (`playwright.config.ts`) bouwt de app met dummy-Supabase-env zodat het
loginscherm rendert i.p.v. de "configuratie ontbreekt"-melding, en serveert de
dist via `vite preview` op poort 4173.

## iPhone Duo voor planner en beheerder

De volgende reeks test de Safari-venstermaten, het vouwen met een open
formulier, de Maandplanning en de bediening van de bovenbalk. Ze gebruikt de
gebouwde app met testgegevens. De tests voor het buitenscherm geven de veilige
zone links of rechts expliciet mee.

```sh
npx playwright test e2e/duo.spec.ts e2e/datumveld-positie.spec.ts e2e/maandplanning-weergave.spec.ts e2e/mobiele-navigatie.spec.ts
```

Controleer in Xcode Device Hub dezelfde handelingen in Safari op een testversie
met een planneraccount. Herhaal het vouwen ook vanuit de geïnstalleerde webapp
om de systeemstroken en de terugknop te beoordelen.

| Begin | Handeling | Verwacht |
|---|---|---|
| Maandplanning, buitenscherm | Kies een dag buiten de getoonde twee weken, open een cel en typ een notitie. Vouw open, draai naar liggend en vouw opnieuw dicht. | Het raster bevat de gekozen dag. Dezelfde cel en conceptnotitie blijven open. Alleen ‘Notitie opslaan’ schrijft. |
| Maandplanning, volledig open binnenscherm | Blader liggend naar twee andere weken. Draai naar staand en terug. Herhaal met een open dienst en een conceptnotitie. | De daglijst start binnen de gekozen periode. Liggend keren dezelfde veertien dagen terug. De dienst en het concept blijven open. |
| Beheer planning of Werkprestaties, binnenscherm | Open de maand- of dagkiezer en wissel naar het liggende buitenscherm. | De actieve keuze blijft behouden en de bovenste en onderste bediening zijn bereikbaar. |
| Vandaag, binnenscherm | Open een gevulde meldingenlijst en vouw dicht. Probeer Terug. Open de lijst opnieuw en kies ‘Alle meldingen’. | Terug sluit de lijst op Vandaag. De laatste actie is boven het dock aantikbaar. |
| Dashboard, staand buitenscherm | Heropen als beheerder, kies ‘Bekijk als chauffeur’ en schakel terug. | De planner benut de vrije kant van het scherm. De chauffeursweergave volgt haar bestaande marges. |
| Maandplanning, liggend binnenscherm | Tik op het midden van de accountknop, naast de iOS-klok. | Het accountmenu opent. Alle veertien dagkolommen blijven beschikbaar voor de planning. |

### Metingen op de Xcode iPhone Duo met iOS 27.2 · 27 november 2026

De interactieve meting gebruikte lokaal gebouwde portaalschermen in een
WKWebView met fictieve accounts en diensten. In de maandplanning bleef de
onopgeslagen notitie bij dienst 2106 op 6 oktober behouden tijdens halfopen
vouwen, volledig openen, draaien en sluiten. De gesloten daglijst, het brede
raster en de teruggekeerde daglijst hadden elk 0 px horizontale overloop.

Met de Duo volledig open bleef ook de handmatig gekozen periode van 9 tot
en met 22 november behouden. Staand opende de daglijst op maandag 9 november.
Na terugdraaien waren alle veertien dagkolommen weer zichtbaar. Bij dezelfde
rotatie bleef de conceptnotitie bij dienst 2109 intact. Het aparte venster
‘Maandoverzicht’ behield november, de 60 chauffeurs en de aflopende naamsortering.

Met 60 chauffeurs toonde het brede scherm alle 14 dagkolommen van 23 november
tot en met 6 december. Op het buitenscherm leverde zoeken naar chauffeur 60
één dienst op. Na openvouwen bleef die chauffeur als enige rij in het raster.
Op het liggende buitenscherm was de knop ‘Alle meldingen’ direct aantikbaar,
31 px boven de navigatie. Een tik opende het volledige meldingenscherm.

Op het brede scherm mat WebKit rechts een systeemzone van 84 px. De
accountknop van de beheerder eindigde op de grens bij x=867 en opende bij
aantikken het accountmenu. Op het staande buitenscherm had de beheerder
16 px links en 84 px rechts. Bij ‘Bekijk als chauffeur’ was dat 84 px aan
beide kanten. Terugschakelen herstelde de beheerderindeling.

In één vouwcyclus met 60 chauffeurs verstreken na het laatste resize-event
151 ms bij sluiten en 197 ms bij openen tot twee opeenvolgende animatieframes
de verwachte lijst of het raster toonden. Dit meet de lay-outwissel in de
simulator op deze Mac. De fysieke vouwanimatie en de beeldsnelheid op een
toestel zijn afzonderlijke metingen.

Een afzonderlijke meetpagina in de Safari-app gaf 382 × 580 px op het staande
buitenscherm en 951 × 537 px bij een open binnenscherm met zichtbare tabbladen.
Een eindcontrole van de geïnstalleerde webapp met een echte testsessie staat nog open.

## Projecten

| Project | Viewport | Specs |
|---|---|---|
| `iPhone 13 (chromium)` | iPhone 13 | alle specs behalve `desktop.spec.ts` en `pwa.spec.ts` |
| `iPhone 13 (webkit)` | iPhone 13 | `mobiele-navigatie.spec.ts`, `dock-transitie.spec.ts` |
| `Desktop (chromium)` | 1440×900 | `desktop.spec.ts`, `a11y.spec.ts` |
| `pwa` | iPhone 13, **service worker aan** | alleen `pwa.spec.ts`; apart via `npm run test:e2e:pwa` |

- **`pwa.spec.ts`** (golf 4): de enige spec mét service worker. Registratie +
  `GET_VERSION`, koude offline start van Mijn dag, Rooster en Maandplanning
  uit de cache `vhb-ritbladen` (met het stille offline-label op Mijn dag) en
  de update-flow (nieuwe worker → "Vernieuw"-toast → `SKIP_WAITING` →
  herlaad). Mocks via `context.route`, want fetches van de SW zelf horen bij
  de context, niet bij de pagina. In CI een eigen stap ("E2E PWA") van de
  verplichte job e2e (1/3), blokkerend sinds 09-10. Wat niet e2e te testen is
  (échte nieuwe build, ritblad-PDF uit storage, push, trage-netwerk-timeout,
  iOS-standalone) staat in de kop van de spec; dat blijft de handmatige
  PWA-checklist + `src/lib/swRitbladen.test.ts`.
- Poort: `E2E_PORT=4201 npx playwright test --project=pwa` voor een parallelle
  sessie; alle specs (ook `dock.spec.ts` met zijn eigen contexts) volgen de
  poort uit de config.

- **`bijlage-viewer.spec.ts`** (29-09): PDF-bijlagen van omleidingen en
  updates openen in de app, op de telefoon (Chromium en WebKit) en op desktop:
  echte pdfjs-render, Terug sluit alleen de viewer, "Extern openen" is de oude
  weg, een verlopen of falende link geeft de foutstaat. Bewaren, openen zonder
  bereik, vervangen en uitloggen staan in `pwa.spec.ts` (mét service worker).

- **`document-viewer.spec.ts`** (29-09): persoonlijke documenten (loonbrieven,
  attesten) openen in de app, op de telefoon (Chromium en WebKit) en op
  desktop: Terug sluit alleen de viewer, de leesbevestiging pas als de PDF in
  beeld staat (nooit bij een mislukte opening of vanuit het beheer), een foto
  gaat de oude weg, zonder bereik een foutstaat met uitleg. Dat er niets in
  Cache Storage, localStorage, sessionStorage of IndexedDB belandt en dat de
  viewer met no-store haalt, staat in `pwa.spec.ts` (mét service worker), net
  als de vervanging van een bijlage met dezelfde naam en grootte (uploadmoment).

- **`uitloggen.spec.ts`** (02-10): afmelden op een gedeeld toestel, in Chromium
  en WebKit. Twee gebruikers met een eigen auth-id en token; aanmelden gaat via
  het echte formulier, want afmelden herlaadt de pagina en een init-script dat
  de sessie bij elke laadbeurt zet, meldt dan meteen weer aan (voor specs met
  een sessie vooraf: `sessieInitScript` met `eenmalig`). Wat erin staat: de
  herlaad na de knop, na een gedwongen uitlog, na inactiviteit en na een
  SIGNED_OUT van elders (met de uitleg op het inlogscherm), een laat antwoord
  van de eerste gebruiker dat niet bij de tweede belandt, de privé-caches weg
  en de schil niet, en waar níét herladen wordt: koude start, start met een
  verlopen sessie, uitnodiging, wachtwoordherstel, afmelden zonder bereik (met
  het `offline`-event, niet met `context.setOffline`: met een echt afgesloten
  netwerk mislukt het voorladen bij het accountmenu en herlaadt lazyRetry de
  pagina 0,8 s later, wat op Linux WebKit de volgende aanmelding brak). Ook:
  afmelden met een verlopen token terwijl de aanmeldserver onbereikbaar is (de
  sessie gaat toch uit de opslag; `page.clock` slaat de herkansingen van
  Supabase over). De service-worker-kant (afmelden zonder bereik uit de schil,
  een laat antwoord dat de cache niet opnieuw vult, geen profiel van de vorige
  uit de cache, en het toestel van vóór deze regel dat zonder bereik gewoon
  Mijn dag opent) staat in `pwa.spec.ts`.

- **Mobiele specs** (`smoke`, `dashboard`, `verlof`, `ruil`, `sessie`, `dock`,
  `donker`): elk met eigen, kleine fixtures — ze testen één schrijfpad en
  willen precies weten wat er in de POST/PATCH zit.
- **Mobiele navigatieregressies** draaien in Chromium én WebKit: dashboard-
  scroll na het sluiten van een tegel en herladen, omleidingen sluiten via
  kruisje of Terug, en de dock-lagen tijdens een echte View Transition.
  Chromium vergelijkt ook de pixels van de gekozen dock-tab. WebKit-
  screenshots missen de live nieuwe lagen van fixed elementen tijdens de
  overgang (ook in een minimale HTML-repro); daar controleren we de
  laaginstellingen. iOS-standalone blijft een handmatige controle op een toestel.
- **`desktop.spec.ts`**: de `lg+`-layouts die mobiel niet bestaan —
  master-detail Omleidingen, sorteren (`aria-sort`) en bulk-selectie in de
  gebruikerslijst, paginering van het activiteitenlog (60 rijen → pagina 2).
- **`a11y.spec.ts`**: axe-core (WCAG 2.1 AA) op login, chauffeur-dashboard,
  rooster, verlof, admin-dashboard en gebruikers — op iPhone én desktop.
  `serious`/`critical` laten de test falen; `moderate`/`minor` komen als
  annotatie en in de console. Bestaande AA-fouten die buiten een ronde vallen
  staan tijdelijk in `TIJDELIJK_UIT` mét reden per regel — haal ze eruit zodra
  de view gefixt is.

`desktop.spec.ts` en `a11y.spec.ts` gebruiken de gedeelde fixtures uit
`scripts/audit-fixtures.mjs` (via `e2e/helpers.ts`) — dezelfde data als de
visuele audits, zodat een nieuw veld overal tegelijk zichtbaar wordt.

## Visuele regressie (CI-job `visueel`)

Op elke PR schiet `scripts/visueel-ci.mjs` de sleutelschermen uit zijn lijst
`SCHERMEN` (sinds 20-09 achttien, met Rapporten erbij: desktop admin-dashboard, gebruikers,
maandplanning, werkvoorraad, designsysteem, dienstopbouw, dagafsluiting,
looncontrole; desktop technieker gele boek, werkprestaties, voertuigen;
Mijn dag op desktop én iPhone; iPhone/WebKit chauffeur-dashboard, rooster,
verlof — licht thema) op de PR-branch én op de basis-branch, en vergelijkt ze
per pixel (pngjs, geen Python). Er zijn geen baselines in de repo: de
basis-branch is de referentie, een nieuw scherm staat één PR lang op "nieuw". Boven **1,5 % per scherm** faalt
de job niet: de tabel staat in de job-samenvatting en de diff-afbeeldingen
(basis | branch | verschil in rood) in het artifact `visuele-regressie`.

Lokaal, met een gebouwde `dist` (dummy-env zoals hierboven):

```bash
VITE_SUPABASE_URL=http://localhost:4173 VITE_SUPABASE_ANON_KEY=e2e npm run build
node scripts/visueel-ci.mjs schiet --out /tmp/visueel/kop            # deze branch
node scripts/visueel-ci.mjs schiet --app ../basis --out /tmp/visueel/basis   # andere checkout
node scripts/visueel-ci.mjs vergelijk /tmp/visueel/basis /tmp/visueel/kop --out /tmp/visueel/verschil
```

Voor de bredere audit (alle schermen, dark, Android) blijft
`scripts/mobile-audit.mjs` + `scripts/screenshot-diff.py` bestaan.
