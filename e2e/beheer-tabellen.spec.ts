import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { ADMIN, seed } from './helpers';

/**
 * Tranche 3B.1 (23-09): de vijf beheerschermen op het gedeelde tabelkader
 * (Gebruikers, Toestellen, Vervaldata, Planningscodes, Beheer
 * dienstoverzicht; sinds 3D één scherm Dienstoverzicht).
 *
 * - geen horizontale paginaoverloop (document én scroll-root) op de
 *   projectbreedte (iPhone 390 / desktop 1440) en, in het desktopproject,
 *   ook op 375, 768, 1024 en 1280 px;
 * - waar een tabel zichtbaar is, past ze in haar kader (TableShell `past`
 *   knipt anders stil af);
 * - axe (WCAG 2.1 AA, serious/critical blokkeert) op elk scherm;
 * - Vervaldata: de naam is een knop, Enter opent het bewerkvenster.
 */

const EXPIRIES = [
  { userId: '42', soort: 'code95', validUntil: '2026-01-10' },
  { userId: '42', soort: 'medische_schifting', validUntil: '2031-06-30' },
  { userId: '43', soort: 'code95', validUntil: '2029-11-27' },
];
const CODES = [
  { code: 'bv', category: 'leave', description: 'Betaald verlof', countsAsShift: false, isPaidAbsence: true, isDayOff: false },
  { code: 'z', category: 'absence', description: 'Ziek', countsAsShift: false, isPaidAbsence: false, isDayOff: false },
  { code: 'r', category: 'service', description: 'Reserve', countsAsShift: true, isPaidAbsence: false, isDayOff: false },
];

type Scherm = { view: string; pad: string; titel: string };
const SCHERMEN: Scherm[] = [
  { view: 'gebruikers', pad: '/beheer/gebruikers', titel: 'Gebruikers' },
  { view: 'toestellen', pad: '/beheer/toestellen', titel: 'Toestellen' },
  { view: 'vervaldata', pad: '/beheer/vervaldata', titel: 'Vervaldata' },
  { view: 'planning-codes', pad: '/beheer/planningscodes', titel: 'Planningscodes' },
  // 3D (23-09): Dienstoverzicht en Beheer dienstoverzicht zijn één scherm.
  { view: 'dienstoverzicht', pad: '/beheer/dienstoverzicht', titel: 'Dienstoverzicht' },
];

