import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { ADMIN, seed } from './helpers';

/**
 * Tranche 3B.3 (23-09): de planningsschermen op het gedeelde tabelkader.
 * Maandplanning (raster op desktop, dagweergave op de telefoon),
 * Planningsoverzicht, Openstaande diensten, Activiteit en een rapport.
 *
 * - geen horizontale paginaoverloop (document én scroll-root) op de
 *   projectbreedte (iPhone 390 / desktop 1440) en, in het desktopproject,
 *   ook op 375, 768, 1024 en 1280 px;
 * - een zichtbare tabel die niet in haar eigen strook schuift, past in haar
 *   kader (TableShell `past`/`sticky` vanaf xl knipt anders stil af);
 * - axe (WCAG 2.1 AA, serious/critical blokkeert) op elk scherm;
 * - plus een paar gerichte toetsen: rijkoppen, de actieve dag, de knop om
 *   een onbekende code toe te voegen op de telefoon, sorteren in het
 *   maandoverzicht.
 */

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const plus = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return iso(d); };
const dagenVanMaand = (maand: string) => {
  const [j, m] = maand.split('-').map(Number);
  const aantal = new Date(j, m, 0).getDate();
  return Array.from({ length: aantal }, (_, i) => `${maand}-${String(i + 1).padStart(2, '0')}`);
};

/** Veertien chauffeurs in twee secties; de ingelogde admin (id 1) rijdt mee, dus er is een eigen rij. */
const CHAUFFEURS = [
  { id: '1', name: 'Jarno De Greve', section: 'Reguliere' },
  ...Array.from({ length: 10 }, (_, i) => ({ id: `c${i + 1}`, name: `Chauffeur ${String.fromCharCode(65 + i)} Van Den Broeck`, section: 'Reguliere' })),
  ...Array.from({ length: 3 }, (_, i) => ({ id: `f${i + 1}`, name: `Flexi ${i + 1}`, section: 'Flexi/invallers' })),
];
const maandPlanning = (maand: string) => {
  const dates = dagenVanMaand(maand);
  const cells: Record<string, Record<string, unknown>> = {};
  CHAUFFEURS.forEach((c, ci) => {
    cells[c.id] = {};
    dates.forEach((d, di) => {
      const dow = new Date(`${d}T00:00:00`).getDay();
      if (dow === 0) return; // zondag leeg: de stippen van een lege cel
      if (ci === 3 && di % 9 === 0) {
        cells[c.id][d] = { code: 'ziek', kind: 'absence', label: 'Ziek', segments: [], hiddenService: `22${String(ci).padStart(2, '0')}` };
      } else if (ci === 5 && di % 7 === 2) {
        cells[c.id][d] = { code: 'bv', kind: 'leave', label: 'Betaald verlof', segments: [] };
      } else {
        cells[c.id][d] = { code: `2${String(100 + ci * 7 + (di % 5)).padStart(3, '0')}`, kind: 'service', label: '', segments: ['05:30 - 13:45'] };
      }
    });
  });
  return { month: maand, dates, drivers: CHAUFFEURS, cells, geimporteerd: { eerste: plus(-90), laatste: plus(90) } };
};

const MATRIX = Array.from({ length: 6 }, (_, i) => ({
  id: `m${i}`,
  source_date: plus(i - 2),
  day_type: 'schooldag',
  raw_row: '',
  assignments: {
    'Test Chauffeur': '2101',
    'Alex Du Priez': i === 1 ? 'xq' : '2607',
    'Diether Van Haute': 'bv',
    ...(i === 3 ? { 'Onbekende Naam': '2101' } : {}),
  },
}));

