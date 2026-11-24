import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { ADMIN, AXE_TAGS, seed } from './helpers';

/**
 * Dekking-grens (24-11, akkoord Jarno): de dekking stopt op de laatste dag met
 * een dienst, de grens waarop Rooster en Maandplanning al stoppen. De server
 * geeft geen dagen na die grens en zegt in `planningTot` tot wanneer er
 * planning is; het dashboard leest dezelfde grens uit `x-planning-tot`.
 * Daarna is een dag niet "open" en ook niet "gedekt": er is geen planning.
 *
 * Draait in iPhone 13 (chromium): de naam staat in geen eigen project van
 * playwright.config.ts. De proeven zetten zelf een desktopvenster, want
 * "Deze week" bestaat pas vanaf lg. Elke proef heeft een vaste klok en eigen
 * gegevens (grens 03/01/2027, zoals productie op 24-11): niets hangt af van vandaag.
 */
test.use({ viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false });

const GRENS = '2027-01-03';
const iso = (d: Date) => d.toISOString().slice(0, 10);
const dagenTussen = (van: string, tot: string) => {
  const uit: string[] = [];
  for (let d = new Date(`${van}T00:00:00Z`); iso(d) <= tot; d.setUTCDate(d.getUTCDate() + 1)) uit.push(iso(d));
  return uit;
};

/** Zoals de server sinds 24-11: dagen van [van, tot] tot en met de grens, plus `planningTot`. */
const dekking = (van: string, tot: string, grens: string | null, open: Record<string, string[]>) => ({
  from: van,
  to: tot,
  days: dagenTussen(van, grens && grens < tot ? grens : tot).map((date) => {
    const missing = open[date] ?? [];
    return { date, dayType: 'schooldag', expected: 2, covered: 2 - missing.length, missing, unknown: [], bron: { soort: 'basis' } };
  }),
  planningTot: grens,
});

const CONFIG = {
  services: ['2101', '2607'],
  dayTypes: [{ name: 'schooldag', services: ['2101', '2607'] }],
  weekdays: Array(7).fill('schooldag'),
  weekdayPeriods: [],
  overrides: [],
};

/** Een paar diensten tot de grens: het dashboard heeft planning (geen "begin hier"). */
const PLANNING = dagenTussen('2026-12-28', GRENS).map((date, i) => ({ id: `p${i}`, date, startTime: '06:12', endTime: '14:30', line: '2101', busNumber: '', loopnr: '4500', driverId: '42' }));

type Opties = { nu: string; grens: string | null; header?: boolean; open?: Record<string, string[]>; vasthouden?: (van: string) => Promise<void> | undefined };

async function open(page: Page, pad: string, { nu, grens, header = true, open: gaten = {}, vasthouden }: Opties) {
  await page.clock.setFixedTime(new Date(nu));
  await seed(page, {
    user: ADMIN,
    extra: (p) => (p.endsWith('/api/coverage-expectations') ? CONFIG : p.endsWith('/api/coverage-expectation-check') ? { afwijkingen: [] } : undefined),
  });
  // Na de seed gezet, dus eerst aan de beurt.
  await page.route((url) => url.pathname.endsWith('/api/planning'), (route) => route.fulfill({
    status: 200, contentType: 'application/json', headers: header && grens ? { 'x-planning-tot': grens } : {}, body: JSON.stringify(PLANNING),
  }));
  await page.route((url) => url.pathname.endsWith('/api/coverage-gaps'), async (route) => {
    const url = new URL(route.request().url());
    const van = url.searchParams.get('from') ?? '';
    const tot = url.searchParams.get('to') ?? '';
    await vasthouden?.(van);
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(dekking(van, tot, grens, gaten)) });
  });
  await page.goto(pad);
}

const dezeWeek = (page: Page) => page.getByRole('list', { name: 'Dekking per dag' });
/** De kop van het paneel (OpsPanel): titel links, de korte stand rechts. */
const paneelKop = (page: Page) => page.locator('.surface-card').filter({ has: dezeWeek(page) }).last().locator('> div').first();

