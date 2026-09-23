import { test, expect } from '@playwright/test';
import { ADMIN, CHAUFFEUR, seed } from './helpers';
import { logIn, zonderSessie } from './deeplinkHulp';

/**
 * Deeplinks V1 (tranche 3C, 23-09).
 *
 * Login → oorspronkelijke bestemming: een link naar een ingelogd scherm,
 * geopend zonder sessie, toont het inlogscherm op dezelfde URL en brengt je
 * na het inloggen daar terug. Alleen interne schermen; de rol-guard blijft
 * beslissen.
 */

test.describe('login → oorspronkelijke bestemming', () => {
  test('een scherm zonder sessie: inlogscherm op dezelfde URL, daarna dat scherm', async ({ page }) => {
    await zonderSessie(page, CHAUFFEUR);
    await page.goto('/verlof');
    await expect(page.getByRole('button', { name: 'Inloggen' })).toBeVisible();
    expect(new URL(page.url()).pathname).toBe('/verlof');
    await logIn(page);
    await expect(page.getByRole('heading', { level: 1, name: 'Verlof' })).toBeVisible();
    expect(new URL(page.url()).pathname).toBe('/verlof');
  });

  test('herladen op het inlogscherm houdt de bestemming vast', async ({ page }) => {
    await zonderSessie(page, CHAUFFEUR);
    await page.goto('/omleidingen');
    await expect(page.getByRole('button', { name: 'Inloggen' })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('button', { name: 'Inloggen' })).toBeVisible();
    expect(new URL(page.url()).pathname).toBe('/omleidingen');
    await logIn(page);
    await expect(page.getByRole('heading', { level: 1, name: 'Omleidingen' })).toBeVisible();
  });

  test('zonder bestemming blijft het dashboard de start', async ({ page }) => {
    await zonderSessie(page, CHAUFFEUR);
    await page.goto('/');
    await logIn(page);
    await expect(page.getByRole('navigation').first()).toBeVisible();
    expect(new URL(page.url()).pathname).toBe('/');
  });

  test('een gemanipuleerde bestemming leidt nooit weg van het portaal', async ({ page }) => {
    await zonderSessie(page, CHAUFFEUR);
    // Scheme-relatief in het pad: de browser houdt dit op onze origin, de app
    // kent het niet als scherm en valt terug op het dashboard.
    await page.goto('/%2F%2Fevil.example%2Fverlof');
    await logIn(page);
    await expect(page.getByRole('navigation').first()).toBeVisible();
    const url = new URL(page.url());
    expect(url.hostname).toBe('localhost');
    expect(url.pathname).toBe('/');
  });

  test('de rol blijft beslissen: een chauffeur landt niet op een beheerscherm', async ({ page }) => {
    await zonderSessie(page, CHAUFFEUR);
    await page.goto('/beheer/gebruikers');
    await logIn(page);
    await expect(page.getByText('Dit scherm is niet beschikbaar voor jouw rol.')).toBeVisible();
    await expect.poll(() => new URL(page.url()).pathname).toBe('/');
    // Eén beslissing van de rol-guard, niet twee (de login zet eerst het doel, dan de gebruiker).
    await expect(page.getByText('Dit scherm is niet beschikbaar voor jouw rol.')).toHaveCount(1);
  });

  test('staf komt op het beheerscherm van de link', async ({ page }) => {
    await zonderSessie(page, ADMIN);
    await page.goto('/beheer/gebruikers?zoek=test');
    await logIn(page);
    await expect(page.getByRole('heading', { level: 1, name: 'Gebruikers' })).toBeVisible();
    const url = new URL(page.url());
    expect(url.pathname).toBe('/beheer/gebruikers');
    expect(url.searchParams.get('zoek')).toBe('test');
  });
});

test('toestel wacht op goedkeuring: het scherm laadt (eigen chunk sinds 3C.1)', async ({ page }) => {
  await seed(page, { user: CHAUFFEUR, extra: (p) => (p.endsWith('/api/devices/register') ? { status: 'pending' } : undefined) });
  // Zoals de server bij een toestel dat nog niet goedgekeurd is: /api/me geeft 403 device_pending.
  await page.route('**/api/me', (route) => route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ error: 'Dit toestel wacht op goedkeuring.', code: 'device_pending' }) }));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Toestel wacht op goedkeuring' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Opnieuw controleren' })).toBeVisible();
});
