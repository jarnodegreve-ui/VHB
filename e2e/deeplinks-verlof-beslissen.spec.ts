import { test, expect, type Page } from '@playwright/test';
import { ADMIN, USERS, historiekOpgeruimd, kanScrollen, seed } from './helpers';
import { dayOffset } from '../scripts/audit-fixtures.mjs';

/**
 * Verlof beslissen met alles in beeld (ronde 6, punt 15), vanaf de link naar
 * één aanvraag (`/verlof/<id>`):
 * - na een geslaagde beslissing opent het paneel de volgende wachtende
 *   aanvraag, in de volgorde van de lijst; bij de laatste sluit het;
 * - dat doorschakelen gebeurt alleen waar de bevestiging ("Verlof
 *   goedgekeurd: …") de kop van het paneel vrijlaat: onder 768 px (toast
 *   onderaan) en vanaf 1195 px breed (toast naast de kaart); ertussen sluit
 *   het paneel na elke beslissing, zoals vroeger (zie het laatste blok);
 * - na elke wissel zijn de beslisknoppen eerst inert en staat de focus op de
 *   titel: een tweede klik op dezelfde plek beslist nooit ongezien, en wie
 *   blijft klikken houdt het slot erop tot hij pauzeert;
 * - de toast noemt wie en wat;
 * - op desktop blijven de knoppen in beeld, op 1440 × 900 en op 1280 × 720 en
 *   ook in de Verlofkalender; de inhoud scrolt in het paneel, het limietsignaal
 *   staat als badge bovenaan en de naam staat vrij onder de topbar, ook op een
 *   gescrolde pagina;
 * - op desktop wijst een dubbelklik op Afwijzen niet af: in de stap met de
 *   reden staat Terug waar Afwijzen stond en de verzendknop waar Goedkeuren
 *   stond;
 * - "Dekking deze periode" noemt de namen, "Ook aangevraagd voor deze
 *   periode" wisselt naar een andere wachtende aanvraag.
 *
 * De bestandsnaam begint met `deeplinks-`: zo draait de spec mee in het
 * desktopproject én in WebKit (playwright.config.ts kiest op naam).
 */

const ALEX = 'Alex Du Priez';
const DIETHER = 'Diether Van Haute';
const TEST = 'Test Chauffeur';
const ELS = { id: '45', name: 'Els Goossens', role: 'chauffeur', employeeId: 'VHB-000045', email: 'els@vhb.be', isActive: true };

type Verlof = { id: string; userId: string; startDate: string; endDate: string; type: string; status: string; createdAt: string; decidedAt?: string; comment?: string };
type Patch = { id: string; body: { status?: string; ifStatus?: string; reden?: string } };
/** Wat de pagina zelf vastlegt rond een wissel van aanvraag (zie volgWissel). */
type Invoer = { soort: string; ms: number; opSlot: boolean; opKnop: boolean };
type Wissel = { tijd?: number; meteenGeklikt: boolean; meteenOpSlot: boolean; plek?: { x: number; y: number }; invoer: Invoer[] };

const uurGeleden = (uren: number) => new Date(Date.now() - uren * 3600e3).toISOString();
const aanvraag = (id: string, userId: string, van: number, tot: number, status = 'pending', uren = 24): Verlof => ({
  id, userId, startDate: dayOffset(van), endDate: dayOffset(tot), type: 'betaald_verlof', status, createdAt: uurGeleden(uren),
  ...(status === 'pending' ? {} : { decidedAt: uurGeleden(uren - 1) }),
});
const dmj = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const periode = (r: Verlof) => (r.startDate === r.endDate ? dmj(r.startDate) : `${dmj(r.startDate)} t/m ${dmj(r.endDate)}`);

const telefoon = (page: Page) => (page.viewportSize()?.width ?? 1440) < 1024;
const pad = (page: Page) => new URL(page.url()).pathname;
/** Het beoordelingspaneel: inline kaart (desktop) of SlideOver (telefoon). */
const paneel = (page: Page, naam: string) => page.locator(`section[aria-label="${naam}"], [role="dialog"][aria-label="${naam}"]`);
const paneelKop = (page: Page, naam: string) => page.getByRole('heading', { name: naam, exact: true });
/** Zonder rol: een inerte knop staat niet in de toegankelijkheidsboom. */
const knopOpTekst = (page: Page, tekst: string) => page.locator('button').filter({ hasText: new RegExp(`^${tekst}$`) });

/**
 * Sessie + fixtures, met een verloflijst die elke PATCH onthoudt en toepast
 * (zoals de server).
 */
async function verlofServer(page: Page, start: Verlof[], opties: { users?: unknown[]; planning?: unknown[] } = {}) {
  const lijst = start.map((r) => ({ ...r }));
  const patches: Patch[] = [];
  await seed(page, {
    user: ADMIN,
    extra: (p, request) => {
      if (p.endsWith('/api/users') && opties.users) return opties.users;
      if (p.endsWith('/api/planning') && opties.planning) return opties.planning;
      if (p.endsWith('/api/leave') && request.method() === 'GET') return lijst;
      const m = /\/api\/leave\/([^/]+)$/.exec(p);
      if (m && request.method() === 'PATCH') {
        const body = JSON.parse(request.postData() ?? '{}') as Patch['body'];
        const id = decodeURIComponent(m[1]);
        patches.push({ id, body });
        const rij = lijst.find((r) => r.id === id);
        if (rij && body.status) { rij.status = body.status; rij.decidedAt = new Date().toISOString(); }
        return { leave: rij };
      }
      return undefined;
    },
  });
  return { lijst, patches };
}

/**
 * Laat de pagina zelf de wissel naar `naam` waarnemen, zonder afhankelijkheid
 * van de klok van de test:
 * - op het moment dat de titel van het paneel naar `naam` wisselt (dezelfde
 *   tel als de wissel) klikt ze al een eerste keer op Goedkeuren van de nieuwe
 *   aanvraag, de strengste tweede klik die er bestaat, en noteert ze of de
 *   beslisknoppen op dat moment inert zijn en waar Goedkeuren nu staat;
 * - van elke echte invoer daarna (aanwijzer, vinger, toets; `isTrusted`)
 *   noteert ze hoeveel ms na de wissel ze viel, of het slot er toen op zat
 *   en of ze op Goedkeuren viel.
 */
async function volgWissel(page: Page, naam: string) {
  await page.evaluate((n) => {
    const w = window as unknown as { __wissel?: Wissel; __wisselLuistert?: boolean };
    const stand: Wissel = { tijd: undefined, meteenGeklikt: false, meteenOpSlot: false, invoer: [] };
    w.__wissel = stand;
    const knopMet = (tekst: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.trim() === tekst);
    if (!w.__wisselLuistert) {
      w.__wisselLuistert = true;
      const noteer = (e: Event) => {
        const nu = w.__wissel;
        if (!e.isTrusted || !nu || nu.tijd === undefined) return;
        const knop = knopMet('Goedkeuren');
        const vak = knop?.getBoundingClientRect();
        const punt = 'touches' in e ? (e as TouchEvent).touches[0] : (e as MouseEvent);
        const x = punt?.clientX, y = punt?.clientY;
        nu.invoer.push({
          soort: e.type,
          ms: Math.round(performance.now() - nu.tijd),
          opSlot: !!knop?.closest('[inert]'),
          opKnop: !!vak && typeof x === 'number' && x >= vak.left && x <= vak.right && y >= vak.top && y <= vak.bottom,
        });
      };
      for (const soort of ['pointerdown', 'mousedown', 'touchstart', 'keydown']) window.addEventListener(soort, noteer, true);
    }
    const waarnemer = new MutationObserver(() => {
      const kop = [...document.querySelectorAll('section[aria-label] h2, [role="dialog"] h2')].find((h) => h.textContent?.trim() === n);
      if (!kop) return;
      waarnemer.disconnect();
      stand.tijd = performance.now();
      const knop = knopMet('Goedkeuren');
      if (knop) {
        const vak = knop.getBoundingClientRect();
        stand.plek = { x: vak.left + vak.width / 2, y: vak.top + vak.height / 2 };
        stand.meteenOpSlot = !!knop.closest('[inert]');
        knop.click();
        stand.meteenGeklikt = true;
      }
    });
    waarnemer.observe(document.body, { childList: true, subtree: true, characterData: true });
  }, naam);
}
const wissel = (page: Page) => page.evaluate(() => (window as unknown as { __wissel: Wissel }).__wissel);
/** Milliseconden sinds de wissel (-1 = nog niet gewisseld) en waar Goedkeuren van de nieuwe aanvraag staat. */
const sindsWissel = (page: Page) => page.evaluate(() => {
  const stand = (window as unknown as { __wissel?: Wissel }).__wissel;
  return { sinds: stand?.tijd === undefined ? -1 : performance.now() - stand.tijd, plek: stand?.plek };
});

