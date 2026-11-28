import { test, expect, type CDPSession, type Locator, type Page } from '@playwright/test';
import { ADMIN, seed, wachtOpAnimaties } from './helpers';

/**
 * Tip-laag (ronde 6, punt 10, src/lib/tipLaag.ts): de uitleg bij een
 * icoonknop in de huisstijl, alleen met een muis. De laag laadt lui bij de
 * eerste muisbeweging na de eerste lading (App.tsx) en alleen bij
 * `(hover: hover) and (pointer: fine)`; in beide iPhone-projecten is die
 * vraag onwaar (gemeten 23-11), dus daar bewijst deze spec zowel de
 * laadvoorwaarde als de `pointerType`.
 *
 * Desktop (chromium): de tip verschijnt na minstens 300 ms, staat in de body
 * met z-index 145 en volledig in het venster, ook in een tabelkader, aan de
 * rechterrand van de topbar en in een venster; de pagina wordt niet breder.
 * Muis eraf, klik, scroll en wiel halen hem weg, een verdwenen knop binnen
 * 250 ms. Tijdens de tip heeft de knop geen title, daarna weer de zijne.
 * Toetsenbord: Tab toont de tip, Escape verbergt hem en het venster blijft
 * open, een tweede Escape sluit het. Mislukt het laden van de chunk, dan
 * blijft alles zoals vroeger.
 */

const DESKTOP = 'Desktop (chromium)';
const TIP = '[data-tip-laag]';
const CHUNK = /\/assets\/tipLaag-[\w-]+\.js$/;

async function open(page: Page, pad: string, view: string) {
  await seed(page, { user: ADMIN, view });
  await page.goto(pad);
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible({ timeout: 15_000 });
  // De h1 staat sinds #843 al in het laadskelet: wacht tot de inhoud er is.
  await expect(page.getByRole('status', { name: 'Scherm wordt geladen' })).toHaveCount(0, { timeout: 15_000 });
  await page.evaluate(() => document.fonts.ready);
  await wachtOpAnimaties(page);
}

/**
 * De eerste muisbeweging ná de eerste lading laadt de laag (App.tsx, `isInitialLoad`); ze maakt
 * haar (verborgen) tip in de body. Op een scherm zonder laadpoort (Designsysteem) zegt het skelet
 * niet wanneer die lading klaar is: blijf bewegen tot de laag er is.
 */
async function laagGeladen(page: Page) {
  await expect(async () => {
    await page.mouse.move(2, 640);
    await page.mouse.move(4, 642);
    await expect(page.locator(TIP)).toBeAttached({ timeout: 500 });
  }).toPass({ timeout: 15_000 });
  await expect(page.locator(TIP)).toBeHidden();
}

/** Midden in beeld en stil: twee gelijke vakken na elkaar. */
async function stil(knop: Locator) {
  await knop.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  let vorig = '';
  await expect.poll(async () => {
    const r = await knop.boundingBox();
    const nu = JSON.stringify(r);
    const gelijk = nu === vorig;
    vorig = nu;
    return gelijk;
  }, { intervals: [60] }).toBe(true);
}

/** Legt vast wanneer de muis op de knop kwam en wanneer de tip verscheen of verdween (MutationObserver + performance.now). */
async function meetTip(page: Page, knop: Locator) {
  await knop.evaluate((el) => {
    const w = window as unknown as { __tipMeting: { over: number[]; uit: number[]; zicht: number[]; weg: number[] } };
    const m = { over: [] as number[], uit: [] as number[], zicht: [] as number[], weg: [] as number[] };
    w.__tipMeting = m;
    window.addEventListener('pointerover', (e) => { if (el.contains(e.target as Node)) m.over.push(performance.now()); }, true);
    window.addEventListener('pointerout', (e) => { if (el.contains(e.target as Node)) m.uit.push(performance.now()); }, true);
    const tip = document.querySelector<HTMLElement>('[data-tip-laag]')!;
    new MutationObserver(() => (tip.hidden ? m.weg : m.zicht).push(performance.now())).observe(tip, { attributes: true, attributeFilter: ['hidden'] });
  });
  return () => page.evaluate(() => (window as unknown as { __tipMeting: { over: number[]; uit: number[]; zicht: number[]; weg: number[] } }).__tipMeting);
}

