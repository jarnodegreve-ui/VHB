import { test, expect, type Page, type Request } from '@playwright/test';
import { ADMIN, USERS, historiekOpgeruimd, kanScrollen, seed } from './helpers';

/**
 * Elke rij opent het juiste record (ronde 6, punt 17).
 *
 * - `/beheer/ziekte/<leaveId>` is het adres van één ziekmelding, volgens het
 *   recept van de andere recordlinks (deeplinks-voertuigen): een koude link
 *   en een herlaad openen het detail, sluiten en Terug gaan naar de lijst,
 *   een onbekend id geeft de nette melding.
 * - "Te herverdelen" op Vandaag, het Overzicht en het dashboard: van een
 *   zieke het detail van zijn ziekmelding, van iemand met verlof de
 *   Maandplanning op die dag.
 * - Een vervaldatum opent de persoon, een open dienst opent Openstaande
 *   diensten op de dag (`/openstaande-diensten/<maand>/<dag>`), ook via de
 *   dienstchips op Vandaag.
 * - Ziek melden op het scherm Ziekte schakelt door naar het detail van de
 *   nieuwe melding (alleen als het melden lukte), en "Stel kandidaten voor"
 *   vult de keuzelijsten in op één klik, in het detail (ook bij één dienst)
 *   en in stap 2 op het dashboard. Er wordt nooit iets vanzelf overgezet.
 */

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const dag = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return iso(d); };
const MAAND = dag(0).slice(0, 7);
const dagenVanMaand = (maand: string) => {
  const [j, m] = maand.split('-').map(Number);
  return Array.from({ length: new Date(j, m, 0).getDate() }, (_, i) => `${maand}-${String(i + 1).padStart(2, '0')}`);
};
type Persoon = { id: string; name: string; role: string };
const [ZIEK, VERLOF, DERDE] = (USERS as Persoon[]).filter((u) => u.role === 'chauffeur');
/** Een vierde chauffeur zonder dienst of afwezigheid: de kandidaat van het advies. */
const VERVANGER = { id: '45', name: 'Vera Vervanger', role: 'chauffeur', employeeId: 'VHB-000045', isActive: true };

const PLANNING = [
  { id: 'p-ziek', date: dag(0), startTime: '05:30', endTime: '13:45', line: '2101', busNumber: '', driverId: ZIEK.id },
  { id: 'p-verlof', date: dag(0), startTime: '14:00', endTime: '22:00', line: '2607', busNumber: '', driverId: VERLOF.id },
  // Rijdt gewoon; wordt in de meldtests ziek gemeld en heeft dan één dienst op naam.
  { id: 'p-derde', date: dag(0), startTime: '06:00', endTime: '14:00', line: '2203', busNumber: '', driverId: DERDE.id },
];
const AFWEZIG = [
  { id: 'z1', userId: ZIEK.id, startDate: dag(0), endDate: dag(2), type: 'ziekte', status: 'approved', createdAt: new Date().toISOString() },
  { id: 'v1', userId: VERLOF.id, startDate: dag(-1), endDate: dag(1), type: 'betaald_verlof', status: 'approved', createdAt: new Date().toISOString() },
];
/** Het bord van de Maandplanning: de afwezigen dragen hun dienst nog op naam (`hiddenService`). */
const maandPlanning = (maand: string) => {
  const dates = dagenVanMaand(maand);
  const cells: Record<string, Record<string, unknown>> = {};
  for (const u of [ZIEK, VERLOF, DERDE]) {
    cells[u.id] = Object.fromEntries(dates.map((d) => [d, { code: '2203', kind: 'service', label: '', segments: ['05:30 - 13:45'] }]));
  }
  if (dates.includes(dag(0))) {
    cells[ZIEK.id][dag(0)] = { code: 'ziek', kind: 'absence', label: 'Ziek', segments: [], hiddenService: '2101' };
    cells[VERLOF.id][dag(0)] = { code: 'bv', kind: 'leave', label: 'Betaald verlof', segments: [], hiddenService: '2607' };
  }
  return { month: maand, dates, drivers: [ZIEK, VERLOF, DERDE].map((u) => ({ id: u.id, name: u.name })), cells, geimporteerd: { eerste: dag(-90), laatste: dag(90) } };
};
const DEKKING_CONFIG = {
  dayTypes: [{ name: 'schooldag', services: ['2101', '2607', '2203', '4407'] }],
  weekdays: Array(7).fill('schooldag'),
  weekdayPeriods: [],
  overrides: [],
};
/** Vandaag mist 2101, 2607 (allebei van een afwezige) en 4407; elke even dag mist 2203, zodat de lijst langer is dan het scherm. */
const dekkingGaten = (van: string, tot: string) => {
  const days: unknown[] = [];
  for (let d = new Date(`${van}T00:00:00`); iso(d) <= tot; d.setDate(d.getDate() + 1)) {
    const datum = iso(d);
    const missing = datum === dag(0) ? ['2101', '2607', '4407'] : d.getDate() % 2 === 0 ? ['2203'] : [];
    days.push({ date: datum, dayType: 'schooldag', expected: 4, covered: 4 - missing.length, missing, bron: { soort: 'basis' } });
  }
  return { days };
};
const VERVALDATA = [{ userId: DERDE.id, soort: 'code95', validUntil: dag(5) }];

const extra = (pad: string, request: Request) => {
  if (request.method() !== 'GET') return undefined;
  const url = new URL(request.url());
  if (pad.endsWith('/api/planning')) return PLANNING;
  if (pad.endsWith('/api/users')) return [...USERS, VERVANGER];
  if (pad.endsWith('/api/leave')) return AFWEZIG;
  if (pad.endsWith('/api/swaps')) return [];
  if (pad.endsWith('/api/devices')) return [];
  if (pad.endsWith('/api/user-expiries')) return VERVALDATA;
  if (pad.endsWith('/api/month-planning')) return maandPlanning(url.searchParams.get('month') ?? MAAND);
  if (pad.endsWith('/api/coverage-expectations')) return DEKKING_CONFIG;
  if (pad.includes('/api/coverage-gaps')) return dekkingGaten(url.searchParams.get('from') ?? dag(0), url.searchParams.get('to') ?? dag(0));
  if (pad.endsWith('/api/coverage-expectation-check')) return { afwijkingen: [] };
  if (pad.endsWith('/api/ziekte-zonder-registratie')) return { reeksen: [] };
  return undefined;
};

