import { test, expect } from '@playwright/test';
import { ADMIN, seed } from './helpers';
import { PLANNING, SWAPS } from '../scripts/audit-fixtures.mjs';

/**
 * Weekoverzicht dienstwissels (bewijsstuk voor het klassement): het
 * printscherm toont de wissels die die week in het portaal zijn uitgevoerd,
 * sinds 16-10 compact: één tabelregel per wissel, zonder verloop of reden.
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
  await expect(page.getByRole('button', { name: 'Afdrukken' })).toBeVisible();
  // Kop van PrintBlad: de week in woorden; geen 'Afgedrukt op' en geen paraafstrook meer.
  await expect(page.getByText(/^Doorgevoerd in week \d{1,2} · \d{2}\/\d{2}\/\d{4} t\/m \d{2}\/\d{2}\/\d{4}$/)).toBeVisible();
  await expect(page.getByText(/Afgedrukt op/)).toHaveCount(0);
  await expect(page.getByText('Paraaf planning')).toHaveCount(0);
  // Gegroepeerd per dag van de dienst (kopregel met de datum), daaronder één
  // regel per wissel: dienst, soort, naam (geeft af), naam (neemt over), aangevraagd, bevestigd.
  const [j, m, d] = PLANNING[0].date.split('-');
  await expect(page.getByRole('cell', { name: new RegExp(`^[a-z]+dag ${d}/${m}/${j}$`) })).toBeVisible();
  const rij = page.getByRole('row').filter({ hasText: 'Alex Du Priez' });
  await expect(rij).toHaveCount(1);
  await expect(rij.getByRole('cell', { name: String(PLANNING[0].line) })).toBeVisible();
  // Bij een ruil klein onder de soort wat er terugkomt (fixture: VRIJ = vrije dag).
  await expect(rij.getByRole('cell', { name: /^Ruil tegen vrije dag, / })).toBeVisible();
  await expect(rij.getByRole('cell', { name: 'Diether Van Haute' })).toBeVisible();
  await expect(rij.getByRole('cell', { name: 'nog niet' })).toBeVisible();
  // Wat er sinds 16-10 niet meer op staat: uitvoerder, verloop en reden.
  await expect(page.getByText('Test Planning')).toHaveCount(0);
  await expect(page.getByText('Dienstruil aangevraagd')).toHaveCount(0);
  await expect(page.getByText('Familiefeest')).toHaveCount(0);
  expect(pageErrors).toEqual([]);
});