/**
 * Echte invoer zonder de wachtlogica van Playwright (`locator.click()` wacht
 * tot de knop weer reageert en zou het slot dus nooit raken): wacht op de
 * wissel en voert daarna `actie` uit zolang ze jonger is dan 300 ms. `actie`
 * krijgt het midden van Goedkeuren van de nieuwe aanvraag: de plek waar een
 * tweede klik kwaad kan. Roep dit meteen na de klik die de wissel uitlokt
 * aan, vóór elke andere controle; de eerste actie valt dan enkele ms na de
 * wissel.
 */
async function binnenHetSlot(page: Page, actie: (plek: { x: number; y: number }) => Promise<void>) {
  const einde = Date.now() + 15_000;
  while (Date.now() < einde) {
    const { sinds, plek } = await sindsWissel(page);
    if (sinds > 300) return;
    if (sinds < 0) { await page.waitForTimeout(5); continue; }
    if (!plek) throw new Error('Goedkeuren van de nieuwe aanvraag stond er niet bij de wissel');
    await actie(plek);
  }
  throw new Error('de wissel van aanvraag kwam niet');
}
/** Een echte klik (desktop) of tik (telefoon) op die plek. */
const klikOfTik = (page: Page) => async (plek: { x: number; y: number }) => {
  if (telefoon(page)) await page.touchscreen.tap(plek.x, plek.y);
  else await page.mouse.click(plek.x, plek.y);
};
const AANWIJZER = ['pointerdown', 'mousedown', 'touchstart'];
/**
 * Het bewijs uit de pagina zelf: er viel echte invoer binnen 300 ms na de
 * wissel (een aanwijzer óp Goedkeuren), en bij alles wat binnen de
 * afgesproken 600 ms viel zat het slot erop. Wat later viel telt niet: dan
 * mag de knop weer werken.
 */
async function verwachtSlot(page: Page, soorten: string[]) {
  const stand = await wissel(page);
  const echt = stand.invoer.filter((i) => soorten.includes(i.soort));
  const raak = echt.filter((i) => i.ms <= 300 && (i.soort === 'keydown' || i.opKnop));
  expect(raak.length, `echte invoer (${soorten.join(', ')}) binnen 300 ms na de wissel, een aanwijzer op Goedkeuren: ${JSON.stringify(stand.invoer)}`).toBeGreaterThan(0);
  expect(echt.filter((i) => i.ms < 600 && !i.opSlot), 'invoer binnen 600 ms na de wissel terwijl de beslisknoppen niet inert waren').toEqual([]);
  // De klik in dezelfde tel als de wissel: de knop stond er, was inert, en de klik is gedaan.
  expect({ meteenGeklikt: stand.meteenGeklikt, meteenOpSlot: stand.meteenOpSlot }).toEqual({ meteenGeklikt: true, meteenOpSlot: true });
}

const DRIE = () => [aanvraag('w1', '43', 5, 9), aanvraag('w2', '44', 6, 7), aanvraag('w3', '42', 20, 21)];

/** Wacht tot de pagina stilstaat (het paneel komt met een zachte scroll in beeld). */
async function paginaRust(page: Page) {
  let vorige = NaN;
  await expect.poll(async () => {
    const nu = await page.locator('[data-scroll-root]').evaluate((el) => el.scrollTop);
    const stil = nu === vorige;
    vorige = nu;
    return stil;
  }, { intervals: [150] }).toBe(true);
}
/**
 * Hoeveel px de titel van het paneel onder de plakkende topbar begint
 * (negatief = erachter). `toBeInViewport` volstaat hier niet: een titel
 * achter de balk staat ook "in het venster".
 */
async function titelOnderTopbar(page: Page, naam: string) {
  const kop = await paneelKop(page, naam).boundingBox();
  const balk = await page.locator('header.topbar').boundingBox();
  if (!kop || !balk) throw new Error('de titel van het paneel of de topbar ontbreekt');
  return Math.round(kop.y - (balk.y + balk.height));
}
type Vak = { x: number; y: number; width: number; height: number };
/** Het grootste verschil (px) tussen twee knoppen: linkerrand, rechterrand en bovenrand. */
const verschil = (a: Vak | null, b: Vak) => (a ? Math.max(Math.abs(a.x - b.x), Math.abs(a.x + a.width - (b.x + b.width)), Math.abs(a.y - b.y)) : Infinity);

