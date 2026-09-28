import { test, expect } from '@playwright/test';
import { CHAUFFEUR, seed } from './helpers';

/**
 * "Ook technieker" (Jarno 28-09): een chauffeur die ook in de garage werkt,
 * op de telefoon. Zijn onderbalk blijft die van een chauffeur; onder "Meer"
 * staat de sectie Techniek erbij en Werkprestaties opent. Een gewone
 * chauffeur heeft er geen, en het loonscherm Dagadministratie blijft voor
 * beiden dicht (dat is iets anders dan zijn werkprestaties).
 */
const OOK_TECHNIEKER = { ...CHAUFFEUR, ookTechnieker: true };
const NIET_VOOR_ROL = 'Dit scherm is niet beschikbaar voor jouw rol.';

test('chauffeur met Ook technieker: chauffeursbalk, Techniek onder Meer, Werkprestaties opent', async ({ page }) => {
  await seed(page, { user: OOK_TECHNIEKER, view: 'mijn-dag' });
  await page.goto('/mijn-dag');
  const dock = page.getByRole('navigation', { name: 'Hoofdnavigatie' });
  await expect(dock).toBeVisible({ timeout: 15_000 });
  await expect(dock.getByRole('button', { name: 'Mijn dag', exact: true })).toBeVisible();
  await expect(dock.getByRole('button', { name: 'Rooster', exact: true })).toBeVisible();
  await expect(dock.getByRole('button', { name: 'Gele boek', exact: true })).toHaveCount(0);

  await dock.getByRole('button', { name: 'Meer', exact: true }).click();
  const zijbalk = page.getByRole('navigation', { name: 'Zijbalk' });
  await expect(zijbalk).toBeVisible();
  for (const label of ['Gele boek', 'Werkprestaties', 'Voertuigen']) {
    await expect(zijbalk.getByRole('button', { name: label, exact: true }), label).toBeVisible();
  }
  await expect(zijbalk.getByRole('button', { name: 'Dagadministratie', exact: true })).toHaveCount(0);

  await zijbalk.getByRole('button', { name: 'Werkprestaties', exact: true }).click();
  await expect(page).toHaveURL(/\/techniek\/prestaties$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Werkprestaties' })).toBeVisible();
  await expect(page.getByText(NIET_VOOR_ROL)).toHaveCount(0);
});

test('gewone chauffeur: geen Techniek onder Meer, en een techniekpad gaat terug naar het dashboard', async ({ page }) => {
  await seed(page, { user: CHAUFFEUR, view: 'mijn-dag' });
  await page.goto('/mijn-dag');
  const dock = page.getByRole('navigation', { name: 'Hoofdnavigatie' });
  await expect(dock).toBeVisible({ timeout: 15_000 });
  await dock.getByRole('button', { name: 'Meer', exact: true }).click();
  const zijbalk = page.getByRole('navigation', { name: 'Zijbalk' });
  await expect(zijbalk.getByRole('button', { name: 'Rooster', exact: true })).toBeVisible();
  await expect(zijbalk.getByRole('button', { name: 'Werkprestaties', exact: true })).toHaveCount(0);

  await page.goto('/techniek/prestaties');
  await expect(page.getByText(NIET_VOOR_ROL)).toBeVisible({ timeout: 15_000 });
  await expect(page).not.toHaveURL(/techniek/);
});

test('met Ook technieker blijft het loonscherm Dagadministratie dicht', async ({ page }) => {
  await seed(page, { user: OOK_TECHNIEKER, view: 'mijn-dag' });
  await page.goto('/beheer/dagadministratie');
  await expect(page.getByText(NIET_VOOR_ROL)).toBeVisible({ timeout: 15_000 });
  await expect(page).not.toHaveURL(/dagadministratie/);
});
