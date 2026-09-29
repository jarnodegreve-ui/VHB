import { test, expect, type Page } from '@playwright/test';
import { ADMIN, seed } from './helpers';

/**
 * Laadfouten veilig (release-safety, 24-09): een collectie die niet kon laden
 * is een Foutkaart met retry, nooit een lege staat met create-acties.
 * - Dienstoverzicht: geen "Nog geen diensten / 0 van 0", geen Nieuwe dienst.
 * - Planningscodes: geen lege lijst, Opslaan en Code toevoegen uit, zodat
 *   een onbekende staat nooit als lege staat opgeslagen kan worden.
 * - Mails (nr. 14): geen lege lijsten en geen "Mail versturen" of "Nieuwe
 *   lijst"; op een omleiding geen "Nog geen verzendlijsten".
 * Retry laadt de collectie en herstelt het scherm.
 */

/** De Foutkaart (role=alert) heeft haar eigen retry; de laadfout-toast van de
 *  datalaag ook, dus klik altijd die van de kaart. */
function breekbaar(page: Page, pad: RegExp) {
  const s = { kapot: true };
  void page.route(pad, (r) => (s.kapot && r.request().method() === 'GET'
    ? r.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"Serverfout"}' })
    : r.fallback()));
  return s;
}

test('Dienstoverzicht: laadfout = Foutkaart met retry, geen lege staat en geen Nieuwe dienst', async ({ page }) => {
  await seed(page, { user: ADMIN });
  const s = breekbaar(page, /\/api\/services(\?|$)/);
  await page.goto('/beheer/dienstoverzicht');
  const kaart = page.getByText('Het dienstoverzicht kon niet laden.');
  await expect(kaart).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('Nog geen diensten')).toHaveCount(0);
  await expect(page.getByText('0 van 0')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Nieuwe dienst' })).toHaveCount(0);
  s.kapot = false;
  await page.getByRole('alert').getByRole('button', { name: 'Opnieuw proberen' }).click();
  await expect(page.getByRole('button', { name: 'Dienst 2515 openen' }).filter({ visible: true }).first()).toBeVisible({ timeout: 15_000 });
  await expect(kaart).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Nieuwe dienst' })).toBeVisible();
});

test('Planningscodes: laadfout = Foutkaart, Opslaan en Code toevoegen uit tot de retry slaagt', async ({ page }) => {
  await seed(page, { user: ADMIN });
  const s = breekbaar(page, /\/api\/planning-codes(\?|$)/);
  await page.goto('/beheer/planningscodes');
  const kaart = page.getByText('De planningscodes konden niet laden.');
  await expect(kaart).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('Nog geen planningscodes')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Opslaan' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Code toevoegen' }).first()).toBeDisabled();
  s.kapot = false;
  await page.getByRole('alert').getByRole('button', { name: 'Opnieuw proberen' }).click();
  await expect(kaart).toHaveCount(0, { timeout: 15_000 });
  await expect(page.getByRole('button', { name: 'Opslaan' })).toBeEnabled();
  // Na de retry: de kopknop én (bij een lege collectie) die in de lege staat.
  await expect(page.getByRole('button', { name: 'Code toevoegen' }).first()).toBeEnabled();
});

test('Mails: laadfout = Foutkaart met retry, geen lege lijsten en geen Mail versturen', async ({ page }) => {
  await seed(page, { user: ADMIN, view: 'beheer-mails' });
  const s = breekbaar(page, /\/api\/mails(\?|$)/);
  await page.goto('/beheer/mails');
  const kaart = page.getByRole('alert').filter({ hasText: 'De mails konden niet laden.' });
  await expect(kaart).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('Nog geen verzendlijsten')).toHaveCount(0);
  await expect(page.getByText('Nog niets verstuurd')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Mail versturen' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Nieuwe lijst' })).toHaveCount(0);
  s.kapot = false;
  await kaart.getByRole('button', { name: 'Opnieuw proberen' }).click();
  await expect(page.getByRole('list', { name: 'Automatische mails' })).toBeVisible({ timeout: 15_000 });
  await expect(kaart).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Mail versturen' })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Nieuwe lijst' })).toBeEnabled();
});

test('Omleiding mailen: verzendlijsten die niet laden zijn een Foutkaart, geen "Nog geen verzendlijsten"', async ({ page, isMobile }) => {
  const omleiding = { id: 'd1', line: '58', location: 'Zottegem', title: 'Werken Markt Zottegem', description: 'Omleiding via de ring.', startDate: '2026-09-20', endDate: '2026-10-10', _rev: 'r1', bijlagen: [] };
  await seed(page, {
    user: ADMIN, view: 'beheer-omleidingen',
    extra: (pad, request) => {
      if (pad.endsWith('/api/diversions') && request.method() === 'GET') return [omleiding];
      if (pad.endsWith('/api/mails/verzendlijsten') && request.method() === 'GET') return [{ id: 'l-1', naam: 'De Lijn', adressen: ['dispatching@delijn.be'] }];
      return undefined;
    },
  });
  const s = breekbaar(page, /\/api\/mails\/verzendlijsten(\?|$)/);
  await page.goto('/beheer/omleidingen/d1');
  const bewerk = page.getByRole(isMobile ? 'dialog' : 'region', { name: /Omleiding bewerken/ });
  await bewerk.getByRole('button', { name: 'Meer acties' }).click();
  await page.getByRole('menuitem', { name: 'Mailen…' }).click();
  const paneel = page.getByRole('dialog', { name: 'Omleiding mailen' });
  const kaart = paneel.getByRole('alert').filter({ hasText: 'De verzendlijsten konden niet laden.' });
  await expect(kaart).toBeVisible({ timeout: 15_000 });
  await expect(paneel.getByText(/Nog geen verzendlijsten/)).toHaveCount(0);
  // Een vrij adres blijft kunnen.
  await expect(paneel.getByLabel('Vrije adressen')).toBeEditable();
  s.kapot = false;
  await kaart.getByRole('button', { name: 'Opnieuw proberen' }).click();
  await expect(paneel.getByRole('checkbox', { name: 'Verzendlijst De Lijn' })).toBeAttached({ timeout: 15_000 });
  await expect(kaart).toHaveCount(0);
});
