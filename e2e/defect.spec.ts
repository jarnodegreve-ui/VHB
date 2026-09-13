import { test, expect } from '@playwright/test';
import { CHAUFFEUR, seed } from './helpers';
import { TECHNIEKER, DEFECTEN, VEHICLES } from '../scripts/audit-fixtures.mjs';

/**
 * Techniek (fase A Access-migratie): de chauffeur meldt een defect vanaf
 * Mijn dag (POST /api/defecten met bus, soort en tekst), de technieker ziet
 * het gele boek en zet een melding op uitgevoerd (PATCH met status en
 * uitvoering). Zelfde opzet als de andere flow-specs: sessie in
 * localStorage, /api/** met fixtures, alleen het schrijfpad wordt gevangen.
 */

test('chauffeur meldt een defect vanaf Mijn dag', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));
  let gepost: Record<string, unknown> | null = null;
  await seed(page, {
    user: CHAUFFEUR,
    view: 'mijn-dag',
    extra: (pad, request) => {
      if (pad.endsWith('/api/defecten') && request.method() === 'POST') {
        gepost = JSON.parse(request.postData() ?? 'null');
        return { ...DEFECTEN[0], id: 'nieuw', ...(gepost ?? {}) };
      }
      return undefined;
    },
  });
  await page.goto('/mijn-dag');

  await page.getByRole('button', { name: 'Defect melden' }).click();
  await expect(page.getByRole('dialog', { name: 'Defect melden' })).toBeVisible();
  // De bussen komen uit de fixture; kies op kort nummer.
  await page.getByRole('combobox', { name: 'Bus' }).selectOption({ label: '613 026' });
  await page.getByRole('button', { name: 'Carrosserie' }).click();
  await page.getByRole('textbox', { name: /Wat is er mis/ }).fill('Spiegel rechts hangt los');
  await page.getByRole('button', { name: 'Melden', exact: true }).click();

  await expect(page.getByText('Gemeld, de garage ziet het in het gele boek.')).toBeVisible();
  expect(gepost, 'POST /api/defecten is nooit verstuurd').not.toBeNull();
  expect(gepost).toEqual({ vehicleId: VEHICLES[0].id, werktype: 'C', omschrijving: 'Spiegel rechts hangt los' });
  expect(pageErrors, `page errors:\n${pageErrors.join('\n')}`).toEqual([]);
});

test('technieker ziet het gele boek en zet een melding op uitgevoerd', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));
  let patch: { pad: string; body: Record<string, unknown> } | null = null;
  await seed(page, {
    user: TECHNIEKER,
    view: 'defecten',
    extra: (pad, request) => {
      if (pad.includes('/api/defecten/') && request.method() === 'PATCH') {
        patch = { pad, body: JSON.parse(request.postData() ?? 'null') };
        return { ...DEFECTEN[0], status: 'uitgevoerd', uitgevoerdWerk: 'Bel vervangen', manuren: 0.5 };
      }
      return undefined;
    },
  });
  await page.goto('/techniek/defecten');

  await expect(page.getByRole('heading', { name: 'Gele boek', level: 1 })).toBeVisible({ timeout: 15_000 });
  // Desktop-tabel en mobiele kaartlijst staan allebei in de DOM (md:hidden);
  // scope op de zichtbare kaartrij, anders pakt .first() de verborgen tabel.
  const rij = page.locator('li:visible').filter({ hasText: 'Bel doet het niet altijd' });
  await expect(rij).toBeVisible();

  // Actiemenu van die open melding → Uitgevoerd.
  await rij.getByRole('button', { name: 'Meer acties' }).click();
  await page.getByRole('menuitem', { name: 'Uitgevoerd' }).click();
  const dialoog = page.getByRole('dialog', { name: /Melding afhandelen/ });
  await expect(dialoog).toBeVisible();
  await dialoog.getByRole('textbox', { name: /Wat is er gedaan/ }).fill('Bel vervangen');
  await dialoog.getByRole('textbox', { name: /Manuren/ }).fill('0,5');
  await dialoog.getByRole('button', { name: 'Afhandelen' }).click();

  await expect(page.getByText('Bus 26: melding afgehandeld.')).toBeVisible();
  expect(patch, 'PATCH /api/defecten/:id is nooit verstuurd').not.toBeNull();
  expect(patch!.pad).toMatch(/\/api\/defecten\/d1$/);
  expect(patch!.body).toMatchObject({ status: 'uitgevoerd', uitgevoerdWerk: 'Bel vervangen', manuren: 0.5 });
  expect(pageErrors, `page errors:\n${pageErrors.join('\n')}`).toEqual([]);
});