test.describe('verlof beslissen: door naar de volgende wachtende', () => {
  test('na Goedkeuren opent de volgende, de knoppen zijn eerst inert, de toast noemt wie en wat; de laatste sluit het paneel', async ({ page }) => {
    const fouten: string[] = [];
    page.on('pageerror', (e) => fouten.push(e.message));
    const start = DRIE();
    const { patches } = await verlofServer(page, start);
    await page.goto('/verlof/w1');
    await expect(paneelKop(page, ALEX)).toBeVisible({ timeout: 15_000 });
    const lengteVoor = await page.evaluate(() => history.length);

    // Eerste beslissing, met de aanwijzer (of de vinger) op Goedkeuren; meteen
    // erna Enter en spatie, zoals wie de knop met het toetsenbord bedient.
    await volgWissel(page, DIETHER);
    await page.getByRole('button', { name: 'Goedkeuren' }).click();
    await binnenHetSlot(page, async () => { await page.keyboard.press('Enter'); await page.keyboard.press('Space'); });
    await verwachtSlot(page, ['keydown']);
    await expect(paneelKop(page, DIETHER)).toBeVisible();
    // De focus staat op de titel, niet op een beslisknop: Enter en spatie doen niets.
    await expect(paneelKop(page, DIETHER)).toBeFocused();
    expect(pad(page)).toBe('/verlof/w2');
    await expect(page.getByText(`Verlof goedgekeurd: ${ALEX}, ${periode(start[0])}.`)).toBeVisible();
    await page.waitForTimeout(400);
    expect(patches, 'geen tweede PATCH door de klik bij de wissel of door Enter en spatie').toHaveLength(1);
    expect(patches[0]).toMatchObject({ id: 'w1', body: { status: 'approved', ifStatus: 'pending' } });
    await expect(paneelKop(page, DIETHER)).toBeVisible();

    // Na het slot werken de knoppen gewoon (locator.click wacht daarop). Een
    // tweede klik of tik op Goedkeuren van de volgende, meteen na deze wissel,
    // doet niets.
    await volgWissel(page, TEST);
    await page.getByRole('button', { name: 'Goedkeuren' }).click();
    await binnenHetSlot(page, klikOfTik(page));
    await verwachtSlot(page, AANWIJZER);
    await expect(paneelKop(page, TEST)).toBeVisible();
    expect(pad(page)).toBe('/verlof/w3');
    await expect(page.getByText(`Verlof goedgekeurd: ${DIETHER}, ${periode(start[1])}.`)).toBeVisible();
    await page.waitForTimeout(400);
    expect(patches, 'geen PATCH door de tweede klik op dezelfde plek').toHaveLength(2);
    expect(patches[1]).toMatchObject({ id: 'w2', body: { status: 'approved', ifStatus: 'pending' } });
    await expect(paneelKop(page, TEST)).toBeVisible();

    // De laatste: afwijzen met een reden; daarna sluit het paneel zoals vroeger.
    await page.getByRole('button', { name: 'Afwijzen' }).click();
    await page.getByLabel('Reden van afwijzing').fill('Te veel collega\'s al vrij.');
    await page.getByRole('button', { name: 'Afwijzen' }).click();
    await expect(paneel(page, TEST)).toHaveCount(0);
    expect(patches).toHaveLength(3);
    expect(patches[2]).toMatchObject({ id: 'w3', body: { status: 'rejected', ifStatus: 'pending', reden: 'Te veel collega\'s al vrij.' } });
    await expect(page.getByText(`Verlof afgewezen: ${TEST}, ${periode(start[2])}.`)).toBeVisible();
    await expect.poll(() => pad(page)).toBe('/verlof');
    await expect(page.getByText('Alles beoordeeld')).toBeVisible();

    // Doorschakelen was telkens een replace: geen extra stappen, geen wees.
    await kanScrollen(page);
    await historiekOpgeruimd(page);
    expect(await page.evaluate(() => history.length)).toBeLessThanOrEqual(lengteVoor);
    expect(fouten, `page errors:\n${fouten.join('\n')}`).toEqual([]);
  });

  test('na Afwijzen met een reden: de volgende begint bovenaan, zonder de weigerstap, en ook dan zit het slot erop', async ({ page }) => {
    const start = [{ ...aanvraag('w1', '43', 5, 9), comment: 'Lange toelichting. '.repeat(80) }, { ...aanvraag('w2', '44', 6, 7), comment: 'Ook lang. '.repeat(120) }];
    const { patches } = await verlofServer(page, start);
    await page.goto('/verlof/w1');
    await expect(paneelKop(page, ALEX)).toBeVisible({ timeout: 15_000 });
    const inhoud = paneel(page, ALEX).locator('.overflow-y-auto').first();
    await inhoud.evaluate((el) => { el.scrollTop = el.scrollHeight; });
    expect(await inhoud.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);

    await page.getByRole('button', { name: 'Afwijzen' }).click();
    await page.getByLabel('Reden van afwijzing').fill('Reden voor Alex');
    // Waar Afwijzen van het formulier staat, staat straks Goedkeuren van de volgende.
    await volgWissel(page, DIETHER);
    await page.getByRole('button', { name: 'Afwijzen' }).click();
    await binnenHetSlot(page, klikOfTik(page));
    await verwachtSlot(page, AANWIJZER);
    await expect(paneelKop(page, DIETHER)).toBeVisible();
    await page.waitForTimeout(400);
    expect(patches).toHaveLength(1);
    expect(patches[0]).toMatchObject({ id: 'w1', body: { status: 'rejected', ifStatus: 'pending', reden: 'Reden voor Alex' } });
    await expect(page.getByText(`Verlof afgewezen: ${ALEX}, ${periode(start[0])}.`)).toBeVisible();
    // Geen tekstvak met de reden van de vorige; de gewone knoppen staan er.
    await expect(page.getByLabel('Reden van afwijzing')).toHaveCount(0);
    await expect(knopOpTekst(page, 'Goedkeuren')).toHaveCount(1);
    await expect.poll(() => paneel(page, DIETHER).locator('.overflow-y-auto').first().evaluate((el) => el.scrollTop)).toBe(0);
  });

  test('wie na de wissel blijft klikken beslist de volgende niet: elke poging zet het slot opnieuw, pas na een pauze werkt de knop', async ({ page }) => {
    const start = DRIE();
    const { patches } = await verlofServer(page, start);
    await page.goto('/verlof/w1');
    await expect(paneelKop(page, ALEX)).toBeVisible({ timeout: 15_000 });

    // De planner klikt uit gewoonte door tot het paneel sluit; het sluit niet
    // meer, het toont de volgende. Drie seconden lang om de 250 ms een echte
    // klik (tik) op de plek waar Goedkeuren van de volgende staat.
    await volgWissel(page, DIETHER);
    await page.getByRole('button', { name: 'Goedkeuren' }).click();
    let plek: { x: number; y: number } | undefined;
    await expect.poll(async () => {
      const nu = await sindsWissel(page);
      plek = nu.plek;
      return nu.sinds;
    }, { intervals: [10] }).toBeGreaterThanOrEqual(0);
    if (!plek) throw new Error('Goedkeuren van de nieuwe aanvraag stond er niet bij de wissel');
    const klik = klikOfTik(page);
    const einde = Date.now() + 3000;
    while (Date.now() < einde) {
      await klik(plek);
      await page.waitForTimeout(250);
    }

    // Het bewijs uit de pagina zelf: elke aanwijzer viel op een knop op slot,
    // ook die ruim na de eerste 650 ms.
    const stand = await wissel(page);
    const pogingen = stand.invoer.filter((i) => AANWIJZER.includes(i.soort));
    expect(pogingen.filter((i) => i.opKnop && i.ms > 1500).length, `klikken op Goedkeuren ruim na het eerste slot: ${JSON.stringify(stand.invoer)}`).toBeGreaterThan(0);
    expect(pogingen.filter((i) => !i.opSlot), `een klik viel op een knop die niet op slot zat: ${JSON.stringify(stand.invoer)}`).toEqual([]);
    expect(patches, 'doorklikken besliste de volgende aanvraag niet').toHaveLength(1);
    expect(patches[0]).toMatchObject({ id: 'w1', body: { status: 'approved' } });
    await expect(paneelKop(page, DIETHER)).toBeVisible();
    expect(pad(page)).toBe('/verlof/w2');

    // Na een pauze langer dan het slot werkt dezelfde klik wel, en alleen dan.
    await page.waitForTimeout(900);
    await klik(plek);
    await expect.poll(() => patches.length).toBe(2);
    expect(patches[1]).toMatchObject({ id: 'w2', body: { status: 'approved', ifStatus: 'pending' } });
    await expect(paneelKop(page, TEST)).toBeVisible();
  });

  test('de laatste van de lijst sluit het paneel, ook als er erboven nog wachten', async ({ page }) => {
    const { patches } = await verlofServer(page, DRIE());
    await page.goto('/verlof/w3');
    await expect(paneelKop(page, TEST)).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: 'Goedkeuren' }).click();
    await expect(paneel(page, TEST)).toHaveCount(0);
    expect(patches).toHaveLength(1);
    await expect.poll(() => pad(page)).toBe('/verlof');
    await expect(paneelKop(page, ALEX)).toHaveCount(0);
    await expect(paneelKop(page, DIETHER)).toHaveCount(0);
  });

  test('mislukt de beslissing (409), dan sluit het paneel zoals vroeger en schakelt het niet door', async ({ page }) => {
    await verlofServer(page, DRIE());
    let geweigerd = 0;
    await page.route('**/api/leave/**', (route) => {
      if (route.request().method() !== 'PATCH') return route.fallback();
      geweigerd++;
      return route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: 'Deze aanvraag is intussen al behandeld.', currentStatus: 'approved' }) });
    });
    await page.goto('/verlof/w1');
    await expect(paneelKop(page, ALEX)).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: 'Goedkeuren' }).click();
    await expect(page.getByText('Deze aanvraag is intussen al behandeld.')).toBeVisible();
    await expect(paneel(page, ALEX)).toHaveCount(0);
    await expect(paneelKop(page, DIETHER)).toHaveCount(0);
    await expect(page.getByText(/^Verlof goedgekeurd/)).toHaveCount(0);
    expect(geweigerd).toBe(1);
    await expect.poll(() => pad(page)).toBe('/verlof');
  });

  test('mislukt de beslissing met een serverfout (500), dan ook: paneel dicht, geen volgende', async ({ page }) => {
    await verlofServer(page, DRIE());
    let pogingen = 0;
    await page.route('**/api/leave/**', (route) => {
      if (route.request().method() !== 'PATCH') return route.fallback();
      pogingen++;
      return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Interne fout' }) });
    });
    await page.goto('/verlof/w1');
    await expect(paneelKop(page, ALEX)).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: 'Goedkeuren' }).click();
    await expect(page.getByText(/^Beslissing opslaan/)).toBeVisible();
    await expect(paneel(page, ALEX)).toHaveCount(0);
    await expect(paneelKop(page, DIETHER)).toHaveCount(0);
    await expect(page.getByText(/^Verlof goedgekeurd/)).toHaveCount(0);
    expect(pogingen).toBe(1);
    await expect.poll(() => pad(page)).toBe('/verlof');
  });

  test('terug na het doorschakelen: geen dode stap', async ({ page }) => {
    await verlofServer(page, DRIE());
    await page.goto('/');
    await page.getByText(`Verlofaanvraag · ${ALEX}`).first().click();
    await expect(paneelKop(page, ALEX)).toBeVisible();
    await page.getByRole('button', { name: 'Goedkeuren' }).click();
    await expect(paneelKop(page, DIETHER)).toBeVisible();
    expect(pad(page)).toBe('/verlof/w2');
    await page.goBack();
    if (telefoon(page)) {
      // Telefoon: de eerste keer terug sluit het paneel (zoals elke overlay)…
      await expect(paneel(page, DIETHER)).toHaveCount(0);
      await expect.poll(() => pad(page)).toBe('/verlof');
      await kanScrollen(page);
      await historiekOpgeruimd(page);
      await page.goBack();
    }
    // …en dan sta je weer waar je vandaan kwam.
    await expect.poll(() => pad(page)).toBe('/');
    await expect(paneelKop(page, DIETHER)).toHaveCount(0);
  });

  test('sluiten na het doorschakelen brengt je naar de lijst en laat geen stap achter', async ({ page }) => {
    await verlofServer(page, DRIE());
    await page.goto('/');
    await page.getByText(`Verlofaanvraag · ${ALEX}`).first().click();
    await expect(paneelKop(page, ALEX)).toBeVisible();
    await page.getByRole('button', { name: 'Goedkeuren' }).click();
    await expect(paneelKop(page, DIETHER)).toBeVisible();
    await paneel(page, DIETHER).getByRole('button', { name: 'Sluiten', exact: true }).click();
    await expect(paneel(page, DIETHER)).toHaveCount(0);
    await expect.poll(() => pad(page)).toBe('/verlof');
    await kanScrollen(page);
    await historiekOpgeruimd(page);
    // Eén keer terug = waar je vandaan kwam, niet de aanvraag van daarnet.
    await page.goBack();
    await expect.poll(() => pad(page)).toBe('/');
    await expect(paneelKop(page, DIETHER)).toHaveCount(0);
    await expect(paneelKop(page, ALEX)).toHaveCount(0);
  });
});