const DEKKING_CONFIG = {
  dayTypes: [{ name: 'schooldag', services: ['2101', '2607', '2203', '2405'] }],
  weekdays: ['schooldag', 'schooldag', 'schooldag', 'schooldag', 'schooldag', 'schooldag', 'schooldag'],
  weekdayPeriods: [],
  overrides: [],
};
const dekkingGaten = (van: string, tot: string) => {
  const dagen: unknown[] = [];
  for (let d = new Date(`${van}T00:00:00`); iso(d) <= tot; d.setDate(d.getDate() + 1)) {
    const dag = iso(d);
    const n = d.getDate();
    const missing = n % 5 === 0 ? ['2203', '2405'] : n % 3 === 0 ? ['2607'] : [];
    dagen.push({
      date: dag,
      dayType: 'schooldag',
      expected: 4,
      covered: 4 - missing.length,
      missing,
      ...(missing.includes('2203') ? { uitval: { 2203: { name: 'Chauffeur B Van Den Broeck', reason: 'ziek' } } } : {}),
      bron: { soort: 'basis' },
    });
  }
  return { days: dagen };
};

type Scherm = { view: string; pad: string; titel: string };
const SCHERMEN: Scherm[] = [
  { view: 'bezetting', pad: '/maandplanning', titel: 'Maandplanning' },
  { view: 'planning-matrix', pad: '/beheer/planningsoverzicht', titel: 'Planningsoverzicht' },
  { view: 'dekking', pad: '/openstaande-diensten', titel: 'Openstaande diensten' },
  { view: 'activiteit', pad: '/beheer/activiteit', titel: 'Activiteit' },
  { view: 'rapporten', pad: '/rapporten/ruilen/ruilaanvragen?van=2026-09-01&tot=2026-09-30', titel: 'Ruilaanvragen' },
];

const extra = (pad: string, request: { url: () => string }) => {
  const url = new URL(request.url());
  if (pad.endsWith('/api/month-planning')) return maandPlanning(url.searchParams.get('month') ?? plus(0).slice(0, 7));
  if (pad.endsWith('/api/planning-matrix')) return MATRIX;
  if (pad.endsWith('/api/coverage-expectations')) return DEKKING_CONFIG;
  if (pad.includes('/api/coverage-gaps')) return dekkingGaten(url.searchParams.get('from') ?? plus(0), url.searchParams.get('to') ?? plus(0));
  if (pad.endsWith('/api/coverage-expectation-check')) return { afwijkingen: [] };
  if (pad.endsWith('/api/coverage-advisor')) return { date: url.searchParams.get('date'), code: url.searchParams.get('code'), segmenten: [], tijdenOnbekend: true, minRustUren: 11, maxDagenNaElkaar: 6, kandidaten: [], kettingen: [], samenvatting: '' };
  return undefined;
};

async function open(page: Page, scherm: Scherm) {
  await seed(page, { user: ADMIN, view: scherm.view, extra });
  await page.goto(scherm.pad);
  await expect(page.getByRole('heading', { name: scherm.titel, level: 1 })).toBeVisible({ timeout: 15_000 });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(400);
}

async function geenOverloop(page: Page, waar: string) {
  const m = await page.evaluate(() => {
    const root = document.querySelector<HTMLElement>('[data-scroll-root]');
    return {
      doc: document.documentElement.scrollWidth, vp: window.innerWidth,
      root: root ? root.scrollWidth - root.clientWidth : 0,
    };
  });
  expect(m.doc, `${waar}: documentbreedte`).toBeLessThanOrEqual(m.vp);
  expect(m.root, `${waar}: scroll-root schuift horizontaal`).toBeLessThanOrEqual(1);
}

/** Elke zichtbare tabel valt binnen haar kaart (surface-table), tenzij ze in haar eigen strook schuift. */
async function tabellenPassen(page: Page, waar: string) {
  const buiten = await page.evaluate(() => [...document.querySelectorAll('table')].flatMap((t) => {
    const r = t.getBoundingClientRect();
    if (r.width === 0) return [];
    const kaartEl = t.closest('.surface-table');
    const kaart = kaartEl?.getBoundingClientRect();
    let schuift = false;
    for (let p = t.parentElement; p && p !== kaartEl; p = p.parentElement) {
      if (getComputedStyle(p).overflowX === 'auto' && p.scrollWidth > p.clientWidth + 1) schuift = true;
    }
    if (!kaart || schuift) return [];
    return r.right <= kaart.right + 1 && r.left >= kaart.left - 1 ? [] : [`${t.getAttribute('aria-label')}: ${Math.round(r.width)} > ${Math.round(kaart.width)}`];
  }));
  expect(buiten, `${waar}: tabel breder dan haar kader`).toEqual([]);
}