const extra = (pad: string) => {
  if (pad.endsWith('/api/user-expiries')) return EXPIRIES;
  if (pad.endsWith('/api/planning-codes')) return CODES;
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

/** Elke zichtbare tabel valt binnen haar kaart (surface-table). */
async function tabellenPassen(page: Page, waar: string) {
  const buiten = await page.evaluate(() => [...document.querySelectorAll('table')].flatMap((t) => {
    const r = t.getBoundingClientRect();
    if (r.width === 0) return [];
    const kaartEl = t.closest('.surface-table');
    const kaart = kaartEl?.getBoundingClientRect();
    // Een tabel die in haar eigen strook schuift (TableShell standaard of
    // `sticky` onder xl) mag breder zijn: dat is de bedoeling.
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
    test(`alle vijf schermen op ${breedte}px: geen overloop, tabel in haar kader`, async ({ browser, baseURL }, info) => {
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

test('Vervaldata: de naam is een knop, Enter opent het bewerkvenster', async ({ page }, info) => {
  test.skip(info.project.name !== 'Desktop (chromium)', 'de tabel staat alleen op desktop; mobiel is de hele kaart een knop');
  await open(page, SCHERMEN[2]);
  const tabel = page.getByRole('table', { name: 'Vervaldata per chauffeur' });
  await expect(tabel.getByRole('columnheader', { name: 'Chauffeur' })).toHaveAttribute('scope', 'col');
  // Geen aparte potloodknop meer.
  await expect(tabel.getByRole('columnheader', { name: 'Acties' })).toHaveCount(0);
  const knop = tabel.getByRole('button', { name: 'Vervaldata van Alex Du Priez bewerken' });
  await knop.focus();
  await page.keyboard.press('Enter');
  const dialoog = page.getByRole('dialog', { name: 'Vervaldata van Alex Du Priez' });
  await expect(dialoog).toBeVisible();
  await expect(page).toHaveURL(/\/beheer\/vervaldata\/43$/);
});

/**
 * Lay-out-polish P4 (23-09). Gebruikers op de telefoon: naast de rolkeuze
 * viel de chip "Nog nooit ingelogd" half buiten het kader (alleen zijn icoon
 * bleef over). Nu staat de rolkeuze over de volle breedte en de chip eronder.
 */
test('Gebruikers op de telefoon: rolkeuze over de volle breedte, snelfilter volledig in beeld', async ({ page }, info) => {
  test.skip(info.project.name !== 'iPhone 13 (chromium)', 'telefoonbreedte');
  await open(page, SCHERMEN[0]);
  const breedte = page.viewportSize()!.width;
  const chip = page.getByRole('button', { name: /Nog nooit ingelogd/ });
  const vak = await chip.boundingBox();
  expect(vak).not.toBeNull();
  expect(vak!.x).toBeGreaterThanOrEqual(0);
  expect(vak!.x + vak!.width, 'chip volledig in beeld').toBeLessThanOrEqual(breedte);
  const rol = await page.getByRole('group', { name: 'Rol' }).boundingBox();
  const zoek = await page.getByRole('searchbox').or(page.getByPlaceholder(/Zoek op naam/)).first().boundingBox();
  // Zelfde breedte als het zoekveld erboven (± de afronding).
  expect(Math.abs(rol!.width - zoek!.width), 'rolkeuze over de volle breedte').toBeLessThanOrEqual(2);
});

test('Gebruikers op desktop: de kop Toestellen staat rechts, boven de cijfers', async ({ page }, info) => {
  test.skip(info.project.name !== 'Desktop (chromium)', 'de tabel staat alleen vanaf md');
  await open(page, SCHERMEN[0]);
  const tabel = page.getByRole('table');
  const kop = await tabel.getByRole('columnheader', { name: 'Toestellen' }).getByText('Toestellen', { exact: true }).boundingBox();
  const rij = tabel.getByRole('row').filter({ hasText: 'Test Chauffeur' });
  const cel = rij.getByRole('cell').nth(5);
  const waarde = await cel.evaluate((td) => {
    const r = document.createRange(); r.selectNodeContents(td);
    return r.getBoundingClientRect().right;
  });
  expect(Math.abs(kop!.x + kop!.width - waarde), 'kop en waarde delen de rechterrand').toBeLessThanOrEqual(2);
});

/**
 * Verlofkalender op de telefoon: een periode las als "28, →" en de status
 * werd afgekapt ("in behandeli…"). Nu de volledige periode en de status op
 * een eigen regel; de maandnavigatie heeft de pijlen aan de randen.
 */
test('Verlofkalender op de telefoon: volledige periode en status, maandnavigatie over de breedte', async ({ page }, info) => {
  test.skip(info.project.name !== 'iPhone 13 (chromium)', 'telefoonbreedte');
  await open(page, { view: 'verlof-kalender', pad: '/beheer/verlofkalender', titel: 'Verlofkalender' });
  const breedte = page.viewportSize()!.width;
  const periode = page.getByText(/^\d{2}\/\d{2}\/\d{4} t\/m \d{2}\/\d{2}\/\d{4}$/).first();
  await expect(periode).toBeVisible();
  const status = page.getByText(/· in behandeling$/).first();
  await expect(status).toBeVisible();
  for (const el of [periode, status]) {
    const afgekapt = await el.evaluate((n) => n.scrollWidth > n.clientWidth + 1 || getComputedStyle(n).textOverflow === 'ellipsis');
    expect(afgekapt, 'tekst niet afgekapt').toBe(false);
  }
  const vorige = await page.getByRole('button', { name: 'Vorige maand' }).boundingBox();
  const volgende = await page.getByRole('button', { name: 'Volgende maand' }).boundingBox();
  // Pijlen aan de randen van de inhoudskolom (16 px marge), niet links gegroepeerd.
  expect(vorige!.x).toBeLessThanOrEqual(24);
  expect(volgende!.x + volgende!.width).toBeGreaterThanOrEqual(breedte - 24);
});
