import { test, expect, type Locator, type Page, type Route } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { ADMIN, AXE_TAGS, AXE_TIJDELIJK_UIT, CHAUFFEUR, seed, wachtOpAnimaties, type Fixture } from './helpers';
import { dayOffset } from '../scripts/audit-fixtures.mjs';

/**
 * Tranche 3B.1 (23-09): de vijf beheerschermen op het gedeelde tabelkader
 * (Gebruikers, Toestellen, Vervaldata, Planningscodes, Beheer
 * dienstoverzicht; sinds 3D één scherm Dienstoverzicht), en sinds 29-09 ook
 * Mails (het verzendlog).
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
  // Controle-ronde 29-09 (nr. 6): het verzendlog knipte op de telefoon af.
  { view: 'beheer-mails', pad: '/beheer/mails', titel: 'Mails' },
];

const extra = (pad: string) => {
  if (pad.endsWith('/api/user-expiries')) return EXPIRIES;
  if (pad.endsWith('/api/planning-codes')) return CODES;
  return undefined;
};

async function open(page: Page, scherm: Scherm, eigen?: (pad: string) => unknown) {
  await seed(page, { user: ADMIN, view: scherm.view, extra: (pad) => eigen?.(pad) ?? extra(pad) });
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

    await wachtOpAnimaties(page);
    const resultaat = await new AxeBuilder({ page }).withTags(AXE_TAGS).disableRules(AXE_TIJDELIJK_UIT).analyze();
    const blokkerend = resultaat.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(blokkerend.map((v) => `${v.id}: ${v.help} (${JSON.stringify(v.nodes[0]?.target)})`)).toEqual([]);
  });
}

test.describe('breedtes', () => {
  for (const breedte of [375, 768, 1024, 1280]) {
    test(`alle schermen op ${breedte}px: geen overloop, tabel in haar kader`, async ({ browser, baseURL }, info) => {
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
  // Eigen aanvraag die vandaag begint, dus altijd in de maand die het scherm
  // opent. De gedeelde fixture begint op vandaag + 5: de laatste vijf dagen
  // van een maand viel ze volledig in de volgende maand en faalde deze test.
  const verlof = [{ id: 'l-nu', userId: '43', startDate: dayOffset(0), endDate: dayOffset(4), type: 'betaald_verlof', status: 'pending', createdAt: new Date().toISOString() }];
  await open(page, { view: 'verlof-kalender', pad: '/beheer/verlofkalender', titel: 'Verlofkalender' },
    (pad) => (pad.endsWith('/api/leave') ? verlof : undefined));
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

/**
 * Overzicht (werkvoorraad), ronde 6 (11-11). Het filter en de zoekterm staan
 * in de URL en overleven dus een rij openen en terugkeren; de rijen van de
 * tabel volgen het tabelrecept (de omschrijving is een knop, Tab + Enter
 * opent), en de actie in een rij (een toestel goedkeuren) opent de rij niet.
 * De gedeelde fixtures geven de admin één toestel dat op goedkeuring wacht.
 */
async function openOverzicht(page: Page, pad = '/overzicht') {
  const goedgekeurd: unknown[] = [];
  await seed(page, {
    user: ADMIN,
    view: 'werkvoorraad',
    extra: (p, request) => {
      if (p.endsWith('/api/devices/approve') && request.method() === 'POST') { goedgekeurd.push(JSON.parse(request.postData() ?? '{}')); return { success: true }; }
      return extra(p);
    },
  });
  await page.goto(pad);
  await expect(page.getByRole('heading', { name: 'Overzicht', level: 1 })).toBeVisible({ timeout: 15_000 });
  // De toestellen laden na de poort; pas dan staat de rij er.
  await expect(page.getByText('Toestel wacht op goedkeuring · Alex Du Priez').filter({ visible: true })).toBeVisible();
  return goedgekeurd;
}
const toestelRij = (page: Page) => page.getByRole('button', { name: /^Toestel wacht op goedkeuring · Alex Du Priez/ });
const verlofTekst = (page: Page) => page.getByText('Verlofaanvraag · Alex Du Priez').filter({ visible: true });

