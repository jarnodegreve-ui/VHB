import { test, expect, type Page } from '@playwright/test';
import { CHAUFFEUR, seed } from './helpers';
import { TECHNIEKER } from '../scripts/audit-fixtures.mjs';

/**
 * 23-09: GET /api/services is alleen nog voor planner en admin. Bewijs dat
 * geen enkel scherm van een chauffeur of technieker de dienstlijst opvraagt:
 * elk scherm van die rol openen (de routetabel, src/app/routes.tsx) en geen
 * enkel verzoek naar /api/services zien. De mock antwoordt 403, zoals de
 * server nu doet, zodat een verborgen gebruiker ook zichtbaar zou breken.
 */

const CHAUFFEUR_PADEN = ['/', '/mijn-dag', '/rooster', '/omleidingen', '/ritbladen', '/dienstruil', '/verlof', '/updates', '/meldingen', '/contacten', '/maandplanning', '/documenten', '/instellingen'];
const TECHNIEKER_PADEN = ['/', '/verlof', '/updates', '/meldingen', '/contacten', '/documenten', '/instellingen', '/techniek/defecten', '/techniek/prestaties', '/techniek/werken', '/techniek/voertuigen'];

async function bezoekAlles(page: Page, user: Record<string, unknown>, paden: string[]) {
  const gevraagd: string[] = [];
  await seed(page, { user });
  await page.route('**/api/services', (route) => {
    gevraagd.push(new URL(page.url()).pathname);
    return route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ error: 'Onvoldoende rechten.' }) });
  });
  for (const pad of paden) {
    await page.goto(pad);
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible({ timeout: 15_000 });
    await page.waitForLoadState('networkidle');
  }
  return gevraagd;
}

test('chauffeur: geen enkel scherm vraagt het dienstoverzicht op', async ({ page }) => {
  expect(await bezoekAlles(page, CHAUFFEUR, CHAUFFEUR_PADEN)).toEqual([]);
});

test('technieker: geen enkel scherm vraagt het dienstoverzicht op', async ({ page }) => {
  expect(await bezoekAlles(page, TECHNIEKER, TECHNIEKER_PADEN)).toEqual([]);
});