test.describe('verlof beslissen: wie nog meer', () => {
  /** w1 wordt beoordeeld; w2 en w3 raken zijn periode (w2 is de oudste aanvraag), w4 niet. */
  const lijst = () => [
    aanvraag('w1', '43', 5, 9, 'pending', 10),
    aanvraag('w3', '42', 8, 12, 'pending', 20),
    aanvraag('w2', '44', 6, 7, 'pending', 30),
    aanvraag('w4', '45', 20, 21, 'pending', 40),
  ];

  test('"Ook aangevraagd voor deze periode" wisselt het paneel, met het slot en zonder extra stap in de historiek', async ({ page }) => {
    const start = lijst();
    const { patches } = await verlofServer(page, start, { users: [...USERS, ELS] });
    await page.goto('/verlof/w1');
    await expect(paneelKop(page, ALEX)).toBeVisible({ timeout: 15_000 });
    const blok = paneel(page, ALEX).getByText('Ook aangevraagd voor deze periode').locator('xpath=..');
    const regels = blok.getByRole('button');
    // De oudste aanvraag eerst; wat de periode niet raakt staat er niet.
    await expect(regels).toHaveCount(2);
    await expect(regels.nth(0)).toContainText(DIETHER);
    await expect(regels.nth(0)).toContainText(periode(start[2]));
    await expect(regels.nth(1)).toContainText(TEST);
    await expect(blok).not.toContainText(ELS.name);

    const lengteVoor = await page.evaluate(() => history.length);
    // Meteen na de wissel een klik of tik op Goedkeuren van de nieuwe aanvraag.
    await volgWissel(page, DIETHER);
    await regels.nth(0).click();
    await binnenHetSlot(page, klikOfTik(page));
    await verwachtSlot(page, AANWIJZER);
    await expect(paneelKop(page, DIETHER)).toBeVisible();
    expect(pad(page)).toBe('/verlof/w2');
    expect(await page.evaluate(() => history.length)).toBe(lengteVoor);
    await page.waitForTimeout(400);
    expect(patches, 'de klikken bij de wissel beslisten niets').toEqual([]);
    // In het paneel van Diether staat alleen wie zíjn periode raakt.
    const blok2 = paneel(page, DIETHER).getByText('Ook aangevraagd voor deze periode').locator('xpath=..');
    await expect(blok2.getByRole('button')).toHaveCount(1);
    await expect(blok2.getByRole('button')).toContainText(ALEX);

    // Sluiten brengt je naar de lijst, daarna is de historiek schoon.
    await paneel(page, DIETHER).getByRole('button', { name: 'Sluiten', exact: true }).click();
    await expect(paneel(page, DIETHER)).toHaveCount(0);
    await expect.poll(() => pad(page)).toBe('/verlof');
    await kanScrollen(page);
    await historiekOpgeruimd(page);
  });

  test('de wissel via "Ook aangevraagd" zet de focus op de titel', async ({ page }) => {
    await verlofServer(page, lijst(), { users: [...USERS, ELS] });
    await page.goto('/verlof/w1');
    await expect(paneelKop(page, ALEX)).toBeVisible({ timeout: 15_000 });
    await paneel(page, ALEX).getByText('Ook aangevraagd voor deze periode').locator('xpath=..').getByRole('button').first().click();
    await expect(paneelKop(page, DIETHER)).toBeVisible();
    await expect(paneelKop(page, DIETHER)).toBeFocused();
  });

  test('geen andere wachtenden voor de periode: het blok staat er niet', async ({ page }) => {
    await verlofServer(page, [aanvraag('w1', '43', 5, 9), aanvraag('w4', '44', 20, 21)]);
    await page.goto('/verlof/w1');
    await expect(paneelKop(page, ALEX)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Ook aangevraagd voor deze periode')).toHaveCount(0);
  });

  test('"Dekking deze periode" noemt wie er al vrij is, hoogstens zes en dan "+ n anderen"', async ({ page }) => {
    const extra = Array.from({ length: 7 }, (_, i) => ({ id: String(60 + i), name: `Collega ${String.fromCharCode(65 + i)}`, role: 'chauffeur', employeeId: `VHB-0000${60 + i}`, email: `c${i}@vhb.be`, isActive: true }));
    const start = [
      aanvraag('w1', '43', 5, 9),
      aanvraag('g1', '44', 6, 7, 'approved', 300),
      ...extra.map((u, i) => aanvraag(`g${i + 2}`, u.id, 7 + (i % 2), 8 + (i % 2), 'approved', 200 - i)),
    ];
    await verlofServer(page, start, { users: [...USERS, ...extra] });
    await page.goto('/verlof/w1');
    await expect(paneelKop(page, ALEX)).toBeVisible({ timeout: 15_000 });
    const kaart = paneel(page, ALEX).getByText('Dekking deze periode').locator('xpath=..');
    await expect(kaart).toContainText('Er zijn al 8 andere chauffeurs met goedgekeurd verlof in deze periode');
    await expect(kaart.getByRole('listitem')).toHaveCount(6);
    // De vroegste periode eerst.
    await expect(kaart.getByRole('listitem').first()).toContainText(DIETHER);
    await expect(kaart.getByRole('listitem').first()).toContainText(periode(start[1]));
    await expect(kaart).toContainText('+ 2 anderen');
  });
});

test.describe('verlof beslissen: de knoppen blijven in beeld (desktop)', () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) < 1024, 'op de telefoon is het paneel een SlideOver met een vaste voet');

  /** Boven de limiet (twee anderen al vrij, limiet 2) en drie botsende diensten. */
  const zwaar = () => ({
    verlof: [
      { ...aanvraag('w1', '43', 5, 9), comment: 'Familiereis, de vlucht is al geboekt. Graag zo snel mogelijk een antwoord, zodat we het hotel kunnen bevestigen.' },
      aanvraag('g1', '44', 5, 9, 'approved', 300),
      aanvraag('g2', '42', 6, 8, 'approved', 200),
    ],
    planning: [5, 6, 7].map((d, i) => ({ id: `c${i}`, date: dayOffset(d), startTime: '06:00', endTime: '14:00', line: String(2101 + i), busNumber: '', loopnr: String(4500 + i), driverId: '43' })),
  });
  const MATEN = [{ width: 1440, height: 900 }, { width: 1280, height: 720 }];
  const pagScroll = (page: Page) => page.locator('[data-scroll-root]').evaluate((el) => el.scrollTop);

  for (const maat of MATEN) {
    test(`Verlof op ${maat.width} × ${maat.height}: Afwijzen, Goedkeuren en de stap met de reden staan in beeld, de inhoud scrolt in het paneel`, async ({ page }) => {
      await page.setViewportSize(maat);
      const { verlof, planning } = zwaar();
      await verlofServer(page, verlof, { planning });
      await page.goto('/verlof/w1');
      const p = paneel(page, ALEX);
      await expect(p).toBeVisible({ timeout: 15_000 });
      await expect(p.getByText('Boven de verloflimiet')).toBeAttached();
      await expect(p.getByText('3 diensten ingepland')).toBeVisible();
      await expect(p.getByText('Conflict met planning')).toBeAttached();

      // De pagina staat bovenaan en de knoppen staan volledig in het venster.
      expect(await pagScroll(page)).toBe(0);
      // Nu Goedkeuren altijd in beeld staat, moet het limietsignaal dat ook:
      // de badge bovenaan, zonder te scrollen in het paneel (de kaart met de
      // dagen staat lager, onder de namen van Dekking).
      await expect(p.getByText('Boven de limiet', { exact: true })).toBeInViewport({ ratio: 1 });
      await expect(page.getByRole('button', { name: 'Afwijzen' })).toBeInViewport({ ratio: 1 });
      await expect(page.getByRole('button', { name: 'Goedkeuren' })).toBeInViewport({ ratio: 1 });
      // De inhoud is langer dan haar vak en scrolt daarin; de knoppen blijven staan.
      const inhoud = p.locator('.overflow-y-auto').first();
      const maten = await inhoud.evaluate((el) => ({ zichtbaar: el.clientHeight, alles: el.scrollHeight }));
      expect(maten.alles).toBeGreaterThan(maten.zichtbaar);
      await inhoud.evaluate((el) => { el.scrollTop = el.scrollHeight; });
      await expect(p.getByText('Toelichting van de aanvrager')).toBeInViewport();
      await expect(page.getByRole('button', { name: 'Goedkeuren' })).toBeInViewport({ ratio: 1 });
      expect(await pagScroll(page)).toBe(0);

      // De stap met de reden: tekstvak, Terug en Afwijzen in beeld, de pagina verspringt niet.
      await page.getByRole('button', { name: 'Afwijzen' }).click();
      await expect(page.getByLabel('Reden van afwijzing')).toBeInViewport({ ratio: 1 });
      await expect(page.getByRole('button', { name: 'Terug' })).toBeInViewport({ ratio: 1 });
      await expect(page.getByRole('button', { name: 'Afwijzen' })).toBeInViewport({ ratio: 1 });
      expect(await pagScroll(page)).toBe(0);
      await expect(p.getByRole('heading', { name: ALEX })).toBeInViewport({ ratio: 1 });
    });

    test(`Verlofkalender op ${maat.width} × ${maat.height}: de knoppen staan in beeld, geen doorschakelen en geen blok met wachtenden`, async ({ page }) => {
      await page.setViewportSize(maat);
      const { verlof, planning } = zwaar();
      const { patches } = await verlofServer(page, [...verlof, aanvraag('w2', '44', 12, 13)], { planning });
      await page.goto(`/beheer/verlofkalender/${dayOffset(5).slice(0, 7)}`);
      await page.getByRole('button', { name: new RegExp(`^${ALEX}, .*: beoordelen$`) }).first().click();
      const p = paneel(page, ALEX);
      await expect(p).toBeVisible();
      await expect(page.getByRole('button', { name: 'Afwijzen' })).toBeInViewport({ ratio: 1 });
      await expect(page.getByRole('button', { name: 'Goedkeuren' })).toBeInViewport({ ratio: 1 });
      await expect(p.getByText('Boven de limiet', { exact: true })).toBeInViewport({ ratio: 1 });
      await expect(p.getByText('Dekking deze periode').locator('xpath=..').getByRole('listitem')).toHaveCount(2);
      await expect(page.getByText('Ook aangevraagd voor deze periode')).toHaveCount(0);

      await page.getByRole('button', { name: 'Afwijzen' }).click();
      await expect(page.getByLabel('Reden van afwijzing')).toBeInViewport({ ratio: 1 });
      await expect(page.getByRole('button', { name: 'Terug' })).toBeInViewport({ ratio: 1 });
      await expect(page.getByRole('button', { name: 'Afwijzen' })).toBeInViewport({ ratio: 1 });
      await page.getByRole('button', { name: 'Terug' }).click();

      // Beslissen in de kalender: terug naar de dag, niet naar de volgende aanvraag.
      await page.getByRole('button', { name: 'Goedkeuren' }).click();
      await expect.poll(() => patches.length).toBe(1);
      await expect(paneel(page, ALEX)).toHaveCount(0);
      await expect(paneelKop(page, DIETHER)).toHaveCount(0);
      await expect(page.getByText('Verloflimiet op deze dag')).toBeVisible();
      // Het dagoverzicht is geen beoordeling: daar groeit het paneel weer vrij.
      expect(await page.locator('section[aria-label]').first().evaluate((el) => (el as HTMLElement).style.maxHeight)).toBe('');
    });
  }

  // Door de begrensde kaart groeit de voet naar boven en blijft de onderste
  // rij staan. De rij van de stap met de reden heeft daarom dezelfde indeling
  // als de gewone rij: Terug valt op Afwijzen, de verzendknop op Goedkeuren.
  // Een dubbelklik op Afwijzen kan de verzendknop dus niet raken, en de tweede
  // klik sluit de stap ook niet meteen weer.
  for (const scherm of ['Verlof', 'Verlofkalender'] as const) {
    test(`${scherm} op 1280 × 720: een dubbelklik op de rechterrand van Afwijzen wijst niet af, de stap met de reden blijft open`, async ({ page }) => {
      await page.setViewportSize(MATEN[1]);
      const { verlof, planning } = zwaar();
      const { patches } = await verlofServer(page, verlof, { planning });
      if (scherm === 'Verlof') {
        await page.goto('/verlof/w1');
      } else {
        await page.goto(`/beheer/verlofkalender/${dayOffset(5).slice(0, 7)}`);
        await page.getByRole('button', { name: new RegExp(`^${ALEX}, .*: beoordelen$`) }).first().click();
      }
      await expect(paneel(page, ALEX)).toBeVisible({ timeout: 15_000 });
      const afwijzen = page.getByRole('button', { name: 'Afwijzen' });
      const goedkeuren = page.getByRole('button', { name: 'Goedkeuren' });
      await expect(goedkeuren).toBeInViewport({ ratio: 1 });
      await paginaRust(page);
      const vakAfwijzen = (await afwijzen.boundingBox())!;
      const vakGoedkeuren = (await goedkeuren.boundingBox())!;

      // Een echte dubbelklik (de tweede klik draagt klikteller 2) op 5 px van de rechterrand.
      await page.mouse.dblclick(vakAfwijzen.x + vakAfwijzen.width - 5, vakAfwijzen.y + vakAfwijzen.height / 2);
      await page.waitForTimeout(400);
      expect(patches, 'de tweede klik van de dubbelklik wees de aanvraag af zonder de stap met de reden').toEqual([]);
      await expect(page.getByLabel('Reden van afwijzing')).toBeVisible();
      await expect(paneel(page, ALEX)).toBeVisible();

      // Zelfde plaatsen als de gewone rij (gemeten: op 1 px na, de randen van
      // de knopsoorten verschillen). De muis weg: een knop onder de muis licht 1 px op.
      await page.mouse.move(5, 5);
      const terug = page.getByRole('button', { name: 'Terug', exact: true });
      await expect.poll(async () => verschil(await terug.boundingBox(), vakAfwijzen), 'Terug staat waar Afwijzen stond').toBeLessThanOrEqual(2);
      const vakVerzend = (await afwijzen.boundingBox())!;
      expect(verschil(vakVerzend, vakGoedkeuren), 'de verzendknop staat waar Goedkeuren stond').toBeLessThanOrEqual(2);
      // Waar het om gaat: de verzendknop begint rechts van waar Afwijzen eindigde.
      expect(vakVerzend.x, 'de verzendknop ligt nergens onder Afwijzen').toBeGreaterThan(vakAfwijzen.x + vakAfwijzen.width);

      // Een gewone klik op Terug en op de verzendknop werkt zoals altijd.
      await terug.click();
      await expect(page.getByLabel('Reden van afwijzing')).toHaveCount(0);
      await expect(goedkeuren).toBeVisible();
      await afwijzen.click();
      await page.getByLabel('Reden van afwijzing').fill('Te veel collega\'s al vrij.');
      await afwijzen.click();
      await expect.poll(() => patches.length).toBe(1);
      expect(patches[0]).toMatchObject({ id: 'w1', body: { status: 'rejected', ifStatus: 'pending', reden: 'Te veel collega\'s al vrij.' } });
    });
  }

  test('het paneel volgt het venster: kleiner maken houdt de knoppen in beeld, groter maken geeft de inhoud weer ruimte', async ({ page }) => {
    await page.setViewportSize(MATEN[0]);
    const { verlof, planning } = zwaar();
    await verlofServer(page, verlof, { planning });
    await page.goto('/verlof/w1');
    const p = paneel(page, ALEX);
    await expect(p).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('button', { name: 'Goedkeuren' })).toBeInViewport({ ratio: 1 });
    const hoog = (await p.boundingBox())!.height;

    await page.setViewportSize(MATEN[1]);
    await expect(page.getByRole('button', { name: 'Afwijzen' })).toBeInViewport({ ratio: 1 });
    await expect(page.getByRole('button', { name: 'Goedkeuren' })).toBeInViewport({ ratio: 1 });
    await expect.poll(async () => (await p.boundingBox())!.height).toBeLessThan(hoog);

    await page.setViewportSize(MATEN[0]);
    await expect.poll(async () => (await p.boundingBox())!.height).toBe(hoog);
    await expect(page.getByRole('button', { name: 'Goedkeuren' })).toBeInViewport({ ratio: 1 });
  });

  test('wie tijdens een lopende beslissing het scherm verlaat en terugkomt, krijgt geen paneel dat vanzelf opengaat', async ({ page }) => {
    const start = DRIE();
    const { patches } = await verlofServer(page, start);
    // De server antwoordt pas als de test het zegt.
    let antwoord = () => {};
    const wacht = new Promise<void>((klaar) => { antwoord = klaar; });
    await page.route('**/api/leave/**', async (route) => {
      if (route.request().method() !== 'PATCH') return route.fallback();
      await wacht;
      return route.fallback();
    });
    await page.goto('/verlof/w1');
    await expect(paneelKop(page, ALEX)).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: 'Goedkeuren' }).click();
    const zijbalk = page.getByRole('navigation', { name: 'Zijbalk' });
    await zijbalk.getByRole('button', { name: 'Dashboard', exact: true }).click();
    await expect.poll(() => pad(page)).toBe('/');
    // De knop draagt ook zijn teller ("Verlof 3"); "Verlofkalender" is een andere.
    await zijbalk.getByRole('button', { name: /^Verlof( \d+)?$/ }).click();
    await expect(page.getByText('Wachtend op goedkeuring')).toBeVisible();
    expect(pad(page)).toBe('/verlof');

    antwoord();
    await expect.poll(() => patches.length).toBe(1);
    // De beslissing is gelukt en gemeld, maar het paneel blijft dicht.
    await expect(page.getByText(`Verlof goedgekeurd: ${ALEX}, ${periode(start[0])}.`)).toBeVisible();
    await page.waitForTimeout(400);
    expect(pad(page)).toBe('/verlof');
    await expect(paneelKop(page, DIETHER)).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Goedkeuren' })).toHaveCount(0);
  });

  test('een gescrolde pagina: het paneel van een andere rij komt in beeld, met zijn knoppen en zijn naam vrij onder de topbar, ook na het doorschakelen', async ({ page }) => {
    await page.setViewportSize(MATEN[1]);
    const { verlof, planning } = zwaar();
    const { patches } = await verlofServer(page, [...verlof, aanvraag('w2', '44', 12, 13)], { planning });
    await page.goto('/verlof');
    await expect(page.getByText('Wachtend op goedkeuring')).toBeVisible({ timeout: 15_000 });
    // Een stuk omlaag, zodat de bovenkant van de kolom uit beeld is.
    const rij = page.getByRole('button', { name: new RegExp(`^${ALEX}`) });
    await page.locator('[data-scroll-root]').evaluate((el) => { el.scrollTop = 260; });
    await expect(rij).toBeInViewport();
    await rij.click();
    const p = paneel(page, ALEX);
    await expect(p).toBeVisible();
    await paginaRust(page);
    await expect(p.getByRole('heading', { name: ALEX })).toBeInViewport({ ratio: 1 });
    // De naam staat niet achter de plakkende topbar: de beslisser ziet over wie het gaat.
    await expect.poll(() => titelOnderTopbar(page, ALEX), 'de naam van de geopende aanvraag ligt achter de topbar').toBeGreaterThanOrEqual(0);
    await expect(page.getByRole('button', { name: 'Afwijzen' })).toBeInViewport({ ratio: 1 });
    await expect(page.getByRole('button', { name: 'Goedkeuren' })).toBeInViewport({ ratio: 1 });

    // Na Goedkeuren toont het paneel de volgende: ook haar naam staat vrij in beeld.
    await page.getByRole('button', { name: 'Goedkeuren' }).click();
    await expect(paneelKop(page, DIETHER)).toBeVisible();
    await expect.poll(() => patches.length).toBe(1);
    await paginaRust(page);
    await expect.poll(() => titelOnderTopbar(page, DIETHER), 'de naam van de volgende aanvraag ligt achter de topbar').toBeGreaterThanOrEqual(0);
    await expect(page.getByRole('button', { name: 'Goedkeuren' })).toBeInViewport({ ratio: 1 });
  });
});

