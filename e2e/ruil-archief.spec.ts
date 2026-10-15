import { test, expect, type Page, type Request } from '@playwright/test';
import { ADMIN, CHAUFFEUR, seed } from './helpers';
import { dayOffset } from '../scripts/audit-fixtures.mjs';

/**
 * Het archief van de dienstruilen (15-10): de opstart geeft alleen het
 * venster (open of de laatste maanden), Dienstruil haalt de oudere per pagina
 * bij `GET /api/swaps/archief` en plakt ze achter de lijst, tien per stap.
 * Een link naar een oude ruil haalt die ene ruil op (`GET /api/swaps/:id`).
 */

const dagenGeleden = (n: number) => new Date(Date.now() - n * 864e5).toISOString();
const knop = (page: Page, tekst: RegExp) => page.getByRole('button', { name: tekst });
const rijenVan = (page: Page, naam: string) => page.getByRole('list', { name: naam }).locator(':scope > li');

const ruil = (id: string, dagen: number, lijn: number, extra: Record<string, unknown> = {}) => ({
  id, shiftId: `x-${id}`, requesterId: '43', targetDriverId: '44', status: 'rejected', reason: '',
  createdAt: dagenGeleden(dagen + 1), decidedAt: dagenGeleden(dagen), shiftDate: dayOffset(-dagen), shiftLine: String(lijn), ...extra,
});

/** Het archief zoals de server het geeft: per pagina, met het totaal. */
const archiefVan = (alle: Array<Record<string, unknown>>, gevraagd: string[] = []) => (request: Request) => {
  const q = new URL(request.url()).searchParams;
  gevraagd.push(q.toString());
  const persoon = q.get('persoon');
  const gefilterd = persoon ? alle.filter((r) => r.requesterId === persoon || r.targetDriverId === persoon) : alle;
  const vanaf = Number(q.get('vanaf') ?? 0);
  const aantal = Number(q.get('aantal') ?? 10);
  return { ruilen: gefilterd.slice(vanaf, vanaf + aantal), totaal: gefilterd.length, grens: '2026-07-01' };
};

test('staf: Afgehandeld loopt na het venster door in het archief, tien per stap', async ({ page }) => {
  const venster = Array.from({ length: 5 }, (_, i) => ruil(`v${i}`, i + 1, 3001 + i));
  const archief = Array.from({ length: 12 }, (_, i) => ruil(`a${i}`, 100 + i, 3101 + i));
  const gevraagd: string[] = [];
  const lees = archiefVan(archief, gevraagd);
  await seed(page, {
    user: ADMIN, view: 'ruil-verzoeken',
    extra: (p, request) => (p.endsWith('/api/swaps') ? venster : p.endsWith('/api/swaps/archief') ? lees(request) : undefined),
  });
  await page.goto('/dienstruil');
  const rijen = page.getByText(/^Dienst 3\d\d\d/);
  // Vijf uit het venster en de eerste vijf uit het archief.
  await expect(rijen).toHaveCount(10);
  await expect(rijen.nth(5)).toContainText('Dienst 3101');
  await expect(knop(page, /^Toon 7 oudere/)).toContainText('10 van 17');
  await knop(page, /^Toon 7 oudere/).click();
  await expect(rijen).toHaveCount(17);
  expect(gevraagd).toContain('vanaf=10&aantal=10');
  await expect(knop(page, /^Toon \d+ oudere/)).toHaveCount(0);
});

test('staf: de filter per persoon geldt ook in het archief', async ({ page }) => {
  const venster = [ruil('v0', 1, 3001)];
  const archief = [ruil('a0', 100, 3101), ruil('a1', 101, 3102, { requesterId: '42', targetDriverId: '43' })];
  const gevraagd: string[] = [];
  const lees = archiefVan(archief, gevraagd);
  await seed(page, {
    user: ADMIN, view: 'ruil-verzoeken',
    extra: (p, request) => (p.endsWith('/api/swaps') ? venster : p.endsWith('/api/swaps/archief') ? lees(request) : undefined),
  });
  await page.goto('/dienstruil');
  const rijen = page.getByText(/^Dienst 3\d\d\d/);
  await expect(rijen).toHaveCount(3);
  await page.getByRole('combobox', { name: 'Afgehandeld van' }).selectOption({ label: 'Test Chauffeur' });
  await expect(rijen).toHaveCount(1);
  await expect(rijen.first()).toContainText('Dienst 3102');
  expect(gevraagd.some((q) => q.startsWith('persoon=42'))).toBe(true);
});

