import { test, expect } from '@playwright/test';
import { ADMIN, seed } from './helpers';
import { PLANNING, SWAPS } from '../scripts/audit-fixtures.mjs';

/**
 * Weekoverzicht dienstwissels (bewijsstuk voor het klassement): het
 * printscherm toont de wissels die die week in het portaal zijn uitgevoerd,
 * met hun verloop uit het activiteitenlog.
 */
test('planning print het weekoverzicht van de uitgevoerde dienstwissels', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));
  const wissel = SWAPS[0];
  const uitgevoerdOp = new Date().toISOString();
  await seed(page, {
    user: ADMIN,
    view: 'ruil-verzoeken',
    extra: (pad) => pad.endsWith('/api/swaps/uitgevoerd')
      ? {
          wissels: [{
            swap: { ...wissel, status: 'approved', shiftId: PLANNING[0].id, shiftDate: PLANNING[0].date, shiftLine: PLANNING[0].line },
            aanvragerNaam: 'Alex Du Priez',
            overnemerNaam: 'Diether Van Haute',
            uitgevoerdOp,
            uitgevoerdDoor: 'Test Planning',
            uitgevoerdDoorRol: 'planner',
            handmatig: false,
            verloop: [{ id: 'h1', createdAt: wissel.createdAt, actorName: 'Alex Du Priez', actorRole: 'chauffeur', category: 'swaps', action: 'Dienstruil aangevraagd', details: '' }],
          }],
        }
      : undefined,
  });
  await page.addInitScript(() => { window.print = () => {}; });
  await page.goto(`/?ruiloverzicht-week=${uitgevoerdOp.slice(0, 10)}`);

  await expect(page.getByRole('heading', { name: 'Ruiloverzicht', level: 1 })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('button', { name: 'Print / Opslaan als PDF' })).toBeVisible();
  await expect(page.getByText('Alex Du Priez').first()).toBeVisible();
  await expect(page.getByText('Test Planning')).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Dienstruil aangevraagd' })).toBeVisible();
  await expect(page.getByText('“Familiefeest”')).toBeVisible();
  expect(pageErrors).toEqual([]);
});
