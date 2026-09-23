import { test, expect } from '@playwright/test';
import { ADMIN, seed } from './helpers';

/**
 * Datumtranche PR 4: het maandveld van "Print per chauffeur" (Beheer
 * planning), desktop en iPhone. Typen of kiezen in het raster; de print-URL
 * krijgt 'YYYY-MM', een onbestaande maand gaat niet mee.
 */
test('print per chauffeur: maand typen of kiezen, de print-URL krijgt YYYY-MM', async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { __geopend: string[] }).__geopend = [];
    window.open = ((url: string) => { (window as unknown as { __geopend: string[] }).__geopend.push(String(url)); return {} as Window; }) as typeof window.open;
  });
  await seed(page, { user: ADMIN });
  await page.goto('/beheer/planning');
  const maand = page.getByLabel('Maand', { exact: true });
  await maand.scrollIntoViewIfNeeded();
  await expect(maand).toHaveAttribute('placeholder', 'mm/jjjj');
  await page.getByLabel('Chauffeur', { exact: true }).selectOption('alle');

  await maand.fill('13/2026');
  await maand.blur();
  await expect(page.getByText('Die maand bestaat niet.')).toBeVisible();

  await maand.fill('082026');
  await maand.press('Enter');
  await expect(maand).toHaveValue('08/2026');
  await page.getByRole('button', { name: 'Open print-weergave' }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __geopend: string[] }).__geopend.at(-1) ?? '')).toContain('print-month=2026-08');

  // Raster met toetsen: één maand verder, Enter kiest.
  await page.getByRole('button', { name: 'Maand kiezen' }).click();
  const raster = page.getByRole('dialog', { name: 'Maand kiezen' });
  await expect(raster.getByRole('gridcell', { name: 'Augustus 2026' })).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  await expect(raster).toHaveCount(0);
  await expect(maand).toHaveValue('09/2026');
});
