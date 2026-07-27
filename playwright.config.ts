import { defineConfig, devices } from '@playwright/test';

/**
 * E2E-smoke voor het VHB-portaal — iPhone-first.
 *
 * Bewust NIET in de GitHub-CI gehaakt: een volledige browser-download + de
 * ingelogde flow vragen een testaccount/backend die we (nog) niet hebben.
 * Dit is een lokaal uitvoerbare fundering (`npm run test:e2e`) die de échte
 * gebouwde app op een iPhone-viewport boot en controleert dat het portaal
 * überhaupt rendert (geen white-screen op mobiel). Uit te breiden naar de
 * ingelogde chauffeur-flow zodra er een seed-/testaccount is.
 *
 * Eenmalig lokaal: `npx playwright install chromium`.
 */

const PORT = 4173;

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
      use: {
        ...devices['iPhone 13'],
        browserName: 'chromium',
        defaultBrowserType: 'chromium',
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
