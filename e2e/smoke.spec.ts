import { test, expect } from '@playwright/test';

/**
 * Boot-smoke op een iPhone-viewport. Vangt het ergste faalgeval af — een
 * white-screen door een crash tijdens het opstarten — en bevestigt dat het
 * loginscherm mobiel netjes rendert zonder horizontale overflow.
 */
test.describe('smoke: portaal boot op mobiel', () => {
  test('loginscherm rendert zonder crash', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));

    await page.goto('/');

    // Titel + kern van het loginformulier zichtbaar → de SPA is echt geboot.
    await expect(page).toHaveTitle(/VHB Portaal/);
    await expect(page.getByRole('button', { name: 'Inloggen' })).toBeVisible();
    await expect(page.getByPlaceholder('naam@bedrijf.be')).toBeVisible();

    // Geen niet-afgevangen JS-fout tijdens het opstarten (= white-screen-oorzaak).
    expect(pageErrors, `page errors:\n${pageErrors.join('\n')}`).toEqual([]);
  });

  test('geen horizontale overflow op mobiel', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Inloggen' })).toBeVisible();

    const overflows = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    );
    expect(overflows, 'de pagina scrollt horizontaal op een iPhone-viewport').toBe(false);
  });
});
