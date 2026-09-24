import { test, expect } from '@playwright/test';
import { CHAUFFEUR, seed } from './helpers';
import { dayOffset } from '../scripts/audit-fixtures.mjs';

/**
 * "Geruild met X" / "Overgenomen van X" op de eigen diensten (vraag Jarno
 * 12-09). De chauffeur nam vandaag dienst 2101 over van Alex; rooster en
 * Mijn dag moeten dat tonen. De koppeling loopt op datum + dienstnummer, dus
 * de badge overleeft een herimport (rij-id's veranderen dan).
 */
const OVERNAME = [{
  id: 'sw9', shiftId: 't1', requesterId: '43', targetDriverId: '42', status: 'approved', swapType: 'overname',
  reason: 'Tandarts', createdAt: new Date(Date.now() - 7200e3).toISOString(), decidedAt: new Date(Date.now() - 3600e3).toISOString(),
  shiftDate: dayOffset(0), shiftLine: '2101',
}];

const OVERNAME_EXTRA = (pad: string) => (pad.endsWith('/api/swaps') ? OVERNAME : undefined);
// Het rooster rendert kaart-, tabel- en lijstvorm; op mobiel is er één
// zichtbaar, dus op de zichtbare badge filteren.
const badge = (page: import('@playwright/test').Page) => page.locator('span:visible', { hasText: 'Overgenomen van Alex Du Priez' }).first();

test('rooster toont van wie een overgenomen dienst komt', async ({ page }) => {
  await seed(page, { user: CHAUFFEUR, view: 'rooster', extra: OVERNAME_EXTRA });
  // Vaste klok (J, 24-09): na 17:29 is dienst 2101 gereden en staat ze in het
  // ingeklapte verleden; de badge hoort bij de dienst van vandaag om 10:00.
  const tien = new Date(); tien.setHours(10, 0, 0, 0);
  await page.clock.setFixedTime(tien);
  await page.goto('/rooster');
  await expect(badge(page)).toBeVisible();
});

test('Mijn dag toont van wie een overgenomen dienst komt', async ({ page }) => {
  // Zonder nagebootste klok: Mijn dag toont de dienst van vandaag ook na haar eindtijd.
  await seed(page, { user: CHAUFFEUR, view: 'mijn-dag', extra: OVERNAME_EXTRA });
  await page.goto('/mijn-dag');
  await expect(badge(page)).toBeVisible();
});
