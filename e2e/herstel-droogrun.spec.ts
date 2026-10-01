import { test, expect, type Request } from '@playwright/test';
import { ADMIN, seed } from './helpers';

/**
 * Droge herstelrun (verbeterronde 4, punt 13): het beheerscherm vraagt de
 * server eerst wat een herstel ZOU doen en toont dat plan vóór de bevestiging.
 * De rekenregels zitten in shared/herstelPlan.test.ts.
 */
// Met een activiteitenlog erin, zoals de echte back-up: dat blijft thuis.
const BESTAND = {
  name: 'vhb-backup.json',
  mimeType: 'application/json',
  buffer: Buffer.from(JSON.stringify({
    exportedAt: new Date().toISOString(),
    version: 2,
    collections: { users: [{ id: '1', role: 'admin' }], services: [{ id: 'a' }], activityLog: [{ id: 'log-1', action: 'Aangemeld' }] },
    authUsers: [{ id: '1', email: 'admin@vhb.test' }],
  })),
};
const regel = (collectie: string, over: Record<string, unknown> = {}) =>
  ({ collectie, inBackup: true, overgeslagen: false, backup: 0, live: 0, erbij: 0, weg: 0, blijft: 0, ...over });
const plan = (over: Record<string, unknown> = {}) => ({
  exportedAt: new Date().toISOString(),
  regels: [regel('users', { backup: 1, live: 3, weg: 2, blijft: 1 }), regel('services', { backup: 1, live: 1, blijft: 1 }), regel('swaps', { inBackup: false, live: 4 })],
  blokkades: [],
  waarschuwingen: ["'users': 2 van de 3 huidige records verdwijnen"],
  totaalBackup: 2,
  ...over,
});

test('herstel toont eerst de droge run, en schrijft pas na de bevestiging', async ({ page }) => {
  const aanroepen: string[] = [];
  const verstuurd: string[][] = [];
  await seed(page, {
    user: ADMIN,
    view: 'beheer-debug',
    extra: (pad: string, request: Request) => {
      if (!pad.endsWith('/api/restore')) return undefined;
      const droog = new URL(request.url()).searchParams.get('droog') === '1';
      aanroepen.push(droog ? 'droog' : 'echt');
      const body = request.postDataJSON() as { collections: Record<string, unknown> };
      verstuurd.push(Object.keys(body.collections));
      return droog ? { droog: true, plan: plan() } : { success: true, summary: { users: 1, services: 1 } };
    },
  });
  await page.goto('/beheer/systeemstatus');
  await page.locator('input[type="file"][accept*="json"]').setInputFiles(BESTAND);

  const dialoog = page.getByRole('dialog', { name: 'Back-up terugzetten' });
  await expect(dialoog).toBeVisible({ timeout: 15_000 });
  await expect(dialoog).toContainText('Dit is een droge run: er is nog niets gewijzigd.');
  await expect(dialoog.getByRole('row', { name: /Gebruikers/ })).toContainText('2');
  await expect(dialoog).toContainText('Gebruikers: 2 van de 3 huidige records verdwijnen');
  await expect(dialoog).toContainText('Niet in deze back-up: Dienstruilen.');
  expect(aanroepen).toEqual(['droog']);

  await dialoog.getByRole('button', { name: 'Terugzetten', exact: true }).click();
  await expect.poll(() => aanroepen).toEqual(['droog', 'echt']);
  // Beide verzoeken dragen alleen wat het herstel terugzet: het
  // activiteitenlog (driekwart van een echte back-up) blijft thuis.
  expect(verstuurd).toEqual([['users', 'services'], ['users', 'services']]);
});

test('een blokkade in de droge run zet het herstel op slot', async ({ page }) => {
  await seed(page, {
    user: ADMIN,
    view: 'beheer-debug',
    extra: (pad: string) => (pad.endsWith('/api/restore') ? { droog: true, plan: plan({ blokkades: ["'services': 1 dubbele id (a)"] }) } : undefined),
  });
  await page.goto('/beheer/systeemstatus');
  await page.locator('input[type="file"][accept*="json"]').setInputFiles(BESTAND);
  const dialoog = page.getByRole('dialog', { name: 'Back-up terugzetten' });
  await expect(dialoog.getByRole('alert')).toContainText('dubbele id');
  await expect(dialoog.getByRole('button', { name: 'Terugzetten', exact: true })).toBeDisabled();
});
