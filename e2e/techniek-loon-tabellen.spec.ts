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

/**
 * De kwaliteitsvlaggen (3B.2, 23-09): het vlak stond `absolute` in de strook
 * waarin de tabel schuift en werd op de onderste rijen afgeknipt. Nu zweeft
 * het (Popover `anker`: portal + fixed, erboven als er onder geen plaats is).
 * Met 14 rijen is er een echte onderste rij tegen de rand van het kader. Per
 * rij (boven, midden, onder) en per breedte: het vlak ligt volledig in de
 * viewport, binnen de kliprechthoek van elke voorouder die knipt, niets
 * anders ligt erover; een vlag gaat aan als volledige set (autosave);
 * Escape en een buiten-klik sluiten en zetten de focus terug op de trigger.
 */
const VLAG_RIJEN = 14;
const VLAG_NAMEN = Array.from({ length: VLAG_RIJEN }, (_, i) => `Chauffeur ${String(i + 1).padStart(2, '0')}`);
const vlagRij = (i: number, datum: string, extra: Record<string, unknown> = {}) => ({
  id: `v${i}`, datum, userId: `u${i}`, naam: VLAG_NAMEN[i], volgnr: 1, planningCode: '2101', geredenCode: '2101', overmin: 0, overminNacht: 0, overminExtra: 0, onvPremie: false,
  qualOngeval: false, qualPanne: false, qualVerkeersovertreding: false, qualKlantklacht: false, qualAdmfout: false, qualInterneklacht: false, qualVertragingDrSchuld: false, qualRitNtGeredenDrSchuld: false,
  opmerking: null, bewerktOp: null, bewerktDoor: null, ...extra,
});