/**
 * Doorschakelen alleen waar de bevestiging de kop van het paneel vrijlaat
 * (herstelronde 2). Gemeten op 11-11 in Chromium en WebKit, zelfde cijfers,
 * op 720 en 900 px hoog. De toast staat vanaf 768 px rechtsboven (384 px
 * breed, 16 px van de rand) en ligt daar 4,2 s, terwijl Goedkeuren van de
 * volgende aanvraag na 650 ms weer werkt:
 * - 768 tot 1023 px: het paneel is een SlideOver rechts; de toast ligt over
 *   avatar, naam, aanvraagdatum en sluitknop (384 × 65 px);
 * - 1024 tot 1194 px: de kaart staat naast de lijst, maar de toast overlapt
 *   haar nog horizontaal (71 px op 1024, 39 px op 1100, 0,2 px op 1194). Op
 *   een pagina die bovenaan staat blijft er verticaal ruimte (96 px, 21 px
 *   bij twee toasts); op een gescrolde pagina, waar het paneel onder de topbar
 *   in beeld komt, raakt de toast de kop (bij twee toasts ligt hij over de
 *   sluitknop);
 * - vanaf 1195 px staat de toast naast de kaart (0,2 px op 1195, 35 px op
 *   1279, 4,5 px op 1280 waar de wortelmaat groeit, 71 px op 1440), waar de
 *   pagina ook staat en hoeveel toasts er ook zijn;
 * - onder 768 px staat de toast onderaan, op de iPhone ruim 350 px onder de
 *   kop, ook bij twee toasts.
 * Tussen 768 en 1194 px sluit het paneel dus na elke beslissing, zoals vroeger.
 */
