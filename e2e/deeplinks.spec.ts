import { test, expect, type Page } from '@playwright/test';
import { ADMIN, CHAUFFEUR, type Fixture } from './helpers';
import { apiFixtures } from '../scripts/audit-fixtures.mjs';

/**
 * Deeplinks V1 (tranche 3C, 23-09).
 *
 * Login → oorspronkelijke bestemming: een link naar een ingelogd scherm,
 * geopend zonder sessie, toont het inlogscherm op dezelfde URL en brengt je
 * na het inloggen daar terug. Alleen interne schermen; de rol-guard blijft
 * beslissen.
 */

/** Geen sessie; na "Inloggen" geeft de Supabase-mock een sessie voor `user`. */
async function zonderSessie(page: Page, user: Fixture) {
  await page.route('**/auth/v1/**', (route) => {
    const nu = Math.floor(Date.now() / 1000);
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        access_token: 'e2e', refresh_token: 'e2e', token_type: 'bearer', expires_in: 3600, expires_at: nu + 3600,
        user: { id: 'auth-e2e', email: user.email, aud: 'authenticated', role: 'authenticated' },
      }),
    });
  });
  await page.route('**/api/**', apiFixtures(user, (p: string) => (p.endsWith('/api/auth/session') ? user : undefined)));
}

async function logIn(page: Page) {
  await page.getByPlaceholder('naam@bedrijf.be').fill('test@vhb.be');
  await page.getByLabel(/wachtwoord/i).first().fill('geheim-geheim');
  await page.getByRole('button', { name: 'Inloggen' }).click();
}

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
    expect(new URL(page.url()).pathname).toBe('/');
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