for (const breedte of [null, 1024] as const) {
  test(`vlaggenmenu blijft heel op de bovenste, middelste en onderste rij${breedte ? ` (${breedte}px)` : ''}`, async ({ page }, info) => {
    const desktop = info.project.name.startsWith('Desktop');
    test.skip(breedte !== null && !desktop, 'De extra breedte hoort bij het desktopproject.');
    if (breedte) await page.setViewportSize({ width: breedte, height: 768 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const pageErrors: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));
    const gisteren = dayOffset(-1);
    const puts: Array<{ id: string; body: Record<string, unknown> }> = [];
    await seed(page, {
      user: ADMIN,
      view: 'dagafsluiting',
      extra: (pad, request) => {
        if (pad.endsWith(`/api/dagafsluiting/${gisteren}`) && request.method() === 'GET') {
          const dag = { datum: gisteren, status: 'open', geopendOp: new Date().toISOString(), geopendDoor: '1', afgeslotenOp: null, afgeslotenDoor: null, heropendOp: null, heropendDoor: null, heropendReden: null };
          return { dag, rijen: VLAG_NAMEN.map((_, i) => vlagRij(i, gisteren)), planningAfwijkingen: [], ontbrekendeCodes: [], inPlanning: true };
        }
        if (pad.includes('/rijen/') && request.method() === 'PUT') {
          const id = pad.split('/').pop() ?? '';
          const body = JSON.parse(request.postData() ?? '{}');
          puts.push({ id, body });
          return vlagRij(Number(id.slice(1)), gisteren, { ...body, bewerktOp: new Date().toISOString() });
        }
        return undefined;
      },
    });
    await page.goto(`/beheer/dagadministratie/${gisteren}`);
    await expect(page.getByRole('heading', { name: 'Dagadministratie', level: 1 })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(`${VLAG_RIJEN} rijen`)).toBeVisible();

    const naarBeneden = () => page.evaluate(() => {
      const root = document.querySelector<HTMLElement>('[data-scroll-root]');
      if (root) root.scrollTop = root.scrollHeight;
      window.scrollTo(0, document.documentElement.scrollHeight);
    });

    for (const [waar, i] of [['bovenste', 0], ['middelste', Math.floor(VLAG_RIJEN / 2)], ['onderste', VLAG_RIJEN - 1]] as const) {
      const naam = VLAG_NAMEN[i];
      const trigger = page.getByRole('button', { name: new RegExp(`^Kwaliteitsvlaggen van ${naam}`) });
      await trigger.scrollIntoViewIfNeeded();
      // De onderste rij tegen de onderrand: de pagina helemaal naar beneden, zodat onder de trigger geen plaats meer is.
      if (waar === 'onderste') await naarBeneden();
      await trigger.click();
      const menu = page.getByRole('dialog', { name: `Kwaliteitsvlaggen van ${naam}` });
      await expect(menu).toBeVisible();
      // Het eerste vinkje krijgt de focus (het vlak staat achteraan in de DOM).
      await expect(menu.getByRole('checkbox', { name: 'Ongeval' })).toBeFocused();

      // Meten na de in-animatie (motion) en de overgangen die de
      // reduced-motion-regel op elke eigenschap zet (0,01 ms, maar pas in het
      // volgende frame afgerond): anders meet je de voorlopige plek.
      await menu.evaluate(async (el) => {
        await Promise.all(el.getAnimations({ subtree: true }).map((a) => a.finished.catch(() => undefined)));
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      });
      const meting = await menu.evaluate((el) => {
        const r = el.getBoundingClientRect();
        const vw = document.documentElement.clientWidth;
        const vh = window.innerHeight;
        const geknipt: string[] = [];
        for (let p = el.parentElement; p; p = p.parentElement) {
          const s = getComputedStyle(p);
          if ([s.overflowX, s.overflowY].every((o) => o === 'visible')) continue;
          const c = p.getBoundingClientRect();
          // html en body met overflow: de viewport is daar de kliprechthoek (hieronder apart).
          if (p === document.documentElement || p === document.body) continue;
          if (r.left < c.left - 0.5 || r.right > c.right + 0.5 || r.top < c.top - 0.5 || r.bottom > c.bottom + 0.5) geknipt.push(`${p.tagName}.${p.className}`);
        }
        // Geen ander element over het vlak: hoeken (4 px naar binnen) en midden.
        const punten = [[r.left + 4, r.top + 4], [r.right - 4, r.top + 4], [r.left + 4, r.bottom - 4], [r.right - 4, r.bottom - 4], [(r.left + r.right) / 2, (r.top + r.bottom) / 2]];
        const bedekt = punten.filter(([x, y]) => { const e = document.elementFromPoint(x, y); return !e || !el.contains(e); }).length;
        // Heeft het vlak een eigen scroll nodig gehad, dan moet de inhoud er nog steeds volledig in kunnen schuiven.
        return { r: { left: r.left, right: r.right, top: r.top, bottom: r.bottom }, vw, vh, geknipt, bedekt, scrollt: el.scrollHeight > el.clientHeight + 1 };
      });
      const tag = `${info.project.name}${breedte ? ` ${breedte}px` : ''}, ${waar} rij`;
      expect(meting.r.left, `${tag}: links in beeld`).toBeGreaterThanOrEqual(0);
      expect(meting.r.top, `${tag}: boven in beeld`).toBeGreaterThanOrEqual(0);
      expect(meting.r.right, `${tag}: rechts in beeld`).toBeLessThanOrEqual(meting.vw);
      expect(meting.r.bottom, `${tag}: onder in beeld`).toBeLessThanOrEqual(meting.vh);
      expect(meting.geknipt, `${tag}: geknipt door een voorouder`).toEqual([]);
      expect(meting.bedekt, `${tag}: iets ligt over het vlak`).toBe(0);
      expect(meting.scrollt, `${tag}: het vlak past zonder eigen scroll`).toBe(false);

      // Een vlag aan: de volledige set gaat mee (autosave als één cel).
      const voor = puts.length;
      await menu.getByText('Panne', { exact: true }).click();
      await expect.poll(() => puts.length).toBe(voor + 1);
      const put = puts[puts.length - 1];
      expect(put.id).toBe(`v${i}`);
      expect(put.body).toEqual({
        qualOngeval: false, qualPanne: true, qualVerkeersovertreding: false, qualKlantklacht: false, qualAdmfout: false, qualInterneklacht: false, qualVertragingDrSchuld: false, qualRitNtGeredenDrSchuld: false,
      });
      await expect(menu.getByRole('checkbox', { name: 'Panne' })).toBeChecked();

      // Escape sluit en zet de focus terug op de trigger.
      await page.keyboard.press('Escape');
      await expect(menu).toBeHidden();
      await expect(trigger).toBeFocused();
      await expect(trigger).toHaveAccessibleName(`Kwaliteitsvlaggen van ${naam}: 1 vlag`);

      // Een buiten-klik (op de naam in dezelfde rij, niet focusbaar) sluit ook en zet de focus terug.
      await trigger.click();
      await expect(menu).toBeVisible();
      await page.locator('tbody tr', { hasText: naam }).locator('td').first().click({ position: { x: 4, y: 4 } });
      await expect(menu).toBeHidden();
      await expect(trigger).toBeFocused();
    }
    expect(pageErrors, `page errors:\n${pageErrors.join('\n')}`).toEqual([]);
  });
}