test('chauffeur: Mijn verzoeken toont ook de oudere eigen aanvragen uit het archief', async ({ page }) => {
  const eigen = (id: string, dagen: number, lijn: number) => ruil(id, dagen, lijn, { requesterId: '42', targetDriverId: '43' });
  const venster = [eigen('v0', 1, 4001), eigen('v1', 2, 4002)];
  const archief = [eigen('a0', 120, 4101), eigen('a1', 130, 4102), eigen('a2', 140, 4103)];
  const lees = archiefVan(archief);
  await seed(page, {
    user: CHAUFFEUR, view: 'ruil-verzoeken',
    extra: (p, request) => (p.endsWith('/api/swaps') ? venster : p.endsWith('/api/swaps/archief') ? lees(request) : undefined),
  });
  await page.goto('/dienstruil');
  await expect(rijenVan(page, 'Mijn verzoeken')).toHaveCount(5);
  await expect(knop(page, /^Toon \d+ meer/)).toHaveCount(0);
});

test('een link naar een oude ruil die niet in het venster zit, toont die ruil', async ({ page }) => {
  const oud = ruil('oud-1', 200, 4201, { requesterId: '42', targetDriverId: '43' });
  await seed(page, {
    user: CHAUFFEUR, view: 'ruil-verzoeken',
    extra: (p) => (p.endsWith('/api/swaps') ? [] : p.endsWith('/api/swaps/oud-1') ? oud : undefined),
  });
  await page.goto('/dienstruil/oud-1');
  // De alleen-lezen kaart van een ruil die in geen lijst (meer) staat. Op de
  // kaart zelf zoeken: de paginakop heet ook "Dienstruil".
  await expect(page.locator('[data-record="oud-1"]').getByRole('heading', { name: 'Dienstruil', exact: true })).toBeVisible();
  await expect(page.getByText('Deze dienstruil is niet beschikbaar')).toHaveCount(0);
});

test('een link naar een ruil die de server niet kent, geeft de nette melding', async ({ page }) => {
  await seed(page, { user: CHAUFFEUR, view: 'ruil-verzoeken', extra: (p) => (p.endsWith('/api/swaps') ? [] : undefined) });
  await page.goto('/dienstruil/bestaat-niet');
  await expect(page.getByText('Deze dienstruil is niet beschikbaar')).toBeVisible();
});

test('chauffeur: lukt het archief niet, dan nooit "Nog geen ruilverzoeken" maar Opnieuw proberen', async ({ page }) => {
  await seed(page, { user: CHAUFFEUR, view: 'ruil-verzoeken', extra: (p) => (p.endsWith('/api/swaps') ? [] : undefined) });
  let mislukt = true;
  const oud = ruil('a0', 120, 4101, { requesterId: '42', targetDriverId: '43' });
  await page.route('**/api/swaps/archief**', (route) => (mislukt
    ? route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'stuk' }) })
    : route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ruilen: [oud], totaal: 1, grens: '2026-07-01' }) })));
  await page.goto('/dienstruil');
  await expect(knop(page, /^Opnieuw proberen/)).toBeVisible();
  await expect(page.getByText('Nog geen ruilverzoeken')).toHaveCount(0);
  mislukt = false;
  await knop(page, /^Opnieuw proberen/).click();
  await expect(rijenVan(page, 'Mijn verzoeken')).toHaveCount(1);
});

test('een link naar een ruil waarop de server faalt, is een laadfout met Opnieuw proberen, niet "niet beschikbaar"', async ({ page }) => {
  const oud = ruil('oud-1', 200, 4201, { requesterId: '42', targetDriverId: '43' });
  await seed(page, { user: CHAUFFEUR, view: 'ruil-verzoeken', extra: (p) => (p.endsWith('/api/swaps') ? [] : undefined) });
  let mislukt = true;
  await page.route('**/api/swaps/oud-1', (route) => (mislukt
    ? route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'stuk' }) })
    : route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(oud) })));
  await page.goto('/dienstruil/oud-1');
  await expect(page.getByText('Deze dienstruil kon niet geladen worden')).toBeVisible();
  await expect(page.getByText('Deze dienstruil is niet beschikbaar')).toHaveCount(0);
  mislukt = false;
  await page.getByRole('button', { name: 'Opnieuw proberen', exact: true }).click();
  await expect(page.locator('[data-record="oud-1"]').getByRole('heading', { name: 'Dienstruil', exact: true })).toBeVisible();
  await expect(page.getByText('Deze dienstruil kon niet geladen worden')).toHaveCount(0);
});
