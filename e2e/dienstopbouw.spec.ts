import { test, expect } from '@playwright/test';
import { ADMIN, seed } from './helpers';

/**
 * Dienstopbouw (fase C Access-migratie): de import-lijst met bevindingen, en
 * het tabblad Diensten met de ritdelen en het ritblad uit data van één
 * dienst. Alleen leesflows; de upload zelf is server-side gedekt door de
 * golden tests in shared/dienst/dienst.test.ts.
 */
test('staf ziet de actieve import, de bevindingen en het ritblad van een dienst', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));
  await seed(page, { user: ADMIN, view: 'dienstopbouw' });
  await page.goto('/beheer/dienstopbouw');

  await expect(page.getByRole('heading', { name: 'Dienstopbouw', level: 1 })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('dienstregeling-et-260901.xlsx').first()).toBeVisible();
  await expect(page.getByText('1 waarschuwingen').first()).toBeVisible();

  await page.getByRole('button', { name: 'Bevindingen' }).first().click();
  await expect(page.getByRole('dialog')).toContainText('Duur wijkt af van einde min start');
  await page.getByRole('dialog').getByRole('button', { name: 'Sluiten', exact: true }).click();

  await page.getByRole('group', { name: 'Onderdeel' }).getByRole('button', { name: 'Diensten', exact: true }).click();
  await page.getByRole('button', { name: /^2101 / }).first().click();
  await expect(page.getByRole('heading', { name: /Dienst 2101/ })).toBeVisible();
  await expect(page.getByText('Ritblad uit data')).toBeVisible();
  await expect(page.getByText('Brugge Station').first()).toBeVisible();
  expect(pageErrors, `page errors:\n${pageErrors.join('\n')}`).toEqual([]);
});
