import { test, expect, type Page } from '@playwright/test';
import { CHAUFFEUR, seed } from './helpers';
import { dayOffset } from '../scripts/audit-fixtures.mjs';

/**
 * Ronde 6 (11-11), kortere wegen op Mijn dag:
 * - de omleidingen volgen de gekozen dag: op Morgen wat morgen loopt (ook wat
 *   morgen pas start), niet wat vandaag eindigt;
 * - een tik op een omleiding opent die omleiding zelf (/omleidingen/<id>),
 *   niet de lijst.
 *
 * De planning is leeg: geen dienst van gisteren die nog loopt, dus "vandaag"
 * is hier altijd de kalenderdag, op elk uur.
 */
const EINDIGT_VANDAAG = { id: 'o-vandaag', line: '58', title: 'Markt afgesloten tot vanavond', description: 'Omleiding via de ring.', startDate: dayOffset(-5), endDate: dayOffset(0), severity: 'medium' };
const START_MORGEN = { id: 'o-morgen', line: '23', title: 'Werken Stationsstraat vanaf morgen', description: 'Halte Station vervalt.', startDate: dayOffset(1), endDate: dayOffset(10), severity: 'medium' };
const LOOPT_DOOR = { id: 'o-door', line: '50', title: 'Brug dicht deze week', description: 'Via de N9.', startDate: dayOffset(-2), endDate: dayOffset(5), severity: 'medium' };
const LATER = { id: 'o-later', line: '871', title: 'Kermis volgende week', description: 'Centrum afgesloten.', startDate: dayOffset(6), endDate: dayOffset(8), severity: 'low' };

const metOmleidingen = (page: Page) => seed(page, {
  user: CHAUFFEUR,
  view: 'mijn-dag',
  extra: (pad) => (pad.endsWith('/api/diversions') ? [EINDIGT_VANDAAG, START_MORGEN, LOOPT_DOOR, LATER] : pad.endsWith('/api/planning') ? [] : undefined),
});

const pad = (page: Page) => new URL(page.url()).pathname;
/** De schakelaar Vandaag | Morgen bovenaan Mijn dag. */
const dag = (page: Page, naam: 'Vandaag' | 'Morgen') => page.getByRole('group', { name: 'Dag kiezen' }).getByRole('button', { name: naam, exact: true });

test.describe('Mijn dag: omleidingen van de gekozen dag', () => {
  test('Morgen toont wat morgen start en niet wat vandaag eindigt', async ({ page }) => {
    await metOmleidingen(page);
    await page.goto('/mijn-dag');
    const sectie = page.getByRole('region', { name: 'Omleidingen' });
    const rij = (titel: string) => sectie.getByRole('button', { name: new RegExp(titel) });

    // Vandaag: wat vandaag loopt, ook wat vandaag zijn laatste dag heeft.
    await expect(sectie).toBeVisible({ timeout: 15_000 });
    await expect(rij(EINDIGT_VANDAAG.title)).toBeVisible();
    await expect(rij(LOOPT_DOOR.title)).toBeVisible();
    await expect(rij(START_MORGEN.title)).toHaveCount(0);
    await expect(rij(LATER.title)).toHaveCount(0);
    await expect(sectie.getByText('2 actief', { exact: true })).toBeVisible();

    // Morgen: wat morgen start staat er, wat vandaag eindigde niet meer.
    await dag(page, 'Morgen').click();
    await expect(rij(START_MORGEN.title)).toBeVisible();
    await expect(rij(LOOPT_DOOR.title)).toBeVisible();
    await expect(rij(EINDIGT_VANDAAG.title)).toHaveCount(0);
    await expect(rij(LATER.title)).toHaveCount(0);
    await expect(sectie.getByText('2 morgen', { exact: true })).toBeVisible();

    // En terug: Vandaag is weer wat het was.
    await dag(page, 'Vandaag').click();
    await expect(rij(EINDIGT_VANDAAG.title)).toBeVisible();
    await expect(rij(START_MORGEN.title)).toHaveCount(0);
  });

  test('een tik opent die omleiding zelf, terug = Mijn dag', async ({ page, isMobile }) => {
    await metOmleidingen(page);
    await page.goto('/mijn-dag');
    const sectie = page.getByRole('region', { name: 'Omleidingen' });
    await expect(sectie).toBeVisible({ timeout: 15_000 });
    await dag(page, 'Morgen').click();
    await sectie.getByRole('button', { name: new RegExp(START_MORGEN.title) }).click();

    await expect.poll(() => pad(page)).toBe(`/omleidingen/${START_MORGEN.id}`);
    // De omleiding zelf staat open: op de telefoon een paneel, op desktop naast de lijst.
    const detail = page.getByRole(isMobile ? 'dialog' : 'region', { name: START_MORGEN.title, exact: true });
    await expect(detail).toBeVisible({ timeout: 15_000 });
    await expect(detail).toContainText('Halte Station vervalt.');

    // Terug: op de telefoon sluit de eerste stap het paneel, daarna ben je weer op Mijn dag.
    await page.goBack();
    if (pad(page) !== '/mijn-dag') await page.goBack();
    await expect.poll(() => pad(page)).toBe('/mijn-dag');
    await expect(page.getByRole('region', { name: 'Omleidingen' })).toBeVisible();
  });
});