const pad = (page: Page) => new URL(page.url()).pathname;
const ZIEKTE = '/beheer/ziekte';
const detail = (page: Page, naam = ZIEK.name) => page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: naam, exact: true }) });
const onbekend = (page: Page) => page.getByText('Deze ziekmelding is niet beschikbaar');
const ziekteKop = (page: Page) => page.getByRole('heading', { level: 1, name: 'Ziekte', exact: true });

async function schoon(page: Page) {
  await kanScrollen(page);
  await historiekOpgeruimd(page);
  await expect.poll(() => page.evaluate(() => (history.state as { vhbOuderStap?: unknown } | null)?.vhbOuderStap ?? null)).toBeNull();
}

/** De rij van de dag uit het adres op Openstaande diensten: gemarkeerd, met de focus en binnen beeld. */
async function dagInBeeld(page: Page, datum: string) {
  const rij = page.locator(`[data-record="${datum}"][aria-current="true"]`).locator('visible=true');
  await expect(rij).toHaveCount(1, { timeout: 15_000 });
  await expect(rij).toBeFocused();
  await expect(rij).toBeInViewport();
}

test.describe('het adres van één ziekmelding', () => {
  test('koude link opent het detail, ook na herladen', async ({ page }) => {
    await seed(page, { user: ADMIN, extra });
    await page.goto(`${ZIEKTE}/z1`);
    await expect(detail(page)).toBeVisible({ timeout: 15_000 });
    // De toestand van het detail hoort bij dit record: de einddatum en de dienst die nog op naam staat.
    await expect(detail(page).getByLabel('Ziek tot en met', { exact: true })).toHaveAttribute('data-datum', dag(2));
    await expect(detail(page).getByText('Dienst 2101', { exact: true })).toBeVisible();
    await page.reload();
    await expect(detail(page)).toBeVisible({ timeout: 15_000 });
    expect(pad(page)).toBe(`${ZIEKTE}/z1`);
    await expect(page.getByRole('dialog')).toHaveCount(1);
    await expect(detail(page).getByLabel('Ziek tot en met', { exact: true })).toHaveAttribute('data-datum', dag(2));
  });

  test('sluiten op een koude link gaat naar de lijst zonder dubbele entry', async ({ page }) => {
    await seed(page, { user: ADMIN, extra });
    await page.goto(`${ZIEKTE}/z1`);
    await expect(detail(page)).toBeVisible({ timeout: 15_000 });
    await detail(page).getByRole('button', { name: 'Sluiten', exact: true }).first().click();
    await expect(detail(page)).toHaveCount(0);
    await expect.poll(() => pad(page)).toBe(ZIEKTE);
    await expect(onbekend(page)).toHaveCount(0);
    await schoon(page);
    await page.goBack();
    await expect.poll(() => page.url()).toBe('about:blank');
  });

  test('terug vanaf een koude link: eerst de lijst, daarna het portaal uit', async ({ page }) => {
    await seed(page, { user: ADMIN, extra });
    await page.goto(`${ZIEKTE}/z1`);
    await expect(detail(page)).toBeVisible({ timeout: 15_000 });
    await page.goBack();
    await expect(detail(page)).toHaveCount(0);
    await expect.poll(() => pad(page)).toBe(ZIEKTE);
    await expect(ziekteKop(page)).toBeVisible();
    await schoon(page);
    await page.goBack();
    await expect.poll(() => page.url()).toBe('about:blank');
  });

  test('een klik in de lijst zet het record in het adres; sluiten haalt het er weer uit', async ({ page }) => {
    await seed(page, { user: ADMIN, extra });
    await page.goto(ZIEKTE);
    await expect(ziekteKop(page)).toBeVisible({ timeout: 15_000 });
    await page.getByRole('region', { name: 'Actueel', exact: true }).getByRole('button', { name: new RegExp(`^Bekijk ziekmelding van ${ZIEK.name}`) }).click();
    await expect(detail(page)).toBeVisible();
    expect(pad(page)).toBe(`${ZIEKTE}/z1`);
    await page.keyboard.press('Escape');
    await expect(detail(page)).toHaveCount(0);
    await expect.poll(() => pad(page)).toBe(ZIEKTE);
    await schoon(page);
  });

  test('onbekend id: nette melding boven de lijst, Sluiten gaat naar de lijst', async ({ page }) => {
    await seed(page, { user: ADMIN, extra });
    await page.goto(`${ZIEKTE}/bestaat-niet`);
    await expect(onbekend(page)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('dialog')).toHaveCount(0);
    // De lijst staat er gewoon onder.
    await expect(page.getByRole('region', { name: 'Actueel', exact: true })).toBeVisible();
    await page.getByRole('status').filter({ hasText: 'niet beschikbaar' }).getByRole('button', { name: 'Sluiten' }).click();
    await expect(onbekend(page)).toHaveCount(0);
    await expect.poll(() => pad(page)).toBe(ZIEKTE);
    await schoon(page);
  });

  test('een verlofaanvraag is op Ziekte geen ziekmelding: zelfde nette melding', async ({ page }) => {
    await seed(page, { user: ADMIN, extra });
    await page.goto(`${ZIEKTE}/v1`);
    await expect(onbekend(page)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('een chauffeur komt niet op het adres van een ziekmelding, ook niet op die van hemzelf', async ({ page }) => {
    // Ziekte is geen verlof: het blad en het detail zijn er alleen voor planner
    // en admin. z1 is de ziekmelding van deze chauffeur zelf en zit in zijn
    // eigen verloflijst; het adres mag daar niets van openen.
    await seed(page, { user: ZIEK, extra });
    await page.goto(`${ZIEKTE}/z1`);
    await expect(page.getByText('Dit scherm is niet beschikbaar voor jouw rol.')).toBeVisible({ timeout: 15_000 });
    await expect.poll(() => pad(page)).toBe('/');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(ziekteKop(page)).toHaveCount(0);
    await expect(onbekend(page)).toHaveCount(0);
    await expect(page.getByText('Ziekteperiode')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^Melding verwijderen/ })).toHaveCount(0);
  });
});

test.describe('te herverdelen landt op de juiste plek', () => {
  test('Vandaag: de rij van een zieke opent het detail van zijn ziekmelding; terug brengt je weer naar Vandaag', async ({ page }) => {
    await seed(page, { user: ADMIN, extra });
    await page.goto('/vandaag');
    await expect(page.getByRole('heading', { level: 1, name: 'Vandaag' })).toBeVisible({ timeout: 15_000 });
    const rij = page.getByRole('button', { name: new RegExp(ZIEK.name) });
    await expect(rij).toContainText('Ziek · 2101 (05:30) te herverdelen');
    await rij.click();
    await expect(detail(page)).toBeVisible({ timeout: 15_000 });
    expect(pad(page)).toBe(`${ZIEKTE}/z1`);
    await expect(detail(page).getByText('Dienst 2101', { exact: true })).toBeVisible();

    // Eén keer terug sluit het detail (de lijst van Ziekte), nog eens terug is Vandaag.
    await page.goBack();
    await expect(detail(page)).toHaveCount(0);
    await expect.poll(() => pad(page)).toBe(ZIEKTE);
    await page.goBack();
    await expect(page.getByRole('heading', { level: 1, name: 'Vandaag' })).toBeVisible();
    expect(pad(page)).toBe('/vandaag');
  });

  test('Vandaag: de rij van iemand met verlof opent de Maandplanning op die dag', async ({ page, isMobile }) => {
    await seed(page, { user: ADMIN, extra });
    await page.goto('/vandaag');
    const rij = page.getByRole('button', { name: new RegExp(VERLOF.name) });
    await expect(rij).toContainText('Verlof · 2607 (14:00) te herverdelen', { timeout: 15_000 });
    await rij.click();
    await expect(page.getByRole('heading', { level: 1, name: 'Maandplanning' })).toBeVisible({ timeout: 15_000 });
    await expect.poll(() => pad(page)).toBe(`/maandplanning/${MAAND}/${dag(0)}`);
    // Geen ziektedetail, geen melding "niet beschikbaar": verlof heeft geen blad op Ziekte.
    await expect(page.getByRole('dialog')).toHaveCount(0);
    // Op de telefoon toont de dagweergave die dag, met de dienst die nog op zijn naam staat.
    if (isMobile) await expect(page.getByText('dienst 2607 open')).toBeVisible();
  });

  test('Overzicht: de rij van een zieke opent zijn ziekmelding, die van verlof de Maandplanning', async ({ page }) => {
    await seed(page, { user: ADMIN, extra });
    await page.goto('/overzicht');
    const rijVan = (naam: string) => page.getByText(`1 dienst nog niet herverdeeld, ${naam}`, { exact: true }).locator('visible=true');
    await expect(rijVan(ZIEK.name)).toBeVisible({ timeout: 15_000 });
    await rijVan(ZIEK.name).click();
    await expect(detail(page)).toBeVisible({ timeout: 15_000 });
    expect(pad(page)).toBe(`${ZIEKTE}/z1`);

    await page.goto('/overzicht');
    await expect(rijVan(VERLOF.name)).toBeVisible({ timeout: 15_000 });
    await rijVan(VERLOF.name).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Maandplanning' })).toBeVisible({ timeout: 15_000 });
    await expect.poll(() => pad(page)).toBe(`/maandplanning/${MAAND}/${dag(0)}`);
  });

  test('dashboard, Open taken: de rij van een zieke opent zijn ziekmelding', async ({ page }) => {
    await seed(page, { user: ADMIN, extra });
    await page.goto('/');
    const rij = page.getByRole('button', { name: new RegExp(`1 dienst nog niet herverdeeld, ${ZIEK.name}`) });
    await expect(rij).toBeVisible({ timeout: 15_000 });
    await rij.click();
    await expect(detail(page)).toBeVisible({ timeout: 15_000 });
    expect(pad(page)).toBe(`${ZIEKTE}/z1`);
  });
});

/**
 * Herstelronde 2 (punt 17). Op desktop toont de Maandplanning twee weken; lag
 * de dag uit het adres daarbuiten (verlof over een paar weken met nog een
 * dienst op naam), dan landde de planner op een scherm zonder die dag. En het
 * menu "Open taken" in de topbar stuurde "te herverdelen" altijd naar Ziekte.
 */
const plus = (datum: string, n: number) => { const d = new Date(`${datum}T00:00:00`); d.setDate(d.getDate() + n); return iso(d); };
const maandagVan = (datum: string) => { const d = new Date(`${datum}T00:00:00`); const w = d.getDay(); return plus(datum, w === 0 ? -6 : 1 - w); };
/** Waar het venster van twee weken begint als het adres alleen een maand draagt: deze week, of de maandag van of vóór de eerste. */
const standaardStart = (maand: string) => {
  const deze = maandagVan(dag(0));
  return Array.from({ length: 7 }, (_, i) => plus(deze, i)).some((d) => d.startsWith(maand)) ? deze : maandagVan(`${maand}-01`);
};
/**
 * Verlof over ruim drie weken: de eerste dag vanaf dan die BUITEN dat
 * standaardvenster valt. Een dag erbinnen stond altijd al in beeld en zou
 * hier niets bewijzen (drie weken na 11/11 is 02/12, binnen 30/11 t/m 13/12).
 */
const VER = (() => {
  for (let n = 21; ; n += 1) {
    const start = standaardStart(dag(n).slice(0, 7));
    if (dag(n) < start || dag(n) > plus(start, 13)) return dag(n);
  }
})();
const VER_MAAND = VER.slice(0, 7);
const VER_ADRES = `/maandplanning/${VER_MAAND}/${VER}`;
const MAANDNAMEN = ['januari', 'februari', 'maart', 'april', 'mei', 'juni', 'juli', 'augustus', 'september', 'oktober', 'november', 'december'];

type Rij = (typeof PLANNING)[number];
type Afwezigheid = (typeof AFWEZIG)[number];
/** Eigen planning en afwezigheden voor één test; `open` = de cellen op het bord die hun dienst nog op naam dragen. */
const metGegevens = (planning: Rij[], afwezig: Afwezigheid[], open: Array<{ userId: string; datum: string; dienst: string }> = []) =>
  (pad: string, request: Request) => {
    if (request.method() === 'GET') {
      if (pad.endsWith('/api/planning')) return planning;
      if (pad.endsWith('/api/leave')) return afwezig;
      if (pad.endsWith('/api/month-planning')) {
        const dates = dagenVanMaand(new URL(request.url()).searchParams.get('month') ?? MAAND);
        const cells: Record<string, Record<string, unknown>> = {};
        for (const u of [ZIEK, VERLOF, DERDE]) cells[u.id] = Object.fromEntries(dates.map((d) => [d, { code: '2101', kind: 'service', label: '', segments: ['05:30 - 13:45'] }]));
        for (const o of open) if (dates.includes(o.datum)) cells[o.userId][o.datum] = { code: 'bv', kind: 'leave', label: 'Betaald verlof', segments: [], hiddenService: o.dienst };
        return { month: dates[0].slice(0, 7), dates, drivers: [ZIEK, VERLOF, DERDE].map((u) => ({ id: u.id, name: u.name })), cells, geimporteerd: { eerste: dag(-90), laatste: dag(120) } };
      }
    }
    return extra(pad, request);
  };
/** Alleen DERDE heeft nog een dienst op naam: verlof van VER tot de dag erna, met dienst 2203 op VER. */
const verVerlof = () => metGegevens(
  [{ id: 'p-ver', date: VER, startTime: '06:00', endTime: '14:00', line: '2203', busNumber: '', driverId: DERDE.id }],
  [{ id: 'v-ver', userId: DERDE.id, startDate: VER, endDate: plus(VER, 1), type: 'betaald_verlof', status: 'approved', createdAt: new Date().toISOString() }],
  [{ userId: DERDE.id, datum: VER, dienst: '2203' }],
);

const raster = (page: Page) => page.getByRole('table', { name: 'Maandplanning per chauffeur en dag' });
/** De dagkop van één dag in het desktopraster (voorgelezen als "maandag 14 december"). */
const kolom = (page: Page, datum: string) =>
  raster(page).getByRole('columnheader', { name: new RegExp(` ${Number(datum.slice(8))} ${MAANDNAMEN[Number(datum.slice(5, 7)) - 1]}`) });
/** De dag uit het adres staat op het scherm: op desktop als kolom met de open dienst erin, op de telefoon als de gekozen dag. */
async function verInBeeld(page: Page, isMobile: boolean) {
  if (isMobile) {
    await expect(page.getByText('dienst 2203 open')).toBeVisible({ timeout: 15_000 });
    return;
  }
  await expect(kolom(page, VER)).toBeInViewport({ ratio: 1, timeout: 15_000 });
  // Het venster begint op de maandag van (of vóór) die dag en telt twee weken.
  await expect(kolom(page, maandagVan(VER))).toBeInViewport({ ratio: 1 });
  await expect(raster(page).getByRole('columnheader')).toHaveCount(15);
  // De cel waarvoor de planner kwam: het verlof van DERDE met de dienst die nog op zijn naam staat.
  const open = raster(page).getByRole('row', { name: new RegExp(DERDE.name) }).getByLabel('dienst nog niet herverdeeld');
  await expect(open).toHaveCount(1);
  await expect(open).toBeInViewport();
}

test.describe('de dag uit het adres staat in beeld, ook buiten de twee weken', () => {
  test('Overzicht: de rij van iemand met verlof over ruim drie weken opent de Maandplanning met die dag in beeld', async ({ page, isMobile }) => {
    await seed(page, { user: ADMIN, extra: verVerlof() });
    await page.goto('/overzicht');
    const rij = page.getByText(`1 dienst nog niet herverdeeld, ${DERDE.name}`, { exact: true }).locator('visible=true');
    await expect(rij).toBeVisible({ timeout: 15_000 });
    await rij.click();
    await expect(page.getByRole('heading', { level: 1, name: 'Maandplanning' })).toBeVisible({ timeout: 15_000 });
    await expect.poll(() => pad(page)).toBe(VER_ADRES);
    await verInBeeld(page, isMobile);
    // Het adres blijft staan: de landing schrijft niets.
    expect(pad(page)).toBe(VER_ADRES);
  });

  test('een koude link naar die dag (de mail naar de admins, een herlaad): de dag staat in beeld', async ({ page, isMobile }) => {
    await seed(page, { user: ADMIN, extra: verVerlof() });
    await page.goto(VER_ADRES);
    await expect(page.getByRole('heading', { level: 1, name: 'Maandplanning' })).toBeVisible({ timeout: 15_000 });
    await verInBeeld(page, isMobile);
    expect(pad(page)).toBe(VER_ADRES);
    await page.reload();
    await verInBeeld(page, isMobile);
    expect(pad(page)).toBe(VER_ADRES);
  });

  test('bladeren na zo\'n landing verschuift vanaf die twee weken en springt niet terug naar de dag; Vandaag gaat naar deze week', async ({ page, isMobile }) => {
    test.skip(isMobile, 'het venster van twee weken is er alleen op desktop');
    await seed(page, { user: ADMIN, extra: verVerlof() });
    await page.goto(VER_ADRES);
    await verInBeeld(page, isMobile);
    const start = maandagVan(VER);

    await page.getByRole('button', { name: 'Volgende 2 weken' }).click();
    await expect(kolom(page, plus(start, 14))).toBeInViewport({ ratio: 1 });
    await expect(kolom(page, VER)).toHaveCount(0);
    // Terugbladeren brengt de planner gewoon weer langs die twee weken, en verder.
    await page.getByRole('button', { name: 'Vorige 2 weken' }).click();
    await expect(kolom(page, VER)).toBeInViewport({ ratio: 1 });
    await page.getByRole('button', { name: 'Vorige 2 weken' }).click();
    await expect(kolom(page, plus(start, -14))).toBeInViewport({ ratio: 1 });
    await expect(kolom(page, VER)).toHaveCount(0);

    // De knop in de kop van het scherm, niet het menu-item Vandaag in de zijbalk.
    await page.locator('#hoofdinhoud').getByRole('button', { name: 'Vandaag', exact: true }).click();
    await expect(kolom(page, dag(0))).toBeInViewport({ ratio: 1 });
    await expect(kolom(page, maandagVan(dag(0)))).toBeInViewport({ ratio: 1 });
    // De hoofdmaand is weer deze maand; een dag uit een andere maand gaat uit
    // het adres (bestaand gedrag) en het venster blijft op deze week staan.
    if (VER_MAAND !== MAAND) await expect.poll(() => pad(page)).toBe('/maandplanning');
    await expect(kolom(page, VER)).toHaveCount(0);
    await expect(kolom(page, dag(0))).toBeInViewport({ ratio: 1 });
  });

  test('zonder dag, met een dag binnen het standaardvenster of met een ongeldige dag begint het venster waar het altijd begon', async ({ page, isMobile }) => {
    test.skip(isMobile, 'het venster van twee weken is er alleen op desktop');
    await seed(page, { user: ADMIN, extra: verVerlof() });
    const start = standaardStart(VER_MAAND);
    // De laatste dag van het standaardvenster ligt altijd in de maand van VER (VER zelf komt er pas na).
    expect(plus(start, 13).startsWith(VER_MAAND)).toBe(true);
    // Alleen de maand; de laatste dag van het venster; een dag die niet bestaat; geen dag; een dag uit een andere maand.
    for (const adres of [`/maandplanning/${VER_MAAND}`, `/maandplanning/${VER_MAAND}/${plus(start, 13)}`, `/maandplanning/${VER_MAAND}/${VER_MAAND}-99`, `/maandplanning/${VER_MAAND}/geen-dag`, `/maandplanning/${VER_MAAND}/${plus(VER, 62)}`]) {
      await page.goto(adres);
      await expect(kolom(page, start), adres).toBeInViewport({ ratio: 1, timeout: 15_000 });
      await expect(kolom(page, plus(start, 13)), adres).toBeInViewport({ ratio: 1 });
      await expect(kolom(page, VER), adres).toHaveCount(0);
    }
  });
});

test.describe('het menu Open taken in de topbar: "te herverdelen" landt op de juiste plek', () => {
  const menuRij = async (page: Page, naam: RegExp) => {
    await page.goto('/');
    await page.getByRole('button', { name: /^Open taken \(\d+\)$/ }).click({ timeout: 15_000 });
    const rij = page.getByRole('menu', { name: 'Open taken' }).getByRole('menuitem', { name: naam });
    await expect(rij).toBeVisible();
    return rij;
  };

  /** Het menu openen op het scherm dat al openstaat (geen `goto` meer ertussen). */
  const menuRijHier = async (page: Page, naam: RegExp) => {
    await page.getByRole('button', { name: /^Open taken \(\d+\)$/ }).click({ timeout: 15_000 });
    const rij = page.getByRole('menu', { name: 'Open taken' }).getByRole('menuitem', { name: naam });
    await expect(rij).toBeVisible();
    return rij;
  };

  test('één chauffeur met verlof terwijl de Maandplanning al openstaat: het Overzicht, en zijn rij daar opent de dag', async ({ page, isMobile }) => {
    // De Maandplanning leest maand en dag alleen bij het openen en zet een
    // adres dat ze niet zelf schreef terug: rechtstreeks was de klik hier dood.
    await seed(page, { user: ADMIN, extra: verVerlof() });
    await page.goto('/maandplanning');
    await expect(page.getByRole('heading', { level: 1, name: 'Maandplanning' })).toBeVisible({ timeout: 15_000 });
    if (!isMobile) await expect(kolom(page, dag(0))).toBeInViewport({ ratio: 1, timeout: 15_000 });
    const rij = await menuRijHier(page, /1 dienst te herverdelen/);
    await expect(rij).toContainText(`${DERDE.name} (1)`);
    await rij.click();
    await expect(page.getByRole('heading', { level: 1, name: 'Overzicht' })).toBeVisible({ timeout: 15_000 });
    await expect.poll(() => pad(page)).toBe('/overzicht');
    await expect(page.getByRole('menu', { name: 'Open taken' })).toHaveCount(0);
    const eigen = page.getByText(`1 dienst nog niet herverdeeld, ${DERDE.name}`, { exact: true }).locator('visible=true');
    await expect(eigen).toBeVisible();
    await historiekOpgeruimd(page);
    await eigen.click();
    await expect(page.getByRole('heading', { level: 1, name: 'Maandplanning' })).toBeVisible({ timeout: 15_000 });
    await expect.poll(() => pad(page)).toBe(VER_ADRES);
    await verInBeeld(page, isMobile);
    expect(pad(page)).toBe(VER_ADRES);
  });

  test('één zieke terwijl Ziekte al openstaat: het detail van zijn ziekmelding opent ter plekke', async ({ page }) => {
    await seed(page, { user: ADMIN, extra: metGegevens([PLANNING[0]], [AFWEZIG[0]]) });
    await page.goto(ZIEKTE);
    await expect(ziekteKop(page)).toBeVisible({ timeout: 15_000 });
    await expect(detail(page)).toHaveCount(0);
    const rij = await menuRijHier(page, /1 dienst te herverdelen/);
    await rij.click();
    await expect(detail(page)).toBeVisible({ timeout: 15_000 });
    await expect.poll(() => pad(page)).toBe(`${ZIEKTE}/z1`);
    await expect(detail(page).getByText('Dienst 2101', { exact: true })).toBeVisible();
  });

  test('één chauffeur met verlof: de Maandplanning op de dag, zoals zijn rij in het Overzicht', async ({ page, isMobile }) => {
    await seed(page, { user: ADMIN, extra: verVerlof() });
    const rij = await menuRij(page, /1 dienst te herverdelen/);
    await expect(rij).toContainText(`${DERDE.name} (1)`);
    await rij.click();
    await expect(page.getByRole('heading', { level: 1, name: 'Maandplanning' })).toBeVisible({ timeout: 15_000 });
    await expect.poll(() => pad(page)).toBe(VER_ADRES);
    await expect(page.getByRole('menu', { name: 'Open taken' })).toHaveCount(0);
    await verInBeeld(page, isMobile);
    // Geen omweg langs Ziekte, en één keer terug is weer het dashboard.
    await expect(ziekteKop(page)).toHaveCount(0);
    await historiekOpgeruimd(page);
    await page.goBack();
    await expect.poll(() => pad(page)).toBe('/');
  });

  test('één zieke: het detail van zijn ziekmelding', async ({ page }) => {
    await seed(page, { user: ADMIN, extra: metGegevens([PLANNING[0]], [AFWEZIG[0]]) });
    const rij = await menuRij(page, /1 dienst te herverdelen/);
    await expect(rij).toContainText(`${ZIEK.name} (1)`);
    await rij.click();
    await expect(detail(page)).toBeVisible({ timeout: 15_000 });
    await expect.poll(() => pad(page)).toBe(`${ZIEKTE}/z1`);
    await expect(detail(page).getByText('Dienst 2101', { exact: true })).toBeVisible();
  });

  test('twee chauffeurs: het Overzicht, waar elke chauffeur zijn eigen rij heeft', async ({ page }) => {
    await seed(page, { user: ADMIN, extra });
    const rij = await menuRij(page, /2 diensten te herverdelen/);
    await expect(rij).toContainText(`${ZIEK.name} (1)`);
    await expect(rij).toContainText(`${VERLOF.name} (1)`);
    await rij.click();
    await expect(page.getByRole('heading', { level: 1, name: 'Overzicht' })).toBeVisible({ timeout: 15_000 });
    await expect.poll(() => pad(page)).toBe('/overzicht');
    for (const naam of [ZIEK.name, VERLOF.name]) {
      await expect(page.getByText(`1 dienst nog niet herverdeeld, ${naam}`, { exact: true }).locator('visible=true')).toBeVisible();
    }
    // Niet het scherm Ziekte, waar iemand met verlof niet op staat.
    await expect(ziekteKop(page)).toHaveCount(0);
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });
});

test.describe('vervaldata en open diensten', () => {
  const fiche = (page: Page) => page.getByRole('dialog').filter({ hasText: DERDE.name });

  test('Overzicht: een vervaldatum opent de persoon', async ({ page }) => {
    await seed(page, { user: ADMIN, extra });
    await page.goto('/overzicht');
    const rij = page.getByText(`Code 95 · ${DERDE.name}`).locator('visible=true');
    await expect(rij).toBeVisible({ timeout: 15_000 });
    await rij.click();
    await expect(page.getByRole('heading', { level: 1, name: 'Vervaldata' })).toBeVisible({ timeout: 15_000 });
    await expect(fiche(page)).toBeVisible();
    expect(pad(page)).toBe(`/beheer/vervaldata/${DERDE.id}`);
  });

  test('dashboard, Open taken: een vervaldatum opent de persoon', async ({ page }) => {
    await seed(page, { user: ADMIN, extra });
    await page.goto('/');
    const rij = page.getByRole('button', { name: new RegExp(`Code 95 · ${DERDE.name}`) });
    await expect(rij).toBeVisible({ timeout: 15_000 });
    await rij.click();
    await expect(fiche(page)).toBeVisible({ timeout: 15_000 });
    expect(pad(page)).toBe(`/beheer/vervaldata/${DERDE.id}`);
  });

  test('Vandaag: een dienstchip opent Openstaande diensten op de dag, net als "Chauffeur toewijzen"', async ({ page }) => {
    await seed(page, { user: ADMIN, extra });
    await page.goto('/vandaag');
    const open = page.getByRole('list', { name: 'Diensten zonder chauffeur' });
    // 2101 en 2607 staan al onder "te herverdelen": alleen 4407 is een open dienst.
    await expect(open.getByRole('listitem')).toHaveCount(1, { timeout: 15_000 });
    await open.getByRole('button', { name: 'Chauffeur toewijzen voor dienst 4407', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Openstaande diensten' })).toBeVisible({ timeout: 15_000 });
    await expect.poll(() => pad(page)).toBe(`/openstaande-diensten/${MAAND}/${dag(0)}`);
    await dagInBeeld(page, dag(0));
    // Een herlaad houdt de dag vast.
    await page.reload();
    await dagInBeeld(page, dag(0));
    expect(pad(page)).toBe(`/openstaande-diensten/${MAAND}/${dag(0)}`);

    await page.goBack();
    await expect(page.getByRole('heading', { level: 1, name: 'Vandaag' })).toBeVisible();
    await page.getByRole('button', { name: 'Chauffeur toewijzen', exact: true }).click();
    await expect.poll(() => pad(page)).toBe(`/openstaande-diensten/${MAAND}/${dag(0)}`);
    await dagInBeeld(page, dag(0));
  });

  test('Overzicht: een open dienst opent Openstaande diensten op de dag', async ({ page }) => {
    await seed(page, { user: ADMIN, extra });
    await page.goto('/overzicht');
    // Vandaag telt één open dienst (4407): 2101 en 2607 staan onder "te herverdelen".
    const rij = page.getByText(/^1 open dienst, /).locator('visible=true').first();
    await expect(rij).toBeVisible({ timeout: 15_000 });
    await rij.click();
    await expect.poll(() => pad(page)).toBe(`/openstaande-diensten/${MAAND}/${dag(0)}`);
    await dagInBeeld(page, dag(0));
  });

  test('dashboard, Open taken: een open dienst opent Openstaande diensten op de dag', async ({ page }) => {
    await seed(page, { user: ADMIN, extra });
    await page.goto('/');
    const rij = page.getByRole('button', { name: /1 open dienst, / }).first();
    await expect(rij).toBeVisible({ timeout: 15_000 });
    await rij.click();
    await expect.poll(() => pad(page)).toBe(`/openstaande-diensten/${MAAND}/${dag(0)}`);
    await dagInBeeld(page, dag(0));
  });

  test('Openstaande diensten: een dag buiten de maand of een ongeldige dag valt stil terug op de maand', async ({ page }) => {
    await seed(page, { user: ADMIN, extra });
    const kop = page.getByRole('heading', { level: 1, name: 'Openstaande diensten' });
    for (const fout of ['2020-01-01', `${MAAND}-99`, 'geen-dag']) {
      await page.goto(`/openstaande-diensten/${MAAND}/${fout}`);
      await expect(kop).toBeVisible({ timeout: 15_000 });
      // De huidige maand heeft een kaal adres; de dag is eruit.
      await expect.poll(() => pad(page)).toBe('/openstaande-diensten');
      await expect(page.locator('[aria-current="true"][data-record]')).toHaveCount(0);
    }
    // Een andere maand met een dag van die maand blijft staan; bladeren haalt de dag eruit.
    const later = dagenVanMaand(dag(40).slice(0, 7)).find((d) => Number(d.slice(8)) % 2 === 0 && Number(d.slice(8)) > 20)!;
    await page.goto(`/openstaande-diensten/${later.slice(0, 7)}/${later}`);
    await dagInBeeld(page, later);
    expect(pad(page)).toBe(`/openstaande-diensten/${later.slice(0, 7)}/${later}`);
    await page.getByRole('button', { name: 'Volgende maand' }).click();
    await expect(page.locator('[aria-current="true"][data-record]')).toHaveCount(0);
    await expect.poll(() => pad(page)).not.toContain(later);
  });
});

/**
 * De server van de meldtests: een geslaagde ziekmelding maakt precies één
 * nieuw record (`z-nieuw`) dat de volgende GET /api/leave teruggeeft, het
 * advies stelt per dienst Vera voor, en elke schrijfactie wordt geteld.
 */
function meldServer() {
  const lijst: unknown[] = AFWEZIG.map((r) => ({ ...r }));
  const meldingen: Array<{ userId: string; startDate: string; endDate: string }> = [];
  const adviezen: unknown[] = [];
  const wissels: unknown[] = [];
  /** Elke bewaarde verloflijst (POST /api/leave): einddatum bijstellen of een melding verwijderen. */
  const bewaard: Array<Array<{ id: string }>> = [];
  const eigen = (pad: string, request: Request) => {
    const post = request.method() === 'POST';
    if (pad.endsWith('/api/leave/sick-report') && post) {
      const body = request.postDataJSON();
      meldingen.push(body);
      lijst.push({ id: 'z-nieuw', userId: body.userId, startDate: body.startDate, endDate: body.endDate, type: 'ziekte', status: 'approved', comment: body.comment, createdAt: new Date().toISOString() });
      return { success: true };
    }
    if (pad.endsWith('/api/leave') && post) {
      const body = request.postDataJSON() as Array<{ id: string }>;
      bewaard.push(body);
      lijst.splice(0, lijst.length, ...body);
      return { success: true };
    }
    if (pad.endsWith('/api/leave') && !post) return lijst;
    if (pad.endsWith('/api/coverage-advisor/batch') && post) {
      const body = request.postDataJSON() as { items: Array<{ date: string; code: string }> };
      adviezen.push(body);
      return { items: body.items.map((i) => ({ ...i, samenvatting: `${VERVANGER.name} past, 12 u rust.`, passend: [{ id: VERVANGER.id, name: VERVANGER.name }] })) };
    }
    if (pad.endsWith('/api/admin/shift-swap') && post) { wissels.push(request.postDataJSON()); return { ok: true }; }
    return extra(pad, request);
  };
  return { eigen, meldingen, adviezen, wissels, bewaard };
}

const meldvenster = (page: Page) => page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Ziekmelding registreren', exact: true }) });
const vervangerVoor = (scope: ReturnType<typeof detail>, code: string) => scope.getByRole('combobox', { name: new RegExp(`^Vervanger voor dienst ${code} op `) });

test.describe('ziek melden schakelt door', () => {
  test('Ziekte: een geslaagde melding opent het detail van de nieuwe melding, met precies één melding', async ({ page }) => {
    const server = meldServer();
    await seed(page, { user: ADMIN, extra: server.eigen });
    await page.goto(ZIEKTE);
    await expect(ziekteKop(page)).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: 'Ziek melden', exact: true }).click();
    await meldvenster(page).getByRole('combobox', { name: 'Chauffeur' }).selectOption(DERDE.id);
    await meldvenster(page).getByRole('button', { name: 'Ziekmelding registreren', exact: true }).click();

    // Het meldvenster is weg, het detail van de nieuwe melding staat open op zijn adres.
    await expect(detail(page, DERDE.name)).toBeVisible({ timeout: 15_000 });
    await expect(meldvenster(page)).toHaveCount(0);
    await expect(page.getByRole('dialog')).toHaveCount(1);
    await expect.poll(() => pad(page)).toBe(`${ZIEKTE}/z-nieuw`);
    expect(server.meldingen).toEqual([{ userId: DERDE.id, startDate: dag(0), endDate: dag(0), comment: '' }]);
    // Herverdelen is de volgende stap: de dienst die nog op naam staat, met een lege keuzelijst.
    await expect(detail(page, DERDE.name).getByText('Dienst 2203', { exact: true })).toBeVisible();
    await expect(vervangerVoor(detail(page, DERDE.name), '2203')).toHaveValue('');
    expect(server.wissels).toEqual([]);
    expect(server.adviezen).toEqual([]);

    // Sluiten landt op de lijst, zonder dode terugstap van het meldvenster of het detail.
    await detail(page, DERDE.name).getByRole('button', { name: 'Sluiten', exact: true }).first().click();
    await expect(detail(page, DERDE.name)).toHaveCount(0);
    await expect.poll(() => pad(page)).toBe(ZIEKTE);
    await schoon(page);
    await page.goBack();
    await expect.poll(() => page.url()).toBe('about:blank');
    expect(server.meldingen).toHaveLength(1);
  });

  test('Ziekte: mislukt het melden, dan blijft het venster open en verandert het adres niet', async ({ page }) => {
    const server = meldServer();
    await seed(page, { user: ADMIN, extra: server.eigen });
    // Later geregistreerd dan de fixtures, dus deze route gaat voor: de server weigert (al ziek gemeld).
    let pogingen = 0;
    await page.route('**/api/leave/sick-report', (route) => {
      pogingen += 1;
      return route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: `${DERDE.name} staat al ziek gemeld. Pas die melding aan via Beheer › Ziekte.` }) });
    });
    await page.goto(ZIEKTE);
    await expect(ziekteKop(page)).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: 'Ziek melden', exact: true }).click();
    await meldvenster(page).getByRole('combobox', { name: 'Chauffeur' }).selectOption(DERDE.id);
    await meldvenster(page).getByRole('button', { name: 'Ziekmelding registreren', exact: true }).click();

    await expect(page.getByText(/staat al ziek gemeld/)).toBeVisible({ timeout: 15_000 });
    await expect(meldvenster(page)).toBeVisible();
    await expect(meldvenster(page).getByRole('combobox', { name: 'Chauffeur' })).toHaveValue(DERDE.id);
    await expect(page.getByRole('dialog')).toHaveCount(1);
    expect(pad(page)).toBe(ZIEKTE);
    expect(pogingen).toBe(1);
    expect(server.meldingen).toEqual([]);
  });

  test('Ziekte: een klik die nog bij het melden hoort verwijdert de verse melding niet; even later werkt de knop gewoon', async ({ page, isMobile }) => {
    // Op 1440 × 900 komt "Melding verwijderen" van het doorgeschakelde detail
    // op de plek van de knop "Ziekmelding registreren": wie nog eens klikte
    // omdat er niets leek te gebeuren, verwijderde de melding die hij net
    // registreerde (tegenlezing ronde 6). Op de telefoon staat de knop onder
    // de vouw; daar bestaat het geval niet.
    test.skip(isMobile, 'alleen desktop: op de telefoon staat de verwijderknop onder de vouw');
    const server = meldServer();
    await seed(page, { user: ADMIN, extra: server.eigen });
    await page.goto(ZIEKTE);
    await expect(ziekteKop(page)).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: 'Ziek melden', exact: true }).click();
    await meldvenster(page).getByRole('combobox', { name: 'Chauffeur' }).selectOption(DERDE.id);
    await meldvenster(page).getByRole('button', { name: 'Ziekmelding registreren', exact: true }).click();

    // Het eerste moment waarop de verwijderknop van het nieuwe detail onder
    // de muis kan liggen, met de stand van de twee knoppen die in één klik
    // schrijven. Daarna een rauwe muisklik op die plek: een locator-klik zou
    // wachten tot de knop aan staat en dan gewoon verwijderen.
    const eersteMoment = () => page.evaluate(() => {
      const knoppen = [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')];
      const knop = knoppen.find((b) => /^Melding verwijderen/.test(b.textContent?.trim() ?? ''));
      if (!knop) return null;
      const r = knop.getBoundingClientRect();
      const x = r.x + r.width / 2;
      const y = r.y + r.height / 2;
      if (document.elementFromPoint(x, y)?.closest('button') !== knop) return null;
      return { x, y, verwijderenUit: knop.disabled, hersteldUit: knoppen.find((b) => /^Hersteld/.test(b.textContent?.trim() ?? ''))?.disabled ?? null };
    });
    let moment: Awaited<ReturnType<typeof eersteMoment>> = null;
    await expect.poll(async () => (moment = await eersteMoment()), { timeout: 15_000, intervals: [20] }).not.toBeNull();
    await page.mouse.click(moment!.x, moment!.y);

    const venster = detail(page, DERDE.name);
    const verwijderen = venster.getByRole('button', { name: /^Melding verwijderen/ });
    const hersteld = venster.getByRole('button', { name: /^Hersteld/ });
    // De knoppen komen vanzelf weer aan; tot dan is er niets bewaard en staat
    // het detail nog open op zijn adres.
    await expect(verwijderen).toBeEnabled();
    await expect(hersteld).toBeEnabled();
    expect(server.bewaard).toEqual([]);
    expect(moment).toMatchObject({ verwijderenUit: true, hersteldUit: true });
    await expect(venster).toBeVisible();
    expect(pad(page)).toBe(`${ZIEKTE}/z-nieuw`);
    expect(server.meldingen).toHaveLength(1);
    await expect(page.getByText(/verwijderd/)).toHaveCount(0);

    // Een bewuste klik daarna verwijdert wel, precies één keer.
    await verwijderen.click();
    await expect(page.getByText(`Ziekmelding van ${DERDE.name} verwijderd.`)).toBeVisible();
    await expect(venster).toHaveCount(0);
    await expect.poll(() => pad(page)).toBe(ZIEKTE);
    expect(server.bewaard).toHaveLength(1);
    expect(server.bewaard[0].map((r) => r.id)).toEqual(['z1', 'v1']);
    expect(server.meldingen).toHaveLength(1);
  });
});

