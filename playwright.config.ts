import { defineConfig, devices } from '@playwright/test';

/**
 * E2E-smoke voor het VHB-portaal — iPhone-first, plus een desktop-project.
 *
 * Draait lokaal (`npm run test:e2e`) én in de GitHub-CI (.github/workflows/
 * ci.yml) — sinds de mocks (sessie in localStorage + page.route-fixtures) is
 * er geen testaccount of backend meer nodig. Boot de échte gebouwde app op
 * een iPhone-viewport (alle mobiele specs) en op 1440×900 (desktop.spec.ts:
 * master-detail, tabellen, paginering). a11y.spec.ts draait op beide.
 *
 * Eenmalig lokaal: `npx playwright install chromium`.
 */

const PORT = 4173;

/** Specs die alleen op het desktop-project horen (én a11y, dat op beide draait). */
const DESKTOP_SPECS = /(desktop|a11y)\.spec\.ts$/;
const ALLEEN_DESKTOP = /desktop\.spec\.ts$/;

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
    // het sw-gedrag zelf zit in de handmatige PWA-checklist.
    serviceWorkers: 'block',
  },

  projects: [
    {
      // iPhone 13-viewport, maar op chromium gedraaid zodat alleen de
      // chromium-browser nodig is (geen extra webkit-download).
      name: 'iPhone 13 (chromium)',
      testIgnore: ALLEEN_DESKTOP,
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
  ],

  // Bouwt de app met dummy-Supabase-env (zodat het loginscherm rendert i.p.v.
  // de "configuratie ontbreekt"-melding) en serveert de dist via vite preview.
  webServer: {
    command: `npm run build && npm run preview -- --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    // Altijd vers bouwen: Vite bakt import.meta.env tijdens de build in, dus een
    // hergebruikte server kan met de verkeerde (of ontbrekende) env gebouwd zijn.
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      VITE_SUPABASE_URL: 'http://localhost:4173',
      VITE_SUPABASE_ANON_KEY: 'e2e-dummy-anon-key',
    },
  },
});
