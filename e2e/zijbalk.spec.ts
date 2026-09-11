import { test, expect } from '@playwright/test';
import { ADMIN, seed } from './helpers';

/**
 * Navigeren vanuit de mobiele zijbalk (melding Jarno 11-09: "wat ik ook
 * aantik in het menu, ik kom steeds op dezelfde pagina terecht").
 *
 * De zijbalk is op mobiel een overlay met een eigen history-entry
 * (useHistoryDismiss), zodat de systeem-terugknop hem sluit. Een tik op een
 * menu-item wisselt de route én sluit de lade in één commit. Deze test rijdt
 * dat in een échte browser mét view transitions — de plek waar de volgorde
 * van history-mutaties telt.
 */
test('zijbalk: elk menu-item opent zijn eigen pagina', async ({ page }) => {
  await seed(page, { user: ADMIN, view: 'verlof' });
  await page.goto('/verlof');
  await page.waitForSelector('[data-scroll-root]');
  await expect(page).toHaveURL(/\/verlof$/);

  for (const [label, pad] of [['Rooster', '/rooster'], ['Contacten', '/contacten'], ['Omleidingen', '/omleidingen']] as const) {
    await page.getByRole('button', { name: 'Meer', exact: true }).click();
    const zijbalk = page.getByRole('navigation', { name: 'Zijbalk' });
    await expect(zijbalk).toBeVisible();
    await zijbalk.getByRole('button', { name: label, exact: true }).click();
    await expect(page, `menu-item ${label}`).toHaveURL(new RegExp(`${pad}$`));
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  }
});

test('zijbalk: één terugstap gaat terug naar de vorige pagina', async ({ page }) => {
  await seed(page, { user: ADMIN, view: 'verlof' });
  await page.goto('/verlof');
  await page.waitForSelector('[data-scroll-root]');

  await page.getByRole('button', { name: 'Meer', exact: true }).click();
  await page.getByRole('navigation', { name: 'Zijbalk' }).getByRole('button', { name: 'Rooster', exact: true }).click();
  await expect(page).toHaveURL(/\/rooster$/);

  await page.goBack();
  await expect(page).toHaveURL(/\/verlof$/);
});
