import { test, expect, type Page } from '@playwright/test';
import { ADMIN, CHAUFFEUR, seed, type Extra } from './helpers';
import { SWAPS } from '../scripts/audit-fixtures.mjs';
import { vandaagIso } from './deeplinkHulp';

/**
 * Paneel "Wacht op jouw antwoord" op het chauffeursdashboard (03-10): een ruil
 * die een collega hem voorstelde (pending) of een goedgekeurde ruil die hij
 * nog niet bevestigde, met een rij die de ruil zelf opent (/dienstruil/<id>),
 * en hetzelfde getal op de Meer-tab. Staf en een chauffeur zonder wachtende
 * ruil zien het paneel niet.
 *
 * Fixture sw1: Alex Du Priez (43) vraagt de testchauffeur (42), pending.
 */

const nu = new Date().toISOString();
/** Goedgekeurde overname die de testchauffeur nog moet bevestigen. */
const SW5 = { id: 'sw5', shiftId: 's2', requesterId: '43', targetDriverId: '42', status: 'approved', swapType: 'overname', reason: '', createdAt: nu, decidedAt: nu, shiftDate: vandaagIso(6), shiftLine: '2305' };
/** Eigen verzoek: wacht op de collega, niet op mij. */
const SW6 = { id: 'sw6', shiftId: 't1', requesterId: '42', targetDriverId: '44', status: 'pending', reason: '', createdAt: nu, shiftDate: vandaagIso(2), shiftLine: '2101', returnDate: vandaagIso(4), returnCode: 'vrij' };

const met = (ruilen: unknown[]): Extra => (p) => (p.endsWith('/api/swaps') ? ruilen : undefined);
const sw1 = { ...SWAPS[0], shiftDate: vandaagIso(1), shiftLine: '2104' };

const paneel = (page: Page) => page.getByRole('heading', { name: 'Wacht op jouw antwoord' });
const meer = (page: Page) => page.getByRole('navigation', { name: 'Hoofdnavigatie' }).getByRole('button', { name: /^Meer/ });

test.describe('wacht op jouw antwoord', () => {
  test('chauffeur: paneel met de vraag van de collega en de te bevestigen ruil, rij opent de ruil', async ({ page }) => {
    await seed(page, { user: CHAUFFEUR, extra: met([sw1, SW5, SW6]) });
    await page.goto('/');
    await expect(paneel(page)).toBeVisible();
    const rijen = page.getByTestId('ruil-wacht-op-mij').getByRole('button');
    await expect(rijen).toHaveCount(2);
    // Antwoorden eerst, dan bevestigen; het eigen verzoek staat er niet.
    await expect(rijen.nth(0)).toContainText('Alex Du Priez wil ruilen');
    await expect(rijen.nth(0)).toContainText('2104');
    await expect(rijen.nth(1)).toContainText('Je rijdt de dienst van Alex Du Priez');
    await expect(rijen.nth(1)).toContainText('bevestig dat je het zag');
    await rijen.nth(0).click();
    await expect.poll(() => new URL(page.url()).pathname).toBe('/dienstruil/sw1');
    await expect(page.locator('[data-record="sw1"]')).toBeInViewport();
  });

  test('chauffeur: het getal op Meer telt dezelfde ruilen', async ({ page, isMobile }) => {
    test.skip(!isMobile, 'de Meer-tab bestaat alleen in het dock op de telefoon');
    await seed(page, { user: CHAUFFEUR, extra: met([sw1, SW5, SW6]) });
    await page.goto('/');
    await expect(meer(page)).toHaveAccessibleName('Meer, 2 ruilen wachten op jouw antwoord');
    await expect(meer(page)).toContainText('2');
  });

  test('chauffeur zonder wachtende ruil: geen paneel en een kale Meer-tab', async ({ page, isMobile }) => {
    await seed(page, { user: CHAUFFEUR, extra: met([SW6]) });
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Komende diensten' })).toBeVisible();
    await expect(paneel(page)).toHaveCount(0);
    if (isMobile) await expect(meer(page)).toHaveAccessibleName('Meer');
  });

  test('staf ziet het paneel niet, ook niet met open ruilen', async ({ page }) => {
    await seed(page, { user: ADMIN, extra: met([sw1, SW5]) });
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Open taken' })).toBeVisible();
    await expect(paneel(page)).toHaveCount(0);
  });
});
