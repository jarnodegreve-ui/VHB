import { test, expect, type Locator, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { ADMIN, AXE_TAGS, AXE_TIJDELIJK_UIT, seed, wachtOpAnimaties } from './helpers';
import { OCPI_MAAND } from '../scripts/audit-fixtures.mjs';

/**
 * Beheer › Laadplein (ronde 6, punt 10, rest): de grafieken tonen hun
 * uitlezing ook als je er met de muis naar wijst.
 *
 * - Desktop: wijzen (`hover()`) zet de uitlezing van die staaf of dat
 *   kwartier binnen één frame in de regel onder de as, met een lichte
 *   markering; van de grafiek af staat er weer de vastgezette keuze of de
 *   samenvatting. Een klik zet vast en maakt los zoals voorheen; wijzen laat
 *   de vastgezette staan. De regel houdt haar hoogte, ook met een knop erin.
 * - Geen title meer op staven en kwartieren; de piekstip draagt een rand in
 *   de kleur van de tegel (`--tile-bg`), ook in donker.
 * - Telefoon (WebKit en Chromium): een tik (`tap()`, pointerType touch)
 *   kiest zoals voorheen en geeft geen wijsmarkering.
 *
 * De testdata zijn de gedeelde ocpi-fixtures (scripts/audit-fixtures.mjs).
 * Let op: Playwright's `click()` stuurt muisgebeurtenissen, ook op een
 * telefoon; een tik toets je met `tap()`.
 */

const DESKTOP = 'Desktop (chromium)';

async function ga(page: Page, pad: string) {
  await page.goto(pad);
  await expect(page.getByRole('heading', { name: 'Laadplein', level: 1 })).toBeVisible({ timeout: 15_000 });
  await page.evaluate(() => document.fonts.ready);
}

async function open(page: Page, pad: string, thema?: 'light' | 'dark') {
  await seed(page, { user: ADMIN, view: 'ocpi-monitoring', thema });
  await ga(page, pad);
}

/** De uitlezingsregel: de alinea na de as-labels, onder de grafiek. */
const regelVan = (grafiek: Locator) => grafiek.locator('xpath=following-sibling::p[1]');

/** De tekst bij het eerstvolgende frame, zonder opnieuw te proberen:
 *  `toHaveText` zou ook slagen als de uitlezing pas na een seconde kwam. */
const tekstNaEenFrame = (regel: Locator) => regel.evaluate((p) => new Promise<string>((klaar) => {
  requestAnimationFrame(() => klaar(p.textContent ?? ''));
}));

/** Muis van de grafiek af (linksboven in de kop). */
const muisWeg = (page: Page) => page.mouse.move(4, 4);

/** Staven met een wijsmarkering (één trede donkerder). */
const gemarkeerd = (grafiek: Locator) => grafiek.locator('button > div.bg-slate-600, button > div.bg-oker-600');

/** Hoogte van de regel en de bovenkant van haar eerste tekst. */
const maat = (regel: Locator) => regel.evaluate((p) => {
  const tekst = [...p.childNodes].find((n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? '').trim() !== '');
  const r = document.createRange();
  if (tekst) r.selectNodeContents(tekst);
  return { hoogte: Math.round(p.getBoundingClientRect().height * 100) / 100, tekstTop: tekst ? Math.round(r.getBoundingClientRect().top * 100) / 100 - Math.round(p.getBoundingClientRect().top * 100) / 100 : null };
});

/** Twee gewone staven (geen piek) in de maandfixture van augustus 2026. */
const augustus = OCPI_MAAND('2026-08');
const gewoon = augustus.dagen.map((_: unknown, i: number) => i).filter((i: number) => augustus.dagen[i].dag !== augustus.totalen.hoogsteDag?.dag);
const [N, M] = [gewoon[8], gewoon[19]];

test('Maand: wijzen toont meteen de uitlezing van de dag, eraf herstelt, klik zet vast en wijzen laat die staan', async ({ page }, info) => {
  test.skip(info.project.name !== DESKTOP, 'wijzen met de muis: desktop');
  await open(page, '/beheer/laadplein/maand');
  const grafiek = page.getByRole('img', { name: /^Verbruik per dag in/ });
  const vakken = grafiek.locator('button');
  await expect(vakken).toHaveCount(31);
  const regel = regelVan(grafiek);
  await expect(regel).toHaveText(/^totaal /);
  const samenvatting = (await regel.textContent()) ?? '';

  // Wijzen: de uitlezing van dag N staat er bij het volgende frame, zonder klik.
  await vakken.nth(N).hover();
  const tekstN = await tekstNaEenFrame(regel);
  expect(tekstN).not.toBe(samenvatting);
  expect(tekstN).toMatch(/kWh · \d+ laadsessies?/);
  await expect(regel).toHaveClass(/font-semibold/);
  await expect(vakken.nth(N).locator('div')).toHaveClass(/\bbg-slate-600\b/);
  await expect(gemarkeerd(grafiek)).toHaveCount(1);

  // Eraf: de samenvatting van de reeks, geen markering.
  await muisWeg(page);
  await expect(regel).toHaveText(samenvatting);
  await expect(regel).toHaveClass(/font-medium/);
  await expect(gemarkeerd(grafiek)).toHaveCount(0);

  // Klik zet vast: na het weggaan staat dezelfde uitlezing als bij wijzen.
  await vakken.nth(N).click();
  await muisWeg(page);
  await expect(vakken.nth(N).locator('div')).toHaveClass(/\bbg-keuze\b/);
  await expect(regel).toHaveText(tekstN);

  // Wijzen op een andere dag: die uitlezing, de vastgezette blijft staan.
  await vakken.nth(M).hover();
  const tekstM = await tekstNaEenFrame(regel);
  expect(tekstM).not.toBe(tekstN);
  expect(tekstM).not.toBe(samenvatting);
  await expect(vakken.nth(N).locator('div')).toHaveClass(/\bbg-keuze\b/);
  await expect(vakken.nth(M).locator('div')).toHaveClass(/\bbg-slate-600\b/);
  await muisWeg(page);
  await expect(regel).toHaveText(tekstN);
  await expect(gemarkeerd(grafiek)).toHaveCount(0);

  // Tweede klik maakt los, zoals voorheen.
  await vakken.nth(N).click();
  await muisWeg(page);
  await expect(regel).toHaveText(samenvatting);
  await expect(grafiek.locator('button > div.bg-keuze')).toHaveCount(0);

  // De piek wordt bij wijzen ook één trede donkerder.
  const piek = augustus.dagen.findIndex((d: { dag: string }) => d.dag === augustus.totalen.hoogsteDag?.dag);
  await vakken.nth(piek).hover();
  await expect(vakken.nth(piek).locator('div')).toHaveClass(/\bbg-oker-600\b/);
});

test('Live: wijzen op een kwartier toont meteen zijn uitlezing met een lichte band; klik zet vast', async ({ page }, info) => {
  test.skip(info.project.name !== DESKTOP, 'wijzen met de muis: desktop');
  await open(page, '/beheer/laadplein');
  const curve = page.getByRole('img', { name: /^Vermogen laatste 24 uur/ });
  const vakken = curve.locator('button');
  await expect(vakken).toHaveCount(96);
  const regel = regelVan(curve);
  await expect(regel).toHaveText(/^piek /);
  const samenvatting = (await regel.textContent()) ?? '';
  const band = (dichtheid: '5' | '10') => curve.locator(`rect[class="fill-slate-900/${dichtheid}"]`);
  const K = 50;
  const L = 70;

  await vakken.nth(K).hover();
  const tekstK = await tekstNaEenFrame(regel);
  expect(tekstK).not.toBe(samenvatting);
  expect(tekstK).toMatch(/^\d{2}:\d{2} · .*kW · \d+ sessies?$/);
  await expect(band('5')).toHaveCount(1);
  expect(Number(await band('5').getAttribute('x'))).toBeCloseTo((K * 100) / 96, 2);
  await expect(band('10')).toHaveCount(0);

  await muisWeg(page);
  await expect(regel).toHaveText(samenvatting);
  await expect(band('5')).toHaveCount(0);

  // Klik zet vast; wijzen op hetzelfde kwartier geeft alleen de keuze.
  await vakken.nth(K).click();
  await expect(band('10')).toHaveCount(1);
  await expect(band('5')).toHaveCount(0);
  await muisWeg(page);
  await expect(regel).toHaveText(tekstK);

  // Wijzen op een ander kwartier: twee banden, de vastgezette blijft.
  await vakken.nth(L).hover();
  const tekstL = await tekstNaEenFrame(regel);
  expect(tekstL).not.toBe(tekstK);
  await expect(band('5')).toHaveCount(1);
  await expect(band('10')).toHaveCount(1);
  expect(Number(await band('10').getAttribute('x'))).toBeCloseTo((K * 100) / 96, 2);
  await muisWeg(page);
  await expect(regel).toHaveText(tekstK);
  await expect(band('5')).toHaveCount(0);

  // Tweede klik maakt los.
  await vakken.nth(K).click();
  await muisWeg(page);
  await expect(regel).toHaveText(samenvatting);
  await expect(band('10')).toHaveCount(0);
});

test('de uitlezingsregel houdt haar hoogte bij wijzen en klikken, ook met een knop erin en met een andere letter', async ({ page }, info) => {
  test.skip(info.project.name !== DESKTOP, 'wijzen met de muis: desktop');
  const GEVALLEN = [
    { pad: '/beheer/laadplein/maand', grafiek: /^Verbruik per dag in/, a: N, b: M, knop: 'dagdetail' },
    { pad: '/beheer/laadplein/historiek', grafiek: /^Verbruik per maand/, a: 1, b: 0, knop: 'maandoverzicht' },
    { pad: '/beheer/laadplein', grafiek: /^Vermogen laatste 24 uur/, a: 50, b: 70, knop: null },
  ];
  await seed(page, { user: ADMIN, view: 'ocpi-monitoring' });
  for (const geval of GEVALLEN) {
    await ga(page, geval.pad);
    const grafiek = page.getByRole('img', { name: geval.grafiek });
    const vakken = grafiek.locator('button');
    const regel = regelVan(grafiek);
    await expect(regel).not.toBeEmpty();
    for (const letter of ['', 'monospace', 'sans-serif']) {
      await page.evaluate((f) => {
        document.getElementById('e2e-letter')?.remove();
        if (!f) return;
        const s = document.createElement('style');
        s.id = 'e2e-letter';
        s.textContent = `* { font-family: ${f} !important; }`;
        document.head.appendChild(s);
      }, letter);
      await muisWeg(page);
      const rust = await maat(regel);
      await vakken.nth(geval.a).hover();
      await expect(regel).toHaveClass(/font-semibold/);
      if (geval.knop) await expect(regel.getByRole('button', { name: geval.knop })).toBeVisible();
      const wijzen = await maat(regel);
      await vakken.nth(geval.a).click();
      await muisWeg(page);
      const vast = await maat(regel);
      await vakken.nth(geval.b).hover();
      const vastEnWijzen = await maat(regel);
      // Loslaten voor de volgende letter.
      await vakken.nth(geval.a).click();
      await muisWeg(page);
      const waar = `${geval.pad} ${letter || 'standaardletter'}`;
      for (const [stand, m] of Object.entries({ wijzen, vast, vastEnWijzen })) {
        expect(Math.abs(m.hoogte - rust.hoogte), `${waar}: hoogte bij ${stand} (${m.hoogte} tegen ${rust.hoogte})`).toBeLessThanOrEqual(0.5);
        expect(Math.abs((m.tekstTop ?? 0) - (rust.tekstTop ?? 0)), `${waar}: tekst verspringt bij ${stand}`).toBeLessThanOrEqual(0.5);
      }
    }
  }
});

test('staven en kwartieren dragen geen title meer, op elke grafiek van het scherm', async ({ page }, info) => {
  test.skip(info.project.name !== DESKTOP, 'title is een muistooltip');
  const zonderTitle = async () => {
    await expect(page.locator('[role="img"].touch-pan-y button').first()).toBeAttached();
    await expect(page.locator('[role="img"].touch-pan-y button[title]')).toHaveCount(0);
  };
  await open(page, '/beheer/laadplein');
  await zonderTitle();
  // Live, vermogen over 7 dagen (dagpieken als staven).
  await page.getByRole('group', { name: 'Termijn vermogensgrafiek' }).getByRole('button', { name: /^7/ }).click();
  await expect(page.getByRole('img', { name: /^Dagpiek per dag, laatste 7 dagen/ })).toBeVisible();
  await zonderTitle();
  // Het dagdetail (kwartiercurve van één dag).
  await page.getByRole('button', { name: /Vandaag geladen/ }).click();
  const dag = page.getByRole('dialog', { name: /^Dagdetail/ });
  await expect(dag.getByRole('img', { name: /^Vermogen op/ })).toBeVisible();
  await zonderTitle();
  await page.keyboard.press('Escape');
  await ga(page, '/beheer/laadplein/maand');
  await zonderTitle();
  await ga(page, '/beheer/laadplein/historiek');
  await zonderTitle();
});

for (const thema of ['light', 'dark'] as const) {
  test(`piekstip: rand in de kleur van de tegel, geen wit (${thema})`, async ({ page }, info) => {
    test.skip(info.project.name !== DESKTOP, 'eenmaal per run');
    await open(page, '/beheer/laadplein', thema);
    const curve = page.getByRole('img', { name: /^Vermogen laatste 24 uur/ });
    const stip = curve.locator('circle');
    await expect(stip).toHaveCount(1);
    const kleuren = await curve.evaluate((el) => {
      const c = el.querySelector('circle')!;
      // Een as-label in dezelfde grafiek draagt de tegelkleur (`--tile-bg`).
      const label = [...el.querySelectorAll<HTMLElement>('span')].find((s) => s.style.background.includes('--tile-bg'))!;
      return {
        klasse: c.getAttribute('class'),
        rand: getComputedStyle(c).stroke,
        token: getComputedStyle(label).backgroundColor,
        tegel: getComputedStyle(el.closest('.surface-card')!).backgroundColor,
      };
    });
    expect(kleuren.klasse).not.toContain('stroke-white');
    expect(kleuren.rand).not.toBe('rgb(255, 255, 255)');
    expect(kleuren.rand, 'rand = --tile-bg').toBe(kleuren.token);
    // De tegel zelf (.surface-card) heeft dezelfde kleur; in donker is haar
    // dekking 95 % tegen 96 % voor --tile-bg (index.css), dus vergelijk de kanalen.
    const kanalen = (kleur: string) => {
      const getallen = [...kleur.matchAll(/-?\d*\.?\d+(?:e-?\d+)?/g)].map((m) => Number(m[0]));
      const srgb = kleur.startsWith('color(srgb');
      return getallen.slice(0, 3).map((v) => Math.round(srgb ? v * 255 : v));
    };
    expect(kanalen(kleuren.rand), `rand ${kleuren.rand} tegen tegel ${kleuren.tegel}`).toEqual(kanalen(kleuren.tegel));
  });
}

test('axe op het laadplein, met de muis op een dag (WCAG 2.1 AA)', async ({ page }, info) => {
  test.skip(info.project.name !== DESKTOP, 'eenmaal per run, op desktop');
  await open(page, '/beheer/laadplein/maand');
  const grafiek = page.getByRole('img', { name: /^Verbruik per dag in/ });
  await grafiek.locator('button').nth(N).hover();
  await expect(regelVan(grafiek).getByRole('button', { name: 'dagdetail' })).toBeVisible();
  await wachtOpAnimaties(page);
  const resultaat = await new AxeBuilder({ page })
    .withTags(AXE_TAGS)
    .disableRules(AXE_TIJDELIJK_UIT)
    // Bestaande fout, niet van deze wijziging (gemeten op de basis 8b705fe3):
    // nested-interactive op de grafiekvlakken zelf, de tik-vlakken zijn
    // <button tabIndex={-1} aria-hidden> in een role="img". Herstel hoort in
    // src/views/admin/laadpalen/grafieken.tsx; de uitlezingsregel eronder
    // valt buiten deze uitsluiting en wordt wel gescand.
    .exclude('[role="img"].touch-pan-y')
    .analyze();
  const blokkerend = resultaat.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(blokkerend.map((v) => `${v.id}: ${v.help} (${JSON.stringify(v.nodes[0]?.target)})`)).toEqual([]);
});

test('telefoon: een tik kiest zoals voorheen en geeft geen wijsmarkering', async ({ page }, info) => {
  test.skip(info.project.name === DESKTOP, 'tikken: de twee iPhone-projecten');
  await open(page, '/beheer/laadplein/maand');
  const grafiek = page.getByRole('img', { name: /^Verbruik per dag in/ });
  const vakken = grafiek.locator('button');
  await expect(vakken).toHaveCount(31);
  const regel = regelVan(grafiek);
  await expect(regel).toHaveText(/^totaal /);
  const samenvatting = (await regel.textContent()) ?? '';

  await vakken.nth(N).tap();
  await expect(vakken.nth(N).locator('div')).toHaveClass(/\bbg-keuze\b/);
  await expect(regel).not.toHaveText(samenvatting);
  await expect(regel).toHaveText(/laadsessies?/);
  await expect(regel).toHaveClass(/font-semibold/);
  await expect(gemarkeerd(grafiek)).toHaveCount(0);
  const gekozen = await regel.textContent();

  // Een tik op een andere dag kiest die, nog altijd zonder wijsmarkering.
  await page.waitForTimeout(120);
  await vakken.nth(M).tap();
  await expect(vakken.nth(M).locator('div')).toHaveClass(/\bbg-keuze\b/);
  await expect(regel).not.toHaveText(gekozen ?? '');
  await expect(gemarkeerd(grafiek)).toHaveCount(0);

  // Nog een tik op dezelfde dag maakt los.
  await page.waitForTimeout(120);
  await vakken.nth(M).tap();
  await expect(regel).toHaveText(samenvatting);
  await expect(grafiek.locator('button > div.bg-keuze')).toHaveCount(0);
  await expect(gemarkeerd(grafiek)).toHaveCount(0);

  // De kwartiercurve: een tik kiest, zonder wijsband.
  await ga(page, '/beheer/laadplein');
  const curve = page.getByRole('img', { name: /^Vermogen laatste 24 uur/ });
  const kwartieren = curve.locator('button');
  await expect(kwartieren).toHaveCount(96);
  await kwartieren.nth(60).tap();
  await expect(curve.locator('rect[class="fill-slate-900/10"]')).toHaveCount(1);
  await expect(curve.locator('rect[class="fill-slate-900/5"]')).toHaveCount(0);
  await expect(regelVan(curve)).toHaveText(/^\d{2}:\d{2} · /);
});
