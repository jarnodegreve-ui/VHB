import { test, expect, type Page } from '@playwright/test';
import { apiFixtures, CHAUFFEUR } from '../scripts/audit-fixtures.mjs';
import { seed } from './helpers';

/**
 * Uitnodiging voor het portaal (30-09): de link uit de mail
 * (`/#uitnodiging=<code>`) opent de landing, de code verdwijnt meteen uit de
 * adresbalk, en na het kiezen van een wachtwoord staat de chauffeur in de
 * app, via dezelfde weg als een gewone aanmelding. De server en Supabase Auth
 * zijn onderschept; wat telt is de volgorde in de browser (ook in WebKit:
 * de mail opent op een iPhone in Safari).
 */

const CODE = '42.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const WACHTWOORD = 'een-goed-wachtwoord';

const sessie = () => ({
  access_token: 'e2e',
  refresh_token: 'e2e',
  token_type: 'bearer',
  expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  user: { id: 'auth-e2e', email: CHAUFFEUR.email, aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {} },
});

/** Supabase Auth: verify (herstel-token), user (wachtwoord), logout en token (aanmelden). */
const onderscheptAuth = async (page: Page) => {
  const gezien = { verify: [] as unknown[], wachtwoord: [] as unknown[], aanmelden: [] as unknown[] };
  await page.route('**/auth/v1/verify**', async (route) => {
    gezien.verify.push(route.request().postDataJSON());
    await route.fulfill({ json: sessie() });
  });
  await page.route('**/auth/v1/user**', async (route) => {
    if (route.request().method() === 'PUT') gezien.wachtwoord.push(route.request().postDataJSON());
    await route.fulfill({ json: sessie().user });
  });
  await page.route('**/auth/v1/logout**', (route) => route.fulfill({ status: 204, body: '' }));
  await page.route('**/auth/v1/token**', async (route) => {
    gezien.aanmelden.push(route.request().postDataJSON());
    await route.fulfill({ json: sessie() });
  });
  return gezien;
};

test('uitnodiging: welkom, wachtwoord kiezen en meteen in de app', async ({ page }) => {
  const geopend: unknown[] = [];
  const afgerond: unknown[] = [];
  await page.route('**/api/**', apiFixtures(CHAUFFEUR, (pad: string) => (pad.endsWith('/api/auth/session') ? { ...CHAUFFEUR, lastLogin: new Date().toISOString() } : undefined)));
  await page.route('**/api/uitnodiging/openen', async (route) => {
    geopend.push(route.request().postDataJSON());
    await route.fulfill({ json: { naam: CHAUFFEUR.name, email: CHAUFFEUR.email, tokenHash: 'hash-e2e' } });
  });
  await page.route('**/api/uitnodiging/afronden', async (route) => {
    afgerond.push(route.request().postDataJSON());
    await route.fulfill({ json: { success: true } });
  });
  const auth = await onderscheptAuth(page);

  await page.goto(`/#uitnodiging=${CODE}`);
  await expect(page.getByRole('heading', { name: `Welkom, ${CHAUFFEUR.name}` })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(CHAUFFEUR.email)).toBeVisible();
  expect(new URL(page.url()).hash, 'de code staat niet meer in de adresbalk').toBe('');
  expect(geopend).toEqual([{ code: CODE }]);
  // Nog geen sessie: die start pas bij het opslaan.
  expect(auth.verify).toEqual([]);

  await page.getByLabel('Kies een wachtwoord').fill(WACHTWOORD);
  await page.getByRole('button', { name: /Wachtwoord opslaan/ }).click();

  await expect(page.locator('[data-scroll-root]')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('heading', { name: `Welkom, ${CHAUFFEUR.name}` })).toHaveCount(0);
  expect(auth.verify).toEqual([expect.objectContaining({ token_hash: 'hash-e2e', type: 'recovery' })]);
  expect(auth.wachtwoord).toEqual([expect.objectContaining({ password: WACHTWOORD })]);
  expect(auth.aanmelden).toEqual([expect.objectContaining({ email: CHAUFFEUR.email, password: WACHTWOORD })]);
  // Na het wachtwoord is de uitnodiging afgerond: de link is geen herstellink meer.
  expect(afgerond).toEqual([{ code: CODE }]);
});

test('verlopen uitnodiging: de uitleg, en "Naar inloggen" toont het gewone loginscherm', async ({ page }) => {
  await page.route('**/api/uitnodiging/openen', (route) => route.fulfill({
    status: 410,
    json: { reden: 'verlopen', error: 'Deze uitnodiging is verlopen, de link werkt 7 dagen. Vraag de planning om een nieuwe.' },
  }));
  await page.goto(`/#uitnodiging=${CODE}`);
  await expect(page.getByRole('heading', { name: 'Uitnodiging verlopen' })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/Vraag de planning om een nieuwe/)).toBeVisible();
  await page.getByRole('button', { name: 'Naar inloggen' }).click();
  await expect(page.getByRole('button', { name: 'Inloggen' })).toBeVisible();
});

test('wie al aangemeld is, blijft in de app en de uitnodiging wordt niet geopend', async ({ page }) => {
  let geopend = 0;
  await seed(page, { user: CHAUFFEUR });
  await page.route('**/api/uitnodiging/openen', (route) => {
    geopend += 1;
    return route.fulfill({ status: 410, json: { reden: 'gebruikt' } });
  });
  await page.goto(`/#uitnodiging=${CODE}`);
  await expect(page.locator('[data-scroll-root]')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/Uitnodiging niet geopend: je bent al aangemeld/)).toBeVisible();
  expect(new URL(page.url()).hash).toBe('');
  expect(geopend).toBe(0);
});
