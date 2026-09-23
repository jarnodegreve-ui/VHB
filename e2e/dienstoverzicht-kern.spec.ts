import { test, expect } from '@playwright/test';
import { ADMIN, seed } from './helpers';

/**
 * De gedeelde kern van het Dienstoverzicht (3D.1, 23-09; sinds 3D.2 één
 * scherm op /beheer/dienstoverzicht): sorteren via de kolomkoppen
 * (aria-sort), standaard de volgorde van de lijst zelf; zoeken via de
 * toolbar; op een smalle kolom dezelfde gegevens als kaarten.
 */

const DIENSTEN = [
  { id: 'd-2515', serviceNumber: '2515', loopnr: '4505', startTime: '07:08', endTime: '08:34', loopnr2: '4510', startTime2: '15:13', endTime2: '21:55', loopnr3: '4515', startTime3: '24:10', endTime3: '25:10' },
  { id: 'd-2101', serviceNumber: '2101', loopnr: '4500', startTime: '04:36', endTime: '07:52' },
  { id: 'd-2607', serviceNumber: '2607', loopnr: '4600', startTime: '15:41', endTime: '26:16' },
];

async function open(page: import('@playwright/test').Page) {
  await seed(page, { user: ADMIN, view: 'dienstoverzicht', extra: (pad) => pad.endsWith('/api/services') ? DIENSTEN : undefined });
  await page.goto('/beheer/dienstoverzicht');
  await expect(page.getByRole('heading', { name: 'Dienstoverzicht', level: 1 })).toBeVisible({ timeout: 15_000 });
}

test('tabel: lijstvolgorde, Dienst en Deel 1 sorteren en keren om, zoeken op loopnummer', async ({ page }, info) => {
  test.skip(info.project.name !== 'Desktop (chromium)', 'tabel = desktop');
  await open(page);
  const tabel = page.getByRole('table', { name: 'Diensten' });
  const eersteKolom = () => tabel.locator('tbody tr td:first-child').allTextContents();
  await expect.poll(eersteKolom).toEqual(['2515', '2101', '2607']);

  await tabel.getByRole('button', { name: /^Dienst/ }).first().click();
  await expect(tabel.getByRole('columnheader', { name: /^Dienst/ })).toHaveAttribute('aria-sort', 'ascending');
  await expect.poll(eersteKolom).toEqual(['2101', '2515', '2607']);

  await tabel.getByRole('button', { name: /Deel 1/ }).click();
  await tabel.getByRole('button', { name: /Deel 1/ }).click();
  await expect(tabel.getByRole('columnheader', { name: /Deel 1/ })).toHaveAttribute('aria-sort', 'descending');
  await expect.poll(eersteKolom).toEqual(['2607', '2515', '2101']);

  await page.getByRole('searchbox', { name: 'Zoek op dienst- of loopnummer…' }).fill('4515');
  await expect.poll(eersteKolom).toEqual(['2515']);
  await expect(page.getByText('1 van 3')).toBeVisible();
  await expect(tabel.getByRole('columnheader', { name: /Deel 1/ })).toHaveAttribute('aria-sort', 'descending');

  await page.getByRole('searchbox', { name: 'Zoek op dienst- of loopnummer…' }).fill('9999');
  await expect(page.getByText('Geen resultaten voor “9999”')).toBeVisible();
  await page.getByRole('button', { name: 'Zoekterm wissen' }).click();
  await expect.poll(eersteKolom).toEqual(['2607', '2515', '2101']);
});

test('telefoon: kaart per dienst met alle delen, loopnummers en het actiemenu', async ({ page }, info) => {
  test.skip(!info.project.name.startsWith('iPhone'), 'kaartlijst = telefoon');
  await open(page);
  await expect(page.getByRole('table')).toBeHidden();
  for (const tekst of ['Deel 3 · loop 4515', '24:10–25:10', '15:41–26:16']) {
    await expect(page.getByText(tekst, { exact: true }).filter({ visible: true })).toBeVisible();
  }
  await expect(page.getByRole('button', { name: 'Acties voor dienst 2515' }).filter({ visible: true })).toBeVisible();
});
