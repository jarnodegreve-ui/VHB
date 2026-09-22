import { test, expect } from '@playwright/test';
import { ADMIN, USERS, seed } from './helpers';

/**
 * Vandaag, de dagbriefing van de planner (verbeterronde 4, punt 4). De regels
 * zitten in src/lib/dagBriefing.test.ts; hier wat de planner ziet en waar de
 * rijen hem heen brengen.
 */
const dag = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const [EEN, TWEE, DRIE] = (USERS as Array<{ id: string; name: string; role: string }>).filter((u) => u.role === 'chauffeur');

const PLANNING = [
  { id: 'v1', date: dag(0), startTime: '05:30', endTime: '13:45', line: '2101', busNumber: '', driverId: EEN.id },
  { id: 'v2', date: dag(0), startTime: '15:00', endTime: '23:00', line: '2230', busNumber: '', driverId: DRIE.id },
];
const VERLOF = [
  { id: 'z1', userId: EEN.id, startDate: dag(0), endDate: dag(2), type: 'ziekte', status: 'approved', createdAt: new Date().toISOString() },
  { id: 'z2', userId: TWEE.id, startDate: dag(-1), endDate: dag(0), type: 'betaald_verlof', status: 'approved', createdAt: new Date().toISOString() },
];
const RUILEN = [
  { id: 'r1', shiftId: 'v2', requesterId: DRIE.id, targetDriverId: TWEE.id, status: 'accepted', createdAt: new Date().toISOString(), shiftDate: dag(0), shiftLine: '2230', returnDate: dag(5), returnCode: 'vrij' },
];
const DEKKING = { days: [{ date: dag(0), missing: ['2101', '4407'] }] };

const extra = (pad: string) =>
  pad.endsWith('/api/planning') ? PLANNING
    : pad.endsWith('/api/leave') ? VERLOF
      : pad.endsWith('/api/swaps') ? RUILEN
        : pad.endsWith('/api/coverage-gaps') ? DEKKING
          : undefined;

test('Vandaag brengt afwezigen, open diensten, ruilen en omleidingen van de dag samen', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));
  await seed(page, { user: ADMIN, view: 'vandaag', extra });
  await page.goto('/vandaag');

  await expect(page.getByRole('heading', { level: 1, name: 'Vandaag' })).toBeVisible({ timeout: 15_000 });
  // 1 dienst te herverdelen + 1 open dienst (2101 telt niet dubbel) + 1 ruil.
  await expect(page.getByText('3 punten vragen nog een beslissing')).toBeVisible();

  await expect(page.getByRole('button', { name: new RegExp(EEN.name) })).toContainText('Ziek · 2101 (05:30) te herverdelen');
  await expect(page.getByText(`${TWEE.name}`).first()).toBeVisible();
  const open = page.getByRole('list', { name: 'Diensten zonder chauffeur' });
  await expect(open.getByRole('listitem')).toHaveCount(1);
  await expect(open).toContainText('4407');
  await expect(page.getByRole('button', { name: /Dienst 2230/ })).toContainText('collega akkoord, wacht op validatie');

  // De rij brengt je naar het scherm waar je beslist.
  await page.getByRole('button', { name: /Dienst 2230/ }).click();
  await expect(page).toHaveURL(/\/dienstruil|\/ruil/);

  expect(pageErrors, `page errors:\n${pageErrors.join('\n')}`).toEqual([]);
});

test('Morgen zonder iets te melden toont één rustige lege staat', async ({ page }) => {
  await seed(page, { user: ADMIN, view: 'vandaag', extra: (pad) => (pad.endsWith('/api/diversions') ? [] : pad.endsWith('/api/coverage-gaps') ? { days: [] } : extra(pad)) });
  await page.goto('/vandaag');
  await expect(page.getByRole('heading', { level: 1, name: 'Vandaag' })).toBeVisible({ timeout: 15_000 });
  await page.getByRole('group', { name: 'Dag kiezen' }).getByRole('button', { name: 'Morgen' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Morgen' })).toBeVisible();
  // Morgen is EEN nog ziek, maar zonder dienst: geen punt dat een beslissing vraagt.
  await expect(page.getByText('Alles geregeld voor morgen')).toBeVisible();
});
