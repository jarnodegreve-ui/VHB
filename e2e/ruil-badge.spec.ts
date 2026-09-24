import { test, expect } from '@playwright/test';
import { CHAUFFEUR, seed } from './helpers';
import { dayOffset, PLANNING } from '../scripts/audit-fixtures.mjs';

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

// Rooster: een overgenomen dienst van MORGEN, zodat de test niet van het uur
// afhangt (J, 24-09: na haar eindtijd staat een dienst van vandaag in het
// ingeklapte verleden). Mijn dag houdt de dienst van vandaag.
const MORGEN_SHIFT = { id: 't9', date: dayOffset(1), startTime: '06:00', endTime: '14:00', line: '2101', busNumber: '', loopnr: '4500', driverId: '42' };
const OVERNAME_MORGEN = [{ ...OVERNAME[0], id: 'sw10', shiftId: 't9', shiftDate: dayOffset(1) }];

test('rooster toont van wie een overgenomen dienst komt', async ({ page }) => {
  await seed(page, {
    user: CHAUFFEUR,
    view: 'rooster',
    extra: (pad) => (pad.endsWith('/api/swaps') ? OVERNAME_MORGEN : pad.endsWith('/api/planning') ? [...PLANNING, MORGEN_SHIFT] : undefined),
  });
  await page.goto('/rooster');
  await expect(badge(page)).toBeVisible();
});

test('Mijn dag toont van wie een overgenomen dienst komt', async ({ page }) => {
  await seed(page, { user: CHAUFFEUR, view: 'mijn-dag', extra: OVERNAME_EXTRA });
  await page.goto('/mijn-dag');
  await expect(badge(page)).toBeVisible();
});
