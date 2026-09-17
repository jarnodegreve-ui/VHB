import { test, expect } from '@playwright/test';
import { ADMIN, seed } from './helpers';
import { SWAPS } from '../scripts/audit-fixtures.mjs';

/**
 * Dagoverzicht dienstwissels (bewijsstuk voor de map): het printscherm toont
 * de wissels van die dag met het verloop uit het activiteitenlog.
 */
test('planning print het dagoverzicht van de dienstwissels', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));
  const wissel = SWAPS[0];
  await seed(page, {
    user: ADMIN,
    view: 'ruil-verzoeken',
    extra: (pad) => pad.endsWith(`/api/activity/swap/${wissel.id}`)
      ? [{ id: 'h1', createdAt: wissel.createdAt, actorName: 'Alex Du Priez', actorRole: 'chauffeur', category: 'swaps', action: 'Dienstruil aangevraagd', details: '' }]
      : undefined,
  });
  await page.addInitScript(() => { window.print = () => {}; });
  await page.goto(`/?print-dienstwissels=${wissel.returnDate}`);

  await expect(page.getByRole('heading', { name: 'Dienstwissels', level: 1 })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('button', { name: 'Print / Opslaan als PDF' })).toBeVisible();
  await expect(page.getByText('Alex Du Priez').first()).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Dienstruil aangevraagd' })).toBeVisible();
  await expect(page.getByText('“Familiefeest”')).toBeVisible();
  expect(pageErrors).toEqual([]);
});
