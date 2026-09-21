import { test, expect } from '@playwright/test';
import { ADMIN, seed } from './helpers';

/**
 * De pagina verlaten midden in de idle-warmup mag geen fouten geven (21-09).
 *
 * De warmup haalt na het laden de chunks van de volgende schermen op, één
 * tegelijk. Bij een harde navigatie (een printblad openen) brak WebKit de
 * lopende fetch af terwijl de pagina al afbrak; de lus startte meteen de
 * volgende, die ook sneuvelde, enzovoort: 30 tot 50 keer "Fetch API cannot
 * load … due to access control checks" als onafgehandelde fout. In de e2e van
 * rapporten viel dat willekeurig om (het hing af van de snelheid van de
 * runner), en op iOS belandt het in de foutrapportage. De warmup breekt nu
 * zelf af op `beforeunload`.
 *
 * Draait in WebKit: Chromium gebruikt <link rel="prefetch"> en kent dit pad
 * niet.
 */
test('wegnavigeren tijdens de warmup geeft geen onafgehandelde fouten', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));
  // Trage chunks, en bijhouden wanneer ze gevraagd worden: zo weet de test
  // zeker dat er een warmup-fetch onderweg is op het moment van verlaten.
  let telNaStart = false;
  let warmupVerzoeken = 0;
  await page.route('**/assets/*.js', async (route) => {
    if (telNaStart) warmupVerzoeken += 1;
    await new Promise((klaar) => setTimeout(klaar, 200));
    await route.fallback();
  });
  await seed(page, { user: ADMIN });
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 15_000 });
  // Het scherm staat er; wat nu nog aan chunks gevraagd wordt is de warmup
  // (start uiterlijk 4 s na het laden, of eerder bij een aanraking).
  await page.waitForTimeout(500);
  telNaStart = true;
  await page.mouse.click(5, 5);
  await expect.poll(() => warmupVerzoeken, { timeout: 12_000 }).toBeGreaterThan(1);

  await page.goto('/?print-rapport=verlofsaldo&jaar=2026');
  await page.waitForTimeout(800);
  expect(pageErrors).toEqual([]);
});