type Rand = { links: number; boven: number; rechts: number; onder: number };
/**
 * De kop van het paneel (de rij met avatar, naam, aanvraagdatum en sluitknop)
 * en de toasts van een beslissing, in px zoals de browser ze tekent.
 */
const kopEnToasts = (page: Page, naam: string) => page.evaluate((n) => {
  const rand = (el: Element): Rand => { const r = el.getBoundingClientRect(); return { links: r.left, boven: r.top, rechts: r.right, onder: r.bottom }; };
  const titel = [...document.querySelectorAll('section[aria-label] h2, [role="dialog"] h2')].find((h) => h.textContent?.trim() === n);
  // De kop: de rij rond de titel waarin ook de sluitknop staat.
  let kop = titel?.parentElement ?? null;
  while (kop && !kop.querySelector('button[aria-label="Sluiten"]')) kop = kop.parentElement;
  const toasts = [...document.querySelectorAll('[role="status"]')].filter((t) => /Verlof (goedgekeurd|afgewezen): /.test(t.textContent ?? ''));
  return { kop: kop ? rand(kop) : null, toasts: toasts.map(rand) };
}, naam);
/** Raken twee vakken elkaar? Een gedeelde rand telt ook. */
const raakt = (a: Rand, b: Rand) => a.links <= b.rechts && b.links <= a.rechts && a.boven <= b.onder && b.boven <= a.onder;
/**
 * Meet zodra de toast binnen is en de pagina stilstaat: geen enkele toast
 * raakt de kop van het paneel van `naam`. `naast`: elke toast begint rechts
 * van de kop (desktop); dat hangt niet af van de plaats van de pagina of van
 * het aantal toasts, en is dus de maat die de grens draagt.
 */
