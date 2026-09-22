import { test, expect } from '@playwright/test';
import { CHAUFFEUR, seed } from './helpers';

/**
 * Schermwissel zonder stotter (21-09). Elk scherm fadede twee keer in: de
 * view transition toonde het nieuwe scherm, en zodra `vt-route` daarna van
 * <html> verdween startte de CSS-inloop (`.view-in`) alsnog, dus het scherm
 * stond er ±230 ms, verdween één frame en kwam opnieuw op.
 *
 * De test meet frame voor frame de dekking van het nieuwe scherm: eens het
 * volledig zichtbaar is, mag het nooit meer doorzichtig worden. Dat geldt met
 * én zonder view transitions (dan loopt de inloop één keer, van 0 naar 1).
 */
test('een scherm komt één keer op: eens zichtbaar, nooit meer doorzichtig', async ({ page }) => {
  await seed(page, { user: CHAUFFEUR });
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 15_000 });

  const dock = page.locator('nav');
  // Eerst één keer heen en terug, zodat de chunk van Rooster binnen is en de
  // gemeten wissel alleen nog over de overgang zelf gaat.
  await dock.getByRole('button', { name: 'Rooster', exact: true }).last().click();
  await expect(page.getByRole('heading', { name: 'Rooster', level: 1 })).toBeVisible();
  await dock.getByRole('button', { name: 'Dashboard', exact: true }).last().click();
  await expect(page.getByRole('heading', { name: 'Rooster', level: 1 })).toHaveCount(0);
  await page.waitForTimeout(600);

  // Sampler: per animatieframe de laagste dekking tussen de kop van het
  // doelscherm en <body>.
  await page.evaluate(() => {
    const w = window as unknown as { __dekking: number[] };
    w.__dekking = [];
    const t0 = performance.now();
    const meet = () => {
      const h1 = [...document.querySelectorAll('h1')].find((h) => h.textContent?.includes('Rooster'));
      if (h1) {
        let laagste = 1;
        for (let n: Element | null = h1; n && n !== document.body; n = n.parentElement) {
          laagste = Math.min(laagste, Number(getComputedStyle(n).opacity));
        }
        w.__dekking.push(laagste);
      }
      if (performance.now() - t0 < 1200) requestAnimationFrame(meet);
    };
    requestAnimationFrame(meet);
  });
  await dock.getByRole('button', { name: 'Rooster', exact: true }).last().click();
  await page.waitForTimeout(1300);

  const dekking = await page.evaluate(() => (window as unknown as { __dekking: number[] }).__dekking);
  expect(dekking.length).toBeGreaterThan(10);
  const eersteVol = dekking.findIndex((d) => d >= 0.99);
  expect(eersteVol, 'het scherm wordt volledig zichtbaar').toBeGreaterThanOrEqual(0);
  const daarna = dekking.slice(eersteVol);
  expect(Math.min(...daarna), 'eens volledig zichtbaar, nooit meer doorzichtig').toBeGreaterThanOrEqual(0.99);
});
