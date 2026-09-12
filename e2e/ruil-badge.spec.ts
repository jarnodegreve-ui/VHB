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

test('rooster en Mijn dag tonen van wie een overgenomen dienst komt', async ({ page }) => {
  await seed(page, { user: CHAUFFEUR, view: 'rooster', extra: (pad) => (pad.endsWith('/api/swaps') ? OVERNAME : undefined) });
  // Het rooster rendert kaart-, tabel- en lijstvorm; op mobiel is er één
  // zichtbaar, dus op de zichtbare badge filteren.
  const badge = () => page.locator('span:visible', { hasText: 'Overgenomen van Alex Du Priez' }).first();
  await page.goto('/rooster');
  await expect(badge()).toBeVisible();

  await page.goto('/mijn-dag');
  await expect(badge()).toBeVisible();
});