async function verwachtKopVrij(page: Page, naam: string, naast: boolean) {
  await paginaRust(page);
  // De toast komt binnen met een lichte schaal (220 ms): daarna pas meten.
  await page.waitForTimeout(350);
  const { kop, toasts } = await kopEnToasts(page, naam);
  if (!kop) throw new Error(`de kop van het paneel van ${naam} ontbreekt`);
  expect(toasts.length, 'de toast van de beslissing staat nog in beeld').toBeGreaterThan(0);
  for (const toast of toasts) {
    expect(raakt(toast, kop), `de toast ${JSON.stringify(toast)} raakt de kop ${JSON.stringify(kop)}`).toBe(false);
    if (naast) expect(toast.links, 'de toast begint rechts van de kop van het paneel').toBeGreaterThanOrEqual(kop.rechts);
    else expect(toast.boven, 'de toast staat onder de kop van het paneel').toBeGreaterThan(kop.onder);
  }
}
const toastVan = (page: Page, naam: string, r: Verlof) => page.getByText(`Verlof goedgekeurd: ${naam}, ${periode(r)}.`);

test.describe('verlof beslissen: doorschakelen alleen waar de bevestiging de kop van het paneel vrijlaat (desktop)', () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) < 1024, 'de breedtes van een venster op desktop; de telefoon heeft zijn eigen meting hieronder');

  test('960 × 720: na Goedkeuren sluit het paneel, er vertrekt precies één PATCH, de toast noemt naam en periode en je staat weer op de lijst', async ({ page }) => {
    const fouten: string[] = [];
    page.on('pageerror', (e) => fouten.push(e.message));
    await page.setViewportSize({ width: 960, height: 720 });
    const start = DRIE();
    const { patches } = await verlofServer(page, start);
    await page.goto('/verlof/w1');
    // Op deze breedte is het paneel een SlideOver rechts, waar ook de toast komt.
    await expect(page.getByRole('dialog', { name: ALEX })).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: 'Goedkeuren' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(toastVan(page, ALEX, start[0])).toBeVisible();
    await expect.poll(() => pad(page)).toBe('/verlof');
    // De volgende opent niet vanzelf, ook niet even later; de twee anderen wachten nog.
    await page.waitForTimeout(600);
    await expect(paneelKop(page, DIETHER)).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Goedkeuren' })).toHaveCount(0);
    expect(patches, 'precies één PATCH').toHaveLength(1);
    expect(patches[0]).toMatchObject({ id: 'w1', body: { status: 'approved', ifStatus: 'pending' } });
    await expect(page.getByRole('button', { name: new RegExp(`^${DIETHER}`) })).toBeVisible();
    await expect(page.getByRole('button', { name: new RegExp(`^${TEST}`) })).toBeVisible();
    await kanScrollen(page);
    await historiekOpgeruimd(page);
    expect(fouten, `page errors:\n${fouten.join('\n')}`).toEqual([]);
  });

  test('960 × 720: afwijzen met een reden sluit het paneel ook, met de reden in de PATCH', async ({ page }) => {
    await page.setViewportSize({ width: 960, height: 720 });
    const start = DRIE();
    const { patches } = await verlofServer(page, start);
    await page.goto('/verlof/w1');
    await expect(page.getByRole('dialog', { name: ALEX })).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: 'Afwijzen' }).click();
    await page.getByLabel('Reden van afwijzing').fill('Te veel collega\'s al vrij.');
    await page.getByRole('button', { name: 'Afwijzen' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByText(`Verlof afgewezen: ${ALEX}, ${periode(start[0])}.`)).toBeVisible();
    await expect.poll(() => pad(page)).toBe('/verlof');
    await page.waitForTimeout(400);
    await expect(paneelKop(page, DIETHER)).toHaveCount(0);
    expect(patches).toHaveLength(1);
    expect(patches[0]).toMatchObject({ id: 'w1', body: { status: 'rejected', ifStatus: 'pending', reden: 'Te veel collega\'s al vrij.' } });
  });

  test('960 × 720: "Ook aangevraagd voor deze periode" wisselt het paneel ook daar, zonder toast; pas de beslissing sluit het', async ({ page }) => {
    await page.setViewportSize({ width: 960, height: 720 });
    const start = DRIE();
    const { patches } = await verlofServer(page, start);
    await page.goto('/verlof/w1');
    await expect(page.getByRole('dialog', { name: ALEX })).toBeVisible({ timeout: 15_000 });
    // De planner kiest hier zelf een naam: er komt geen toast over de kop.
    await paneel(page, ALEX).getByText('Ook aangevraagd voor deze periode').locator('xpath=..').getByRole('button').first().click();
    await expect(paneelKop(page, DIETHER)).toBeVisible();
    await expect(paneelKop(page, DIETHER)).toBeFocused();
    expect(pad(page)).toBe('/verlof/w2');
    await page.waitForTimeout(300);
    await expect(page.getByText(/Verlof (goedgekeurd|afgewezen)/)).toHaveCount(0);
    expect(patches).toEqual([]);
    // Na het slot (locator.click wacht daarop) beslist Goedkeuren over Diether, en dan sluit het paneel.
    await page.getByRole('button', { name: 'Goedkeuren' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(toastVan(page, DIETHER, start[1])).toBeVisible();
    await expect.poll(() => pad(page)).toBe('/verlof');
    expect(patches).toHaveLength(1);
    expect(patches[0]).toMatchObject({ id: 'w2', body: { status: 'approved', ifStatus: 'pending' } });
  });

  // De regel op haar twee grenzen, en net ernaast.
  const GRENZEN = [
    { breedte: 767, door: true },
    { breedte: 768, door: false },
    { breedte: 1023, door: false },
    { breedte: 1024, door: false },
    { breedte: 1194, door: false },
    { breedte: 1195, door: true },
  ];
  for (const { breedte, door } of GRENZEN) {
    test(`${breedte} px breed: na Goedkeuren ${door ? 'opent de volgende, de toast raakt de kop niet' : 'sluit het paneel'}`, async ({ page }) => {
      await page.setViewportSize({ width: breedte, height: 720 });
      const start = DRIE();
      const { patches } = await verlofServer(page, start);
      await page.goto('/verlof/w1');
      await expect(paneelKop(page, ALEX)).toBeVisible({ timeout: 15_000 });
      await page.getByRole('button', { name: 'Goedkeuren' }).click();
      await expect(toastVan(page, ALEX, start[0])).toBeVisible();
      if (door) {
        await expect(paneelKop(page, DIETHER)).toBeVisible();
        expect(pad(page)).toBe('/verlof/w2');
        await verwachtKopVrij(page, DIETHER, breedte >= 768);
      } else {
        await expect(paneel(page, ALEX)).toHaveCount(0);
        await expect.poll(() => pad(page)).toBe('/verlof');
        await page.waitForTimeout(400);
        await expect(paneelKop(page, DIETHER)).toHaveCount(0);
        await expect(page.getByRole('button', { name: 'Goedkeuren' })).toHaveCount(0);
      }
      expect(patches).toHaveLength(1);
      expect(patches[0]).toMatchObject({ id: 'w1', body: { status: 'approved', ifStatus: 'pending' } });
    });
  }

  // De vaste meting waar het paneel wel doorschakelt. Op een gescrolde pagina:
  // daar komt het paneel onder de topbar in beeld, zo dicht bij de toast als
  // het kan. En twee beslissingen na elkaar: dan staan er twee toasts.
  for (const maat of [{ width: 1195, height: 720 }, { width: 1280, height: 720 }, { width: 1440, height: 900 }]) {
    test(`${maat.width} × ${maat.height}: het paneel schakelt door en de toast staat naast de kop, ook op een gescrolde pagina en na een tweede beslissing`, async ({ page }) => {
      await page.setViewportSize(maat);
      const start = DRIE();
      const { patches } = await verlofServer(page, start);
      await page.goto('/verlof');
      await expect(page.getByText('Wachtend op goedkeuring')).toBeVisible({ timeout: 15_000 });
      await page.locator('[data-scroll-root]').evaluate((el) => { el.scrollTop = 260; });
      await page.getByRole('button', { name: new RegExp(`^${ALEX}`) }).click();
      await expect(paneelKop(page, ALEX)).toBeVisible();
      await paginaRust(page);
      // De pagina staat echt gescrold; het paneel hangt dan vlak onder de topbar.
      expect(await page.locator('[data-scroll-root]').evaluate((el) => el.scrollTop), 'de pagina is gescrold').toBeGreaterThan(0);

      await page.getByRole('button', { name: 'Goedkeuren' }).click();
      await expect(paneelKop(page, DIETHER)).toBeVisible();
      await expect(toastVan(page, ALEX, start[0])).toBeVisible();
      await verwachtKopVrij(page, DIETHER, true);
      expect(await page.locator('[data-scroll-root]').evaluate((el) => el.scrollTop), 'de pagina is nog gescrold na het doorschakelen').toBeGreaterThan(0);

      await page.getByRole('button', { name: 'Goedkeuren' }).click();
      await expect(paneelKop(page, TEST)).toBeVisible();
      await expect(toastVan(page, DIETHER, start[1])).toBeVisible();
      await verwachtKopVrij(page, TEST, true);
      expect(patches).toHaveLength(2);
    });
  }

  test('de opstelling telt bij de beslissing, niet bij het laden: versmald na het laden sluit het paneel, verbreed schakelt het door', async ({ page }) => {
    // Geladen op 1280 px (de kaart naast de lijst), daarna versleept naar 960 px.
    await page.setViewportSize({ width: 1280, height: 720 });
    const start = DRIE();
    const { patches } = await verlofServer(page, start);
    await page.goto('/verlof/w1');
    await expect(page.locator(`section[aria-label="${ALEX}"]`)).toBeVisible({ timeout: 15_000 });
    await page.setViewportSize({ width: 960, height: 720 });
    await expect(page.getByRole('dialog', { name: ALEX })).toBeVisible();
    await page.getByRole('button', { name: 'Goedkeuren' }).click();
    await expect(paneel(page, ALEX)).toHaveCount(0);
    await expect(toastVan(page, ALEX, start[0])).toBeVisible();
    await expect.poll(() => pad(page)).toBe('/verlof');
    await page.waitForTimeout(400);
    await expect(paneelKop(page, DIETHER)).toHaveCount(0);
    expect(patches).toHaveLength(1);

    // Omgekeerd: op 960 px de volgende openen, verbreden naar 1280 px, beslissen.
    await page.getByRole('button', { name: new RegExp(`^${DIETHER}`) }).click();
    await expect(page.getByRole('dialog', { name: DIETHER })).toBeVisible();
    await page.setViewportSize({ width: 1280, height: 720 });
    await expect(page.locator(`section[aria-label="${DIETHER}"]`)).toBeVisible();
    await page.getByRole('button', { name: 'Goedkeuren' }).click();
    await expect(paneelKop(page, TEST)).toBeVisible();
    expect(pad(page)).toBe('/verlof/w3');
    expect(patches).toHaveLength(2);
    expect(patches[1]).toMatchObject({ id: 'w2', body: { status: 'approved', ifStatus: 'pending' } });
  });
});

test.describe('verlof beslissen: op de telefoon blijft de kop vrij', () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) >= 768, 'de telefoon: de toast staat onderaan');

  test('het paneel schakelt door en de toast staat onderaan, ver onder de kop, ook na een tweede beslissing', async ({ page }) => {
    const start = DRIE();
    const { patches } = await verlofServer(page, start);
    await page.goto('/verlof/w1');
    await expect(paneelKop(page, ALEX)).toBeVisible({ timeout: 15_000 });

    await page.getByRole('button', { name: 'Goedkeuren' }).click();
    await expect(paneelKop(page, DIETHER)).toBeVisible();
    await expect(toastVan(page, ALEX, start[0])).toBeVisible();
    await verwachtKopVrij(page, DIETHER, false);

    await page.getByRole('button', { name: 'Goedkeuren' }).click();
    await expect(paneelKop(page, TEST)).toBeVisible();
    await expect(toastVan(page, DIETHER, start[1])).toBeVisible();
    await verwachtKopVrij(page, TEST, false);
    expect(patches).toHaveLength(2);
  });
});