/** De tip: tekst, in de body, z-index 145, volledig in het venster, boven elke andere laag in de body; en de pagina schuift niet opzij. */
async function tipKlopt(page: Page, tekst: string) {
  const tip = page.locator(TIP);
  await expect(tip).toBeVisible();
  await expect(tip).toHaveText(tekst);
  const m = await page.evaluate(() => {
    const el = document.querySelector<HTMLElement>('[data-tip-laag]')!;
    const r = el.getBoundingClientRect();
    const root = document.querySelector<HTMLElement>('[data-scroll-root]');
    const anderen = [...document.body.children].filter((c) => c !== el).map((c) => Number(getComputedStyle(c).zIndex) || 0);
    return {
      ouderIsBody: el.parentElement === document.body,
      positie: getComputedStyle(el).position,
      z: getComputedStyle(el).zIndex,
      hoogsteAndere: Math.max(0, ...anderen),
      r: { left: r.left, top: r.top, right: r.right, bottom: r.bottom },
      vw: window.innerWidth, vh: window.innerHeight,
      doc: document.documentElement.scrollWidth,
      rootOver: root ? root.scrollWidth - root.clientWidth : 0,
      rootLinks: root ? root.scrollLeft : 0,
      ariaHidden: el.getAttribute('aria-hidden'),
      pointerEvents: getComputedStyle(el).pointerEvents,
    };
  });
  expect(m.ouderIsBody, 'de tip is een kind van body').toBe(true);
  expect(m.positie).toBe('fixed');
  expect(m.z).toBe('145');
  expect(m.hoogsteAndere, 'geen laag in de body ligt hoger').toBeLessThan(145);
  expect(m.ariaHidden).toBe('true');
  expect(m.pointerEvents).toBe('none');
  expect(m.r.left, 'links in het venster').toBeGreaterThanOrEqual(0);
  expect(m.r.top, 'boven in het venster').toBeGreaterThanOrEqual(0);
  expect(m.r.right, 'rechts in het venster').toBeLessThanOrEqual(m.vw);
  expect(m.r.bottom, 'onder in het venster').toBeLessThanOrEqual(m.vh);
  expect(m.doc, 'de pagina wordt niet breder').toBeLessThanOrEqual(m.vw);
  expect(m.rootOver, 'de scroll-root schuift niet horizontaal').toBeLessThanOrEqual(1);
  expect(m.rootLinks).toBe(0);
  return m.r;
}

/** Wijs aan met de muis en toets: na minstens 300 ms, de tip klopt, en de knop heeft intussen geen title. */
async function wijsEnToets(page: Page, knop: Locator) {
  const naam = (await knop.getAttribute('aria-label'))!;
  await expect(knop).toHaveAttribute('title', naam);
  await stil(knop);
  const meting = await meetTip(page, knop);
  await knop.hover();
  const r = await tipKlopt(page, naam);
  const m = await meting();
  expect(m.over.length, 'de muis kwam op de knop').toBeGreaterThan(0);
  expect(m.zicht[0] - m.over[0], 'de tip wacht minstens 300 ms').toBeGreaterThanOrEqual(299);
  expect(await knop.getAttribute('title'), 'tijdens de tip geen title').toBeNull();
  return { naam, r, meting };
}

