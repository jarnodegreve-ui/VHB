import { test, expect } from '@playwright/test';
import { FILMNUMMERS } from '../scripts/audit-fixtures.mjs';
import { ADMIN, CHAUFFEUR, seed } from './helpers';

/**
 * Filmnummers (01-10): de naslaglijst van de chauffeur en de import van de
 * admin. De regels (lezen van het bestand, zoeken, indelen) zitten in de
 * unit-tests; hier wat iemand op zijn toestel ziet en doet.
 */

test('een chauffeur vindt het nummer van zijn bestemming: zoeken, één lijn, algemeen', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));
  await seed(page, { user: CHAUFFEUR, view: 'filmnummers' });
  await page.goto('/filmnummers');

  await expect(page.getByRole('heading', { level: 1, name: 'Filmnummers' })).toBeVisible({ timeout: 15_000 });
  const bestemmingen = page.getByRole('list', { name: 'Bestemmingen' });
  const algemeen = page.getByRole('list', { name: 'Algemeen' });
  await expect(bestemmingen.getByRole('listitem')).toHaveCount(13);
  await expect(algemeen.getByRole('listitem')).toHaveCount(4);
  // Lijn, bestemming en het nummer staan op één regel.
  const brugge = bestemmingen.getByRole('listitem').filter({ hasText: 'Brugge Station' });
  await expect(brugge.getByRole('img', { name: 'Lijn 50' })).toBeVisible();
  await expect(brugge).toContainText('5000');
  // Alleen-lezen: de import is er voor een chauffeur niet.
  await expect(page.getByRole('button', { name: /Lijst (vervangen|importeren)/ })).toHaveCount(0);

  // Eén lijn kiezen.
  await page.getByRole('button', { name: 'Lijn 871', exact: true }).click();
  await expect(bestemmingen.getByRole('listitem')).toHaveCount(3);
  await expect(bestemmingen).toContainText('8714');
  await expect(algemeen).toHaveCount(0);

  // De algemene boodschappen.
  await page.getByRole('button', { name: 'Algemeen', exact: true }).click();
  await expect(algemeen).toContainText('Stelplaats');
  await expect(bestemmingen).toHaveCount(0);

  // Zoeken gaat over lijn, bestemming en nummer.
  await page.getByRole('button', { name: 'Alle', exact: true }).click();
  const zoek = page.getByRole('searchbox', { name: 'Zoek in de filmnummers' });
  await zoek.fill('aalter');
  await expect(bestemmingen.getByRole('listitem')).toHaveCount(4);
  await zoek.fill('8830');
  await expect(bestemmingen.getByRole('listitem')).toHaveCount(1);
  await expect(bestemmingen).toContainText('Tielt Station via Lotenhulle');
  await zoek.fill('bestaat niet');
  await expect(page.getByText('Geen filmnummer gevonden')).toBeVisible();
  await page.getByRole('button', { name: 'Wis filters' }).click();
  await expect(bestemmingen.getByRole('listitem')).toHaveCount(13);

  // De pagina schuift nooit opzij; alleen de rij met lijnen doet dat.
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  expect(pageErrors, `page errors:\n${pageErrors.join('\n')}`).toEqual([]);
});

test('zonder bereik staat de lijst er nog: de kopie op het toestel', async ({ page }) => {
  let bereik = true;
  await seed(page, { user: CHAUFFEUR, view: 'filmnummers' });
  // Na de seed gezet, dus eerst aan de beurt: zonder bereik faalt alleen deze call.
  await page.route('**/api/filmnummers', (route) => (bereik ? route.fallback() : route.abort('internetdisconnected')));
  await page.goto('/filmnummers');
  await expect(page.getByRole('list', { name: 'Bestemmingen' }).getByRole('listitem')).toHaveCount(13, { timeout: 15_000 });

  bereik = false;
  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: 'Filmnummers' })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('list', { name: 'Bestemmingen' }).getByRole('listitem')).toHaveCount(13);
  await expect(page.getByText('Dit kon niet laden')).toHaveCount(0);
  await expect(page.getByText('Nog geen filmnummers')).toHaveCount(0);
});

