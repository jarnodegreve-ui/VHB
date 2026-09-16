import { defineConfig, devices } from '@playwright/test';

/**
 * E2E-smoke voor het VHB-portaal — iPhone-first, plus een desktop-project en
 * (sinds golf 4) een pwa-project mét service worker.
 *
 * Draait lokaal (`npm run test:e2e`) én in de GitHub-CI (.github/workflows/
 * ci.yml) — sinds de mocks (sessie in localStorage + page.route-fixtures) is
 * er geen testaccount of backend meer nodig. Boot de échte gebouwde app op
 * een iPhone-viewport (alle mobiele specs) en op 1440×900 (desktop.spec.ts:
 * master-detail, tabellen, paginering). a11y.spec.ts draait op beide.
 *
 * Het project `pwa` (alleen e2e/pwa.spec.ts, `npm run test:e2e:pwa`) laat de
 * service worker wél toe: registratie, koude offline start van Mijn dag uit
 * de SW-cache en de update-flow met de "Vernieuw"-toast. Het draait apart en
 * in CI niet-blokkerend (zie ci.yml), omdat SW-gedrag in headless Chromium
 * op een gedeelde runner nog niet bewezen stabiel is.
 *
 * Eenmalig lokaal: `npx playwright install chromium webkit`.
 */

// E2E_PORT: parallelle sessies/worktrees kiezen elk een vrije poort (4173 blijft de standaard).
const PORT = Number(process.env.E2E_PORT) > 0 ? Number(process.env.E2E_PORT) : 4173;

/** Specs die alleen op het desktop-project horen (én a11y, dat op beide draait). */
const DESKTOP_SPECS = /(desktop|a11y|omleidingen-layout|ziekte-overzicht|ritblad-zoom)\.spec\.ts$/;
/** Specs die NIET op het mobiele standaardproject horen: desktop-only en de pwa-spec. */
const NIET_MOBIEL = /(desktop|pwa)\.spec\.ts$/;
const PWA_SPEC = /pwa\.spec\.ts$/;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',

  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'on-first-retry',
    // Service worker blokkeren: die onderschept anders de GET-calls naar
    // /api/**, waardoor page.route-mocks niet aankomen en de test op de
    // SPA-fallback (index.html) stuit. We testen hier de app, niet de sw —
    // het sw-gedrag zelf zit in het project `pwa` hieronder (context.route
    // i.p.v. page.route, want Playwright routeert SW-fetches op contextniveau).
    serviceWorkers: 'block',
  },

  projects: [
    {
      // De mobiele regressies ook in Safari's engine: focus, History API en
      // view-transition-lagen gedragen zich daar anders dan in Chromium.
      name: 'iPhone 13 (webkit)',
      testMatch: /(mobiele-navigatie|dock-transitie|activiteit-layout|beheer-dienstoverzicht-layout|omleidingen-layout|ziekte-overzicht|ritblad-zoom)\.spec\.ts$/,
      use: { ...devices['iPhone 13'], browserName: 'webkit' },
    },
    {
      // De volledige mobiele suite in Chromium; de regressies hierboven
      // draaien aanvullend in WebKit.
      name: 'iPhone 13 (chromium)',
      testIgnore: NIET_MOBIEL,
      use: {
        ...devices['iPhone 13'],
        browserName: 'chromium',
        defaultBrowserType: 'chromium',
      },
    },
    {
      // Desktop 1440×900: de lg+-layouts (master-detail, tabel i.p.v.
      // kaartlijst). Alleen desktop.spec.ts en a11y.spec.ts.
      name: 'Desktop (chromium)',
      testMatch: DESKTOP_SPECS,
      use: {
        browserName: 'chromium',
        viewport: { width: 1440, height: 900 },
        deviceScaleFactor: 1,
      },
    },
    {
      // PWA: dezelfde iPhone-emulatie, maar mét service worker. Alleen
      // pwa.spec.ts; niet in `npm run test:e2e` (zie package.json) zodat
      // een flaky SW-run de gewone smoke niet rood kleurt.
      name: 'pwa',
      testMatch: PWA_SPEC,
      use: {
        ...devices['iPhone 13'],
        browserName: 'chromium',
        defaultBrowserType: 'chromium',
        serviceWorkers: 'allow',
      },
    },
  ],

  // Bouwt de app met dummy-Supabase-env (zodat het loginscherm rendert i.p.v.
  // de "configuratie ontbreekt"-melding) en serveert de dist via vite preview.
  webServer: {
    // E2E_SKIP_BUILD=1: alleen serveren. Uitsluitend voor een tweede run
    // direct ná een run met dezelfde env in dezelfde job (CI: de pwa-stap na
    // de smoke), zodat de app niet twee keer gebouwd wordt. Lokaal niet
    // gebruiken tenzij je zeker weet dat dist met de dummy-env gebouwd is.
    command: process.env.E2E_SKIP_BUILD === '1'
      ? `npm run preview -- --port ${PORT} --strictPort`
      : `npm run build && npm run preview -- --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    // Altijd vers bouwen: Vite bakt import.meta.env tijdens de build in, dus een
    // hergebruikte server kan met de verkeerde (of ontbrekende) env gebouwd zijn.
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      VITE_SUPABASE_URL: `http://localhost:${PORT}`,
      VITE_SUPABASE_ANON_KEY: 'e2e-dummy-anon-key',
    },
  },
});