test.describe('Desktop: de tip', () => {
  test.beforeEach(({}, info) => {
    test.skip(info.project.name !== DESKTOP, 'muis en desktopbreedte');
  });

  test('rijknop in het tabelkader van Gebruikers: na 300 ms, binnen het venster, boven elke laag; verlaten zet de title terug', async ({ page }) => {
    const verzoeken: string[] = [];
    page.on('request', (r) => { if (CHUNK.test(r.url())) verzoeken.push(r.url()); });
    await open(page, '/beheer/gebruikers', 'gebruikers');
    await laagGeladen(page);
    const tabel = page.getByRole('table').first();
    const knop = tabel.getByRole('button', { name: /^Meer acties voor / }).first();
    const { naam, meting } = await wijsEnToets(page, knop);
    // Muis eraf: weg in dezelfde taak als het verlaten (binnen één frame).
    await page.mouse.move(4, 642);
    await expect(page.locator(TIP)).toBeHidden();
    const m = await meting();
    expect(m.weg.length).toBeGreaterThan(0);
    expect(m.weg[0] - m.uit[0], 'weg binnen één frame').toBeLessThan(17);
    await expect(knop).toHaveAttribute('title', naam);
    expect(verzoeken, 'de chunk laadt één keer').toHaveLength(1);
  });

  test('knop in de topbar vlak bij de rechterrand: de tip staat eronder en binnen het venster; een knop met eigen title houdt die', async ({ page }) => {
    await open(page, '/beheer/gebruikers', 'gebruikers');
    await laagGeladen(page);
    // De bel in de topbar (zonder ongelezen: naam en title "Meldingen"); niet het menu-item in de zijbalk.
    const bel = page.locator('button[aria-haspopup="menu"][aria-label="Meldingen"]');
    const { r } = await wijsEnToets(page, bel);
    const knop = (await bel.boundingBox())!;
    expect(r.top, 'onder de knop, want boven is geen plaats').toBeGreaterThanOrEqual(knop.y + knop.height);
    await page.mouse.move(4, 642);
    await expect(page.locator(TIP)).toBeHidden();
    await expect(bel).toHaveAttribute('title', 'Meldingen');

    // Open taken met een teller: naam "Open taken (5)", eigen title "Open taken".
    const taken = page.locator('button[aria-haspopup="menu"][title="Open taken"]');
    await expect(taken).toHaveAttribute('aria-label', /^Open taken \(\d+\)$/);
    await stil(taken);
    await taken.hover();
    await page.waitForTimeout(700);
    await expect(page.locator(TIP)).toBeHidden();
    await expect(taken).toHaveAttribute('title', 'Open taken');
  });

  test('knop in een open venster (Gebruiker bewerken): binnen het venster en boven de modal', async ({ page }) => {
    await open(page, '/beheer/gebruikers', 'gebruikers');
    await laagGeladen(page);
    await page.getByRole('row', { name: /Alex Du Priez/ }).getByRole('button', { name: 'Bewerken', exact: true }).click();
    const venster = page.getByRole('dialog').filter({ hasText: 'Gebruiker bewerken' });
    await expect(venster).toBeVisible();
    await wachtOpAnimaties(page);
    const knop = venster.getByRole('button', { name: 'Gebruiker verwijderen' });
    await wijsEnToets(page, knop);
    await page.mouse.move(4, 642);
    await expect(page.locator(TIP)).toBeHidden();
    await expect(knop).toHaveAttribute('title', 'Gebruiker verwijderen');
  });

  test('klik, scroll en wiel halen de tip weg en zetten de title terug', async ({ page }) => {
    await open(page, '/beheer/designsysteem', 'designsysteem');
    await laagGeladen(page);
    const knoppen = page.getByRole('button', { name: 'Bewerken', exact: true });
    const knop = knoppen.first();

    await wijsEnToets(page, knop);
    await page.mouse.down();
    await expect(page.locator(TIP)).toBeHidden();
    await expect(knop).toHaveAttribute('title', 'Bewerken');
    await page.mouse.up();

    await page.mouse.move(4, 642);
    await wijsEnToets(page, knop);
    await page.mouse.wheel(0, 120);
    await expect(page.locator(TIP)).toBeHidden();
    await expect(knop).toHaveAttribute('title', 'Bewerken');

    await page.mouse.move(4, 642);
    await wijsEnToets(page, knop);
    await page.evaluate(() => document.querySelector<HTMLElement>('[data-scroll-root]')!.scrollBy(0, 40));
    await expect(page.locator(TIP)).toBeHidden();
    await expect(knop).toHaveAttribute('title', 'Bewerken');
  });

  test('de knop verdwijnt terwijl de tip staat: weg binnen 250 ms (klok stil)', async ({ page }) => {
    await page.clock.install();
    await open(page, '/beheer/designsysteem', 'designsysteem');
    await laagGeladen(page);
    const knop = page.getByRole('button', { name: 'Zoeken', exact: true });
    const tip = page.locator(TIP);
    await stil(knop);
    // De klok staat stil vóór het wijzen: de 300 ms en de 250 ms zijn dan exact.
    // Een seconde marge: onder belasting ligt "nu" anders al voorbij het doel.
    await page.clock.pauseAt(await page.evaluate(() => Date.now()) + 1000);
    await knop.hover();
    await page.clock.runFor(299);
    await expect(tip).toBeHidden();
    await page.clock.runFor(1);
    await expect(tip).toBeVisible();
    await expect(tip).toHaveText('Zoeken');
    await knop.evaluate((el) => el.remove());
    await page.clock.runFor(250);
    await expect(tip).toBeHidden();
  });

  test('title: een uitgeschakelde knop krijgt geen tip; wordt een knop tijdens de tip uitgeschakeld, dan is de tip weg en blijft een eigen title staan, anders komt title = naam terug', async ({ page }) => {
    await open(page, '/beheer/designsysteem', 'designsysteem');
    await laagGeladen(page);
    const tip = page.locator(TIP);

    // Al uitgeschakeld: geen tip, title blijft.
    const sluiten = page.getByRole('button', { name: 'Sluiten', exact: true }).first();
    await sluiten.evaluate((el: HTMLButtonElement) => { el.disabled = true; });
    await stil(sluiten);
    await sluiten.hover();
    await page.waitForTimeout(700);
    await expect(tip).toBeHidden();
    await expect(sluiten).toHaveAttribute('title', 'Sluiten');
    await page.mouse.move(4, 642);

    // Het patroon van "Vorige 2 weken" (CapacityView): uitgeschakeld mét een eigen reden.
    const bewerk = page.getByRole('button', { name: 'Bewerken', exact: true }).last();
    await wijsEnToets(page, bewerk);
    await bewerk.evaluate((el: HTMLButtonElement) => { el.disabled = true; el.setAttribute('title', 'Je ziet de planning vanaf deze week'); });
    await expect(tip).toBeHidden();
    await page.mouse.move(4, 642);
    await expect(bewerk).toHaveAttribute('title', 'Je ziet de planning vanaf deze week');

    // Uitgeschakeld zonder eigen title: title = naam komt terug.
    const verwijder = page.getByRole('button', { name: 'Verwijderen', exact: true }).last();
    await wijsEnToets(page, verwijder);
    await verwijder.evaluate((el: HTMLButtonElement) => { el.disabled = true; });
    await expect(tip).toBeHidden();
    await expect(verwijder).toHaveAttribute('title', 'Verwijderen');
  });

  test('toetsenbord: Tab toont de tip, Escape verbergt hem en het venster blijft open, een tweede Escape sluit het', async ({ page }) => {
    await open(page, '/beheer/gebruikers', 'gebruikers');
    await laagGeladen(page);
    await page.getByRole('row', { name: /Alex Du Priez/ }).getByRole('button', { name: 'Bewerken', exact: true }).click();
    const venster = page.getByRole('dialog').filter({ hasText: 'Gebruiker bewerken' });
    await expect(venster).toBeVisible();
    await expect.poll(() => page.evaluate(() => window.history.state?.vhbOverlay ?? null)).not.toBeNull();
    await wachtOpAnimaties(page);
    await page.mouse.move(4, 642);

    const prullenbak = venster.getByRole('button', { name: 'Gebruiker verwijderen' });
    // De knop vóór Annuleren: focus op Annuleren, dan Shift+Tab.
    await venster.getByRole('button', { name: 'Annuleren' }).focus();
    await page.keyboard.press('Shift+Tab');
    await expect(prullenbak).toBeFocused();
    await expect(page.locator(TIP)).toBeVisible();
    await expect(page.locator(TIP)).toHaveText('Gebruiker verwijderen');
    // Bij focus blijft de title staan.
    await expect(prullenbak).toHaveAttribute('title', 'Gebruiker verwijderen');

    await page.keyboard.press('Escape');
    await expect(page.locator(TIP)).toBeHidden();
    await page.waitForTimeout(300);
    await expect(venster).toBeVisible();
    await expect(prullenbak).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(venster).toHaveCount(0);
  });

  test('focus die een kiezer na Escape aan zijn knop teruggeeft, toont geen tip: de volgende Escape sluit het venster', async ({ page }) => {
    await open(page, '/beheer/gebruikers', 'gebruikers');
    await laagGeladen(page);
    await page.getByRole('row', { name: /Alex Du Priez/ }).getByRole('button', { name: 'Bewerken', exact: true }).click();
    const venster = page.getByRole('dialog').filter({ hasText: 'Gebruiker bewerken' });
    await expect(venster).toBeVisible();
    await wachtOpAnimaties(page);
    const kalender = venster.getByRole('button', { name: 'Kalender openen' }).first();
    await stil(kalender);
    await kalender.click();
    await expect(page.getByRole('dialog')).toHaveCount(2);
    await page.mouse.move(4, 642);
    // Elke keer dat de tip zichtbaar wordt, telt (ook als hij meteen weer weggaat).
    await page.evaluate(() => {
      const w = window as unknown as { __tipZicht: number };
      w.__tipZicht = 0;
      const tip = document.querySelector<HTMLElement>('[data-tip-laag]')!;
      new MutationObserver(() => { if (!tip.hidden) w.__tipZicht++; }).observe(tip, { attributes: true, attributeFilter: ['hidden'] });
    });
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(1);
    await expect(kalender).toBeFocused();
    await page.waitForTimeout(400);
    expect(await page.evaluate(() => (window as unknown as { __tipZicht: number }).__tipZicht), 'nooit een tip op de teruggegeven focus').toBe(0);
    await page.keyboard.press('Escape');
    await expect(venster).toHaveCount(0);
  });

  // De tip van een knop naast een open laag (tip-escape, 25-11): de kalender
  // opent met ArrowDown terwijl de muis op de kalenderknop staat. Vroeger
  // bleef de tip staan en slikte hij de Escape (e2e/datumveld.spec.ts:47 was
  // daardoor wankel); nu is hij weg zodra de laag opent, en een tip die de
  // muis daarna opnieuw oproept, laat de Escape door naar de kalender.
  test('kalenderknop: staat zijn tip er als ArrowDown de kalender opent, dan is de tip weg en sluit één Escape de kalender', async ({ page }) => {
    await open(page, '/beheer/designsysteem', 'designsysteem');
    await laagGeladen(page);
    const veld = page.getByLabel('Startdatum', { exact: true });
    const knop = veld.locator('xpath=following-sibling::button[1]');
    const kalender = page.getByRole('dialog', { name: 'Datum kiezen' });
    const tip = page.locator(TIP);
    await veld.fill('23/09/2026');
    await veld.press('Enter');
    await expect(veld).toHaveAttribute('data-datum', '2026-09-23');

    await wijsEnToets(page, knop);
    await veld.focus();
    await expect(tip).toBeVisible();
    await expect(tip).toHaveText('Kalender openen');

    await page.keyboard.press('ArrowDown');
    await expect(kalender).toBeVisible();
    await expect(tip, 'de laag gaat open: de tip is weg').toBeHidden();
    await expect(knop).toHaveAttribute('title', 'Kalender openen');
    await expect(kalender.getByRole('gridcell', { name: /23 sep 2026/ })).toBeFocused();
    await expect.poll(() => page.evaluate(() => window.history.state?.vhbOverlay ?? null)).not.toBeNull();

    // De muis blijft op de knop en schuift van het icoon naar de rand: geen nieuwe tip.
    const vak = (await knop.boundingBox())!;
    const rand = { x: vak.x + 2, y: vak.y + 2 };
    expect(await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest('button')?.getAttribute('aria-label') ?? null, [rand.x, rand.y]), 'onder het punt ligt de kalenderknop').toBe('Kalender openen');
    await page.mouse.move(rand.x, rand.y);
    await page.waitForTimeout(450);
    await expect(tip).toBeHidden();

    await page.keyboard.press('Escape');
    await expect(kalender).toHaveCount(0);
    await expect(veld).toBeFocused();
    await expect(veld).toHaveValue('23/09/2026');
  });

  test('kiezer open in een venster, de muis komt opnieuw op de kalenderknop: één Escape verbergt de tip en sluit de kiezer, het venster blijft open', async ({ page }) => {
    await open(page, '/beheer/gebruikers', 'gebruikers');
    await laagGeladen(page);
    await page.getByRole('row', { name: /Alex Du Priez/ }).getByRole('button', { name: 'Bewerken', exact: true }).click();
    const venster = page.getByRole('dialog').filter({ hasText: 'Gebruiker bewerken' });
    await expect(venster).toBeVisible();
    await expect.poll(() => page.evaluate(() => window.history.state?.vhbOverlay ?? null)).not.toBeNull();
    await wachtOpAnimaties(page);
    const knop = venster.getByRole('button', { name: 'Kalender openen' }).first();
    const veld = knop.locator('xpath=preceding-sibling::input[1]');
    const tip = page.locator(TIP);
    await stil(knop);
    await page.mouse.move(4, 642);
    const vensterEntry = await page.evaluate(() => window.history.state?.vhbOverlay ?? null);

    await veld.focus();
    await page.keyboard.press('ArrowDown');
    await expect(page.getByRole('dialog')).toHaveCount(2);
    await expect.poll(() => page.evaluate(() => window.history.state?.vhbOverlay ?? null)).not.toBe(vensterEntry);
    await wachtOpAnimaties(page);
    const kiezer = page.getByRole('dialog').filter({ has: page.getByRole('grid') });
    await expect(kiezer.locator('[role="gridcell"]:focus')).toHaveCount(1);

    await wijsEnToets(page, knop);
    await page.keyboard.press('Escape');
    await expect(tip).toBeHidden();
    await expect(kiezer).toHaveCount(0);
    await expect(page.getByRole('dialog')).toHaveCount(1);
    await expect(venster).toBeVisible();
    await expect(veld).toBeFocused();
  });

  // Het inline DetailPaneel is geen dialoog: `data-laag` maakt het herkenbaar als laag.
  test('inline beoordelingspaneel (Verlof): focus in het paneel, de tip van de bel in de topbar, één Escape verbergt de tip en sluit het paneel', async ({ page }) => {
    await open(page, '/verlof/l1', 'verlof');
    // De h1 staat al in het laadskelet ("Scherm wordt geladen"); de tip-laag laadt pas bij een
    // muisbeweging ná de eerste lading. Het paneel bewijst dat die lading er is.
    const paneel = page.locator('section[aria-label="Alex Du Priez"]');
    await expect(paneel).toBeVisible();
    await expect(paneel).toHaveAttribute('data-laag', '');
    await wachtOpAnimaties(page);
    await laagGeladen(page);
    const tip = page.locator(TIP);

    await paneel.getByRole('button', { name: 'Sluiten', exact: true }).focus();
    const bel = page.locator('button[aria-haspopup="menu"][aria-label="Meldingen"]');
    await wijsEnToets(page, bel);
    await expect(paneel.getByRole('button', { name: 'Sluiten', exact: true })).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(tip).toBeHidden();
    await expect(paneel).toHaveCount(0);
    await expect.poll(() => new URL(page.url()).pathname).toBe('/verlof');
  });

  // Hersteltronde (25-11). Het rijmenu "…" opent met een klik, en de druk haalde de tip al weg.
  // Een kleine beweging binnen de knop roept hem niet terug, eraf en erop wel. Dan liggen knop
  // en focus allebei in de pagina terwijl het menu open staat: één Escape sluit het menu.
  test('rijmenu met de muis geopend: geen tip bij een kleine beweging binnen de knop; eraf en erop wel, en één Escape sluit het menu', async ({ page }) => {
    await open(page, '/beheer/gebruikers', 'gebruikers');
    await laagGeladen(page);
    const knop = page.getByRole('row', { name: /Alex Du Priez/ }).getByRole('button', { name: 'Meer acties voor Alex Du Priez' });
    const menu = page.getByRole('menu', { name: 'Meer acties voor Alex Du Priez' });
    const tip = page.locator(TIP);
    await stil(knop);
    // De klik valt op de rand van de knop, naast het icoon. Zo komt er tijdens het indrukken
    // geen nieuwe pointerover (op het icoon verschuift de ingedrukte schaal het pad onder de muis).
    const vak = (await knop.boundingBox())!;
    const rand = { x: vak.x + 4, y: vak.y + vak.height / 2 };
    const icoon = { x: vak.x + vak.width / 2, y: vak.y + vak.height / 2 };
    const onder = ([x, y]: number[]) => {
      const el = document.elementFromPoint(x, y);
      return { knop: el?.closest('button')?.getAttribute('aria-label') ?? null, icoon: !!el?.closest('svg') };
    };
    expect(await page.evaluate(onder, [rand.x, rand.y]), 'rand: de knop zelf, niet het icoon').toEqual({ knop: 'Meer acties voor Alex Du Priez', icoon: false });
    expect(await page.evaluate(onder, [icoon.x, icoon.y]), 'midden: het icoon van de knop').toEqual({ knop: 'Meer acties voor Alex Du Priez', icoon: true });

    // Een stille klik: muis op de rand, meteen indrukken en loslaten (de tip had geen tijd).
    await page.mouse.move(rand.x, rand.y);
    await page.mouse.down();
    await page.mouse.up();
    await expect(menu).toBeVisible();
    await expect.poll(() => page.evaluate(() => window.history.state?.vhbOverlay ?? null)).not.toBeNull();
    await wachtOpAnimaties(page);

    // Van de rand naar het icoon: dezelfde knop, geen nieuwe tip.
    await page.mouse.move(icoon.x, icoon.y);
    await page.waitForTimeout(450);
    await expect(tip).toBeHidden();
    await expect(knop).toHaveAttribute('title', 'Meer acties voor Alex Du Priez');

    // Eraf en er weer op: de tip mag weer, het menu staat nog open.
    await page.mouse.move(4, 642);
    await wijsEnToets(page, knop);
    await expect(menu).toBeVisible();
    await expect(knop, 'de focus bleef op de knop van het menu, in de pagina').toBeFocused();

    await page.keyboard.press('Escape');
    await expect(tip).toBeHidden();
    await expect(menu).toHaveCount(0);
    await expect(knop).toBeFocused();
  });

  // Tip-geschiedenis (26-11). De knop Wijzigingsgeschiedenis in het paneel van een dienst opent
  // een venster, en de achtergrond van dat venster schuift over de knop. Chromium stuurt dan een
  // pointerout van de knop naar die achtergrond, en bij het sluiten een pointerover op de knop,
  // allebei op de plek van de muis. Bewoog de muis niet, dan komt er geen tip: vroeger kwam hij na
  // 300 ms en slikte hij de Escape voor het paneel (e2e/lagen.spec.ts, "Escape: eerst de
  // geschiedenis, dan het paneel", was daardoor wankel). Bewoog ze wel, dan krijgt de knop zijn tip.
  test.describe('na het venster van de geschiedenis', () => {
    type Rand = { type: string; x: number; y: number; soort: string };
    const onderPunt = ([x, y]: number[]) => document.elementFromPoint(x, y)?.closest('button')?.getAttribute('aria-label') ?? null;
    const entry = (page: Page) => page.evaluate(() => window.history.state?.vhbOverlay ?? null);
    /** De pointerover en pointerout over de rand van de knop (van of naar buiten de knop). */
    const rand = (page: Page) => page.evaluate(() => (window as unknown as { __rand: Rand[] }).__rand);
    const tipZicht = (page: Page) => page.evaluate(() => (window as unknown as { __tipZicht: number }).__tipZicht);

    /**
     * Dienstoverzicht, paneel van dienst 2515 open, de tip-laag geladen, de knop stil in beeld.
     * Telt vanaf hier elke pointerover en pointerout over de rand van de knop, elke pointerover of
     * pointerout waar ook (`__grens`, tijdstippen), en elke keer dat de tip zichtbaar wordt.
     */
    async function paneelOpen(page: Page) {
      await open(page, '/beheer/dienstoverzicht', 'dienstoverzicht');
      await laagGeladen(page);
      await page.getByRole('button', { name: 'Dienst 2515 openen' }).filter({ visible: true }).click();
      const paneel = page.getByRole('dialog', { name: 'Dienst 2515', exact: true });
      await expect(paneel).toBeVisible();
      await expect.poll(() => entry(page)).not.toBeNull();
      await wachtOpAnimaties(page);
      const paneelEntry = await entry(page);
      const knop = paneel.getByRole('button', { name: 'Wijzigingsgeschiedenis' });
      await stil(knop);
      const vak = (await knop.boundingBox())!;
      const plek = { x: vak.x + vak.width / 2, y: vak.y + vak.height / 2 };
      expect(await page.evaluate(onderPunt, [plek.x, plek.y]), 'onder het punt ligt de knop').toBe('Wijzigingsgeschiedenis');
      await knop.evaluate((el) => {
        const w = window as unknown as { __rand: Rand[]; __grens: number[]; __tipZicht: number };
        w.__rand = [];
        w.__grens = [];
        w.__tipZicht = 0;
        const binnen = (n: EventTarget | null) => n instanceof Node && el.contains(n);
        for (const type of ['pointerover', 'pointerout']) {
          window.addEventListener(type, (e) => {
            const p = e as PointerEvent;
            w.__grens.push(performance.now());
            if (binnen(p.target) && !binnen(p.relatedTarget)) w.__rand.push({ type, x: p.clientX, y: p.clientY, soort: p.pointerType });
          }, true);
        }
        const tip = document.querySelector<HTMLElement>('[data-tip-laag]')!;
        new MutationObserver(() => { if (!tip.hidden) w.__tipZicht++; }).observe(tip, { attributes: true, attributeFilter: ['hidden'] });
      });
      return { paneel, paneelEntry, knop, plek, venster: page.getByRole('dialog', { name: 'Wijzigingsgeschiedenis' }) };
    }

    /** Klik op de knop: het venster staat in de stapel en zijn achtergrond ligt over de knop (de pointerout kwam). */
    async function geschiedenisOpen(page: Page, { paneelEntry, plek, venster }: Awaited<ReturnType<typeof paneelOpen>>) {
      await page.mouse.click(plek.x, plek.y);
      await expect(venster).toBeVisible();
      await expect.poll(() => entry(page)).not.toBe(paneelEntry);
      await expect.poll(async () => (await rand(page)).map((r) => r.type), { message: 'de achtergrond kwam over de knop' }).toEqual(['pointerover', 'pointerout']);
      const [over, uit] = await rand(page);
      expect({ x: uit.x, y: uit.y, soort: uit.soort }, 'de pointerout valt op de plek van de klik').toEqual({ x: over.x, y: over.y, soort: 'mouse' });
    }

    test('de muis staat stil: na Escape geen tip, ook niet na 300 ms, en de volgende Escape sluit het paneel', async ({ page }) => {
      const s = await paneelOpen(page);
      const tip = page.locator(TIP);
      await geschiedenisOpen(page, s);
      await page.keyboard.press('Escape');
      await expect(s.venster).toHaveCount(0);
      await expect(s.paneel).toBeVisible();
      await expect(s.knop).toBeFocused();
      // De achtergrond is weg: de pointerover op de knop, op exact de plek van het weggaan.
      await expect.poll(async () => (await rand(page)).length, { message: 'de pointerover na het sluiten' }).toBe(3);
      const [, uit, terug] = await rand(page);
      expect(terug, 'de muis bewoog niet').toEqual({ ...uit, type: 'pointerover' });
      // 300 ms plus ruime marge.
      await page.waitForTimeout(1000);
      expect(await tipZicht(page), 'geen tip onder de stille muis').toBe(0);
      await expect(tip).toBeHidden();
      await expect(s.knop).toHaveAttribute('title', 'Wijzigingsgeschiedenis');
      await expect.poll(() => entry(page)).toBe(s.paneelEntry);
      await page.keyboard.press('Escape');
      await expect(s.paneel).toHaveCount(0);
      expect(await tipZicht(page)).toBe(0);
    });

    test('de muis gaat weg over de effen achtergrond en komt na Escape terug op exact de plek van de klik: de tip komt na 300 ms en slikt zoals altijd de eerste Escape', async ({ page }) => {
      const s = await paneelOpen(page);
      const tip = page.locator(TIP);
      await geschiedenisOpen(page, s);
      // Daar en op de knop ligt dezelfde achtergrond, buiten het venster zelf.
      const weg = { x: 4, y: 642 };
      expect(await page.evaluate(([x1, y1, x2, y2]) => {
        const a = document.elementFromPoint(x1, y1);
        return !!a && a === document.elementFromPoint(x2, y2) && !a.closest('[role="dialog"]');
      }, [s.plek.x, s.plek.y, weg.x, weg.y]), 'één effen achtergrond').toBe(true);
      const voor = await page.evaluate(() => performance.now());
      await page.mouse.move(weg.x, weg.y);
      expect(await page.evaluate((t) => (window as unknown as { __grens: number[] }).__grens.filter((x) => x > t).length, voor), 'geen pointerover of pointerout onderweg').toBe(0);
      await page.keyboard.press('Escape');
      await expect(s.venster).toHaveCount(0);
      await expect(s.knop).toBeFocused();
      await expect.poll(() => entry(page)).toBe(s.paneelEntry);
      expect((await rand(page)).length, 'de knop zag de muis niet terugkomen').toBe(2);

      expect(await page.evaluate(onderPunt, [s.plek.x, s.plek.y]), 'onder het punt ligt de knop').toBe('Wijzigingsgeschiedenis');
      const meting = await meetTip(page, s.knop);
      await page.mouse.move(s.plek.x, s.plek.y);
      await tipKlopt(page, 'Wijzigingsgeschiedenis');
      const m = await meting();
      expect(m.zicht[0] - m.over[0], 'de tip wacht minstens 300 ms').toBeGreaterThanOrEqual(299);
      const [eerst, , terug] = await rand(page);
      expect({ x: terug.x, y: terug.y }, 'terug op de plek van de klik').toEqual({ x: eerst.x, y: eerst.y });

      // Knop en focus in het paneel: zoals sinds #844 is de eerste Escape voor de tip. Sloot ze het
      // paneel, dan stond het adres al op de lijst (sluiten vervangt het in dezelfde toets).
      await page.keyboard.press('Escape');
      await expect(tip).toBeHidden();
      expect(await page.evaluate(() => location.pathname), 'het paneel bleef open').toBe('/beheer/dienstoverzicht/3');
      expect(await page.evaluate(() => document.body.dataset.scrollLocks ?? '')).toBe('slideover');
      await expect(s.paneel).toBeVisible();
    });
  });

  test('laden mislukt: de icoonknop houdt zijn title, geen tip, geen foutscherm en geen herlaadbeurt', async ({ page }) => {
    const afgebroken: string[] = [];
    await page.route(CHUNK, (route) => { afgebroken.push(route.request().url()); return route.abort(); });
    await open(page, '/beheer/designsysteem', 'designsysteem');
    await page.evaluate(() => { (window as unknown as { __zelfdePagina: boolean }).__zelfdePagina = true; });
    // Zoals in laagGeladen: bewegen tot de lading de laag opvraagt.
    await expect(async () => {
      await page.mouse.move(2, 640);
      await page.mouse.move(4, 642);
      await expect.poll(() => afgebroken.length, { timeout: 500 }).toBeGreaterThan(0);
    }).toPass({ timeout: 15_000 });
    const knop = page.getByRole('button', { name: 'Zoeken', exact: true });
    await stil(knop);
    await knop.hover();
    await page.waitForTimeout(700);
    await expect(knop).toHaveAttribute('title', 'Zoeken');
    await expect(page.locator(TIP)).toHaveCount(0);
    await expect(page.getByText(/Er ging iets mis|Dit scherm kon niet geladen worden/)).toHaveCount(0);
    expect(await page.evaluate(() => (window as unknown as { __zelfdePagina?: boolean }).__zelfdePagina), 'geen herlaadbeurt').toBe(true);
    expect(afgebroken, 'één poging, geen herhaling').toHaveLength(1);
  });
});

