import { test, expect } from '@playwright/test';

/**
 * De voorgerenderde schil (22-09): vóór de JavaScript-bundel binnen is, staat
 * er al iets in beeld. De test houdt de bundel tegen en kijkt naar wat er dan
 * overblijft: de statische HTML uit scripts/voorrender-schil.mjs plus het
 * bootscript in index.html dat kiest welke van de twee schillen zichtbaar is.
 *
 * Bewaakt ook de build zelf: slaat een bouwomgeving de voorrenderstap over
 * (vercel.json zet daarom `buildCommand` expliciet), dan is #root leeg en
 * faalt dit.
 */
test.describe('voorgerenderde schil, zonder de app-bundel', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/assets/*.js', (route) => route.abort());
  });

  test('met een opgeslagen sessie staat het skelet van de app er meteen', async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem('sb-test-auth-token', '{}'));
    await page.goto('/mijn-dag');
    await expect(page.locator('#voorschil-warm')).toBeVisible();
    await expect(page.locator('#voorschil-koud')).toBeHidden();
    await expect(page.locator('#voorschil-warm [aria-busy="true"]').first()).toBeVisible();
  });

  test('zonder sessie staat het laadscherm met het logo er meteen', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#voorschil-koud')).toBeVisible();
    await expect(page.locator('#voorschil-warm')).toBeHidden();
    await expect(page.locator('#voorschil-koud').getByRole('img', { name: /VHB/ })).toBeVisible();
  });
});

test('React neemt de schil over: na het laden blijft er geen voorgerenderde laag achter', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#voorschil-warm, #voorschil-koud')).toHaveCount(0, { timeout: 15_000 });
});