test.describe('"Stel kandidaten voor" is één bewuste klik', () => {
  test('Ziekte-detail met één dienst: het voorstel vult de keuzelijst in en zet niets over', async ({ page }) => {
    const server = meldServer();
    await seed(page, { user: ADMIN, extra: server.eigen });
    await page.goto(`${ZIEKTE}/z1`);
    const venster = detail(page);
    await expect(venster).toBeVisible({ timeout: 15_000 });
    const keuze = vervangerVoor(venster, '2101');
    await expect(keuze).toBeEnabled();
    await expect(keuze).toHaveValue('');
    // Eén dienst op naam: de knop staat er, "Verdeel alles" niet.
    await expect(venster.getByRole('button', { name: /^Verdeel alles/ })).toHaveCount(0);
    await venster.getByRole('button', { name: 'Stel kandidaten voor', exact: true }).click();
    await expect(keuze).toHaveValue(VERVANGER.id);
    await expect(venster.getByText(`${VERVANGER.name} past, 12 u rust.`)).toBeVisible();
    expect(server.adviezen).toEqual([{ items: [{ date: dag(0), code: '2101' }] }]);
    // De keuze blijft te wijzigen; overzetten is een eigen klik.
    await keuze.selectOption(DERDE.id);
    await expect(keuze).toHaveValue(DERDE.id);
    expect(server.wissels).toEqual([]);
    await venster.getByRole('button', { name: 'Zet over', exact: true }).click();
    await expect.poll(() => server.wissels).toEqual([{ date: dag(0), line: '2101', fromDriverId: ZIEK.id, toDriverId: DERDE.id, reason: 'Ziekte' }]);
  });

  test('dashboard, stap 2 van de ziekmelding: lege keuzelijsten tot de klik, daarna het voorstel, nog altijd te wijzigen', async ({ page }) => {
    const server = meldServer();
    await seed(page, { user: ADMIN, extra: server.eigen });
    await page.goto('/');
    await page.getByRole('button', { name: 'Ziek melden', exact: true }).click({ timeout: 15_000 });
    await meldvenster(page).getByRole('combobox', { name: 'Chauffeur' }).selectOption(DERDE.id);
    await meldvenster(page).getByRole('button', { name: 'Ziekmelding registreren', exact: true }).click();

    const stap2 = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Wie neemt de dienst over?', exact: true }) });
    await expect(stap2).toBeVisible({ timeout: 15_000 });
    expect(server.meldingen).toHaveLength(1);
    const keuze = vervangerVoor(stap2, '2203');
    await expect(keuze).toBeEnabled();
    // Niets vooraf ingevuld, geen advies opgevraagd.
    await expect(keuze).toHaveValue('');
    expect(server.adviezen).toEqual([]);

    await stap2.getByRole('button', { name: 'Stel kandidaten voor', exact: true }).click();
    await expect(keuze).toHaveValue(VERVANGER.id);
    await expect(stap2.getByText(`${VERVANGER.name} past, 12 u rust.`)).toBeVisible();
    expect(server.adviezen).toEqual([{ items: [{ date: dag(0), code: '2203' }] }]);
    expect(server.wissels).toEqual([]);

    // De planner blijft de baas: een andere keuze, en pas "Zet over" schrijft.
    await keuze.selectOption(ZIEK.id);
    await expect(keuze).toHaveValue(ZIEK.id);
    await keuze.selectOption(VERVANGER.id);
    expect(server.wissels).toEqual([]);
    await stap2.getByRole('button', { name: 'Zet over', exact: true }).click();
    await expect(stap2.getByText(`Overgezet naar ${VERVANGER.name}`)).toBeVisible();
    expect(server.wissels).toEqual([{ date: dag(0), line: '2203', fromDriverId: DERDE.id, toDriverId: VERVANGER.id, reason: 'Ziekte' }]);
    // Alles rond: het voorstel heeft niets meer te doen.
    await expect(stap2.getByRole('button', { name: 'Stel kandidaten voor', exact: true })).toHaveCount(0);
  });
});
