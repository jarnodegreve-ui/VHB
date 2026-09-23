import { test, expect, type Locator, type Page } from '@playwright/test';
import { ADMIN, CHAUFFEUR, seed, type Fixture } from './helpers';

/**
 * Datumtranche PR 5: de verlofaanvraag met typbare Van/Tot naast het
 * bereikraster, desktop en iPhone. Typen en klikken volgen dezelfde regels:
 * een eigen aanvraag start niet in het verleden, het einde niet vóór de start;
 * de registratie door staf namens een chauffeur mag in het verleden.
 */
const dag = (plus: number) => {
  const d = new Date();
  d.setDate(d.getDate() + plus);
  return d.toLocaleDateString('sv-SE');
};
const dmj = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

async function openAanvraag(page: Page, user: Fixture = CHAUFFEUR, knop: RegExp = /Verlof aanvragen/) {
  const posts: any[] = [];
  await seed(page, { user, extra: (p, req) => { if (p.endsWith('/api/leave') && req.method() === 'POST') { posts.push(JSON.parse(req.postData() ?? 'null')); return {}; } return undefined; } });
  await page.goto('/verlof');
  await page.getByRole('button', { name: knop }).first().click();
  const modal = page.locator('form').filter({ hasText: 'Periode kiezen' });
  await expect(modal).toBeVisible();
  return { modal, posts };
}
const van = (m: Locator) => m.getByLabel('Startdatum', { exact: true });
const tot = (m: Locator) => m.getByLabel('Einddatum', { exact: true });

test('typen in Van en Tot: dd/mm/jjjj erin, ISO in de aanvraag, het raster volgt', async ({ page }) => {
  const { modal, posts } = await openAanvraag(page);
  const start = dag(40);
  const eind = dag(42);
  await van(modal).fill(dmj(start));
  await van(modal).press('Tab');
  await tot(modal).fill(dmj(eind));
  await tot(modal).blur();
  await expect(van(modal)).toHaveAttribute('data-datum', start);
  await expect(tot(modal)).toHaveAttribute('data-datum', eind);
  await expect(modal.locator(`[data-iso="${start}"]`)).toHaveAttribute('aria-label', /begin van de periode$/);
  await modal.getByRole('button', { name: 'Aanvraag indienen' }).click();
  await expect.poll(() => posts.length).toBe(1);
  expect(posts[0].at(-1)).toMatchObject({ startDate: start, endDate: eind, status: 'pending' });
});

test('regels bij typen: verleden, einde vóór start, onbestaande dag en schrikkeldag', async ({ page }) => {
  const { modal } = await openAanvraag(page);
  // Eigen aanvraag: in het raster zijn dagen vóór vandaag uitgeschakeld (zelfde regel als typen).
  await modal.getByRole('button', { name: 'Vorige maand' }).click();
  await expect(modal.getByRole('grid').locator('[role="gridcell"][data-iso]').first()).toBeDisabled();
  await modal.getByRole('button', { name: 'Volgende maand' }).click();
  await van(modal).fill(dmj(dag(-2)));
  await van(modal).blur();
  await expect(modal.getByText('Je kan geen verlof aanvragen in het verleden.').first()).toBeVisible();
  await expect(van(modal)).not.toHaveAttribute('data-datum', /.+/);

  await van(modal).fill(dmj(dag(30)));
  await van(modal).blur();
  await tot(modal).fill(dmj(dag(20)));
  await tot(modal).blur();
  await expect(modal.getByText(`Vroegst ${dmj(dag(30))}.`)).toBeVisible();
  await expect(tot(modal)).not.toHaveAttribute('data-datum', /.+/);

  await tot(modal).fill('30/02/2030');
  await tot(modal).blur();
  await expect(modal.getByText('Die dag bestaat niet.')).toBeVisible();

  await van(modal).fill('28/02/2028');
  await van(modal).blur();
  await tot(modal).fill('29/02/2028');
  await tot(modal).blur();
  await expect(tot(modal)).toHaveAttribute('data-datum', '2028-02-29');
});

test('toetsenbord: één tab-stop in het raster, pijlen en Enter kiezen begin en einde', async ({ page }) => {
  const { modal } = await openAanvraag(page);
  // Een maand vooruit: elke dag kiesbaar, wat de klok ook zegt.
  await modal.getByRole('button', { name: 'Volgende maand' }).click();
  const grid = modal.getByRole('grid');
  await expect(grid.locator('[role="gridcell"][tabindex="0"]')).toHaveCount(1);
  await grid.locator('[role="gridcell"][tabindex="0"]').focus();
  const eersteIso = await page.evaluate(() => (document.activeElement as HTMLElement).dataset.iso ?? '');
  await page.keyboard.press('Enter');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  await expect(van(modal)).toHaveAttribute('data-datum', eersteIso);
  const verwachtEind = await page.evaluate((iso) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 2); return d.toISOString().slice(0, 10); }, eersteIso);
  await expect(tot(modal)).toHaveAttribute('data-datum', verwachtEind);
  await expect(grid.locator(`[data-iso="${verwachtEind}"]`)).toHaveAttribute('aria-label', /einde van de periode$/);
});

test('registratie door staf namens een chauffeur mag in het verleden, typen én raster (bestaande flow)', async ({ page }) => {
  const { modal, posts } = await openAanvraag(page, ADMIN, /Verlof registreren/);
  await modal.getByLabel(/Chauffeur/).selectOption({ label: 'Test Chauffeur' });
  // Ook in het raster: een dag in het verleden is kiesbaar (zelfde regel als typen).
  await modal.getByRole('button', { name: 'Vorige maand' }).click();
  const grid = modal.getByRole('grid');
  const oudeDag = grid.locator('[role="gridcell"][data-iso]').first();
  await expect(oudeDag).toBeEnabled();
  const oudeIso = await oudeDag.getAttribute('data-iso');
  await oudeDag.click();
  await expect(van(modal)).toHaveAttribute('data-datum', oudeIso!);
  await modal.getByRole('button', { name: 'Volgende maand' }).click();
  const start = dag(-5);
  await van(modal).fill(dmj(start));
  await van(modal).blur();
  await expect(van(modal)).toHaveAttribute('data-datum', start);
  await tot(modal).fill(dmj(start));
  await tot(modal).blur();
  await modal.getByRole('button', { name: 'Vastleggen' }).click();
  await expect.poll(() => posts.length).toBe(1);
  expect(posts[0].at(-1)).toMatchObject({ startDate: start, endDate: start, userId: '42', status: 'approved' });
});
