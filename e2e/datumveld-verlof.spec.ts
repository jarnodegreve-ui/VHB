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
});

// Regel Jarno 02-10: verlof eindigt uiterlijk op 31 december van volgend jaar
// (shared/verlofGrens.ts, de server weigert het ook). Met een vaste klok in
// 2027 is de grens 31/12/2028, en valt de schrikkeldag van 2028 erbinnen.
test('uiterste einddatum en schrikkeldag: typen, raster en indienen (vaste klok)', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2027-10-01T08:00:00Z'));
  const GRENS = 'Verlof aanvragen kan tot en met 31/12/2028.';
  const { modal, posts } = await openAanvraag(page);

  // De schrikkeldag bestaat en ligt binnen de grens.
  await van(modal).fill('28/02/2028');
  await van(modal).blur();
  await tot(modal).fill('29/02/2028');
  await tot(modal).blur();
  await expect(tot(modal)).toHaveAttribute('data-datum', '2028-02-29');

  // Een einde na 31/12 van volgend jaar: de regel bij het veld, de oude waarde blijft, er vertrekt niets.
  await tot(modal).fill('01/01/2029');
  await tot(modal).blur();
  await expect(modal.getByText(GRENS)).toBeVisible();
  await expect(tot(modal)).toHaveAttribute('data-datum', '2028-02-29');

  // De laatste dag zelf mag, in het veld en in het raster; de dag erna is in het raster uitgeschakeld.
  await van(modal).fill('30/12/2028');
  await van(modal).blur();
  await tot(modal).fill('31/12/2028');
  await tot(modal).blur();
  await expect(modal.getByText(GRENS)).toHaveCount(0);
  await expect(tot(modal)).toHaveAttribute('data-datum', '2028-12-31');
  const grid = modal.getByRole('grid');
  await expect(grid.locator('[data-iso="2028-12-31"]')).toBeEnabled();
  await modal.getByRole('button', { name: 'Volgende maand' }).click();
  await expect(grid.locator('[data-iso="2029-01-01"]')).toBeDisabled();
  await expect(grid.locator('[data-iso="2029-01-01"]')).toHaveAttribute('title', GRENS);

  // Ook een start na de grens (zonder einde) krijgt de regel, niet "Uiterlijk …".
  await modal.getByRole('button', { name: 'Periode wissen' }).click();
  await van(modal).fill('05/01/2029');
  await van(modal).blur();
  await expect(modal.getByText(GRENS)).toBeVisible();
  await expect(van(modal)).not.toHaveAttribute('data-datum', /.+/);

  await van(modal).fill('30/12/2028');
  await van(modal).blur();
  await tot(modal).fill('31/12/2028');
  await tot(modal).blur();
  await modal.getByRole('button', { name: 'Aanvraag indienen' }).click();
  await expect.poll(() => posts.length).toBe(1);
  expect(posts[0].at(-1)).toMatchObject({ startDate: '2028-12-30', endDate: '2028-12-31', status: 'pending' });
});

test('de uiterste einddatum geldt ook als staf verlof voor een chauffeur vastlegt (vaste klok)', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2027-10-01T08:00:00Z'));
  const { modal, posts } = await openAanvraag(page, ADMIN, /Verlof registreren/);
  await modal.getByLabel(/Chauffeur/).selectOption({ label: 'Test Chauffeur' });
  await van(modal).fill('20/12/2028');
  await van(modal).blur();
  await tot(modal).fill('02/01/2029');
  await tot(modal).blur();
  await expect(modal.getByText('Verlof aanvragen kan tot en met 31/12/2028.')).toBeVisible();
  await expect(tot(modal)).not.toHaveAttribute('data-datum', /.+/);
  await expect(modal.getByRole('button', { name: 'Vastleggen' })).toBeDisabled();
  expect(posts).toHaveLength(0);
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