test('Mijn dag heeft een knop naar de filmnummers', async ({ page }) => {
  await seed(page, { user: CHAUFFEUR, view: 'mijn-dag' });
  await page.goto('/mijn-dag');
  // In de inhoud: het menu (op de telefoon een lade buiten beeld) heeft ook een item Filmnummers.
  await page.locator('#hoofdinhoud').getByRole('button', { name: 'Filmnummers', exact: true }).click();
  await expect(page).toHaveURL(/\/filmnummers$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Filmnummers' })).toBeVisible({ timeout: 15_000 });
});

test('het dashboard van de chauffeur heeft de snelle actie Filmnummers (zonder zijbalk)', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'De snelle acties staan alleen onder lg; op desktop staat het scherm in de zijbalk.');
  await seed(page, { user: CHAUFFEUR, view: 'dashboard' });
  await page.goto('/');
  await page.locator('#hoofdinhoud').getByRole('button', { name: /Filmnummers/ }).click();
  await expect(page).toHaveURL(/\/filmnummers$/);
});

test('een admin vervangt de lijst met een bestand: voorbeeld, verschillen, bevestigen', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));
  let verstuurd: { items: Array<{ code: string; lijn: string; tekst: string }> } | null = null;
  await seed(page, {
    user: ADMIN,
    view: 'filmnummers',
    extra: (pad, request) => {
      if (!pad.endsWith('/api/filmnummers') || request.method() !== 'PUT') return undefined;
      verstuurd = request.postDataJSON();
      return { items: verstuurd!.items, bijgewerktOp: '2026-10-02T08:00:00.000Z' };
    },
  });
  await page.goto('/filmnummers');
  await expect(page.getByRole('list', { name: 'Bestemmingen' }).getByRole('listitem')).toHaveCount(13, { timeout: 15_000 });

  // Het bestand van VHB: nummer, tekst; de lijn vooraan in de tekst. Eén regel
  // is nieuw (9070), één gewijzigd (5000), één onleesbaar, de rest verdwijnt.
  const csv = ['1;Geen dienst', '94;Stelplaats', '5000;50 Brugge Station Perron 3', '9070;907 Mariakerke VISO-AHS', 'ABC;Geen nummer'].join('\r\n');
  const kiezer = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Lijst vervangen' }).click();
  await (await kiezer).setFiles({ name: 'Filmbeelden.csv', mimeType: 'text/csv', buffer: Buffer.from(csv, 'utf8') });

  const dialoog = page.getByRole('dialog', { name: 'Filmnummers importeren' });
  await expect(dialoog).toContainText('4 filmnummers gevonden: 2 bestemmingen op 2 lijnen en 2 algemene boodschappen.');
  await expect(dialoog).toContainText('1 nieuw: 9070 Mariakerke VISO-AHS');
  await expect(dialoog).toContainText('1 gewijzigd: 5000 Brugge Station Perron 3');
  await expect(dialoog).toContainText('14 verdwijnen');
  await expect(dialoog).toContainText('1 regel overgeslagen');
  await expect(dialoog).toContainText('Regel 5 (ABC · Geen nummer): het nummer bestaat niet uit 1 tot 6 cijfers.');
  expect(verstuurd, 'nog niets verstuurd vóór de bevestiging').toBeNull();

  await dialoog.getByRole('button', { name: 'Lijst vervangen' }).click();
  await expect(dialoog).toHaveCount(0);
  expect(verstuurd).toEqual({
    items: [
      { code: '1', lijn: '', tekst: 'Geen dienst' },
      { code: '94', lijn: '', tekst: 'Stelplaats' },
      { code: '5000', lijn: '50', tekst: 'Brugge Station Perron 3' },
      { code: '9070', lijn: '907', tekst: 'Mariakerke VISO-AHS' },
    ],
  });
  await expect(page.getByText('Filmnummers bijgewerkt: 4 nummers.')).toBeVisible();
  await expect(page.getByRole('list', { name: 'Bestemmingen' }).getByRole('listitem')).toHaveCount(2);
  await expect(page.getByRole('list', { name: 'Bestemmingen' })).toContainText('Brugge Station Perron 3');
  expect(FILMNUMMERS.items).toHaveLength(17);
  expect(pageErrors, `page errors:\n${pageErrors.join('\n')}`).toEqual([]);
});