test('Overzicht: filter en zoekterm staan in de URL en zijn terug na een rij openen en terugkeren', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));
  await openOverzicht(page);
  // De standaard (alles, geen zoekterm) laat de URL schoon.
  await expect(page).toHaveURL(/\/overzicht$/);
  await expect(verlofTekst(page)).toBeVisible();

  const chip = page.getByRole('button', { name: /^Toestellen \(\d+\)$/ });
  await chip.click();
  await expect(page).toHaveURL(/\/overzicht\?soort=toestellen$/);
  await expect(chip).toHaveAttribute('aria-pressed', 'true');
  await expect(verlofTekst(page)).toHaveCount(0);
  await page.getByRole('searchbox').fill('alex');
  await expect(page).toHaveURL(/\/overzicht\?soort=toestellen&zoek=alex$/);

  // De rij opent het scherm waar je beslist; terug brengt filter én zoekterm mee.
  await toestelRij(page).click();
  await expect(page.getByRole('heading', { name: 'Toestellen', level: 1 })).toBeVisible();
  await expect(page).toHaveURL(/\/beheer\/toestellen$/);
  await page.goBack();
  await expect(page.getByRole('heading', { name: 'Overzicht', level: 1 })).toBeVisible();
  await expect(page).toHaveURL(/\/overzicht\?soort=toestellen&zoek=alex$/);
  await expect(chip).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('searchbox')).toHaveValue('alex');
  await expect(toestelRij(page)).toBeVisible();
  await expect(verlofTekst(page)).toHaveCount(0);

  // Vooruit en weer terug werken ook.
  await page.goForward();
  await expect(page.getByRole('heading', { name: 'Toestellen', level: 1 })).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/\/overzicht\?soort=toestellen&zoek=alex$/);
  await expect(chip).toHaveAttribute('aria-pressed', 'true');

  // Terug naar de standaard: de URL is weer schoon.
  await page.getByRole('searchbox').fill('');
  await expect(page).toHaveURL(/\/overzicht\?soort=toestellen$/);
  await page.getByRole('button', { name: 'Alles', exact: true }).click();
  await expect(page).toHaveURL(/\/overzicht$/);
  await expect(chip).toHaveAttribute('aria-pressed', 'false');
  await expect(verlofTekst(page)).toBeVisible();
  expect(pageErrors, `page errors:\n${pageErrors.join('\n')}`).toEqual([]);
});