for (const scherm of SCHERMEN) {
  test(`${scherm.titel}: geen overloop, tabel in haar kader, a11y`, async ({ page }, info) => {
    await open(page, scherm);
    await geenOverloop(page, info.project.name);
    await tabellenPassen(page, info.project.name);

    const resultaat = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    const blokkerend = resultaat.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(blokkerend.map((v) => `${v.id}: ${v.help} (${JSON.stringify(v.nodes[0]?.target)})`)).toEqual([]);
  });
}

test.describe('breedtes', () => {
  for (const breedte of [375, 768, 1024, 1280]) {
    test(`alle planningsschermen op ${breedte}px: geen overloop, tabel in haar kader`, async ({ browser, baseURL }, info) => {
      test.skip(info.project.name !== 'Desktop (chromium)', 'eenmaal per run, in het desktopproject');
      const context = await browser.newContext({
        baseURL, viewport: { width: breedte, height: 900 },
        isMobile: breedte < 768, hasTouch: breedte < 1024, serviceWorkers: 'block',
      });
      try {
        for (const scherm of SCHERMEN) {
          const page = await context.newPage();
          await open(page, scherm);
          await geenOverloop(page, `${scherm.titel} ${breedte}px`);
          await tabellenPassen(page, `${scherm.titel} ${breedte}px`);
          await page.close();
        }
      } finally {
        await context.close();
      }
    });
  }
});

test('Maandplanning: raster met rijkoppen, eigen rij zonder goud, maandoverzicht sorteert', async ({ page }, info) => {
  test.skip(info.project.name !== 'Desktop (chromium)', 'het raster staat alleen op desktop; de telefoon heeft de dagweergave');
  await seed(page, {
    user: ADMIN, view: 'bezetting',
    extra: (pad, req) => (pad.includes('/api/month-planning') && new URL(req.url()).searchParams.get('format') === 'summary'
      ? {
          dagen: 30,
          rijen: [
            { driverId: 'a', naam: 'Anna', diensten: 10, minuten: 4800, anderWerk: 0, ziek: 1, betaald: 0, vrij: 8, overig: [], dagen: 11 },
            { driverId: 'b', naam: 'Bert', diensten: 18, minuten: 8600, anderWerk: 1, ziek: 0, betaald: 2, vrij: 6, overig: [{ code: 'tk', keren: 1 }], dagen: 21 },
          ],
          totaal: { diensten: 28, minuten: 13400, anderWerk: 1, ziek: 1, betaald: 2, vrij: 14, dagen: 32 },
        }
      : extra(pad, req)),
  });
  await page.goto('/maandplanning');
  const raster = page.getByRole('table', { name: 'Maandplanning per chauffeur en dag' });
  await expect(raster).toBeVisible({ timeout: 15_000 });
  await expect(raster.getByRole('columnheader', { name: 'Chauffeur' })).toHaveAttribute('scope', 'col');
  const eigen = raster.getByRole('rowheader', { name: /Jarno De Greve/ });
  await expect(eigen).toHaveAttribute('scope', 'row');
  // Geen gouden vlak op de eigen rij (goud = actie, focus, nu).
  const achtergrond = await eigen.evaluate((el) => getComputedStyle(el).backgroundColor);
  const gewoon = await raster.getByRole('rowheader', { name: 'Flexi 1' }).evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(achtergrond).toBe(gewoon);
  // Sectiekoppen zijn koppen over een groep rijen.
  await expect(raster.getByRole('rowheader', { name: 'Reguliere diensten' })).toHaveAttribute('scope', 'rowgroup');

  // Zoeken via het gedeelde zoekveld, met wisknop.
  const zoek = page.getByRole('searchbox', { name: 'Zoek chauffeur of dienst' });
  await zoek.fill('Flexi 2');
  await expect(raster.getByRole('rowheader')).toHaveCount(2); // sectiekop + Flexi 2
  await page.getByRole('button', { name: 'Zoekopdracht wissen' }).click();
  await expect(zoek).toHaveValue('');

  // Maandoverzicht: numerieke kolommen rechts, sorteren met aria-sort, totaalrij als rijkop.
  await page.getByRole('button', { name: 'Meer acties' }).click();
  await page.getByRole('menuitem', { name: 'Maandoverzicht' }).click();
  const overzicht = page.getByRole('table', { name: /^Maandoverzicht / });
  await expect(overzicht).toBeVisible();
  await expect(overzicht.getByRole('columnheader', { name: 'Chauffeur' })).toHaveAttribute('aria-sort', 'ascending');
  await expect(overzicht.getByRole('rowheader', { name: 'Totaal' })).toBeVisible();
  await overzicht.getByRole('button', { name: 'Diensten' }).click();
  await expect(overzicht.getByRole('columnheader', { name: 'Diensten' })).toHaveAttribute('aria-sort', 'descending');
  await expect(overzicht.getByRole('row').nth(1)).toContainText('Bert');
  await overzicht.getByRole('button', { name: 'Diensten' }).click();
  await expect(overzicht.getByRole('columnheader', { name: 'Diensten' })).toHaveAttribute('aria-sort', 'ascending');
  await expect(overzicht.getByRole('row').nth(1)).toContainText('Anna');
});

