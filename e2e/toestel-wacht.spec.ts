import { test, expect, type Route } from '@playwright/test';
import { CHAUFFEUR, seed } from './helpers';

/**
 * Toestel wacht op goedkeuring (P3, 23-09): het wachtscherm is de melding.
 * Vroeger gaf elke laadcall met een 403 device_pending een rode "Kon … niet
 * laden. Controleer je verbinding."-toast, die in de wachtrij bleef staan en
 * na de goedkeuring allemaal tegelijk verscheen.
 */

const WACHT = { status: 403, contentType: 'application/json', body: JSON.stringify({ error: 'Dit toestel wacht op goedkeuring door de planning.', code: 'device_pending' }) };
const DATA = /\/api\/(planning|diversions|updates|leave|meldingen|swaps|users|documents)/;

test('wachtscherm zonder laadfout-toasts, en na goedkeuring de app zonder rode meldingen', async ({ page }) => {
  let goedgekeurd = false;
  await seed(page, { user: CHAUFFEUR, extra: (p) => (p.endsWith('/api/devices/register') && !goedgekeurd ? { status: 'pending' } : undefined) });
  // Het toestel wordt midden in de sessie op wachten gezet: het profiel kwam
  // nog binnen, de gegevens niet meer.
  await page.route(DATA, (route: Route) => (goedgekeurd ? route.fallback() : route.fulfill(WACHT)));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Toestel wacht op goedkeuring' })).toBeVisible();
  // De gebundelde laadfout-toast komt na 400 ms; wacht daar ruim overheen.
  await page.waitForTimeout(900);

  goedgekeurd = true;
  await page.getByRole('button', { name: 'Opnieuw controleren' }).click();
  await expect(page.getByRole('navigation').first()).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Toestel wacht op goedkeuring' })).toHaveCount(0);
  await page.waitForTimeout(900);
  await expect(page.getByText(/niet laden/)).toHaveCount(0);
  await expect(page.getByText(/Controleer je verbinding/)).toHaveCount(0);
});

test('nieuw toestel (profiel 403 device_pending): wachtscherm, na goedkeuring de app zonder rode meldingen', async ({ page }) => {
  let goedgekeurd = false;
  await seed(page, { user: CHAUFFEUR, extra: (p) => (p.endsWith('/api/devices/register') && !goedgekeurd ? { status: 'pending' } : undefined) });
  await page.route('**/api/me', (route: Route) => (goedgekeurd ? route.fallback() : route.fulfill(WACHT)));
  await page.route(DATA, (route: Route) => (goedgekeurd ? route.fallback() : route.fulfill(WACHT)));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Toestel wacht op goedkeuring' })).toBeVisible();
  await page.waitForTimeout(900);

  goedgekeurd = true;
  await page.getByRole('button', { name: 'Opnieuw controleren' }).click();
  await expect(page.getByRole('navigation').first()).toBeVisible();
  await page.waitForTimeout(900);
  await expect(page.getByText(/niet laden/)).toHaveCount(0);
});
