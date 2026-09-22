import { test, expect } from '@playwright/test';
import { ADMIN, seed } from './helpers';
import { dayOffset } from '../scripts/audit-fixtures.mjs';

/**
 * Loon (fase B Access-migratie): de planner opent de dagafsluiting van
 * gisteren, wijzigt de gereden code en de overminuten van een chauffeur
 * (PUT met alleen de gewijzigde velden) en sluit de dag af (POST). De
 * looncontrole toont de maandstand en de controle vóór de export.
 */

test('planner past een rij aan en sluit de dag af', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));
  const gisteren = dayOffset(-1);
  const puts: Array<{ pad: string; body: Record<string, unknown> }> = [];
  let afgesloten: string | null = null;
  await seed(page, {
    user: ADMIN,
    view: 'dagafsluiting',
    extra: (pad, request) => {
      if (pad.includes('/api/dagafsluiting/') && pad.includes('/rijen/') && request.method() === 'PUT') {
        const body = JSON.parse(request.postData() ?? '{}');
        puts.push({ pad, body });
        return { id: 'p1', datum: gisteren, userId: '42', naam: 'Test Chauffeur', volgnr: 1, planningCode: '2101', geredenCode: body.geredenCode ?? '2101', overmin: body.overmin ?? 0, overminNacht: 0, overminExtra: 0, onvPremie: false, qualOngeval: false, qualPanne: false, qualVerkeersovertreding: false, qualKlantklacht: false, qualAdmfout: false, qualInterneklacht: false, qualVertragingDrSchuld: false, qualRitNtGeredenDrSchuld: false, opmerking: null, bewerktOp: new Date().toISOString(), bewerktDoor: '1' };
      }
      if (pad.endsWith('/afsluiten') && request.method() === 'POST') {
        afgesloten = pad;
        return { datum: gisteren, status: 'afgesloten', geopendOp: new Date().toISOString(), geopendDoor: '1', afgeslotenOp: new Date().toISOString(), afgeslotenDoor: '1', heropendOp: null, heropendDoor: null, heropendReden: null };
      }
      return undefined;
    },
  });
  await page.goto(`/beheer/dagadministratie/${gisteren}`);

  await expect(page.getByRole('heading', { name: 'Dagadministratie', level: 1 })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('3 rijen')).toBeVisible();

  // Gereden code van Test Chauffeur naar 2607, overminuten 30.
  await page.getByRole('combobox', { name: 'Gereden code van Test Chauffeur' }).selectOption('2607');
  await expect.poll(() => puts.length).toBe(1);
  expect(puts[0].pad).toMatch(new RegExp(`/api/dagafsluiting/${gisteren}/rijen/p1$`));
  expect(puts[0].body).toEqual({ geredenCode: '2607' });

  const rij = page.getByRole('row').filter({ hasText: 'Test Chauffeur' });
  await rij.getByRole('textbox', { name: 'Overminuten', exact: true }).fill('30');
  await rij.getByRole('textbox', { name: 'Opmerking voor Test Chauffeur' }).focus();
  await expect.poll(() => puts.length).toBe(2);
  expect(puts[1].body).toEqual({ overmin: 30 });

  // Dag afsluiten via de bevestiging.
  await page.getByRole('button', { name: 'Dag afsluiten' }).click();
  await page.getByRole('button', { name: 'Afsluiten', exact: true }).click();
  await expect(page.getByText('Afgesloten', { exact: true })).toBeVisible();
  expect(afgesloten).toMatch(new RegExp(`/api/dagafsluiting/${gisteren}/afsluiten$`));
  expect(pageErrors, `page errors:\n${pageErrors.join('\n')}`).toEqual([]);
});

test('looncontrole toont de maandstand en de exportcontrole', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));
  await seed(page, { user: ADMIN, view: 'looncontrole' });
  await page.goto('/beheer/looncontrole');
  await expect(page.getByRole('heading', { name: 'Looncontrole', level: 1 })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('Easypay-export')).toBeVisible();
  await expect(page.getByText(/dagen nog open/)).toBeVisible();
  await page.getByRole('button', { name: 'Looncodes' }).click();
  await expect(page.getByText('Betaald verlof')).toBeVisible();
  await page.getByRole('button', { name: 'Medewerkers' }).click();
  await expect(page.getByText(/zonder Easypay-matricule/)).toBeVisible();
  expect(pageErrors, `page errors:\n${pageErrors.join('\n')}`).toEqual([]);
});
