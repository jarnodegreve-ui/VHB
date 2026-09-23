import { test, expect } from '@playwright/test';
import { ADMIN, seed } from './helpers';

/**
 * Dagadministratie tot en met vandaag (Jarno 23-09), desktop en iPhone:
 * het verleden blijft bewerkbaar, de toekomst niet. De grens is de
 * Brusselse kalenderdag (Playwright draait in Europe/Brussels).
 */
const brussel = (plus = 0) => {
  const d = new Date(Date.now() + plus * 864e5);
  return d.toLocaleDateString('en-CA', { timeZone: 'Europe/Brussels' });
};
const dmj = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const MELDING = 'Dagadministratie kan enkel tot en met vandaag worden aangepast.';

async function metSchrijfacties(page: import('@playwright/test').Page) {
  const schrijf: string[] = [];
  await seed(page, { user: ADMIN, extra: (p, req) => { if (req.method() !== 'GET' && p.includes('/api/dagafsluiting')) schrijf.push(`${req.method()} ${p}`); return undefined; } });
  return schrijf;
}

test('historische dag en vandaag: open; volgende dag stopt bij vandaag', async ({ page }) => {
  await metSchrijfacties(page);
  const oud = brussel(-40);
  await page.goto(`/beheer/dagadministratie/${oud}`);
  const dag = page.getByLabel('Dag', { exact: true });
  await expect(dag).toHaveValue(dmj(oud));
  await expect(page.getByRole('button', { name: 'Volgende dag' })).toBeEnabled();

  await page.goto(`/beheer/dagadministratie/${brussel(0)}`);
  await expect(dag).toHaveValue(dmj(brussel(0)));
  await expect(page.getByRole('button', { name: 'Volgende dag' })).toBeDisabled();
});

test('morgen typen: melding, de vorige dag blijft, geen schrijfactie', async ({ page }) => {
  const schrijf = await metSchrijfacties(page);
  const gisteren = brussel(-1);
  await page.goto(`/beheer/dagadministratie/${gisteren}`);
  const dag = page.getByLabel('Dag', { exact: true });
  await dag.fill(dmj(brussel(1)));
  await dag.press('Enter');
  await expect(page.getByText(`${MELDING} De vorige datum blijft staan.`)).toBeVisible();
  await expect(dag).toHaveValue(dmj(gisteren));
  await expect(page).toHaveURL(new RegExp(`/beheer/dagadministratie/${gisteren}$`));
  // In de kalender zijn dagen na vandaag uitgeschakeld.
  await dag.locator('xpath=following-sibling::button[1]').click();
  const kalender = page.getByRole('dialog', { name: 'Dag' });
  await expect(kalender.locator(`[data-iso="${brussel(1)}"]`)).toBeDisabled();
  expect(schrijf).toEqual([]);
});

test('een link naar een dag in de toekomst gaat naar vandaag, met de melding', async ({ page }) => {
  const schrijf = await metSchrijfacties(page);
  await page.goto(`/beheer/dagadministratie/${brussel(5)}`);
  await expect(page.getByText(MELDING)).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/beheer/dagadministratie/${brussel(0)}$`));
  await expect(page.getByLabel('Dag', { exact: true })).toHaveValue(dmj(brussel(0)));
  expect(schrijf.filter((s) => s.includes(brussel(5)))).toEqual([]);
});
