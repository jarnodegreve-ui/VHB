import type { Page, Request } from '@playwright/test';
import { type Extra, type Fixture } from './helpers';
import { apiFixtures } from '../scripts/audit-fixtures.mjs';

/**
 * Gedeeld door de deeplink-specs (tranche 3C): geen sessie bij het openen;
 * na "Inloggen" geeft de Supabase-mock een sessie voor `user` en beantwoorden
 * de gewone fixtures de API (plus `extra`).
 */
export async function zonderSessie(page: Page, user: Fixture, extra?: Extra) {
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
  await page.route('**/api/**', apiFixtures(user, (p: string, r: Request) => (p.endsWith('/api/auth/session') ? user : extra?.(p, r))));
}

export async function logIn(page: Page) {
  await page.getByPlaceholder('naam@bedrijf.be').fill('test@vhb.be');
  await page.getByLabel(/wachtwoord/i).first().fill('geheim-geheim');
  await page.getByRole('button', { name: 'Inloggen' }).click();
}

/** Vandaag als ISO-dag in de tijdzone van de browser (zoals de app rekent). */
export const vandaagIso = (plus = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + plus);
  return d.toLocaleDateString('sv-SE');
};
