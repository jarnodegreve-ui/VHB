import { test, expect } from '@playwright/test';
import { CHAUFFEUR, seed } from './helpers';

/**
 * Mijn week (verbeterronde 4, punt 3): de zeven dagen vanaf vandaag als strook
 * op Mijn dag. De rekenregels zitten in src/lib/mijnWeek.test.ts; hier alleen
 * wat een chauffeur ziet: dienst, verlof, vrij en "nog niet gepland", zonder
 * dat de strook buiten een telefoonscherm valt.
 */
const dag = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const PLANNING = [
  { id: 'w1', date: dag(0), startTime: '04:36', endTime: '07:52', line: '2101', busNumber: '', loopnr: '4500', driverId: CHAUFFEUR.id },
  { id: 'w2', date: dag(0), startTime: '13:39', endTime: '17:29', line: '2101', busNumber: '', loopnr: '4611', driverId: CHAUFFEUR.id },
  { id: 'w3', date: dag(1), startTime: '15:41', endTime: '23:16', line: '2607', busNumber: '', driverId: CHAUFFEUR.id },
  { id: 'w4', date: dag(4), startTime: '06:12', endTime: '14:30', line: '4101', busNumber: '', driverId: CHAUFFEUR.id },
];
const VERLOF = [
  { id: 'v1', userId: CHAUFFEUR.id, startDate: dag(2), endDate: dag(2), type: 'betaald_verlof', status: 'approved', createdAt: new Date().toISOString() },
];

test('Mijn dag toont de komende zeven dagen: dienst, verlof, vrij en nog niet gepland', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));
  await seed(page, {
    user: CHAUFFEUR,
    view: 'mijn-dag',
    extra: (pad) => (pad.endsWith('/api/planning') ? PLANNING : pad.endsWith('/api/leave') ? VERLOF : undefined),
  });
  await page.goto('/mijn-dag');

  const week = page.getByRole('region', { name: 'Mijn week' });
  await expect(week).toBeVisible({ timeout: 15_000 });
  const cellen = week.getByRole('listitem');
  await expect(cellen).toHaveCount(7);
  await expect(cellen.nth(0)).toHaveAccessibleName(/dienst 2101, 04:36 tot 17:29, 2 delen$/);
  await expect(cellen.nth(1)).toHaveAccessibleName(/dienst 2607, 15:41 tot 23:16$/);
  await expect(cellen.nth(2)).toHaveAccessibleName(/verlof$/);
  await expect(cellen.nth(3)).toHaveAccessibleName(/vrij$/);
  await expect(cellen.nth(4)).toHaveAccessibleName(/dienst 4101/);
  // Na de laatste geplande dag weten we niets: geen "vrij" beweren.
  await expect(cellen.nth(6)).toHaveAccessibleName(/nog niet gepland$/);

  // De strook past in het scherm (geen horizontale scroll op een telefoon).
  const breder = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  expect(breder).toBe(false);

  // Eén knop naar het rooster, de cellen zelf zijn geen knoppen.
  await week.getByRole('button', { name: 'Rooster' }).click();
  await expect(page).toHaveURL(/\/rooster/);

  expect(pageErrors, `page errors:\n${pageErrors.join('\n')}`).toEqual([]);
});