test('Planningsoverzicht: actieve dag gemarkeerd, onbekende code ook op de telefoon toe te voegen', async ({ page }) => {
  await open(page, SCHERMEN[1]);
  const dagen = page.getByRole('list', { name: 'Geüploade dagen' });
  const actief = dagen.locator('[aria-current="true"]');
  await expect(actief).toHaveCount(1);
  // Kies de dag met de onbekende code (tweede dag).
  const knoppen = dagen.getByRole('button');
  await knoppen.nth(1).click();
  await expect(knoppen.nth(1)).toHaveAttribute('aria-current', 'true');
  await expect(knoppen.nth(0)).not.toHaveAttribute('aria-current', 'true');
  // Zowel in de tabel (desktop) als in de lijst (telefoon) staat de knop.
  const voegToe = page.getByRole('button', { name: 'Voeg xq toe als planningscode' }).filter({ visible: true });
  await expect(voegToe.first()).toBeVisible();
});

test('Openstaande diensten: tabel op desktop, lijst op de telefoon, gat opent de kandidaten', async ({ page }, info) => {
  await open(page, SCHERMEN[2]);
  const desktop = info.project.name === 'Desktop (chromium)';
  const tabel = page.getByRole('table', { name: /^Openstaande diensten/ });
  if (desktop) {
    await expect(tabel).toBeVisible();
    await expect(tabel.getByRole('columnheader', { name: 'Dag', exact: true })).toHaveAttribute('scope', 'col');
    await expect(tabel.getByRole('rowheader').first()).toBeVisible();
  } else {
    await expect(tabel).toBeHidden();
    await expect(page.getByRole('list', { name: /^Openstaande diensten/ })).toBeVisible();
  }
  // "Alleen dagen met gaten" staat standaard aan; uit toont ook de gedekte dagen, aan weer niet.
  const volledig = page.getByText('volledig gedekt').filter({ visible: true });
  await expect(volledig).toHaveCount(0);
  await page.getByRole('button', { name: 'Alleen dagen met gaten' }).click();
  await expect(volledig.first()).toBeVisible();
  await page.getByRole('button', { name: 'Alleen dagen met gaten' }).click();
  await expect(volledig).toHaveCount(0);
  // Een gat opent de kandidaten.
  await page.getByRole('button', { name: /^2607/ }).filter({ visible: true }).first().click();
  await expect(page.getByText('Kandidaten voor dienst 2607')).toBeVisible();
  await expect(page.getByText('Niemand is vrij op deze dag (geen dienst én geen verlof).')).toBeVisible();
});