test('Overzicht: een onbekende soort in de URL telt als alles', async ({ page }) => {
  await openOverzicht(page, '/overzicht?soort=bestaat-niet');
  await expect(page.getByRole('button', { name: 'Alles', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(verlofTekst(page)).toBeVisible();
});

test('Overzicht: de omschrijving is een knop, Tab en Enter openen de rij; een klik in de rij ook', async ({ page }, info) => {
  test.skip(info.project.name !== 'Desktop (chromium)', 'de tabel staat alleen op desktop; mobiel is de hele rij een knop');
  // Een link met het filter erin opent gefilterd: één rij.
  await openOverzicht(page, '/overzicht?soort=toestellen');
  const tabel = page.getByRole('table', { name: 'Werkvoorraad' });
  await expect(tabel.getByRole('row')).toHaveCount(2);

  // Van de laatste kolomkop gaat Tab naar de knop van de eerste rij.
  await tabel.getByRole('button', { name: 'Wanneer' }).focus();
  await page.keyboard.press('Tab');
  await expect(toestelRij(page)).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Toestellen', level: 1 })).toBeVisible();
  await expect(page).toHaveURL(/\/beheer\/toestellen$/);

  // Muisgemak: een klik ergens in de rij (hier de cel "Wanneer") opent ook.
  await page.goBack();
  await expect(page.getByRole('heading', { name: 'Overzicht', level: 1 })).toBeVisible();
  await tabel.getByRole('row').nth(1).getByRole('cell').nth(2).click();
  await expect(page.getByRole('heading', { name: 'Toestellen', level: 1 })).toBeVisible();
});

test('Overzicht: "Goedkeuren" in een rij keurt het toestel goed en opent de rij niet', async ({ page }, info) => {
  test.skip(info.project.name !== 'Desktop (chromium)', 'de knop staat alleen in de tabel op desktop');
  const goedgekeurd = await openOverzicht(page, '/overzicht?soort=toestellen');
  const tabel = page.getByRole('table', { name: 'Werkvoorraad' });
  await tabel.getByRole('button', { name: 'Goedkeuren' }).click();

  await expect(page.getByText('Toestel goedgekeurd.')).toBeVisible();
  expect(goedgekeurd).toEqual([{ userId: '43', deviceToken: 'tok-2' }]);
  // Nog altijd het Overzicht, met het filter; de rij is afgehandeld en weg.
  await expect(page.getByRole('heading', { name: 'Overzicht', level: 1 })).toBeVisible();
  await expect(page).toHaveURL(/\/overzicht\?soort=toestellen$/);
  await expect(page.getByRole('heading', { name: 'Toestellen', level: 1 })).toHaveCount(0);
  await expect(toestelRij(page)).toHaveCount(0);
  // De lege staat van het filter wist filter en zoekterm, ook in de URL.
  await page.getByRole('button', { name: 'Zoekterm en filter wissen' }).click();
  await expect(page).toHaveURL(/\/overzicht$/);
  await expect(verlofTekst(page)).toBeVisible();
});

test('Overzicht: a11y, met de rijknoppen erbij', async ({ page }) => {
  await openOverzicht(page);
  await page.evaluate(() => document.fonts.ready);
  await wachtOpAnimaties(page);
  // Alle regels, ook label-content-name-mismatch: de rijknop heeft geen eigen
  // label, zijn naam is de zichtbare tekst.
  const resultaat = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
  const blokkerend = resultaat.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(blokkerend.map((v) => `${v.id}: ${v.help} (${JSON.stringify(v.nodes[0]?.target)})`)).toEqual([]);
});

/**
 * "Kijkt ook mee" (ronde 6, 11-11) staat nu ook op Dagadministratie en
 * Maandplanning: de collega van de staf die hetzelfde scherm open heeft. De
 * Maandplanning is ook een scherm van chauffeurs; die zien en volgen niemand.
 * De collega's komen uit de mock van de aanwezigheid (src/lib/presence.ts).
 */
const MEEKIJKERS = [
  { userId: '77', naam: 'Pieter Peeters', rol: 'planner', view: 'dagafsluiting', sinds: '2026-11-11T08:00:00.000Z' },
  { userId: '78', naam: 'Nele Claes', rol: 'planner', view: 'bezetting', sinds: '2026-11-11T08:00:00.000Z' },
];
const metMeekijkers = (page: Page) => page.addInitScript((lijst) => window.localStorage.setItem('vhb-aanwezigheid-mock', JSON.stringify(lijst)), MEEKIJKERS);
/** De chip zonder eigen breedte (de negen oudere schermen, ronde 6, punt 20):
 *  zo breed als zijn tekst, dus geen grootste breedte en niets afgekapt. */
const chipZonderGrens = (page: Page, tekst: string) => page.getByText(tekst).evaluate((span) => ({
  grootsteBreedte: getComputedStyle(span.closest('[title]')!).maxWidth,
  tekstPast: span.scrollWidth <= span.clientWidth,
}));

test('Kijkt ook mee: Dagadministratie en Maandplanning tonen de collega op hetzelfde scherm', async ({ page }) => {
  await metMeekijkers(page);
  await seed(page, { user: ADMIN, view: 'dagafsluiting' });
  await page.goto('/beheer/dagadministratie');
  await expect(page.getByRole('heading', { name: 'Dagadministratie', level: 1 })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('Pieter bekijkt dit ook')).toBeVisible();
  await expect(page.getByText('Nele bekijkt dit ook')).toHaveCount(0);
  expect(await chipZonderGrens(page, 'Pieter bekijkt dit ook')).toEqual({ grootsteBreedte: 'none', tekstPast: true });

  await page.goto('/maandplanning');
  await expect(page.getByRole('heading', { name: 'Maandplanning', level: 1 })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('Nele bekijkt dit ook')).toBeVisible();
  await expect(page.getByText('Pieter bekijkt dit ook')).toHaveCount(0);
  expect(await chipZonderGrens(page, 'Nele bekijkt dit ook')).toEqual({ grootsteBreedte: 'none', tekstPast: true });
});

test('Kijkt ook mee: een chauffeur ziet op de Maandplanning niemand', async ({ page }) => {
  await metMeekijkers(page);
  await seed(page, { user: CHAUFFEUR, view: 'bezetting' });
  await page.goto('/maandplanning');
  await expect(page.getByRole('heading', { name: 'Maandplanning', level: 1 })).toBeVisible({ timeout: 15_000 });
  // Het zoekveld staat in dezelfde kopacties: de kop is dus helemaal getekend.
  await expect(page.getByRole('searchbox', { name: 'Zoek chauffeur of dienst' })).toBeVisible();
  await page.waitForTimeout(400);
  await expect(page.getByText(/bekijk(t|en) dit ook/)).toHaveCount(0);
});

/**
 * "Kijkt ook mee" ook op Verlof en Dienstruil (ronde 6, punt 20, rest), alleen
 * voor staf. Op deze twee schermen beslist de planner in de lijst onder de
 * kop, en de chip verschijnt live zodra een collega binnenkomt: hij mag de kop
 * dus nooit hoger maken en geen knop verplaatsen. Daarom een vaste grootste
 * breedte (14rem, de namen kappen af, de stip blijft rond) en pas vanaf de
 * breedte waarop hij met die volle breedte naast de uitleg past: Verlof vanaf
 * xl (1280 px), Dienstruil met zijn lange uitleg vanaf 2xl (1536 px).
 * Daaronder heeft hij geen box. Op Dienstruil (in de warmup van de chauffeur)
 * laadt alleen de staf de chip, lui: mislukt dat, dan is er gewoon geen chip.
 * De toetsen maken hun breedtes zelf en lopen eenmaal, in het desktopproject.
 */
const SINDS = '2026-11-11T08:00:00.000Z';
const OP_VERLOF_EN_RUIL = [
  { userId: '77', naam: 'Pieter Peeters', rol: 'planner', view: 'verlof', sinds: SINDS },
  { userId: '78', naam: 'Nele Claes', rol: 'planner', view: 'ruil-verzoeken', sinds: SINDS },
];
/** Twee lange voornamen: de tekst is breder dan 14rem en kapt dus af. */
const langeNamenOp = (view: string) => [
  { userId: '77', naam: 'Maximiliaan Vandenbroucke', rol: 'planner', view, sinds: SINDS },
  { userId: '78', naam: 'Anne-Sophie Peeters', rol: 'planner', view, sinds: SINDS },
];
const PLANNER = { id: '9', name: 'Els Goossens', role: 'planner', employeeId: 'VHB-000009', email: 'els@vhb.be', isActive: true };
/** `null` = niemand: de sleutel gaat weg (pagina's van één context delen hun opslag). */
const metAanwezigen = (page: Page, lijst: unknown[] | null) => page.addInitScript((l) => {
  if (l) window.localStorage.setItem('vhb-aanwezigheid-mock', JSON.stringify(l));
  else window.localStorage.removeItem('vhb-aanwezigheid-mock');
}, lijst);
const alleenDesktop = (project: string) => test.skip(project !== 'Desktop (chromium)', 'eenmaal per run, in het desktopproject; de breedtes maakt de test zelf');
const chipTekst = (page: Page) => page.getByText(/bekijk(t|en) dit ook/);
const CHIP_CHUNK = '**/assets/AanwezigOpScherm-*.js';

type KopScherm = {
  view: string; pad: string; titel: string;
  /** Vanaf deze vensterbreedte (px) staat de chip in de kop. */
  vanaf: number;
  /** De knoppen in de kopacties van de staf, in volgorde. */
  knoppen: string[];
  /** De eerste plek in de lijst waar de staf beslist. */
  eerste: (page: Page) => Locator;
};
const KOP_VERLOF: KopScherm = {
  view: 'verlof', pad: '/verlof', titel: 'Verlof', vanaf: 1280, knoppen: ['Meer acties', 'Verlof registreren'],
  // Het keuzevakje van de eerste wachtende aanvraag (fixture l1): het vak dat je aantikt, niet het verborgen invoerveld.
  eerste: (page) => page.locator('label').filter({ has: page.getByRole('checkbox', { name: 'Selecteer Alex Du Priez' }) }),
};
const KOP_RUIL: KopScherm = {
  view: 'ruil-verzoeken', pad: '/dienstruil', titel: 'Dienstruil', vanaf: 1536, knoppen: ['Dienstruil aanvragen'],
  // Fixture sw1 wacht nog op de collega: een admin kan in de rij al goedkeuren.
  eerste: (page) => page.getByRole('table', { name: 'Dienstruilen' }).getByRole('button', { name: 'Direct goedkeuren' }),
};

async function openKop(page: Page, scherm: KopScherm, user: Fixture, aanwezig: unknown[] | null) {
  await metAanwezigen(page, aanwezig);
  await seed(page, { user, view: scherm.view });
  await page.goto(scherm.pad);
  await expect(page.getByRole('heading', { name: scherm.titel, level: 1 })).toBeVisible({ timeout: 15_000 });
}

type KopMaat = {
  kopHoogte: number;
  /** Elke knop in de kopacties, in volgorde. */
  knoppen: Array<{ naam: string; x: number; y: number }>;
  /** Aantal kinderen van de kopacties. */
  kinderen: number;
  eersteY: number;
  chip: null | { display: string; breedte: number; hoogte: number; grootsteBreedte: string; rem: number; stip: { breedte: number; hoogte: number }; afgekapt: boolean };
};
async function leesKop(page: Page, eerste: Locator): Promise<KopMaat> {
  const eersteY = await eerste.evaluate((el) => el.getBoundingClientRect().y);
  const kop = await page.evaluate(() => {
    const kop = document.querySelector('h1')!.closest('header')!;
    const acties = kop.lastElementChild!;
    const chip = [...acties.children].find((el) => el.matches('span[title]') && /bekijk(t|en) dit ook/.test(el.textContent ?? ''));
    const tekst = chip?.lastElementChild;
    const stip = chip?.firstElementChild?.getBoundingClientRect();
    const vak = chip?.getBoundingClientRect();
    return {
      kopHoogte: kop.getBoundingClientRect().height,
      knoppen: [...acties.querySelectorAll('button')].map((knop) => {
        const r = knop.getBoundingClientRect();
        return { naam: knop.getAttribute('aria-label') ?? (knop.textContent ?? '').trim(), x: r.x, y: r.y };
      }),
      kinderen: acties.childElementCount,
      chip: chip && tekst && stip && vak ? {
        display: getComputedStyle(chip).display,
        breedte: vak.width, hoogte: vak.height,
        grootsteBreedte: getComputedStyle(chip).maxWidth,
        rem: parseFloat(getComputedStyle(document.documentElement).fontSize),
        stip: { breedte: stip.width, hoogte: stip.height },
        afgekapt: tekst.scrollWidth > tekst.clientWidth,
      } : null,
    };
  });
  return { ...kop, eersteY };
}
/** Meet pas als de kop stilstaat: lettertypes geladen, inloop voorbij, twee gelijke metingen na elkaar. */
async function meetKop(page: Page, eerste: Locator): Promise<KopMaat> {
  await expect(eerste).toBeVisible({ timeout: 15_000 });
  await page.evaluate(() => document.fonts.ready);
  await wachtOpAnimaties(page);
  let vorige = await leesKop(page, eerste);
  for (let ronde = 0; ronde < 20; ronde++) {
    await page.waitForTimeout(150);
    const nu = await leesKop(page, eerste);
    if (JSON.stringify(nu) === JSON.stringify(vorige)) return nu;
    vorige = nu;
  }
  throw new Error('de kop staat na 3 s nog niet stil');
}

test('Kijkt ook mee: planner en admin zien op Verlof en Dienstruil de collega op hetzelfde scherm', async ({ browser, baseURL }, info) => {
  alleenDesktop(info.project.name);
  for (const user of [ADMIN, PLANNER]) {
    const context = await browser.newContext({ baseURL, viewport: { width: 1600, height: 900 }, serviceWorkers: 'block' });
    try {
      const page = await context.newPage();
      await openKop(page, KOP_VERLOF, user, OP_VERLOF_EN_RUIL);
      await expect(page.getByText('Pieter bekijkt dit ook'), `${user.role} op Verlof`).toBeVisible();
      await expect(page.getByText('Nele bekijkt dit ook')).toHaveCount(0);

      await page.goto(KOP_RUIL.pad);
      await expect(page.getByRole('heading', { name: KOP_RUIL.titel, level: 1 })).toBeVisible({ timeout: 15_000 });
      await expect(page.getByText('Nele bekijkt dit ook'), `${user.role} op Dienstruil`).toBeVisible();
      await expect(page.getByText('Pieter bekijkt dit ook')).toHaveCount(0);
    } finally {
      await context.close();
    }
  }
});

test('Kijkt ook mee: een chauffeur ziet op Verlof en Dienstruil niemand en haalt de chip op Dienstruil niet op', async ({ browser, baseURL }, info) => {
  alleenDesktop(info.project.name);
  // 1600 px: breed genoeg voor de chip op beide schermen, als hij er zou zijn.
  const context = await browser.newContext({ baseURL, viewport: { width: 1600, height: 900 }, serviceWorkers: 'block' });
  try {
    for (const scherm of [{ ...KOP_VERLOF, knoppen: ['Verlof aanvragen'] }, KOP_RUIL]) {
      const kinderen: number[] = [];
      for (const aanwezig of [null, OP_VERLOF_EN_RUIL]) {
        const page = await context.newPage();
        const chipVerzoeken: string[] = [];
        page.on('request', (verzoek) => { if (/\/assets\/AanwezigOpScherm-/.test(verzoek.url())) chipVerzoeken.push(verzoek.resourceType()); });
        await openKop(page, scherm, CHAUFFEUR, aanwezig);
        await expect(page.getByRole('button', { name: scherm.knoppen[0], exact: true })).toBeVisible();
        // De kop staat er; een luie import zou nu al lang vertrokken zijn.
        await page.waitForTimeout(600);
        await expect(chipTekst(page)).toHaveCount(0);
        const acties = await page.evaluate(() => {
          const el = document.querySelector('h1')!.closest('header')!.lastElementChild!;
          return { kinderen: el.childElementCount, knoppen: [...el.querySelectorAll('button')].map((knop) => (knop.textContent ?? '').trim()) };
        });
        expect(acties.knoppen, `${scherm.titel}: de knoppen van de chauffeur`).toEqual(scherm.knoppen);
        kinderen.push(acties.kinderen);
        // Dienstruil zit in de warmup van de chauffeur: die betaalt de chip niet.
        if (scherm.view === 'ruil-verzoeken') expect(chipVerzoeken, 'een chauffeur vraagt de chip niet op').toEqual([]);
        await page.close();
      }
      expect(kinderen, `${scherm.titel}: geen extra element in de kopacties`).toEqual([1, 1]);
    }
  } finally {
    await context.close();
  }
});

for (const scherm of [KOP_VERLOF, KOP_RUIL]) {
  test(`Kijkt ook mee: de chip maakt de kop van ${scherm.titel} niet hoger en verplaatst geen knop`, async ({ browser, baseURL }, info) => {
    alleenDesktop(info.project.name);
    test.setTimeout(150_000);
    const dicht = (a: number, b: number) => Math.abs(a - b) <= 0.5;
    const fouten: string[] = [];
    const metMetChip: number[] = [];
    for (const breedte of [768, 1024, 1280, 1440, 1536, 1920]) {
      const waar = `${scherm.titel} op ${breedte}px`;
      const context = await browser.newContext({ baseURL, viewport: { width: breedte, height: 900 }, hasTouch: breedte < 1024, serviceWorkers: 'block' });
      try {
        // Twee keer laden: eerst zonder collega, dan met twee lange namen.
        let page = await context.newPage();
        await openKop(page, scherm, ADMIN, null);
        const zonder = await meetKop(page, scherm.eerste(page));
        await page.close();
        page = await context.newPage();
        await openKop(page, scherm, ADMIN, langeNamenOp(scherm.view));
        // De chip staat in de DOM (op Dienstruil pas na zijn luie import), ook waar hij geen box heeft.
        await expect(chipTekst(page)).toHaveCount(1, { timeout: 15_000 });
        const met = await meetKop(page, scherm.eerste(page));
        await page.close();

        if (zonder.chip) fouten.push(`${waar}: een chip zonder collega`);
        if (met.kinderen !== zonder.kinderen + 1) fouten.push(`${waar}: ${zonder.kinderen} kinderen zonder, ${met.kinderen} met chip`);
        for (const [soort, maat] of [['zonder', zonder], ['met', met]] as const) {
          const namen = maat.knoppen.map((k) => k.naam);
          if (JSON.stringify(namen) !== JSON.stringify(scherm.knoppen)) fouten.push(`${waar}, ${soort} chip: knoppen ${JSON.stringify(namen)}`);
        }
        if (!dicht(met.kopHoogte, zonder.kopHoogte)) fouten.push(`${waar}: kop ${zonder.kopHoogte.toFixed(2)} hoog zonder, ${met.kopHoogte.toFixed(2)} met chip`);
        zonder.knoppen.forEach((knop, i) => {
          const na = met.knoppen[i];
          if (na && (!dicht(na.x, knop.x) || !dicht(na.y, knop.y))) fouten.push(`${waar}: ${knop.naam} van ${knop.x.toFixed(2)},${knop.y.toFixed(2)} naar ${na.x.toFixed(2)},${na.y.toFixed(2)}`);
        });
        if (!dicht(met.eersteY, zonder.eersteY)) fouten.push(`${waar}: eerste beslisknop van y ${zonder.eersteY.toFixed(2)} naar ${met.eersteY.toFixed(2)}`);

        const chip = met.chip;
        if (!chip) { fouten.push(`${waar}: geen chip in de kopacties`); continue; }
        if (breedte < scherm.vanaf) {
          // Onder het breekpunt: geen box, dus ook geen extra tussenruimte.
          if (chip.display !== 'none' || chip.breedte !== 0 || chip.hoogte !== 0) fouten.push(`${waar}: chip heeft een box (${chip.display}, ${chip.breedte} x ${chip.hoogte})`);
          continue;
        }
        metMetChip.push(breedte);
        const grens = 14 * chip.rem;
        if (chip.display === 'none') fouten.push(`${waar}: chip niet getoond`);
        if (!dicht(parseFloat(chip.grootsteBreedte), grens)) fouten.push(`${waar}: grootste breedte ${chip.grootsteBreedte}, verwacht ${grens}px`);
        if (!chip.afgekapt) fouten.push(`${waar}: de lange namen zijn niet afgekapt`);
        if (!dicht(chip.breedte, grens)) fouten.push(`${waar}: chip ${chip.breedte.toFixed(2)} breed, verwacht ${grens}`);
        if (!dicht(chip.stip.breedte, 6) || !dicht(chip.stip.hoogte, 6)) fouten.push(`${waar}: stip ${chip.stip.breedte.toFixed(2)} x ${chip.stip.hoogte.toFixed(2)}, verwacht 6 x 6`);
      } finally {
        await context.close();
      }
    }
    expect(fouten, 'de chip verandert de kop').toEqual([]);
    expect(metMetChip, 'breedtes waarop de chip getoond en gemeten is').toEqual([768, 1024, 1280, 1440, 1536, 1920].filter((b) => b >= scherm.vanaf));
  });
}

test('Kijkt ook mee: mislukt het ophalen van de chip, dan blijft Dienstruil gewoon staan, zonder chip', async ({ browser, baseURL }, info) => {
  alleenDesktop(info.project.name);
  const context = await browser.newContext({ baseURL, viewport: { width: 1600, height: 900 }, serviceWorkers: 'block' });
  try {
    const page = await context.newPage();
    const paginafouten: string[] = [];
    page.on('pageerror', (e) => paginafouten.push(e.message));
    let ladingen = 0;
    page.on('load', () => { ladingen += 1; });
    // Elk verzoek naar de chunk van de chip breekt af: de import van het scherm zelf
    // (een script) en de stille prefetch van de warmup (via de Maandplanning).
    const afgebroken: string[] = [];
    await page.route(CHIP_CHUNK, (route) => { afgebroken.push(route.request().resourceType()); return route.abort(); });
    await openKop(page, KOP_RUIL, ADMIN, OP_VERLOF_EN_RUIL);
    await page.evaluate(() => { (window as unknown as { __nietHerladen?: boolean }).__nietHerladen = true; });
    await expect.poll(() => afgebroken.includes('script'), { message: 'het scherm vroeg de chip op' }).toBe(true);
    // Het vangnet van de luie schermen (lazyRetry) probeert na 0,8 s opnieuw en
    // herlaadt dan de schil. Dat mag hier niet: ruim daarna staat alles er nog.
    await page.waitForTimeout(2500);
    await expect(page.getByRole('heading', { name: 'Dienstruil', level: 1 })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Dienstruil aanvragen' })).toBeVisible();
    await expect(KOP_RUIL.eerste(page)).toBeVisible();
    await expect(chipTekst(page)).toHaveCount(0);
    await expect(page.getByText('Dit scherm kon niet geladen worden')).toHaveCount(0);
    expect(await page.evaluate(() => (window as unknown as { __nietHerladen?: boolean }).__nietHerladen), 'geen herlaadbeurt').toBe(true);
    expect(ladingen, 'geen herlaadbeurt').toBe(1);
    expect(await page.evaluate(() => window.sessionStorage.getItem('vhb-chunk-reload')), 'het vangnet van de luie schermen kwam niet in actie').toBeNull();
    expect(paginafouten).toEqual([]);
  } finally {
    await context.close();
  }
});

test('Kijkt ook mee: komt de chip pas binnen na het verlaten van Dienstruil, dan verschijnt hij nergens', async ({ browser, baseURL }, info) => {
  alleenDesktop(info.project.name);
  const context = await browser.newContext({ baseURL, viewport: { width: 1600, height: 900 }, serviceWorkers: 'block' });
  try {
    const page = await context.newPage();
    const fouten: string[] = [];
    page.on('pageerror', (e) => fouten.push(e.message));
    // Netwerkruis van de testomgeving (geen realtime-server) is geen fout van de app; al de rest wel.
    const ruis = /^(Failed to load resource|WebSocket connection to )/;
    page.on('console', (m) => { if (m.type() === 'error' && !ruis.test(m.text())) fouten.push(m.text()); });
    // De chunk van de chip blijft onderweg tot de test hem loslaat.
    const vast: Route[] = [];
    let los = false;
    await page.route(CHIP_CHUNK, (route) => {
      if (los) return route.continue();
      vast.push(route);
    });
    // Ook op het dashboard zit een collega: zou de late chip daar toch landen, dan staat hij er.
    await openKop(page, KOP_RUIL, ADMIN, [...OP_VERLOF_EN_RUIL, { userId: '79', naam: 'Koen Maes', rol: 'planner', view: 'dashboard', sinds: SINDS }]);
    await expect.poll(() => vast.some((route) => route.request().resourceType() === 'script'), { message: 'het scherm vroeg de chip op' }).toBe(true);
    await expect(chipTekst(page)).toHaveCount(0);

    // Weg van Dienstruil, binnen de app: een herlaadbeurt zou de wachtende import weggooien.
    await page.getByRole('navigation', { name: 'Zijbalk' }).getByRole('button', { name: 'Dashboard', exact: true }).click();
    await expect.poll(() => new URL(page.url()).pathname).toBe('/');
    await expect(page.getByRole('heading', { name: 'Dienstruil', level: 1 })).toHaveCount(0);

    const binnen = page.waitForEvent('requestfinished', (verzoek) => /\/assets\/AanwezigOpScherm-/.test(verzoek.url()) && verzoek.resourceType() === 'script');
    los = true;
    await Promise.all(vast.map((route) => route.continue().catch(() => undefined)));
    await binnen;
    // De module is binnen en uitgevoerd; haar antwoord vindt geen scherm meer.
    await page.waitForTimeout(500);
    await expect(chipTekst(page)).toHaveCount(0);
    expect(new URL(page.url()).pathname).toBe('/');
    await expect(page.getByText('Dit scherm kon niet geladen worden')).toHaveCount(0);
    expect(fouten, `fouten:\n${fouten.join('\n')}`).toEqual([]);
  } finally {
    await context.close();
  }
});

/**
 * Kop en eerste kolom op één lijn (ronde 6, punt 10): vanaf md begint de kop
 * van een tabelkader (zoekveld, filters, titel) waar de eerste kolom begint.
 * Gemeten op de inhoudsbox, niet op de eerste letter (een selectievakje of
 * een rechts uitgelijnde kolom begint niet met tekst), ten opzichte van het
 * kader (div.surface-table):
 * - koplijn = linkerrand van het kopblok + zijn padding-left;
 * - kolomlijn = linkerrand van de eerste th + zijn padding-left, of bij een
 *   th zonder opvulling (SortTh) de knop erin + zijn padding-left.
 * Dienstoverzicht houdt 4 px verschil: zijn cellen hebben bewust px-3 (acht
 * kolommen vanaf 42 rem). Toont een kader op een breedte geen tabel (container
 * query), dan slaat de toets die breedte over en zegt dat in een annotatie;
 * elk kader moet op minstens één breedte gemeten zijn.
 */
type KopEnKolom = { fout: string | null; getoond: boolean; koplijn: number; kolomlijn: number };
async function kopEnKolom(page: Page, label: string): Promise<KopEnKolom> {
  await expect(page.locator(`div.surface-table table[aria-label="${label}"]`).first()).toBeAttached();
  return page.evaluate((label): KopEnKolom => {
    const niets: KopEnKolom = { fout: null, getoond: false, koplijn: 0, kolomlijn: 0 };
    const px = (v: string) => parseFloat(v) || 0;
    const zichtbaar = (el: Element) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    const tabellen = [...document.querySelectorAll('div.surface-table table')].filter((t) => t.getAttribute('aria-label') === label);
    if (tabellen.length !== 1) return { ...niets, fout: `${tabellen.length} tabellen met dit label` };
    const tabel = tabellen[0];
    if (!zichtbaar(tabel)) return niets;
    const kader = tabel.closest('div.surface-table')!;
    const kop = kader.firstElementChild;
    if (!kop || kop.contains(tabel)) return { ...niets, fout: 'kader zonder kop' };
    const th = [...tabel.querySelectorAll('thead tr:first-child > th')].find(zichtbaar);
    if (!th) return { ...niets, fout: 'geen zichtbare kolomkop' };
    const links = kader.getBoundingClientRect().left;
    const koplijn = kop.getBoundingClientRect().left + px(getComputedStyle(kop).paddingLeft) - links;
    const thLinks = px(getComputedStyle(th).paddingLeft);
    const knop = thLinks === 0 ? th.querySelector('button') : null;
    const kolomlijn = knop
      ? knop.getBoundingClientRect().left + px(getComputedStyle(knop).paddingLeft) - links
      : th.getBoundingClientRect().left + thLinks - links;
    return { fout: null, getoond: true, koplijn, kolomlijn };
  }, label);
}

test('kop en eerste kolom op één lijn', async ({ browser, baseURL }, info) => {
  test.skip(info.project.name !== 'Desktop (chromium)', 'eenmaal per run, in het desktopproject; de breedtes maakt de test zelf');
  test.setTimeout(150_000);
  const schermen: Array<{ open: (page: Page) => Promise<unknown>; kaders: Array<{ label: string; verschil?: number }> }> = [
    { open: (page) => open(page, SCHERMEN[0]), kaders: [{ label: 'Gebruikers' }] },
    { open: (page) => open(page, SCHERMEN[2]), kaders: [{ label: 'Vervaldata per chauffeur' }] },
    { open: (page) => open(page, SCHERMEN[4]), kaders: [{ label: 'Diensten', verschil: 4 }] },
    { open: (page) => open(page, SCHERMEN[5]), kaders: [{ label: 'Verzendlog' }] },
    { open: (page) => openOverzicht(page), kaders: [{ label: 'Werkvoorraad' }] },
  ];
  const gemeten = new Map<string, number>();
  const fouten: string[] = [];
  for (const breedte of [768, 1024, 1280, 1440]) {
    const context = await browser.newContext({ baseURL, viewport: { width: breedte, height: 900 }, hasTouch: breedte < 1024, serviceWorkers: 'block' });
    try {
      for (const scherm of schermen) {
        const page = await context.newPage();
        await scherm.open(page);
        for (const { label, verschil = 0 } of scherm.kaders) {
          const m = await kopEnKolom(page, label);
          if (m.fout) { fouten.push(`${label} op ${breedte}px: ${m.fout}`); continue; }
          if (!m.getoond) { info.annotations.push({ type: 'niet getoond', description: `${label} op ${breedte}px: geen tabel op deze breedte (container query)` }); continue; }
          gemeten.set(label, (gemeten.get(label) ?? 0) + 1);
          const gezien = m.koplijn - m.kolomlijn;
          if (Math.abs(gezien - verschil) > 1) fouten.push(`${label} op ${breedte}px: koplijn ${m.koplijn.toFixed(2)}, kolomlijn ${m.kolomlijn.toFixed(2)} (verschil ${gezien.toFixed(2)}, verwacht ${verschil})`);
        }
        await page.close();
      }
    } finally {
      await context.close();
    }
  }
  expect(fouten, 'kop en eerste kolom niet op één lijn').toEqual([]);
  const nooit = schermen.flatMap((s) => s.kaders.map((k) => k.label)).filter((label) => !gemeten.get(label));
  expect(nooit, 'kader op geen enkele breedte gemeten').toEqual([]);
});
