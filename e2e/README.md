# E2E (Playwright)

Rooktests en flow-tests op de **échte gebouwde app**, zonder testaccount of
backend: de sessie wordt vóór het laden in localStorage gezet en elke
`/api/**`-call wordt met fixtures beantwoord (`page.route`). Draait lokaal én
in de GitHub-CI (`.github/workflows/ci.yml`, job `checks`).

## Draaien

```bash
npx playwright install chromium   # eenmalig, lokaal
npm run test:e2e                  # bouwt + serveert (poort 4173) + test
npm run test:e2e:ui               # interactieve UI-modus
npx playwright test e2e/desktop.spec.ts e2e/a11y.spec.ts   # alleen desktop + a11y
```

De config (`playwright.config.ts`) bouwt de app met dummy-Supabase-env zodat het
loginscherm rendert i.p.v. de "configuratie ontbreekt"-melding, en serveert de
dist via `vite preview` op poort 4173.

## Projecten

| Project | Viewport | Specs |
|---|---|---|
| `iPhone 13 (chromium)` | iPhone 13 | alle specs behalve `desktop.spec.ts` |
| `Desktop (chromium)` | 1440×900 | `desktop.spec.ts`, `a11y.spec.ts` |

- **Mobiele specs** (`smoke`, `dashboard`, `verlof`, `ruil`, `sessie`, `dock`,
  `donker`): elk met eigen, kleine fixtures — ze testen één schrijfpad en
  willen precies weten wat er in de POST/PATCH zit.
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

Op elke PR schiet `scripts/visueel-ci.mjs` zes sleutelschermen (desktop:
admin-dashboard, gebruikers, maandplanning; iPhone/WebKit: chauffeur-dashboard,
rooster, verlof — licht thema) op de PR-branch én op de basis-branch, en
vergelijkt ze per pixel (pngjs, geen Python). Boven **1,5 % per scherm** faalt
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
