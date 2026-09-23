import { test, expect } from '@playwright/test';
import { ADMIN, seed } from './helpers';
import { dayOffset } from '../scripts/audit-fixtures.mjs';

/**
 * Datumtranche PR 3: de compacte en navigatievelden, desktop en iPhone.
 * Een getypte datum stuurt het scherm (URL), een ongeldige niet; een
 * navigatieveld (`wisbaar={false}`) krijgt na leegmaken zijn datum terug.
 */
const dmj = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

test('rapportperiode: typen zet van/tot in de URL, een onbestaande dag niet', async ({ page }) => {
  await seed(page, { user: ADMIN });
  await page.goto('/rapporten/ziekte/ziekte-kalenderdagen?van=2026-01-01&tot=2026-12-31');
  const van = page.getByLabel('Van', { exact: true });
  await expect(van).toHaveValue('01/01/2026');
  await van.fill('01/03/2026');
  await van.press('Enter');
  await expect(page).toHaveURL(/van=2026-03-01/);

  await van.fill('31/02/2026');
  await van.blur();
  await expect(page.getByText('Die dag bestaat niet.')).toBeVisible();
  await expect(page).toHaveURL(/van=2026-03-01/);

  // Tot vóór van: de bestaande grens, ook bij typen.
  const tot = page.getByLabel('Tot en met', { exact: true });
  await tot.fill('01/02/2026');
  await tot.blur();
  await expect(page.getByText('Vroegst 01/03/2026.')).toBeVisible();
  await expect(page).toHaveURL(/tot=2026-12-31/);
});

test('dagnavigatie Dagadministratie: typen gaat naar die dag, leegmaken zet de dag terug', async ({ page }) => {
  await seed(page, { user: ADMIN });
  const gisteren = dayOffset(-1);
  const eerder = dayOffset(-3);
  await page.goto(`/beheer/dagadministratie/${gisteren}`);
  const dagVeld = page.getByLabel('Dag', { exact: true });
  await expect(dagVeld).toHaveValue(dmj(gisteren));

  await dagVeld.fill(dmj(eerder));
  await dagVeld.press('Enter');
  await expect(page).toHaveURL(new RegExp(`/beheer/dagadministratie/${eerder}$`));

  await dagVeld.fill('');
  await dagVeld.blur();
  await expect(dagVeld).toHaveValue(dmj(eerder));
  await expect(page).toHaveURL(new RegExp(`/beheer/dagadministratie/${eerder}$`));

  // Geen Wissen in de kalender van een navigatieveld.
  await dagVeld.locator('xpath=following-sibling::button[1]').click();
  const kalender = page.getByRole('dialog', { name: 'Dag' });
  await expect(kalender.getByRole('button', { name: 'Vandaag' })).toBeVisible();
  await expect(kalender.getByRole('button', { name: 'Wissen' })).toHaveCount(0);
});