test.describe('iPhone: nooit een tip', () => {
  test.beforeEach(({}, info) => {
    test.skip(!info.project.name.startsWith('iPhone 13'), 'touch');
  });

  test('tik en lang drukken op een icoonknop: geen tip en de chunk wordt niet opgehaald', async ({ page }, info) => {
    const verzoeken: string[] = [];
    page.on('request', (r) => { if (CHUNK.test(r.url())) verzoeken.push(r.url()); });
    await open(page, '/beheer/designsysteem', 'designsysteem');
    expect(await page.evaluate(() => matchMedia('(hover: hover) and (pointer: fine)').matches), 'geen fijne aanwijzer').toBe(false);
    const knop = page.getByRole('button', { name: 'Zoeken', exact: true });
    await stil(knop);
    await knop.tap();
    await page.waitForTimeout(400);
    // Lang drukken: in Chromium een echte aanraking via CDP; WebKit kent alleen
    // tap(), dus daar een lang ingedrukte muisknop (pointerType mouse in een
    // touch-context, zoals hover() en click()).
    const vak = (await knop.boundingBox())!;
    const x = vak.x + vak.width / 2;
    const y = vak.y + vak.height / 2;
    const onder = await page.evaluate(([px, py]) => document.elementFromPoint(px, py)?.closest('button')?.getAttribute('aria-label') ?? null, [x, y]);
    expect(onder, 'onder het punt ligt de knop').toBe('Zoeken');
    if (info.project.name.includes('chromium')) {
      const cdp: CDPSession = await page.context().newCDPSession(page);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
      await page.waitForTimeout(900);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } else {
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.waitForTimeout(900);
      await page.mouse.up();
    }
    await knop.hover();
    await page.waitForTimeout(700);
    await expect(page.locator(TIP)).toHaveCount(0);
    await expect(knop).toHaveAttribute('title', 'Zoeken');
    expect(verzoeken, 'de chunk van tipLaag is niet opgehaald').toHaveLength(0);
  });
});