test.describe('Dashboard, Deze week', () => {
  test('over de grens heen (klok 30/12/2026): na 3/1 geen stip en geen telling, de open dienst blijft', async ({ page }) => {
    await open(page, '/', { nu: '2026-12-30T08:00:00+01:00', grens: GRENS, open: { '2026-12-31': ['2607'] } });
    const lijst = dezeWeek(page);
    await expect(lijst.getByRole('listitem')).toHaveCount(7, { timeout: 15_000 });
    const cellen = lijst.getByRole('listitem');
    // 30/12 tot 3/1: vier gedekt, één open; 4/1 en 5/1: geen planning.
    await expect(lijst.locator('[aria-label="gedekt"]')).toHaveCount(4);
    await expect(cellen.nth(1)).toHaveAttribute('title', /open: 2607/);
    await expect(cellen.nth(5)).toHaveAttribute('title', /geen planning/);
    await expect(cellen.nth(6)).toHaveAttribute('title', /geen planning/);
    await expect(cellen.nth(5)).toContainText('geen planning');
    await expect(cellen.nth(5).locator('[aria-label="gedekt"]')).toHaveCount(0);
    await expect(paneelKop(page)).toContainText('1 open');
    // axe op de strook. De groene stip van een gedekte dag (aria-label op een
    // kale span, aria-prohibited-attr) bestond al vóór 24-11 en valt buiten
    // deze proef; de nieuwe cellen dragen hun betekenis als tekst.
    const { violations } = await new AxeBuilder({ page }).withTags(AXE_TAGS).include('[aria-label="Dekking per dag"]').exclude('[aria-label="gedekt"]').analyze();
    expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.html).join(' | ')}`)).toEqual([]);
  });

  test('alles gedekt tot de grens: de kop zegt tot wanneer, niet "alles gedekt" voor de hele week', async ({ page }) => {
    await open(page, '/', { nu: '2026-12-30T08:00:00+01:00', grens: GRENS });
    await expect(dezeWeek(page).getByRole('listitem')).toHaveCount(7, { timeout: 15_000 });
    await expect(dezeWeek(page).locator('[aria-label="gedekt"]')).toHaveCount(5);
    await expect(paneelKop(page)).toContainText(/alles gedekt t\/m \S+ 3 jan/);
  });

  test('een week helemaal na de grens (klok 10/01/2027): zeven dagen zonder planning, geen "nog geen verwachte diensten"', async ({ page }) => {
    await open(page, '/', { nu: '2027-01-10T08:00:00+01:00', grens: GRENS });
    const lijst = dezeWeek(page);
    await expect(lijst.getByRole('listitem')).toHaveCount(7, { timeout: 15_000 });
    await expect(lijst.locator('[aria-label="gedekt"]')).toHaveCount(0);
    for (let i = 0; i < 7; i += 1) await expect(lijst.getByRole('listitem').nth(i)).toHaveAttribute('title', /geen planning/);
    await expect(paneelKop(page)).toContainText('geen planning');
    await expect(page.getByText('Nog geen verwachte diensten')).toHaveCount(0);
  });

  test('zonder grens van de server: zoals vroeger', async ({ page }) => {
    await open(page, '/', { nu: '2026-12-30T08:00:00+01:00', grens: null, open: { '2026-12-31': ['2607'] } });
    const lijst = dezeWeek(page);
    await expect(lijst.getByRole('listitem')).toHaveCount(7, { timeout: 15_000 });
    await expect(lijst.locator('[aria-label="gedekt"]')).toHaveCount(6);
    await expect(lijst.getByText('geen planning')).toHaveCount(0);
    await expect(paneelKop(page)).toContainText('1 open');
  });
});

test.describe('Openstaande diensten', () => {
  const NU = '2026-12-30T08:00:00+01:00';
  const titel = (page: Page) => page.getByRole('heading', { name: 'Openstaande diensten', level: 1 });
  const regel = (page: Page) => page.getByText('De planning loopt tot en met 03/01/2027.');

  test('januari 2027: de open diensten tot de grens, plus de regel', async ({ page }) => {
    await open(page, '/openstaande-diensten/2027-01', { nu: NU, grens: GRENS, open: { '2027-01-02': ['2607'] } });
    await expect(titel(page)).toBeVisible({ timeout: 15_000 });
    await expect(regel(page)).toBeVisible();
    await expect(page.getByText('1 niet-ingevulde dienst deze maand')).toBeVisible();
    await expect(page.getByText(/Nog geen planning/)).toHaveCount(0);
  });

  test('februari 2027: geen planning voor die maand, nooit "alle verwachte diensten zijn ingevuld"', async ({ page }) => {
    await open(page, '/openstaande-diensten/2027-02', { nu: NU, grens: GRENS });
    await expect(titel(page)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Nog geen planning voor februari 2027.')).toBeVisible();
    await expect(regel(page)).toBeVisible();
    await expect(page.getByText('Alle verwachte diensten zijn ingevuld')).toHaveCount(0);
    await expect(page.getByText(/Geen openstaande diensten/)).toHaveCount(0);
  });

  test('naar de volgende maand: de regel van januari blijft niet staan terwijl februari laadt', async ({ page }) => {
    let laatGaan!: () => void;
    const februari = new Promise<void>((r) => { laatGaan = r; });
    await open(page, '/openstaande-diensten/2027-01', {
      nu: NU, grens: GRENS, open: { '2027-01-02': ['2607'] },
      vasthouden: (van) => (van.startsWith('2027-02') ? februari : undefined),
    });
    await expect(regel(page)).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: 'Volgende maand' }).click();
    await expect(page.getByText('Februari 2027', { exact: true })).toBeVisible();
    await expect(regel(page)).toHaveCount(0);
    await expect(page.getByText(/niet-ingevulde/)).toHaveCount(0);
    laatGaan();
    await expect(page.getByText('Nog geen planning voor februari 2027.')).toBeVisible();
    await expect(regel(page)).toBeVisible();
  });
});
