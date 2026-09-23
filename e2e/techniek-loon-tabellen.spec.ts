import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { ADMIN, seed } from './helpers';
import { dayOffset } from '../scripts/audit-fixtures.mjs';

/**
 * Tranche 3B.2 (23-09): de techniek- en loonschermen op het gedeelde
 * tabelkader (Voertuigen, Dagadministratie techniek, Looncontrole,
 * Dagafsluiting, Dienstopbouw), elk tabblad apart.
 *
 * - geen horizontale paginaoverloop (document én scroll-root) op de
 *   projectbreedte (iPhone 390 / desktop 1440) en, in het desktopproject,
 *   ook op 375, 768, 1024 en 1280 px;
 * - waar een tabel zichtbaar is, past ze in haar kader of schuift ze in
 *   haar eigen strook (TableShell `past` knipt anders stil af);
 * - axe (WCAG 2.1 AA, serious/critical blokkeert) op elk scherm;
 * - Voertuigen: de bus is een knop, Enter opent de fiche;
 * - Dagafsluiting op de telefoon: een kaart per chauffeur, niets schuift.
 */

type Scherm = { naam: string; view: string; pad: string; titel: string; tab?: string; na?: (page: Page) => Promise<void> };
const gisteren = dayOffset(-1);
const SCHERMEN: Scherm[] = [
  { naam: 'Voertuigen', view: 'voertuigen', pad: '/techniek/voertuigen', titel: 'Voertuigen' },
  { naam: 'Dagadministratie techniek, lijst', view: 'werkprestaties', pad: '/techniek/prestaties', titel: 'Dagadministratie' },
  { naam: 'Dagadministratie techniek, rapport', view: 'werkprestaties', pad: '/techniek/prestaties', titel: 'Dagadministratie', tab: 'Rapport' },
  { naam: 'Looncontrole, maand', view: 'looncontrole', pad: '/beheer/looncontrole', titel: 'Looncontrole' },
  { naam: 'Looncontrole, looncodes', view: 'looncontrole', pad: '/beheer/looncontrole', titel: 'Looncontrole', tab: 'Looncodes' },
  { naam: 'Looncontrole, medewerkers', view: 'looncontrole', pad: '/beheer/looncontrole', titel: 'Looncontrole', tab: 'Medewerkers' },
  { naam: 'Dagafsluiting', view: 'dagafsluiting', pad: `/beheer/dagadministratie/${gisteren}`, titel: 'Dagadministratie' },
  { naam: 'Dienstopbouw, imports', view: 'dienstopbouw', pad: '/beheer/dienstopbouw', titel: 'Dienstopbouw' },
  {
    naam: 'Dienstopbouw, diensten', view: 'dienstopbouw', pad: '/beheer/dienstopbouw', titel: 'Dienstopbouw', tab: 'Diensten',
    na: async (page) => {
      await page.getByRole('button', { name: /^2101 / }).first().click();
      await expect(page.getByText('Ritblad uit data')).toBeVisible();
      await expect(page.getByText('Brugge Station').filter({ visible: true }).first()).toBeVisible();
    },
  },
  { naam: 'Dienstopbouw, dagtypes', view: 'dienstopbouw', pad: '/beheer/dienstopbouw', titel: 'Dienstopbouw', tab: 'Dagtypes' },
];

async function open(page: Page, scherm: Scherm) {
  await seed(page, { user: ADMIN, view: scherm.view });
  await page.goto(scherm.pad);
  await expect(page.getByRole('heading', { name: scherm.titel, level: 1 })).toBeVisible({ timeout: 15_000 });
  if (scherm.tab) {
    await page.getByRole('group', { name: /Onderdeel|Weergave/ }).getByRole('button', { name: scherm.tab, exact: true }).click();
  }
  if (scherm.na) await scherm.na(page);
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
  test(`${scherm.naam}: geen overloop, tabel in haar kader, a11y`, async ({ page }, info) => {
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
    test(`alle schermen op ${breedte}px: geen overloop, tabel in haar kader`, async ({ browser, baseURL }, info) => {
      test.skip(info.project.name !== 'Desktop (chromium)', 'eenmaal per run, in het desktopproject');
      test.setTimeout(90_000);
      const context = await browser.newContext({
        baseURL, viewport: { width: breedte, height: 900 },
        isMobile: breedte < 768, hasTouch: breedte < 1024, serviceWorkers: 'block',
      });
      try {
        for (const scherm of SCHERMEN) {
          const page = await context.newPage();
          await open(page, scherm);
          await geenOverloop(page, `${scherm.naam} ${breedte}px`);
          await tabellenPassen(page, `${scherm.naam} ${breedte}px`);
          await page.close();
        }
      } finally {
        await context.close();
      }
    });
  }
});

test('Voertuigen: de bus is een knop, Enter opent de fiche', async ({ page }, info) => {
  test.skip(info.project.name !== 'Desktop (chromium)', 'de tabel staat alleen op desktop; mobiel is de hele kaart een knop');
  await open(page, SCHERMEN[0]);
  const tabel = page.getByRole('table', { name: 'Voertuigen' });
  await expect(tabel.getByRole('columnheader', { name: 'Bus' })).toHaveAttribute('scope', 'col');
  // Geen aparte potloodknop meer.
  await expect(tabel.getByRole('columnheader', { name: 'Acties' })).toHaveCount(0);
  const knop = tabel.getByRole('button', { name: 'Bus 26 openen' });
  await knop.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: 'Voertuig Bus 26' })).toBeVisible();
});

test('Dagafsluiting op de telefoon: een kaart per chauffeur, dezelfde cellen', async ({ page }, info) => {
  test.skip(info.project.name !== 'iPhone 13 (chromium)', 'de kaartopmaak geldt onder md');
  await open(page, SCHERMEN[6]);
  const rij = page.getByRole('row').filter({ hasText: 'Test Chauffeur' });
  // De kolomkop is weg, elke cel draagt zijn eigen kopje.
  await expect(page.getByRole('columnheader', { name: 'Chauffeur' })).toBeHidden();
  await expect(rij.getByText('Gereden', { exact: true })).toBeVisible();
  // Invoer volledig in beeld: niets schuift horizontaal.
  const opmerking = rij.getByRole('textbox', { name: 'Opmerking voor Test Chauffeur' });
  const vak = await opmerking.boundingBox();
  const breedte = page.viewportSize()!.width;
  expect(vak).not.toBeNull();
  expect(vak!.x).toBeGreaterThanOrEqual(0);
  expect(vak!.x + vak!.width).toBeLessThanOrEqual(breedte);
});
