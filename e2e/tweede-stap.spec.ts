import { test, expect, type Page } from '@playwright/test';
import { ADMIN, apiFixtures } from '../scripts/audit-fixtures.mjs';
import { logIn } from './deeplinkHulp';

/**
 * Niets laden vóór aal2 (07-10): een planner of admin met twee-stapsverificatie
 * krijgt na het wachtwoord eerst het codescherm, en tot de code gegeven is
 * vertrekt er geen enkel gegevensverzoek met het aal1-token. Vroeger vroeg
 * handleLogin de gebruikerslijst al op en liet een onleesbare status van de
 * client de hele laadronde door; de server weigerde die verzoek voor verzoek
 * (mfa_required). De aanmelddienst en de API zijn nagebootst zoals in de
 * andere specs; het token is een echte JWT-vorm, want de client leest het
 * niveau (aal) uit het token zelf.
 */

const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
const token = (aal: 'aal1' | 'aal2') =>
  `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: 'auth-e2e', aud: 'authenticated', role: 'authenticated', aal, amr: [{ method: 'password', timestamp: 1 }], exp: Math.floor(Date.now() / 1000) + 3600 })}.e2e`;
const FACTOR = { id: 'f1', factor_type: 'totp', friendly_name: 'Telefoon', status: 'verified', created_at: '2026-09-07T10:00:00Z', updated_at: '2026-09-07T10:00:00Z' };
const GEBRUIKER = { id: 'auth-e2e', email: ADMIN.email, aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, factors: [FACTOR] };
const sessie = (aal: 'aal1' | 'aal2') => ({
  access_token: token(aal), refresh_token: `ververs-${aal}`, token_type: 'bearer', expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600, user: GEBRUIKER,
});

/** Wat de server ook op aal1 beantwoordt (MFA_EXEMPT in api/middleware.ts), plus
 *  de bereikcontrole van useOnline (HEAD /api/health, zonder sessie). */
const VRIJ = ['/api/auth/session', '/api/me', '/api/me/beveiliging', '/api/devices/register', '/api/client-errors', '/api/health'];

type Staat = { niveau: 'aal1' | 'aal2'; gebruikerFaalt: boolean; verzoeken: string[] };
const nietVrijOpAal1 = (staat: Staat) => staat.verzoeken.filter((v) => v.startsWith('aal1 ') && !VRIJ.includes(v.split(' ')[2]));

async function opzet(page: Page, staat: Staat) {
  // Playwright kiest de laatst geregistreerde route die past: eerst de vangnetten.
  await page.route('**/auth/v1/**', (route) => route.fulfill({ status: 404, contentType: 'application/json', body: '{}' }));
  await page.route('**/auth/v1/logout**', (route) => route.fulfill({ status: 204, body: '' }));
  await page.route('**/auth/v1/token**', (route) => route.fulfill({ json: sessie(staat.niveau) }));
  // De status van de tweede stap: de client leest de factoren via /auth/v1/user.
  await page.route('**/auth/v1/user**', (route) => (staat.gebruikerFaalt
    ? route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'storing' }) })
    : route.fulfill({ json: GEBRUIKER })));
  await page.route('**/auth/v1/factors/f1/challenge**', (route) => route.fulfill({ json: { id: 'c1', type: 'totp', expires_at: Math.floor(Date.now() / 1000) + 300 } }));
  await page.route('**/auth/v1/factors/f1/verify**', (route) => {
    staat.niveau = 'aal2';
    return route.fulfill({ json: sessie('aal2') });
  });
  const beveiliging = () => ({ mfaVerplicht: true, aal: staat.niveau });
  const fixtures = apiFixtures(ADMIN, (p: string) => (
    p.endsWith('/api/auth/session') ? { ...ADMIN, beveiliging: beveiliging() }
      : p.endsWith('/api/me') ? { ...ADMIN, toestel: { status: 'approved', gateActief: false }, beveiliging: beveiliging() }
        : undefined));
  await page.route('**/api/**', (route) => {
    const p = new URL(route.request().url()).pathname;
    staat.verzoeken.push(`${staat.niveau} ${route.request().method()} ${p}`);
    if (staat.niveau === 'aal1' && !VRIJ.includes(p)) {
      return route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ error: 'Twee-stapsverificatie is vereist voor dit account.', code: 'mfa_required' }) });
    }
    return fixtures(route);
  });
}

test('staf met tweede stap: na het wachtwoord eerst de code, en geen enkel gegevensverzoek vóór aal2', async ({ page }) => {
  const staat: Staat = { niveau: 'aal1', gebruikerFaalt: false, verzoeken: [] };
  await opzet(page, staat);
  await page.goto('/');
  await logIn(page);

  await expect(page.getByRole('heading', { name: 'Code uit je authenticator' })).toBeVisible({ timeout: 15_000 });
  const code = page.getByLabel('Code uit je authenticator-app');
  await expect(code).toBeVisible();
  // Even wachten op wat nog zou kunnen vertrekken: niets mag.
  await page.waitForTimeout(1500);
  expect(nietVrijOpAal1(staat)).toEqual([]);
  await expect(page.getByText(/Kon .* niet laden/)).toHaveCount(0);

  await code.fill('123456');
  await page.getByRole('button', { name: 'Bevestigen' }).click();
  await expect(page.getByRole('navigation').first()).toBeVisible({ timeout: 15_000 });
  // Pas na de code komen de gegevens, met het aal2-token.
  await expect.poll(() => staat.verzoeken.includes('aal2 GET /api/users')).toBe(true);
  expect(nietVrijOpAal1(staat)).toEqual([]);
});

test('status van de tweede stap onleesbaar: de server eist de code, dus niets laden en een weg terug op het scherm', async ({ page }) => {
  const staat: Staat = { niveau: 'aal1', gebruikerFaalt: true, verzoeken: [] };
  await opzet(page, staat);
  await page.goto('/');
  await logIn(page);

  await expect(page.getByRole('heading', { name: 'Code uit je authenticator' })).toBeVisible({ timeout: 15_000 });
  const opnieuw = page.getByRole('button', { name: 'Opnieuw proberen' });
  await expect(opnieuw).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(1000);
  expect(nietVrijOpAal1(staat)).toEqual([]);
  await expect(page.getByText(/Kon .* niet laden/)).toHaveCount(0);

  // Zodra de aanmelddienst weer antwoordt, leest het scherm de factor zelf.
  staat.gebruikerFaalt = false;
  await opnieuw.click();
  await expect(page.getByLabel('Code uit je authenticator-app')).toBeVisible({ timeout: 15_000 });
  expect(nietVrijOpAal1(staat)).toEqual([]);
});
