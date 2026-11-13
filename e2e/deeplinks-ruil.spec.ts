import { test, expect, type Locator, type Page } from '@playwright/test';
import { ADMIN, CHAUFFEUR, historiekOpgeruimd, seed, type Extra } from './helpers';
import { SWAPS } from '../scripts/audit-fixtures.mjs';
import { logIn, vandaagIso, zonderSessie } from './deeplinkHulp';

/**
 * Deeplinks V1, dienstruil (tranche 3C, 23-09): `/dienstruil/<id>` opent die
 * ene ruil. Staf krijgt het beoordelingspaneel (een SlideOver, ook op
 * desktop); een chauffeur de ruil in zijn eigen lijst, open en in beeld, of
 * een alleen-lezen kaart als ze daar niet (meer) staat. Wat niet in zijn
 * gegevens staat geeft één nette melding.
 *
 * Fixture sw1: Alex Du Priez (43) vraagt de testchauffeur (42), pending,
 * dienst van morgen. De extra ruilen hieronder dekken de andere gevallen.
 */

const ALEX = 'Alex Du Priez';
const pad = (page: Page) => new URL(page.url()).pathname;
const paneel = (page: Page, naam = ALEX) => page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: naam, exact: true }) });
const onbekend = (page: Page) => page.getByText('Deze dienstruil is niet beschikbaar');

const nu = new Date().toISOString();
/** Eigen verzoek van de testchauffeur aan Diether (44). */
const SW2 = { id: 'sw2', shiftId: 't1', requesterId: '42', targetDriverId: '44', status: 'pending', reason: 'Afspraak', createdAt: nu, returnDate: SWAPS[0].returnDate, returnCode: 'VRIJ' };
/** Afgehandelde ruil waarin de testchauffeur de collega was: in geen lijst meer. */
const SW3 = { id: 'sw3', shiftId: 's1', requesterId: '43', targetDriverId: '42', status: 'rejected', reason: '', createdAt: nu, decidedAt: nu, returnDate: SWAPS[0].returnDate, returnCode: 'VRIJ' };
/** Ruil tussen twee collega's: een chauffeur krijgt hem nooit van de server. */
const SW9 = { id: 'sw9', shiftId: 's2', requesterId: '43', targetDriverId: '44', status: 'pending', reason: 'Geheim', createdAt: nu, returnDate: SWAPS[0].returnDate, returnCode: 'VRIJ' };
/** Geaccepteerde ruil op een dienst van vandaag (fixture t1, 2101): staat op Vandaag. */
const SW4 = { id: 'sw4', shiftId: 't1', requesterId: '42', targetDriverId: '43', status: 'accepted', reason: '', createdAt: nu, shiftDate: vandaagIso(0), shiftLine: '2101', returnDate: vandaagIso(5), returnCode: 'vrij' };
const ALLE = [...SWAPS, SW2, SW3, SW9, SW4];

/** Zoals GET /api/swaps: staf alles, een chauffeur alleen waar hij bij betrokken is. */
const ruilenVoor = (userId: string | null): Extra => (p) => {
  if (!p.endsWith('/api/swaps')) return undefined;
  return userId ? ALLE.filter((s) => s.requesterId === userId || s.targetDriverId === userId) : ALLE;
};

test.describe('ruil-deeplink met sessie', () => {
  test('staf: de link opent het beoordelingspaneel van die ruil, ook na herladen', async ({ page }) => {
    await seed(page, { user: ADMIN, extra: ruilenVoor(null) });
    await page.goto('/dienstruil/sw1');
    await expect(paneel(page)).toBeVisible();
    await page.reload();
    await expect(paneel(page)).toBeVisible();
    expect(pad(page)).toBe('/dienstruil/sw1');
    await expect(page.getByRole('dialog')).toHaveCount(1);
  });

  test('staf: sluiten haalt het id uit de URL', async ({ page }) => {
    await seed(page, { user: ADMIN, extra: ruilenVoor(null) });
    await page.goto('/dienstruil/sw1');
    await expect(paneel(page)).toBeVisible();
    await paneel(page).getByRole('button', { name: 'Sluiten' }).first().click();
    await expect(paneel(page)).toHaveCount(0);
    await expect.poll(() => pad(page)).toBe('/dienstruil');
  });

  test('chauffeur als collega: de openstaande vraag in beeld, met de focus erop', async ({ page }) => {
    await seed(page, { user: CHAUFFEUR, extra: ruilenVoor('42') });
    await page.goto('/dienstruil/sw1');
    const kaart = page.locator('[data-record="sw1"]');
    await expect(kaart).toBeInViewport();
    await expect(kaart).toBeFocused();
    // Een chauffeur krijgt nooit het staf-paneel met beslisknoppen.
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('chauffeur als aanvrager: zijn eigen verzoek open en in beeld', async ({ page }) => {
    await seed(page, { user: CHAUFFEUR, extra: ruilenVoor('42') });
    await page.goto('/dienstruil/sw2');
    const titel = page.locator('[data-record="sw2"]');
    await expect(titel).toBeInViewport();
    await expect(titel.locator('xpath=ancestor::button[1]')).toHaveAttribute('aria-expanded', 'true');
  });

  test('afgehandelde ruil die in geen lijst meer staat: alleen-lezen kaart', async ({ page }) => {
    await seed(page, { user: CHAUFFEUR, extra: ruilenVoor('42') });
    await page.goto('/dienstruil/sw3');
    const kaart = page.locator('[data-record="sw3"]');
    await expect(kaart).toBeVisible();
    await expect(kaart.getByRole('heading', { name: 'Dienstruil' })).toBeVisible();
    await expect(kaart.getByRole('button', { name: /goedkeuren|afwijzen|accepteren|weigeren/i })).toHaveCount(0);
    await kaart.getByRole('button', { name: 'Sluiten' }).click();
    await expect(kaart).toHaveCount(0);
    expect(pad(page)).toBe('/dienstruil');
  });

  test('niet-bestaand record: nette melding', async ({ page }) => {
    await seed(page, { user: ADMIN, extra: ruilenVoor(null) });
    await page.goto('/dienstruil/bestaat-niet');
    await expect(onbekend(page)).toBeVisible();
    await page.getByRole('status').filter({ hasText: 'niet beschikbaar' }).getByRole('button', { name: 'Sluiten' }).click();
    await expect(onbekend(page)).toHaveCount(0);
    expect(pad(page)).toBe('/dienstruil');
  });

  test('verwijderd record: na herladen verdwenen, dezelfde nette melding', async ({ page }) => {
    let weg = false;
    await seed(page, { user: ADMIN, extra: (p) => (p.endsWith('/api/swaps') ? (weg ? ALLE.filter((s) => s.id !== 'sw1') : ALLE) : undefined) });
    await page.goto('/dienstruil/sw1');
    await expect(paneel(page)).toBeVisible();
    weg = true;
    // Sinds 15-10 zoekt het scherm een ruil buiten de lijst nog één keer op
    // (GET /api/swaps/:id, voor oude ruilen buiten het venster); een
    // verwijderde ruil kent de server daar ook niet meer.
    await page.route('**/api/swaps/sw1', (route) => route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'Deze dienstruil is niet beschikbaar.' }) }));
    await page.reload();
    await expect(onbekend(page)).toBeVisible();
    await expect(paneel(page)).toHaveCount(0);
  });

  test('geen recht: een chauffeur op een ruil tussen twee collega’s ziet er niets van', async ({ page }) => {
    await seed(page, { user: CHAUFFEUR, extra: ruilenVoor('42') });
    await page.goto('/dienstruil/sw9');
    await expect(onbekend(page)).toBeVisible();
    await expect(page.getByText('Geheim')).toHaveCount(0);
    await expect(page.locator('[data-record="sw9"]')).toHaveCount(0);
  });
});

test.describe('ruil-deeplink vanuit het portaal', () => {
  /** Het paneel is een SlideOver (ook op desktop): eerst sluit terug het paneel, dan ben je terug. */
  async function terugNaar(page: Page, herkomst: string) {
    await page.goBack();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    if (pad(page) !== herkomst) await page.goBack();
    await expect.poll(() => pad(page)).toBe(herkomst);
  }

  test('dashboard → ruil, terug = dashboard', async ({ page }) => {
    await seed(page, { user: ADMIN, extra: ruilenVoor(null) });
    await page.goto('/');
    await page.getByText(`Dienstruil · ${ALEX} → Test Chauffeur`).first().click();
    await expect(paneel(page)).toBeVisible();
    expect(pad(page)).toBe('/dienstruil/sw1');
    await terugNaar(page, '/');
  });

  test('Vandaag → dezelfde ruil', async ({ page }) => {
    await seed(page, { user: ADMIN, extra: ruilenVoor(null) });
    await page.goto('/vandaag');
    await page.getByRole('button', { name: /Dienst 2101/ }).filter({ hasText: 'wacht op validatie' }).click();
    await expect(paneel(page, 'Test Chauffeur')).toBeVisible();
    expect(pad(page)).toBe('/dienstruil/sw4');
    await terugNaar(page, '/vandaag');
  });

  test('melding → dezelfde ruil', async ({ page }) => {
    await seed(page, {
      user: ADMIN,
      extra: (p, r) => (p.endsWith('/api/meldingen')
        ? { meldingen: [{ id: 'm1', titel: 'Dienstruil wacht op validatie', tekst: 'Rij- en rusttijden checken.', soort: 'ruil', doel: 'dienstruil/sw1', createdAt: nu }], ongelezen: 1 }
        : ruilenVoor(null)(p, r)),
    });
    await page.goto('/meldingen');
    await page.getByText('Dienstruil wacht op validatie').click();
    await expect(paneel(page)).toBeVisible();
    expect(pad(page)).toBe('/dienstruil/sw1');
    await terugNaar(page, '/meldingen');
  });
});

test.describe('ruil-deeplink zonder sessie', () => {
  test('link → inloggen → dezelfde ruil', async ({ page }) => {
    await zonderSessie(page, ADMIN, ruilenVoor(null));
    await page.goto('/dienstruil/sw1');
    await expect(page.getByRole('button', { name: 'Inloggen' })).toBeVisible();
    await logIn(page);
    await expect(paneel(page)).toBeVisible();
    expect(pad(page)).toBe('/dienstruil/sw1');
  });
});

/**
 * Ronde 6, punt 16: de beheertabel op desktop. De rustwaarschuwing staat in de
 * rij; bij zo'n rij opent Goedkeuren (ook "Direct goedkeuren" van de admin)
 * eerst dit beoordelingspaneel, waar de rustregels staan en goedkeuren nog
 * altijd kan (een waarschuwing, geen blokkade). Afwijzen in de rij vraagt
 * altijd eerst een bevestiging. Rijen zonder waarschuwing en de telefoonlijst
 * bleven zoals ze waren.
 *
 * De tests staan hier omdat deze spec in de drie projecten draait: een nieuwe
 * spec komt pas in het desktopproject als haar naam in DESKTOP_SPECS
 * (playwright.config.ts) staat.
 */

/** md: vanaf hier bestaat de tabel (`hidden md:block`), daaronder de lijst (`md:hidden`). */
const TABEL_VANAF = 768;
const TEST_CHAUFFEUR = 'Test Chauffeur';
const PLANNER = { id: '9', name: 'Els Goossens', role: 'planner', employeeId: 'VHB-000009', email: 'els@vhb.be', isActive: true };
const RUST_DAG = vandaagIso(10);
const TE_KORT = [{ wie: 'collega', datum: RUST_DAG, dienst: '2505', rustVoor: 340, rustNa: null, teKort: true }];
const GENOEG = [{ wie: 'collega', datum: RUST_DAG, dienst: '2505', rustVoor: 660, rustNa: null, teKort: false }];
type Ruil = Record<string, unknown> & { id: string };
/** Ruil van de testchauffeur (42) met Alex (43), de collega ging akkoord. */
const teBeoordelen = (extra: Record<string, unknown> = {}): Ruil => ({
  id: 'rr1', shiftId: 'x1', requesterId: '42', targetDriverId: '43', status: 'accepted', reason: '', createdAt: nu,
  shiftDate: RUST_DAG, shiftLine: '2505', returnDate: vandaagIso(14), returnCode: 'vrij', ...extra,
});

/** GET /api/swaps geeft `ruilen`; elke PATCH wordt genoteerd en beantwoord
 *  zoals de server: het record met de nieuwe status, en `rust` alleen zolang
 *  de ruil nog beslist moet worden. `schrijf` noteert daarnaast ELK verzoek
 *  naar /api/swaps dat geen GET is (ook een POST op de lijst of een ander pad
 *  onder een ruil): "niets beslist" is daar "geen enkel schrijfverzoek". */
function ruilServer(ruilen: Ruil[]) {
  const patches: Array<{ id: string; body: unknown }> = [];
  const schrijf: Array<{ methode: string; pad: string; body: unknown }> = [];
  const extra: Extra = (p, request) => {
    if (p.includes('/api/swaps') && request.method() !== 'GET') {
      let body: unknown = request.postData();
      try { body = JSON.parse(request.postData() ?? 'null'); } catch { /* geen JSON: de rauwe tekst */ }
      schrijf.push({ methode: request.method(), pad: p.slice(p.indexOf('/api/swaps')), body });
    }
    const een = /\/api\/swaps\/([^/]+)$/.exec(p);
    if (een && request.method() === 'PATCH') {
      const body = JSON.parse(request.postData() ?? '{}') as { status: string };
      patches.push({ id: een[1], body });
      const i = ruilen.findIndex((r) => r.id === een[1]);
      const { rust: _rust, ...zonderRust } = ruilen[i];
      ruilen[i] = { ...(body.status === 'pending' || body.status === 'accepted' ? ruilen[i] : zonderRust), status: body.status };
      return { swap: ruilen[i] };
    }
    return p.endsWith('/api/swaps') ? ruilen : undefined;
  };
  return { patches, schrijf, extra };
}

const rijVan = (page: Page, dienst = '2505') => page.getByRole('table', { name: 'Dienstruilen' }).getByRole('row').filter({ hasText: `Dienst ${dienst}` });
const afwijsVraag = (page: Page) => page.getByRole('dialog', { name: 'Dienstruil afwijzen?' });
/** Het midden van een knop, zodra ze stilstaat en zelf de klik op die plek
 *  krijgt (het paneel staat ook zonder beweging pas een beeldje later op zijn
 *  plaats). */
const midden = async (knop: Locator) => {
  let punt = { x: -1, y: -1 };
  await expect.poll(async () => {
    const vak = await knop.boundingBox();
    if (!vak) return false;
    const plek = { x: Math.round(vak.x + vak.width / 2), y: Math.round(vak.y + vak.height / 2) };
    const stil = plek.x === punt.x && plek.y === punt.y;
    punt = plek;
    return stil && await knop.evaluate((el, p) => el.contains(document.elementFromPoint(p.x, p.y)), plek);
  }).toBe(true);
  return punt;
};
type Punt = { x: number; y: number };
/** Krijgt deze knop zelf de klik op dit punt? Vlak voor een herhaalde klik: valt
 *  hij niet op de voetknop (ze ligt elders, of de tijdgrendel laat de klik nog
 *  door de voet heen vallen), dan bewijst "geen verzoek" niets. */
const ligtOp = (knop: Locator, punt: Punt) => knop.evaluate((el, p) => el.contains(document.elementFromPoint(p.x, p.y)), punt);
/** Meet waar een voetknop van het paneel ligt (open via de naam, meet, sluit)
 *  en maakt het venster zo hoog dat de rijknop op de lijn van de voet ligt: de
 *  stand waarin een herhaalde klik op de plek van de rijknop op de voet valt.
 *  Geeft het midden van de rijknop terug, het vaste punt van de proef. */
async function rijknopOpVoetlijn(page: Page, rij: Locator, rijKnop: Locator, voetKnop: Locator): Promise<Punt> {
  const open = paneel(page, TEST_CHAUFFEUR);
  const venster = page.viewportSize()!;
  await rij.getByRole('button', { name: new RegExp(TEST_CHAUFFEUR) }).click();
  const voet = await midden(voetKnop);
  await page.keyboard.press('Escape');
  await expect(open).toHaveCount(0);
  await historiekOpgeruimd(page);
  const rijVoor = await midden(rijKnop);
  await page.setViewportSize({ width: venster.width, height: rijVoor.y + (venster.height - voet.y) });
  return midden(rijKnop);
}
/** Een ander punt op dezelfde voetknop, 40 px opzij van `punt`. */
async function opzijOpKnop(knop: Locator, punt: Punt): Promise<Punt> {
  const vak = (await knop.boundingBox())!;
  const opzij = { x: punt.x - 40 > vak.x + 4 ? punt.x - 40 : punt.x + 40, y: punt.y };
  expect(opzij.x > vak.x && opzij.x < vak.x + vak.width, 'het tweede punt ligt op dezelfde knop').toBe(true);
  return opzij;
}
/** Na een geslikte klik of tik: de focus staat op het venster zelf (het paneel
 *  of de bevestiging), niet op een knop die beslist, en spatie en Enter doen
 *  niets. De aanroeper kijkt daarna na dat er niets verstuurd of geopend is. */
async function geenToetsBeslist(page: Page, venster: Locator, wanneer: string) {
  await expect(venster, `${wanneer} staat de focus op het venster, niet op een knop`).toBeFocused();
  await page.keyboard.press('Space');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
}
/** Schuift de strook van de tabel helemaal naar rechts, zodat de kolom Acties
 *  in beeld staat (768 px met een goedgekeurde rij: de tabel is breder dan haar
 *  kader). Geeft terug of er een strook was die schuift. */
const schuifNaarActies = (knop: Locator) => knop.evaluate((el) => {
  let strook = el.parentElement;
  while (strook && !(strook.scrollWidth > strook.clientWidth + 1 && /auto|scroll/.test(getComputedStyle(strook).overflowX))) strook = strook.parentElement;
  if (strook) strook.scrollLeft = strook.scrollWidth;
  return !!strook;
});
/** Meet waar de bevestigknop van "Dienstruil afwijzen?" ligt (open via de
 *  rijknop, meet, sluit) en maakt het venster zo hoog dat Afwijzen van de rij
 *  op de lijn van die knop ligt. De bevestiging staat verticaal in het midden:
 *  met een venster van h hoog ligt haar knop op h/2 + d. Geeft een punt terug
 *  dat op de rijknop ligt en, zodra de vraag open staat, op de bevestigknop. */
async function rijknopOpVraagknop(page: Page, rijKnop: Locator, vraagKnop: Locator): Promise<Punt> {
  const venster = page.viewportSize()!;
  expect(await schuifNaarActies(rijKnop), 'de tabel is breder dan haar kader en schuift').toBe(true);
  await rijKnop.click();
  const knop = await midden(vraagKnop);
  const knopVak = (await vraagKnop.boundingBox())!;
  await page.keyboard.press('Escape');
  await expect(vraagKnop).toHaveCount(0);
  await historiekOpgeruimd(page);
  const rijVoor = await midden(rijKnop);
  await page.setViewportSize({ width: venster.width, height: Math.round(2 * (rijVoor.y - (knop.y - venster.height / 2))) });
  await schuifNaarActies(rijKnop);
  const rij = await midden(rijKnop);
  const rijVak = (await rijKnop.boundingBox())!;
  const links = Math.max(rijVak.x, knopVak.x);
  const rechts = Math.min(rijVak.x + rijVak.width, knopVak.x + knopVak.width);
  expect(rechts - links, 'Afwijzen van de rij en de bevestigknop overlappen').toBeGreaterThan(6);
  return { x: Math.round((links + rechts) / 2), y: rij.y };
}

test.describe('beheertabel op desktop: rustwaarschuwing in de rij, afwijzen met bevestiging', () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) < TABEL_VANAF, 'De beheertabel bestaat pas vanaf 768 px; op de telefoon staat de ruil in de lijst (zie het blok hieronder).');

  test('te weinig rust staat in de rij; Goedkeuren opent eerst het paneel en daar kan goedkeuren nog', async ({ page }) => {
    const { patches, extra } = ruilServer([teBeoordelen({ rust: TE_KORT })]);
    await seed(page, { user: ADMIN, extra });
    await page.goto('/dienstruil');
    const rij = rijVan(page);
    await expect(rij.getByText('Te weinig rust')).toBeVisible();
    // De naam en de title van de knop zeggen wat de klik doet; de gewone knop staat er niet.
    await expect(rij.getByRole('button', { name: 'Goedkeuren', exact: true })).toHaveCount(0);
    const knop = rij.getByRole('button', { name: 'Goedkeuren, bekijk eerst de rusttijd', exact: true });
    await expect(knop).toHaveAttribute('title', 'Bekijk eerst de rusttijd');
    await knop.click();

    const open = paneel(page, TEST_CHAUFFEUR);
    await expect(open.getByRole('region', { name: 'Rusttijd' })).toContainText(`Te weinig rust: ${ALEX}, dienst 2505`);
    expect(pad(page)).toBe('/dienstruil/rr1');
    expect(patches, 'openen beslist niets').toEqual([]);

    // Een waarschuwing, geen blokkade.
    await open.getByRole('button', { name: 'Goedkeuren', exact: true }).click();
    await expect.poll(() => patches).toEqual([{ id: 'rr1', body: { status: 'approved', ifStatus: 'accepted' } }]);
    await expect(open).toHaveCount(0);
    // Goedgekeurd: de rij blijft staan (Afhandelen), de waarschuwing is weg.
    await expect(rij.getByRole('button', { name: 'Afhandelen' })).toBeVisible();
    await expect(rij.getByText('Te weinig rust')).toHaveCount(0);
  });

  test('zonder waarschuwing keurt Goedkeuren in één klik goed, zoals vroeger', async ({ page }) => {
    const { patches, extra } = ruilServer([teBeoordelen({ rust: GENOEG })]);
    await seed(page, { user: ADMIN, extra });
    await page.goto('/dienstruil');
    const rij = rijVan(page);
    const knop = rij.getByRole('button', { name: 'Goedkeuren', exact: true });
    await expect(knop).toHaveAttribute('title', 'Goedkeuren (rij-/rusttijden ok)');
    await expect(rij.getByText('Te weinig rust')).toHaveCount(0);
    await knop.click();
    await expect.poll(() => patches).toEqual([{ id: 'rr1', body: { status: 'approved', ifStatus: 'accepted' } }]);
    await expect(rij.getByRole('button', { name: 'Afhandelen' })).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('Afwijzen vraagt eerst een bevestiging; Annuleren doet niets, bevestigen wijst af', async ({ page }) => {
    const { patches, extra } = ruilServer([teBeoordelen()]);
    await seed(page, { user: ADMIN, extra });
    await page.goto('/dienstruil');
    const rij = rijVan(page);
    await rij.getByRole('button', { name: 'Afwijzen' }).click();
    const vraag = afwijsVraag(page);
    // Aanvrager, collega, dienst en dag (als dag, nooit als rauwe ISO-datum).
    await expect(vraag).toContainText(new RegExp(`De aanvraag van ${TEST_CHAUFFEUR} met ${ALEX} voor dienst 2505 op \\S+ \\d{1,2} \\S+( \\d{4})? wordt afgewezen\\.`));
    await expect(vraag).not.toContainText(RUST_DAG);
    expect(patches, 'de vraag beslist niets').toEqual([]);

    await vraag.getByRole('button', { name: 'Annuleren' }).click();
    await expect(vraag).toHaveCount(0);
    await expect(rij.getByRole('button', { name: 'Afwijzen' })).toBeVisible();
    expect(patches, 'Annuleren beslist niets').toEqual([]);

    await rij.getByRole('button', { name: 'Afwijzen' }).click();
    await vraag.getByRole('button', { name: 'Afwijzen' }).click();
    await expect.poll(() => patches).toEqual([{ id: 'rr1', body: { status: 'rejected', ifStatus: 'accepted' } }]);
    await expect(vraag).toHaveCount(0);
    // Afgewezen: de ruil staat niet meer in de tabel van wat nog een beslissing vraagt.
    await expect(page.getByText('Geen dienstruilen om te beoordelen')).toBeVisible();
  });

  test('admin, Direct goedkeuren bij te weinig rust: eerst het paneel, zonder bevestiging of beslissing', async ({ page }) => {
    const { patches, extra } = ruilServer([teBeoordelen({ status: 'pending', rust: TE_KORT })]);
    await seed(page, { user: ADMIN, extra });
    await page.goto('/dienstruil');
    const rij = rijVan(page);
    await expect(rij.getByText('Te weinig rust')).toBeVisible();
    await expect(rij.getByRole('button', { name: 'Direct goedkeuren', exact: true })).toHaveCount(0);
    const knop = rij.getByRole('button', { name: 'Direct goedkeuren, bekijk eerst de rusttijd', exact: true });
    await expect(knop).toHaveAttribute('title', 'Bekijk eerst de rusttijd, collega heeft nog niet bevestigd');
    await knop.click();

    const open = paneel(page, TEST_CHAUFFEUR);
    await expect(open.getByRole('region', { name: 'Rusttijd' })).toContainText('Te weinig rust');
    await expect(page.getByRole('dialog', { name: 'Direct goedkeuren' })).toHaveCount(0);
    expect(patches, 'openen beslist niets').toEqual([]);

    // In het paneel loopt het zoals altijd: de bestaande bevestiging van de admin.
    await open.getByRole('button', { name: 'Goedkeuren', exact: true }).click();
    await page.getByRole('dialog', { name: 'Direct goedkeuren' }).getByRole('button', { name: 'Toch goedkeuren' }).click();
    await expect.poll(() => patches).toEqual([{ id: 'rr1', body: { status: 'approved', ifStatus: 'pending' } }]);
  });

  test('admin, Direct goedkeuren zonder waarschuwing: de bestaande bevestiging, zoals vroeger', async ({ page }) => {
    const { patches, extra } = ruilServer([teBeoordelen({ status: 'pending' })]);
    await seed(page, { user: ADMIN, extra });
    await page.goto('/dienstruil');
    const knop = rijVan(page).getByRole('button', { name: 'Direct goedkeuren', exact: true });
    await expect(knop).toHaveAttribute('title', 'Direct goedkeuren, collega heeft nog niet bevestigd');
    await knop.click();
    const vraag = page.getByRole('dialog', { name: 'Direct goedkeuren' });
    await expect(vraag).toContainText('De collega heeft deze ruil nog niet bevestigd.');
    await expect(paneel(page, TEST_CHAUFFEUR)).toHaveCount(0);
    expect(patches, 'de vraag beslist niets').toEqual([]);
    await vraag.getByRole('button', { name: 'Toch goedkeuren' }).click();
    await expect.poll(() => patches).toEqual([{ id: 'rr1', body: { status: 'approved', ifStatus: 'pending' } }]);
  });

  test('planner bij een ruil die op de collega wacht: de waarschuwing staat er, Afwijzen vraagt ook daar een bevestiging', async ({ page }) => {
    const { patches, extra } = ruilServer([teBeoordelen({ status: 'pending', rust: TE_KORT })]);
    await seed(page, { user: PLANNER, extra });
    await page.goto('/dienstruil');
    const rij = rijVan(page);
    await expect(rij.getByText('Te weinig rust')).toBeVisible();
    await expect(rij.getByText('Wacht op collega').first()).toBeVisible();
    await expect(rij.getByRole('button', { name: /goedkeuren/i })).toHaveCount(0);
    await rij.getByRole('button', { name: 'Afwijzen' }).click();
    const vraag = afwijsVraag(page);
    await expect(vraag).toBeVisible();
    expect(patches, 'de vraag beslist niets').toEqual([]);
    await vraag.getByRole('button', { name: 'Afwijzen' }).click();
    await expect.poll(() => patches).toEqual([{ id: 'rr1', body: { status: 'rejected', ifStatus: 'pending' } }]);
  });

  test('toetsenbord: Enter op Goedkeuren opent het paneel, Enter op Afwijzen de bevestiging; een tweede Enter en Escape beslissen niets', async ({ page }) => {
    const { patches, extra } = ruilServer([teBeoordelen({ rust: TE_KORT })]);
    await seed(page, { user: ADMIN, extra });
    await page.goto('/dienstruil');
    const rij = rijVan(page);
    const open = paneel(page, TEST_CHAUFFEUR);

    // Enter en spatie: de focus staat daarna op het paneel zelf, niet op een knop
    // die beslist. Dezelfde toets nog eens (en nog eens, na de grendel) doet niets.
    for (const toets of ['Enter', 'Space']) {
      await rij.getByRole('button', { name: 'Goedkeuren, bekijk eerst de rusttijd', exact: true }).focus();
      await page.keyboard.press(toets);
      await expect(open.getByRole('region', { name: 'Rusttijd' })).toBeVisible();
      await expect(open, `na ${toets} staat de focus op het paneel`).toBeFocused();
      await page.keyboard.press(toets);
      await page.waitForTimeout(800);
      await page.keyboard.press(toets);
      await expect(open).toBeFocused();
      await page.keyboard.press('Escape');
      await expect(open).toHaveCount(0);
      await historiekOpgeruimd(page);
    }

    await rij.getByRole('button', { name: 'Afwijzen' }).focus();
    await page.keyboard.press('Enter');
    const vraag = afwijsVraag(page);
    await expect(vraag).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(vraag).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(vraag).toHaveCount(0);
    expect(patches, 'niets beslist').toEqual([]);
  });

  test('dubbelklik op Goedkeuren beslist niets, ook niet met de voet van het paneel onder de aanwijzer', async ({ page }) => {
    // De rijknop ligt onder de voet van het paneel dat ze opent. Zonder grendel
    // viel de tweede klik van een dubbelklik daar op Goedkeuren (of, terwijl het
    // paneel nog inschuift, op Afwijzen) en besliste hij meteen. Zonder beweging
    // staat het paneel er direct: het zwaarste geval, en hier het vaste.
    // De klok van de pagina is die van de test (page.clock): de 0,7 s van de
    // grendel verstrijken pas als de test ze laat verstrijken, hoe traag de
    // machine ook is. Zonder dat hing de test aan de wandklok.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.clock.install();
    const { patches, schrijf, extra } = ruilServer([teBeoordelen({ rust: TE_KORT })]);
    await seed(page, { user: ADMIN, extra });
    await page.goto('/dienstruil');
    const rij = rijVan(page);
    const rijKnop = rij.getByRole('button', { name: 'Goedkeuren, bekijk eerst de rusttijd', exact: true });
    const open = paneel(page, TEST_CHAUFFEUR);
    const inPaneel = (naam: string) => open.getByRole('button', { name: naam, exact: true });

    // Waar ligt de voet? Open via de naam, meet, sluit.
    await rij.getByRole('button', { name: new RegExp(TEST_CHAUFFEUR) }).click();
    await expect(inPaneel('Goedkeuren')).toBeVisible();
    const voetGoedkeuren = await midden(inPaneel('Goedkeuren'));
    const voetAfwijzen = await midden(inPaneel('Afwijzen'));
    const venster = page.viewportSize()!;
    await page.keyboard.press('Escape');
    await expect(open).toHaveCount(0);

    // Breng de rijknop op de lijn van die voet: het venster zo hoog dat de rij onderaan ligt.
    const rijVoor = await midden(rijKnop);
    await page.setViewportSize({ width: venster.width, height: rijVoor.y + (venster.height - voetGoedkeuren.y) });
    const klik = await midden(rijKnop);
    const voetLijn = klik.y;

    // De klok staat stil vanaf hier; de test schuift ze zelf op.
    await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
    await page.mouse.click(klik.x, klik.y);
    // 150 ms na de eerste klik, de tweede klik van een dubbelklik. Het paneel
    // staat er: Goedkeuren ligt op de lijn van de rijknop, waar het gemeten is,
    // en de grendel is aan (de voet laat de aanwijzer door).
    await page.clock.runFor(150);
    await expect(open.getByRole('region', { name: 'Rusttijd' })).toBeVisible();
    await expect.poll(async () => {
      const vak = await inPaneel('Goedkeuren').boundingBox();
      return !!vak && Math.abs(vak.y + vak.height / 2 - voetLijn) <= 2 && Math.abs(vak.x + vak.width / 2 - voetGoedkeuren.x) <= 2;
    }, { message: 'Goedkeuren van de voet ligt op de lijn van de rijknop, waar het gemeten is' }).toBe(true);
    const aanwijzerDoor = () => inPaneel('Goedkeuren').evaluate((el) => getComputedStyle(el).pointerEvents);
    expect(await aanwijzerDoor(), 'de grendel is aan').toBe('none');
    await page.mouse.click(klik.x, klik.y);
    await page.mouse.click(voetAfwijzen.x, voetLijn);
    await page.mouse.click(voetGoedkeuren.x, voetLijn);
    // Tot vlak voor het einde van de 0,7 s blijft dat zo.
    await page.clock.runFor(500);
    expect(await aanwijzerDoor(), 'de grendel is nog aan na 650 ms').toBe('none');
    await page.mouse.click(voetGoedkeuren.x, voetLijn);
    await expect(open.getByRole('region', { name: 'Rusttijd' })).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(1);
    expect(schrijf, 'een dubbelklik beslist niets').toEqual([]);

    // De grendel is kort: na 0,7 s beslist de planner gewoon in het paneel.
    await page.clock.runFor(100);
    await expect.poll(aanwijzerDoor, { message: 'de grendel is voorbij' }).toBe('auto');
    await page.clock.resume();
    await inPaneel('Goedkeuren').click();
    await expect.poll(() => patches).toEqual([{ id: 'rr1', body: { status: 'approved', ifStatus: 'accepted' } }]);
  });

  test('via de naam opent het paneel zoals vroeger: de knoppen in de voet werken meteen', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const { patches, extra } = ruilServer([teBeoordelen({ rust: TE_KORT })]);
    await seed(page, { user: ADMIN, extra });
    await page.goto('/dienstruil');
    await rijVan(page).getByRole('button', { name: new RegExp(TEST_CHAUFFEUR) }).click();
    const knop = paneel(page, TEST_CHAUFFEUR).getByRole('button', { name: 'Goedkeuren', exact: true });
    await expect(knop).toBeVisible();
    const plek = await midden(knop);
    // Een kale klik op de plek van de knop: Playwright wacht hier nergens op.
    await page.mouse.click(plek.x, plek.y);
    await expect.poll(() => patches).toEqual([{ id: 'rr1', body: { status: 'approved', ifStatus: 'accepted' } }]);
  });

  test('paneel geopend langs de rijknop: Afwijzen in de voet vraagt de bevestiging; Annuleren doet niets, bevestigen wijst af', async ({ page }) => {
    const { patches, extra } = ruilServer([teBeoordelen({ status: 'pending', rust: TE_KORT })]);
    await seed(page, { user: ADMIN, extra });
    await page.goto('/dienstruil');
    const rijKnop = rijVan(page).getByRole('button', { name: 'Direct goedkeuren, bekijk eerst de rusttijd', exact: true });
    const open = paneel(page, TEST_CHAUFFEUR);
    const vraag = afwijsVraag(page);

    await rijKnop.click();
    await open.getByRole('button', { name: 'Afwijzen', exact: true }).click();
    await expect(vraag).toContainText(new RegExp(`De aanvraag van ${TEST_CHAUFFEUR} met ${ALEX} voor dienst 2505 op \\S+ \\d{1,2} \\S+( \\d{4})? wordt afgewezen\\.`));
    await expect(open).toHaveCount(0);
    await vraag.getByRole('button', { name: 'Annuleren' }).click();
    await expect(vraag).toHaveCount(0);
    expect(patches, 'de vraag en Annuleren beslissen niets').toEqual([]);

    // De status die de admin zag toen de vraag opende gaat mee.
    await rijKnop.click();
    await open.getByRole('button', { name: 'Afwijzen', exact: true }).click();
    await vraag.getByRole('button', { name: 'Afwijzen' }).click();
    await expect.poll(() => patches).toEqual([{ id: 'rr1', body: { status: 'rejected', ifStatus: 'pending' } }]);
  });

  test('daarna via de naam is het paneel weer zoals vroeger: Afwijzen is één klik, na Escape en na de terugknop', async ({ page }) => {
    const { patches, extra } = ruilServer([teBeoordelen({ rust: TE_KORT })]);
    await seed(page, { user: ADMIN, extra });
    await page.goto('/dienstruil');
    const rij = rijVan(page);
    const rijKnop = rij.getByRole('button', { name: 'Goedkeuren, bekijk eerst de rusttijd', exact: true });
    const open = paneel(page, TEST_CHAUFFEUR);

    // Langs de rijknop open en weer dicht: één keer met Escape, één keer met de terugknop.
    await rijKnop.click();
    await expect(open.getByRole('region', { name: 'Rusttijd' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(open).toHaveCount(0);
    await historiekOpgeruimd(page);
    await rijKnop.click();
    await expect(open.getByRole('region', { name: 'Rusttijd' })).toBeVisible();
    await page.goBack();
    await expect(open).toHaveCount(0);
    await expect.poll(() => pad(page)).toBe('/dienstruil');

    // Via de naam: het paneel van altijd, Afwijzen beslist in één klik, zonder vraag.
    await rij.getByRole('button', { name: new RegExp(TEST_CHAUFFEUR) }).click();
    await open.getByRole('button', { name: 'Afwijzen', exact: true }).click();
    await expect.poll(() => patches).toEqual([{ id: 'rr1', body: { status: 'rejected', ifStatus: 'accepted' } }]);
    await expect(afwijsVraag(page)).toHaveCount(0);
  });
});

/**
 * Herstelronde 2 (punt 16), de plaatsgrendel. De rijknop ligt onder de voet van
 * het paneel dat ze opent. De tijdgrendel (0,7 s) dekt een echte dubbelklik,
 * maar wie 0,75 s tot enkele seconden later opnieuw op dezelfde plek klikt ("de
 * eerste klik pakte niet"), keurde goed zonder de rustregels te lezen (gemeten
 * door de nakijker op 768, 1024, 1280 en 1440 px). Zolang de aanwijzer niet weg
 * is geweest van het punt van de openingsklik, doet een klik in de voet op dat
 * punt daarom niets: geen beslissing, geen bevestiging, geen verzoek.
 *
 * De proef van de nakijker als vaste test: kale page.mouse.click op vaste
 * coördinaten, vlak voor elke herhaalde klik vastgesteld dat de voetknop daar
 * zelf de klik krijgt (dus de tijdgrendel is voorbij), en ELK schrijfverzoek
 * naar /api/swaps geteld.
 */
const GOEDGEKEURD = () => teBeoordelen({ id: 'rr2', shiftId: 'x2', status: 'approved', decidedAt: nu, shiftLine: '2606', shiftDate: vandaagIso(12) });
const GOEDKEURING = { methode: 'PATCH', pad: '/api/swaps/rr1', body: { status: 'approved', ifStatus: 'accepted' } };

test.describe('plaatsgrendel: een herhaalde klik op de plek van de rijknop beslist nooit', () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) < TABEL_VANAF, 'De beheertabel bestaat pas vanaf 768 px; op de telefoon is er geen rijknop.');

  for (const breed of [768, 1024, 1280, 1440]) {
    for (const wacht of [750, 1000, 2000]) {
      test(`${breed} px, ${wacht} ms later opnieuw op dezelfde plek: geen verzoek; 40 px opzij op dezelfde knop: precies één goedkeuring`, async ({ page }) => {
        await page.setViewportSize({ width: breed, height: 900 });
        // Zonder goedgekeurde rij: dan ligt de rijknop onder Goedkeuren van de voet.
        const { schrijf, extra } = ruilServer([teBeoordelen({ rust: TE_KORT })]);
        await seed(page, { user: ADMIN, extra });
        await page.goto('/dienstruil');
        const rij = rijVan(page);
        const rijKnop = rij.getByRole('button', { name: 'Goedkeuren, bekijk eerst de rusttijd', exact: true });
        const open = paneel(page, TEST_CHAUFFEUR);
        const voetKnop = open.getByRole('button', { name: 'Goedkeuren', exact: true });
        const klik = await rijknopOpVoetlijn(page, rij, rijKnop, voetKnop);

        await page.mouse.click(klik.x, klik.y);
        await page.waitForTimeout(wacht);
        for (const keer of ['tweede', 'derde']) {
          await expect.poll(() => ligtOp(voetKnop, klik), { message: `vóór de ${keer} klik: Goedkeuren van de voet ligt op het punt van de rijknop en de tijdgrendel is voorbij` }).toBe(true);
          await page.mouse.click(klik.x, klik.y);
          // De geslikte klik laat de focus niet op de knop achter (het indrukken
          // gaf ze haar, onzichtbaar): spatie of Enter keurde dan goed zonder
          // dat de aanwijzer bewoog.
          await geenToetsBeslist(page, open, `na de ${keer} klik`);
          expect(schrijf, `de ${keer} klik op dezelfde plek beslist niets, spatie en Enter daarna ook niet`).toEqual([]);
          await expect(page.getByRole('dialog'), 'alleen het paneel staat open, geen bevestiging').toHaveCount(1);
          await expect(open.getByRole('region', { name: 'Rusttijd' })).toBeVisible();
        }

        // Weg van het punt, naar een andere plek op dezelfde knop: nu beslist de klik gewoon.
        const opzij = await opzijOpKnop(voetKnop, klik);
        await page.mouse.move(opzij.x, opzij.y);
        expect(await ligtOp(voetKnop, opzij), 'ook het tweede punt krijgt de klik op Goedkeuren').toBe(true);
        await page.mouse.click(opzij.x, opzij.y);
        await expect(open).toHaveCount(0);
        await expect.poll(() => schrijf).toEqual([GOEDKEURING]);
        await page.waitForTimeout(200);
        expect(schrijf, 'precies één verzoek').toEqual([GOEDKEURING]);
      });
    }
  }

  // Met een goedgekeurde rij is de kolom Acties breder en ligt de rijknop op
  // 1280 en 1440 px onder Afwijzen van de voet (op 1920 px ook zonder): een
  // herhaalde klik wees daar af, het omgekeerde van wat de planner koos. Tot en
  // met commit 6144f988 opende die klik de bevestiging "Dienstruil afwijzen?";
  // nu doet hij niets. De bevestiging zelf blijft voor wie het paneel langs de
  // rijknop opende en op een andere plek op Afwijzen klikt.
  for (const { breed, metGoedgekeurd } of [{ breed: 1280, metGoedgekeurd: true }, { breed: 1440, metGoedgekeurd: true }, { breed: 1920, metGoedgekeurd: false }]) {
    test(`${breed} px${metGoedgekeurd ? ' met een goedgekeurde rij' : ''}: de rijknop ligt onder Afwijzen van de voet, een herhaalde klik wijst niet af en vraagt niets`, async ({ page }) => {
      await page.setViewportSize({ width: breed, height: 900 });
      const { schrijf, extra } = ruilServer([teBeoordelen({ rust: TE_KORT }), ...(metGoedgekeurd ? [GOEDGEKEURD()] : [])]);
      await seed(page, { user: ADMIN, extra });
      await page.goto('/dienstruil');
      const rij = rijVan(page);
      const rijKnop = rij.getByRole('button', { name: 'Goedkeuren, bekijk eerst de rusttijd', exact: true });
      const open = paneel(page, TEST_CHAUFFEUR);
      const voetKnop = open.getByRole('button', { name: 'Afwijzen', exact: true });
      const vraag = afwijsVraag(page);
      const klik = await rijknopOpVoetlijn(page, rij, rijKnop, voetKnop);

      await page.mouse.click(klik.x, klik.y);
      await page.waitForTimeout(1000);
      for (const keer of ['tweede', 'derde']) {
        await expect.poll(() => ligtOp(voetKnop, klik), { message: `vóór de ${keer} klik: Afwijzen van de voet ligt op het punt van de rijknop en de tijdgrendel is voorbij` }).toBe(true);
        await page.mouse.click(klik.x, klik.y);
        // Met de focus op Afwijzen opende spatie of Enter hier de bevestiging.
        await geenToetsBeslist(page, open, `na de ${keer} klik`);
        expect(schrijf, `de ${keer} klik op dezelfde plek beslist niets, spatie en Enter daarna ook niet`).toEqual([]);
        await expect(vraag, 'geen bevestigingsvenster').toHaveCount(0);
        await expect(page.getByRole('dialog'), 'alleen het paneel staat open').toHaveCount(1);
      }

      // Een andere plek op Afwijzen: het paneel ging langs de rijknop open, dus
      // eerst de bevestiging, zoals in de rij. Annuleren beslist niets.
      const opzij = await opzijOpKnop(voetKnop, klik);
      await page.mouse.move(opzij.x, opzij.y);
      await page.mouse.click(opzij.x, opzij.y);
      await expect(vraag).toContainText(`De aanvraag van ${TEST_CHAUFFEUR} met ${ALEX} voor dienst 2505`);
      await expect(open).toHaveCount(0);
      await vraag.getByRole('button', { name: 'Annuleren' }).click();
      await expect(vraag).toHaveCount(0);
      expect(schrijf, 'de vraag en Annuleren beslissen niets').toEqual([]);
    });
  }

  test('na wegbewegen en terugkomen werkt een klik op het punt van de rijknop weer gewoon', async ({ page }) => {
    const { schrijf, extra } = ruilServer([teBeoordelen({ rust: TE_KORT })]);
    await seed(page, { user: ADMIN, extra });
    await page.goto('/dienstruil');
    const rij = rijVan(page);
    const rijKnop = rij.getByRole('button', { name: 'Goedkeuren, bekijk eerst de rusttijd', exact: true });
    const open = paneel(page, TEST_CHAUFFEUR);
    const voetKnop = open.getByRole('button', { name: 'Goedkeuren', exact: true });
    const klik = await rijknopOpVoetlijn(page, rij, rijKnop, voetKnop);

    await page.mouse.click(klik.x, klik.y);
    const rust = open.getByRole('region', { name: 'Rusttijd' });
    await expect(rust).toBeVisible();
    // De planner leest de rustregels (de aanwijzer gaat een eind omhoog) en komt
    // terug op precies hetzelfde punt. Een vast punt in het venster: het paneel
    // schuift nog in, dus zijn inhoud ligt even buiten beeld.
    await page.mouse.move(klik.x, klik.y - 200);
    await page.mouse.move(klik.x, klik.y);
    await expect.poll(() => ligtOp(voetKnop, klik)).toBe(true);
    await page.mouse.click(klik.x, klik.y);
    await expect.poll(() => schrijf).toEqual([GOEDKEURING]);
  });

  test('een geslikte klik brengt de rustregels in beeld', async ({ page }) => {
    // Een lange toelichting: het paneel loopt over en kan naar onder schuiven,
    // waar de rustregels boven de vouw verdwijnen.
    const lang = Array.from({ length: 40 }, (_, i) => `Regel ${i + 1} van een lange toelichting.`).join('\n');
    const { schrijf, extra } = ruilServer([teBeoordelen({ rust: TE_KORT, reason: lang })]);
    await seed(page, { user: ADMIN, extra });
    await page.goto('/dienstruil');
    const rij = rijVan(page);
    const rijKnop = rij.getByRole('button', { name: 'Goedkeuren, bekijk eerst de rusttijd', exact: true });
    const open = paneel(page, TEST_CHAUFFEUR);
    const voetKnop = open.getByRole('button', { name: 'Goedkeuren', exact: true });
    const klik = await rijknopOpVoetlijn(page, rij, rijKnop, voetKnop);

    await page.mouse.click(klik.x, klik.y);
    const rust = open.getByRole('region', { name: 'Rusttijd' });
    await expect(rust).toBeVisible();
    await rust.evaluate((el) => {
      let vak = el.parentElement;
      while (vak && !/auto|scroll/.test(getComputedStyle(vak).overflowY)) vak = vak.parentElement;
      vak!.scrollTop = vak!.scrollHeight;
    });
    await expect(rust, 'de rustregels staan boven de vouw').not.toBeInViewport();
    await expect.poll(() => ligtOp(voetKnop, klik)).toBe(true);
    await page.mouse.click(klik.x, klik.y);
    await expect(rust, 'de geslikte klik brengt de rustregels in beeld').toBeInViewport({ ratio: 1 });
    expect(schrijf, 'en beslist niets').toEqual([]);
  });

  // "Dezelfde plek" is voor de planner het icoon, niet één punt: een tweede klik
  // elders op hetzelfde rij-icoon (hier van de ene hoek naar de andere, ±40 px
  // verder) viel buiten de straal van 12 px en keurde goed.
  for (const breed of [768, 1440]) {
    test(`${breed} px: een herhaalde klik op een ander punt van hetzelfde rij-icoon beslist niets; naast het icoon keurt de klik gewoon goed`, async ({ page }) => {
      await page.setViewportSize({ width: breed, height: 900 });
      const { schrijf, extra } = ruilServer([teBeoordelen({ rust: TE_KORT })]);
      await seed(page, { user: ADMIN, extra });
      await page.goto('/dienstruil');
      const rij = rijVan(page);
      const rijKnop = rij.getByRole('button', { name: 'Goedkeuren, bekijk eerst de rusttijd', exact: true });
      const open = paneel(page, TEST_CHAUFFEUR);
      const voetKnop = open.getByRole('button', { name: 'Goedkeuren', exact: true });
      const hart = await rijknopOpVoetlijn(page, rij, rijKnop, voetKnop);
      const vak = (await rijKnop.boundingBox())!;
      const linksboven = { x: Math.ceil(vak.x) + 4, y: Math.ceil(vak.y) + 4 };
      const rechtsonder = { x: Math.floor(vak.x + vak.width) - 4, y: Math.floor(vak.y + vak.height) - 4 };
      expect(await ligtOp(rijKnop, linksboven), 'de eerste klik valt op het rij-icoon').toBe(true);

      await page.mouse.click(linksboven.x, linksboven.y);
      await page.waitForTimeout(1000);
      for (const [waar, punt] of [['de andere hoek van het icoon', rechtsonder], ['het midden', hart], ['de eerste hoek', linksboven]] as const) {
        await expect.poll(() => ligtOp(voetKnop, punt), { message: `vóór de klik op ${waar}: Goedkeuren van de voet ligt daar en de tijdgrendel is voorbij` }).toBe(true);
        await page.mouse.click(punt.x, punt.y);
        await geenToetsBeslist(page, open, `na de klik op ${waar}`);
        expect(schrijf, `de klik op ${waar} beslist niets`).toEqual([]);
        await expect(page.getByRole('dialog'), 'alleen het paneel staat open').toHaveCount(1);
      }

      // Naast het icoon (de aanwijzer verlaat het vak): de voet werkt gewoon.
      const opzij = await opzijOpKnop(voetKnop, hart);
      await page.mouse.click(opzij.x, opzij.y);
      await expect(open).toHaveCount(0);
      await expect.poll(() => schrijf).toEqual([GOEDKEURING]);
    });
  }

  test('admin, ruil die op de collega wacht: de herhaalde klik op Goedkeuren van de voet opent de bevestiging niet, spatie en Enter daarna ook niet', async ({ page }) => {
    const { schrijf, extra } = ruilServer([teBeoordelen({ status: 'pending', rust: TE_KORT })]);
    await seed(page, { user: ADMIN, extra });
    await page.goto('/dienstruil');
    const rij = rijVan(page);
    const rijKnop = rij.getByRole('button', { name: 'Direct goedkeuren, bekijk eerst de rusttijd', exact: true });
    const open = paneel(page, TEST_CHAUFFEUR);
    const voetKnop = open.getByRole('button', { name: 'Goedkeuren', exact: true });
    const klik = await rijknopOpVoetlijn(page, rij, rijKnop, voetKnop);

    await page.mouse.click(klik.x, klik.y);
    await page.waitForTimeout(1000);
    await expect.poll(() => ligtOp(voetKnop, klik), { message: 'Goedkeuren van de voet ligt op het punt van de rijknop en de tijdgrendel is voorbij' }).toBe(true);
    await page.mouse.click(klik.x, klik.y);
    await geenToetsBeslist(page, open, 'na de herhaalde klik');
    await expect(page.getByRole('dialog', { name: 'Direct goedkeuren' }), 'geen bevestigingsvenster').toHaveCount(0);
    await expect(page.getByRole('dialog'), 'alleen het paneel staat open').toHaveCount(1);
    expect(schrijf, 'niets beslist').toEqual([]);
  });
});

test.describe('plaatsgrendel op een aanraakscherm (tabletbreedte)', () => {
  test.use({ hasTouch: true });
  test.skip(({ viewport }) => (viewport?.width ?? 0) < TABEL_VANAF, 'De beheertabel bestaat pas vanaf 768 px; op de telefoon is er geen rijknop.');

  for (const breed of [768, 1024]) {
    test(`${breed} px: een tweede tik op dezelfde plek beslist niets; een tik elders op de knop keurt meteen goed, zonder tik die alleen ontgrendelt`, async ({ page }) => {
      await page.setViewportSize({ width: breed, height: 900 });
      const { schrijf, extra } = ruilServer([teBeoordelen({ rust: TE_KORT })]);
      await seed(page, { user: ADMIN, extra });
      await page.goto('/dienstruil');
      const rij = rijVan(page);
      const rijKnop = rij.getByRole('button', { name: 'Goedkeuren, bekijk eerst de rusttijd', exact: true });
      const open = paneel(page, TEST_CHAUFFEUR);
      const voetKnop = open.getByRole('button', { name: 'Goedkeuren', exact: true });
      const klik = await rijknopOpVoetlijn(page, rij, rijKnop, voetKnop);

      await page.touchscreen.tap(klik.x, klik.y);
      await page.waitForTimeout(1000);
      // Een vinger raakt nooit twee keer hetzelfde punt: ook 13 px ernaast, nog
      // op de plek van het rij-icoon (40 x 44 px), is "dezelfde plek". Daarna
      // een toetsenbord aan de tablet: Enter keurde goed zolang de geslikte tik
      // de focus op de knop liet.
      for (const [keer, punt] of [['tweede', klik], ['derde', klik], ['vierde, 13 px opzij', { x: klik.x + 13, y: klik.y }], ['vijfde, 13 px lager', { x: klik.x, y: klik.y + 13 }]] as const) {
        await expect.poll(() => ligtOp(voetKnop, punt), { message: `vóór de ${keer} tik: Goedkeuren van de voet ligt op dat punt en de tijdgrendel is voorbij` }).toBe(true);
        await page.touchscreen.tap(punt.x, punt.y);
        await geenToetsBeslist(page, open, `na de ${keer} tik`);
        expect(schrijf, `de ${keer} tik op de plek van het rij-icoon beslist niets, Enter daarna ook niet`).toEqual([]);
        await expect(page.getByRole('dialog')).toHaveCount(1);
      }

      const opzij = await opzijOpKnop(voetKnop, klik);
      await page.touchscreen.tap(opzij.x, opzij.y);
      await expect.poll(() => schrijf).toEqual([GOEDKEURING]);
      await expect(open).toHaveCount(0);
    });
  }
});

/**
 * Afwijzen in de rij opent de bevestiging "Dienstruil afwijzen?", midden in het
 * venster. Op 768 tot ±800 px breed, met een goedgekeurde rij in de tabel en de
 * tabel naar rechts geschoven, ligt haar knop Afwijzen onder Afwijzen van de
 * rij: de tweede klik van een dubbelklik (of een herhaalde klik een seconde
 * later) bevestigde de vraag die de planner nog niet gelezen had, een
 * eindstatus met een melding naar de chauffeur. De rijknop zet daarom dezelfde
 * plaatsgrendel als Goedkeuren: zolang de aanwijzer niet van het icoon weg is
 * geweest, doet een klik op die plek niets.
 */
const AFWIJZING = { methode: 'PATCH', pad: '/api/swaps/rr1', body: { status: 'rejected', ifStatus: 'accepted' } };

test.describe('Afwijzen in de rij: een herhaalde klik op dezelfde plek bevestigt de vraag niet', () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) < TABEL_VANAF, 'De beheertabel bestaat pas vanaf 768 px; op de telefoon is er geen rijknop.');

  for (const wacht of [150, 1000]) {
    test(`768 px met de tabel naar rechts geschoven, ${wacht} ms later opnieuw op dezelfde plek: de vraag blijft staan, geen verzoek; elders op de knop: precies één afwijzing`, async ({ page }) => {
      await page.setViewportSize({ width: 768, height: 900 });
      const { schrijf, extra } = ruilServer([teBeoordelen({ rust: TE_KORT }), GOEDGEKEURD()]);
      await seed(page, { user: ADMIN, extra });
      await page.goto('/dienstruil');
      const rijKnop = rijVan(page).getByRole('button', { name: 'Afwijzen', exact: true });
      const vraag = afwijsVraag(page);
      const bevestig = vraag.getByRole('button', { name: 'Afwijzen', exact: true });
      const klik = await rijknopOpVraagknop(page, rijKnop, bevestig);
      expect(await ligtOp(rijKnop, klik), 'de eerste klik valt op Afwijzen van de rij').toBe(true);

      await page.mouse.click(klik.x, klik.y);
      await page.waitForTimeout(wacht);
      for (const keer of ['tweede', 'derde']) {
        await expect.poll(() => ligtOp(bevestig, klik), { message: `vóór de ${keer} klik: Afwijzen van de bevestiging ligt op het punt van de rijknop` }).toBe(true);
        await page.mouse.click(klik.x, klik.y);
        await geenToetsBeslist(page, vraag, `na de ${keer} klik`);
        expect(schrijf, `de ${keer} klik op dezelfde plek bevestigt niets, spatie en Enter daarna ook niet`).toEqual([]);
        await expect(vraag, 'de vraag staat er nog').toBeVisible();
      }

      // Weg van het icoon, naar een andere plek op dezelfde knop: nu bevestigt de klik gewoon.
      const opzij = await opzijOpKnop(bevestig, klik);
      await page.mouse.click(opzij.x, opzij.y);
      await expect(vraag).toHaveCount(0);
      await expect.poll(() => schrijf).toEqual([AFWIJZING]);
      await page.waitForTimeout(200);
      expect(schrijf, 'precies één verzoek').toEqual([AFWIJZING]);
    });
  }
});

test.describe('Afwijzen in de rij op een aanraakscherm (tabletbreedte)', () => {
  test.use({ hasTouch: true });
  test.skip(({ viewport }) => (viewport?.width ?? 0) < TABEL_VANAF, 'De beheertabel bestaat pas vanaf 768 px; op de telefoon is er geen rijknop.');

  test('768 px: een tweede tik op dezelfde plek bevestigt de vraag niet; een tik elders op de knop wijst af', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 900 });
    const { schrijf, extra } = ruilServer([teBeoordelen({ rust: TE_KORT }), GOEDGEKEURD()]);
    await seed(page, { user: ADMIN, extra });
    await page.goto('/dienstruil');
    const rijKnop = rijVan(page).getByRole('button', { name: 'Afwijzen', exact: true });
    const vraag = afwijsVraag(page);
    const bevestig = vraag.getByRole('button', { name: 'Afwijzen', exact: true });
    const klik = await rijknopOpVraagknop(page, rijKnop, bevestig);
    expect(await ligtOp(rijKnop, klik), 'de eerste tik valt op Afwijzen van de rij').toBe(true);

    await page.touchscreen.tap(klik.x, klik.y);
    await page.waitForTimeout(300);
    for (const keer of ['tweede', 'derde']) {
      await expect.poll(() => ligtOp(bevestig, klik), { message: `vóór de ${keer} tik: Afwijzen van de bevestiging ligt op het punt van de rijknop` }).toBe(true);
      await page.touchscreen.tap(klik.x, klik.y);
      await geenToetsBeslist(page, vraag, `na de ${keer} tik`);
      expect(schrijf, `de ${keer} tik op dezelfde plek bevestigt niets`).toEqual([]);
      await expect(vraag, 'de vraag staat er nog').toBeVisible();
    }

    const opzij = await opzijOpKnop(bevestig, klik);
    await page.touchscreen.tap(opzij.x, opzij.y);
    await expect.poll(() => schrijf).toEqual([AFWIJZING]);
    await expect(vraag).toHaveCount(0);
  });
});

test.describe('beheerlijst op de telefoon bleef zoals ze was', () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) >= TABEL_VANAF, 'Vanaf 768 px staat de ruil in de tabel (zie het blok hierboven).');

  test('goedkeuren bij te weinig rust en afwijzen beslissen meteen, de rust staat in de uitklap', async ({ page }) => {
    const { patches, extra } = ruilServer([
      teBeoordelen({ rust: TE_KORT }),
      teBeoordelen({ id: 'rr2', shiftId: 'x2', shiftLine: '2606', shiftDate: vandaagIso(11) }),
    ]);
    await seed(page, { user: ADMIN, extra });
    await page.goto('/dienstruil');
    const lijst = page.getByRole('list', { name: 'Beheer dienstruilen' });

    const metRust = lijst.getByRole('button', { name: /Dienst 2505/ });
    await expect(metRust).toContainText('Te weinig rust');
    await metRust.click();
    await expect(lijst.getByRole('region', { name: 'Rusttijd' })).toContainText('Te weinig rust');
    await lijst.getByRole('button', { name: 'Goedkeuren', exact: true }).click();
    await expect.poll(() => patches).toEqual([{ id: 'rr1', body: { status: 'approved', ifStatus: 'accepted' } }]);

    await lijst.getByRole('button', { name: /Dienst 2606/ }).click();
    await lijst.getByRole('button', { name: 'Afwijzen', exact: true }).click();
    await expect.poll(() => patches.at(-1)).toEqual({ id: 'rr2', body: { status: 'rejected', ifStatus: 'accepted' } });
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });
});

// ── Ronde 6, punt 12: de uren bij elke dienst, een zoekveld in stap 2, en op
//    de telefoon eerst wat op jouw antwoord wacht ──

/** Dag `dag` van de maand `maandenVerder` maanden na deze: vast in één
 *  kalendermaand en altijd in de toekomst, wat vandaagIso(n) niet belooft. */
const dagInMaand = (maandenVerder: number, dag: number) => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth() + maandenVerder, dag).toLocaleDateString('sv-SE');
};
const dienstCel = (code: string, segments: string[]) => ({ code, kind: 'service', label: `Dienst ${code}`, segments });
const UREN = /\d{2}:\d{2}–\d{2}:\d{2}/;
/** Een loopnummer zoals het bord het bij de tijden zet; "Verloop" telt niet. */
const LOOPNUMMER = /\(loop|4500|4611|4700/;
const ALEX_ID = '43';

/** De server van Dienstruil voor de testchauffeur (42): zijn ruilen, zijn
 *  planning, de beschikbaarheid en het maandbord per maand. Telt de verzoeken
 *  naar het bord per maand en bewaart wat de wizard verstuurt. */
function urenServer(opties: { ruilen?: unknown[]; planning?: unknown[]; availability?: unknown; users?: unknown[]; bord?: Record<string, unknown> }) {
  const bordVerzoeken: Record<string, number> = {};
  const verstuurd: any[] = [];
  const extra: Extra = (p, request) => {
    if (p.endsWith('/api/swaps')) {
      if (request.method() === 'GET') return opties.ruilen ?? [];
      verstuurd.push(JSON.parse(request.postData() ?? 'null'));
      return {};
    }
    if (p.endsWith('/api/planning')) return opties.planning ?? [];
    if (p.endsWith('/api/availability')) return opties.availability ?? { days: [] };
    if (p.endsWith('/api/users') && opties.users) return opties.users;
    if (p.endsWith('/api/month-planning')) {
      const maand = new URL(request.url()).searchParams.get('month') ?? '';
      bordVerzoeken[maand] = (bordVerzoeken[maand] ?? 0) + 1;
      return opties.bord?.[maand] ?? { month: maand, dates: [], drivers: [], cells: {} };
    }
    return undefined;
  };
  return { extra, bordVerzoeken, verstuurd };
}

test.describe('uren bij elke dienst in Dienstruil (ronde 6, punt 12)', () => {
  test('de aangezochte collega ziet in het voorstel de uren van het bord; het bord wordt per maand één keer gevraagd', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));
    const M1 = dagInMaand(1, 5).slice(0, 7);
    const M2 = dagInMaand(2, 3).slice(0, 7);
    const voorstel = (id: string, shiftDate: string, shiftLine: string, terug: { returnDate: string; returnCode: string }) => ({
      id, shiftId: `sh-${id}`, requesterId: ALEX_ID, targetDriverId: CHAUFFEUR.id, status: 'pending', reason: '', createdAt: nu, shiftDate, shiftLine, ...terug,
    });
    const { extra, bordVerzoeken } = urenServer({
      ruilen: [
        // Gesplitste dienst van de collega; ik geef er mijn (ook gesplitste) dienst 2202 voor af.
        voorstel('v1', dagInMaand(1, 5), '2323', { returnDate: dagInMaand(1, 12), returnCode: '2202' }),
        // Zelfde maand: geen tweede verzoek. Zijn cel draagt die dag een andere dienst.
        voorstel('v2', dagInMaand(1, 19), '4101', { returnDate: dagInMaand(1, 20), returnCode: 'vrij' }),
        // Dezelfde dienst 2323 in een andere maand, op een dag met andere uren.
        voorstel('v3', dagInMaand(2, 3), '2323', { returnDate: dagInMaand(2, 4), returnCode: 'vrij' }),
      ],
      // Mijn eigen planning: dienst 2202 in twee delen, niet in chronologische volgorde.
      planning: [
        { id: 'e2', date: dagInMaand(1, 12), startTime: '15:00', endTime: '19:00', line: '2202', busNumber: '', loopnr: '4611', driverId: CHAUFFEUR.id },
        { id: 'e1', date: dagInMaand(1, 12), startTime: '05:00', endTime: '09:00', line: '2202', busNumber: '', loopnr: '4500', driverId: CHAUFFEUR.id },
      ],
      bord: {
        [M1]: { month: M1, dates: [], drivers: [], cells: { [ALEX_ID]: {
          [dagInMaand(1, 5)]: dienstCel('2323', ['06:45–10:00 (loop 4500)', '15:45–19:35 (loop 4611)']),
          [dagInMaand(1, 19)]: dienstCel('2101', ['08:00–16:00']),
        } } },
        [M2]: { month: M2, dates: [], drivers: [], cells: { [ALEX_ID]: { [dagInMaand(2, 3)]: dienstCel('2323', ['07:02–15:10 (loop 4700)']) } } },
      },
    });
    await seed(page, { user: CHAUFFEUR, extra });
    await page.goto('/dienstruil');
    const kaart = (id: string) => page.locator(`[data-record="${id}"]`);
    await expect(kaart('v1')).toBeVisible();

    // De dienst die ik zou krijgen: alle delen op één regel, zonder loopnummers.
    await expect(kaart('v1')).toContainText('06:45–10:00 · 15:45–19:35');
    await expect(kaart('v1')).not.toContainText(LOOPNUMMER);
    // Wat ik ervoor afgeef komt uit mijn eigen planning, vroegste deel eerst.
    await expect(kaart('v1')).toContainText('Jij geeft dienst 2202');
    await expect(kaart('v1')).toContainText('05:00–09:00 · 15:00–19:00');
    // Dezelfde dienst op een andere dag: de uren van díe dag.
    await expect(kaart('v3')).toContainText('07:02–15:10');
    await expect(kaart('v3')).not.toContainText('06:45');
    // De cel van de collega draagt die dag een andere dienst: geen uren, geen
    // placeholder, en de ruil blijft te beantwoorden.
    await expect(kaart('v2')).not.toContainText(UREN);
    await expect(kaart('v2').getByRole('button', { name: 'Accepteren' })).toBeEnabled();

    // Een tijdvak breekt nooit halverwege: elk stuk staat op één regel.
    const regels = await kaart('v1').locator('span.whitespace-nowrap').evaluateAll((els) => els.map((e) => e.getClientRects().length));
    expect(regels).toEqual([1, 1, 1, 1]);

    // Eén verzoek per maand, niet per ruil; ook niet opnieuw na een bevestiging
    // die open en dicht ging of na het openen van de wizard.
    expect(bordVerzoeken).toEqual({ [M1]: 1, [M2]: 1 });
    await kaart('v1').getByRole('button', { name: 'Weigeren' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Annuleren' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.getByRole('button', { name: 'Dienstruil aanvragen' }).click();
    await expect(page.getByText('Stap 1 van 3')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByText('Stap 1 van 3')).toBeHidden();
    await page.waitForTimeout(400);
    expect(bordVerzoeken).toEqual({ [M1]: 1, [M2]: 1 });
    expect(pageErrors, `page errors:\n${pageErrors.join('\n')}`).toEqual([]);
  });

  for (const geval of ['een fout van de server', 'een antwoord in een onverwachte vorm', 'geen antwoord'] as const) {
    test(`zonder bord (${geval}): geen uren, geen fout, de ruil blijft bruikbaar`, async ({ page }) => {
      const pageErrors: string[] = [];
      page.on('pageerror', (err) => pageErrors.push(err.message));
      const { extra } = urenServer({
        ruilen: [{
          id: 'w1', shiftId: 'r1', requesterId: ALEX_ID, targetDriverId: CHAUFFEUR.id, status: 'pending', reason: '', createdAt: nu,
          shiftDate: dagInMaand(1, 5), shiftLine: '2323', returnDate: dagInMaand(1, 12), returnCode: 'vrij',
        }],
      });
      await seed(page, { user: CHAUFFEUR, extra });
      // Later geregistreerd, dus vóór de fixtures: het bord faalt op drie manieren.
      let gevraagd = 0;
      await page.route('**/api/month-planning**', (route) => {
        gevraagd += 1;
        if (geval === 'een fout van de server') return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Maandplanning kon niet berekend worden' }) });
        if (geval === 'geen antwoord') return route.abort('failed');
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ cells: [{ code: '2323', segments: ['06:45–10:00'] }], uren: '06:45–10:00' }) });
      });
      await page.goto('/dienstruil');
      const kaart = page.locator('[data-record="w1"]');
      await expect(kaart).toBeVisible();
      await expect.poll(() => gevraagd).toBeGreaterThan(0);
      // Ruim voorbij de stille herkansing van een mislukte GET (600 ms).
      await page.waitForTimeout(1500);

      await expect(kaart).toContainText('Dienst 2323');
      await expect(kaart).not.toContainText(UREN);
      // Geen foutmelding, nergens: geen toast, geen foutkaart, geen alert.
      await expect(page.getByRole('alert')).toHaveCount(0);
      await expect(page.getByText(/kon niet|mislukt|Er ging iets mis|Opnieuw proberen|Geen bereik|verbinding/i)).toHaveCount(0);
      // Een mislukt bord wordt dit bezoek niet opnieuw gevraagd (de ene stille herkansing van elke GET niet meegeteld).
      const na = gevraagd;
      await kaart.getByRole('button', { name: 'Accepteren' }).click();
      // De ruil is te beantwoorden zoals vandaag.
      await expect(page.getByText('De planner beoordeelt ze daarna nog')).toBeVisible();
      await page.waitForTimeout(800);
      expect(gevraagd).toBe(na);
      expect(pageErrors, `page errors:\n${pageErrors.join('\n')}`).toEqual([]);
    });
  }

  test('stap 3 toont de uren bij elke dienst van de collega; twee maanden in beeld zijn twee verzoeken, elk één keer', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));
    const M1 = dagInMaand(1, 20).slice(0, 7);
    const M2 = dagInMaand(2, 2).slice(0, 7);
    // Alex is vrij op de dag van mijn dienst, rijdt 2202 op het einde van die
    // maand en 2303 (gesplitst) aan het begin van de volgende, en is daarna vrij.
    const { extra, bordVerzoeken, verstuurd } = urenServer({
      planning: [{ id: 'p1', date: dagInMaand(1, 20), startTime: '08:00', endTime: '16:00', line: '2101', busNumber: '', loopnr: '', driverId: CHAUFFEUR.id }],
      availability: { days: [
        { date: dagInMaand(1, 20), working: [CHAUFFEUR.id], leave: [], free: [ALEX_ID], lines: { [CHAUFFEUR.id]: '2101' } },
        { date: dagInMaand(1, 28), working: [ALEX_ID], leave: [], free: [], lines: { [ALEX_ID]: '2202' } },
        { date: dagInMaand(2, 2), working: [ALEX_ID], leave: [], free: [], lines: { [ALEX_ID]: '2303' } },
        { date: dagInMaand(2, 4), working: [], leave: [], free: [ALEX_ID], lines: {} },
      ] },
      bord: {
        [M1]: { month: M1, dates: [], drivers: [], cells: { [ALEX_ID]: { [dagInMaand(1, 28)]: dienstCel('2202', ['06:12–14:30 (loop 4500)']) } } },
        [M2]: { month: M2, dates: [], drivers: [], cells: { [ALEX_ID]: { [dagInMaand(2, 2)]: dienstCel('2303', ['05:10–09:00 (loop 4500)', '16:00–19:30 (loop 4611)']) } } },
      },
    });
    await seed(page, { user: CHAUFFEUR, extra });
    await page.goto('/dienstruil');
    await page.getByRole('button', { name: 'Dienstruil aanvragen' }).click();
    const wizard = page.getByRole('dialog');
    await wizard.getByRole('button', { name: /Dienst 2101/ }).click();
    await expect(page.getByText('Stap 2 van 3')).toBeVisible();
    await expect(wizard.getByRole('button', { name: new RegExp(ALEX) })).toBeVisible();
    // Tot hier valt er geen dienst van een collega te tonen: het bord is niet gevraagd.
    expect(bordVerzoeken).toEqual({});

    await wizard.getByRole('button', { name: new RegExp(ALEX) }).click();
    await expect(page.getByText('Stap 3 van 3')).toBeVisible();
    // Elke dienst van de collega met de uren van die dag, op één regel en zonder loopnummers.
    await expect(wizard.getByRole('button', { name: /Dienst 2202/ })).toContainText('Dienst 2202 · 06:12–14:30');
    await expect(wizard.getByRole('button', { name: /Dienst 2303/ })).toContainText('Dienst 2303 · 05:10–09:00 · 16:00–19:30');
    await expect(wizard).not.toContainText(LOOPNUMMER);
    // Een vrije dag heeft geen uren.
    const vrijeDagen = wizard.getByRole('button', { name: /Vrije dag van de collega/ });
    await expect(vrijeDagen).toHaveCount(2);
    for (const knop of await vrijeDagen.all()) await expect(knop).not.toContainText(UREN);
    expect(bordVerzoeken).toEqual({ [M1]: 1, [M2]: 1 });

    // Terug en opnieuw dezelfde collega: geen nieuw verzoek, de uren staan er meteen.
    await wizard.getByRole('button', { name: 'Vorige stap' }).click();
    await wizard.getByRole('button', { name: new RegExp(ALEX) }).click();
    await expect(wizard.getByRole('button', { name: /Dienst 2202/ })).toContainText('06:12–14:30');
    await page.waitForTimeout(400);
    expect(bordVerzoeken).toEqual({ [M1]: 1, [M2]: 1 });

    // Wat de wizard verstuurt is niet veranderd: dag en code van de gekozen dienst, geen uren.
    await wizard.getByRole('button', { name: /Dienst 2303/ }).click();
    await wizard.getByRole('button', { name: 'Ruilverzoek versturen' }).click();
    await expect(page.getByText('Stap 3 van 3')).toBeHidden();
    const nieuw = verstuurd.at(-1)?.at(-1);
    expect(nieuw).toMatchObject({ shiftId: 'p1', requesterId: CHAUFFEUR.id, targetDriverId: ALEX_ID, status: 'pending', swapType: 'ruil', reason: '', returnDate: dagInMaand(2, 2), returnCode: '2303' });
    expect(JSON.stringify(nieuw)).not.toMatch(UREN);
    expect(pageErrors, `page errors:\n${pageErrors.join('\n')}`).toEqual([]);
  });

  test('stap 2: het zoekveld filtert op naam zonder de volgorde of de labels te wijzigen; Enter dient niets in', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));
    const collega = (id: string, name: string) => ({ id, name, role: 'chauffeur', employeeId: `VHB-0000${id}`, email: `${id}@vhb.be`, isActive: true });
    const ZOE = collega('81', 'Zoë Verhaeghe');
    const ANNA = collega('82', 'Anna Baert');
    const BERT = collega('83', 'Bert Claeys');
    const CARL = collega('84', 'Carl Dhondt');
    const dienstdag = dagInMaand(1, 10);
    const { extra, verstuurd } = urenServer({
      users: [CHAUFFEUR, ZOE, CARL, BERT, ANNA],
      planning: [{ id: 'p1', date: dienstdag, startTime: '08:00', endTime: '16:00', line: '2101', busNumber: '', loopnr: '', driverId: CHAUFFEUR.id }],
      availability: { days: [
        {
          date: dienstdag, working: [CHAUFFEUR.id, BERT.id], leave: [CARL.id], free: [ZOE.id],
          lines: { [CHAUFFEUR.id]: '2101', [BERT.id]: '2303' }, takeover: { [ANNA.id]: 'bv' }, reden: { [CARL.id]: 'Verlof' },
        },
        { date: dagInMaand(1, 17), working: [ZOE.id], leave: [], free: [], lines: { [ZOE.id]: '2202' } },
      ] },
    });
    await seed(page, { user: CHAUFFEUR, extra });
    await page.goto('/dienstruil');
    await page.getByRole('button', { name: 'Dienstruil aanvragen' }).click();
    const wizard = page.getByRole('dialog');
    await wizard.getByRole('button', { name: /Dienst 2101/ }).click();
    await expect(page.getByText('Stap 2 van 3')).toBeVisible();

    const opties = wizard.getByRole('button', { name: /Verhaeghe|Baert|Claeys|Dhondt/ });
    const zoek = wizard.getByRole('searchbox', { name: 'Zoek een collega' });
    const alles = [/^Anna Baert\s*BV$/, /^Bert Claeys\s*Dienst 2303$/, /^Zoë Verhaeghe\s*Vrij$/, /^Carl Dhondt\s*Verlof$/];
    await expect(opties).toHaveText(alles);
    // Het veld staat boven de lijst en krijgt de focus niet vanzelf (het klavier zou de lijst bedekken).
    const veldVak = (await zoek.boundingBox())!;
    const eersteVak = (await opties.first().boundingBox())!;
    expect(veldVak.y + veldVak.height).toBeLessThanOrEqual(eersteVak.y);
    await expect(zoek).not.toBeFocused();

    // Hoofdletters en accenten tellen niet; het label onder de naam blijft.
    await zoek.fill('zoe');
    await expect(opties).toHaveText([/^Zoë Verhaeghe\s*Vrij$/]);
    await expect(wizard.getByText(/^Niet beschikbaar op /)).toHaveCount(0);
    await zoek.fill('  VERHAEGHE ');
    await expect(opties).toHaveText([/^Zoë Verhaeghe\s*Vrij$/]);
    // Een letter die in elke naam zit, over de twee lijsten heen: volgorde en reden blijven.
    await zoek.fill('a');
    await expect(opties).toHaveText(alles);
    await zoek.fill('dhon');
    await expect(opties).toHaveText([/^Carl Dhondt\s*Verlof$/]);
    await expect(wizard.getByText(/^Niet beschikbaar op /)).toBeVisible();

    // Geen treffer: één stille regel, geen fout.
    await zoek.fill('xyz');
    await expect(opties).toHaveCount(0);
    await expect(wizard.getByText('Geen collega gevonden met die naam.')).toBeVisible();
    await expect(wizard.getByRole('alert')).toHaveCount(0);

    // Enter (de zoektoets van de telefoon) dient het formulier niet in.
    await zoek.press('Enter');
    await expect(page.getByText('Stap 2 van 3')).toBeVisible();
    await expect(wizard.getByRole('alert')).toHaveCount(0);

    // Wissen geeft de hele lijst terug.
    await wizard.getByRole('button', { name: 'Zoekopdracht wissen' }).click();
    await expect(opties).toHaveText(alles);
    await expect(wizard.getByText('Geen collega gevonden met die naam.')).toHaveCount(0);

    // Het gevaarlijke geval: collega en tegenprestatie zijn al gekozen, terug
    // naar stap 2, zoeken en Enter. Er vertrekt geen aanvraag.
    await zoek.fill('zoë');
    await opties.first().click();
    await expect(page.getByText('Stap 3 van 3')).toBeVisible();
    await wizard.getByRole('button', { name: /Dienst 2202/ }).click();
    await expect(wizard.getByRole('button', { name: 'Ruilverzoek versturen' })).toBeEnabled();
    await wizard.getByRole('button', { name: 'Vorige stap' }).click();
    await expect(page.getByText('Stap 2 van 3')).toBeVisible();
    // De zoekterm staat er nog: je ziet waarom de lijst kort is.
    await expect(zoek).toHaveValue('zoë');
    await zoek.fill('verh');
    await zoek.press('Enter');
    await page.waitForTimeout(500);
    expect(verstuurd, 'Enter in het zoekveld verstuurde een ruilaanvraag').toEqual([]);
    await expect(page.getByText('Stap 2 van 3')).toBeVisible();
    await expect(wizard.getByRole('alert')).toHaveCount(0);

    // Een dienst opnieuw kiezen in stap 1 begint met een leeg zoekveld.
    await wizard.getByRole('button', { name: 'Vorige stap' }).click();
    await wizard.getByRole('button', { name: /Dienst 2101/ }).click();
    await expect(zoek).toHaveValue('');
    await expect(opties).toHaveText(alles);
    expect(pageErrors, `page errors:\n${pageErrors.join('\n')}`).toEqual([]);
  });

  test('volgorde: op de telefoon eerst wat op jouw antwoord wacht, op desktop en voor staf zoals het was', async ({ page }) => {
    const telefoon = (page.viewportSize()?.width ?? 0) < 768;
    const ruilen = [
      { id: 'mv-lopend', shiftId: 'm2', requesterId: CHAUFFEUR.id, targetDriverId: ALEX_ID, status: 'pending', reason: '', createdAt: nu, shiftDate: vandaagIso(12), shiftLine: '2202', returnDate: vandaagIso(13), returnCode: 'vrij' },
      { id: 'os-antwoord', shiftId: 'o2', requesterId: ALEX_ID, targetDriverId: CHAUFFEUR.id, status: 'pending', reason: '', createdAt: nu, shiftDate: vandaagIso(9), shiftLine: '2404', returnDate: vandaagIso(11), returnCode: 'vrij' },
    ];
    const volgorde = () => page.locator('[data-record]').evaluateAll((els) => els.map((e) => e.getAttribute('data-record')));
    const kopY = async (tekst: string) => (await page.getByText(tekst, { exact: true }).boundingBox())!;

    await seed(page, { user: CHAUFFEUR, extra: urenServer({ ruilen }).extra });
    await page.goto('/dienstruil');
    await expect(page.locator('[data-record="os-antwoord"]')).toBeVisible();
    // De opbouw zelf wisselt, niet alleen het beeld: lees- en tabvolgorde volgen mee.
    await expect.poll(volgorde).toEqual(telefoon ? ['os-antwoord', 'mv-lopend'] : ['mv-lopend', 'os-antwoord']);
    const open = await kopY('Openstaande dienstruilen');
    const mijn = await kopY('Mijn verzoeken');
    if (telefoon) expect(open.y).toBeLessThan(mijn.y);
    else {
      // Twee kolommen naast elkaar, Mijn verzoeken links: ongewijzigd.
      expect(open.y).toBe(mijn.y);
      expect(mijn.x).toBeLessThan(open.x);
    }
    // De inhoud van de blokken is dezelfde: het voorstel met zijn knoppen, het eigen verzoek als rij.
    await expect(page.locator('[data-record="os-antwoord"]').getByRole('button', { name: /^(Weigeren|Accepteren)$/ })).toHaveText(['Weigeren', 'Accepteren']);
    await expect(page.getByRole('list', { name: 'Mijn verzoeken' }).getByRole('button', { name: /Dienst 2202/ })).toBeVisible();
  });

  test('volgorde voor staf: Mijn verzoeken blijft eerst, ook op de telefoon', async ({ page }) => {
    const ruilen = [
      { id: 'st-eigen', shiftId: 'm2', requesterId: ADMIN.id, targetDriverId: ALEX_ID, status: 'pending', reason: '', createdAt: nu, shiftDate: vandaagIso(12), shiftLine: '2202', returnDate: vandaagIso(13), returnCode: 'vrij' },
      { id: 'st-open', shiftId: 'o2', requesterId: ALEX_ID, targetDriverId: '44', status: 'pending', reason: '', createdAt: nu, shiftDate: vandaagIso(9), shiftLine: '2404', returnDate: vandaagIso(11), returnCode: 'vrij' },
    ];
    await seed(page, { user: ADMIN, extra: urenServer({ ruilen }).extra });
    await page.goto('/dienstruil');
    const mijn = page.getByText('Mijn verzoeken', { exact: true });
    const open = page.getByText('Openstaande dienstruilen', { exact: true });
    await expect(page.getByRole('list', { name: 'Openstaande dienstruilen' })).toBeVisible();
    const [m, o] = [(await mijn.boundingBox())!, (await open.boundingBox())!];
    if ((page.viewportSize()?.width ?? 0) < 768) expect(m.y).toBeLessThan(o.y);
    else { expect(m.y).toBe(o.y); expect(m.x).toBeLessThan(o.x); }
    // Staf leest het bord hier nergens voor: geen uren van het bord in de staflijst.
    expect(await page.evaluate(() => performance.getEntriesByType('resource').filter((r) => r.name.includes('/api/month-planning')).length)).toBe(0);
  });
});

// ── Tegenlezing 12-11: komen de uren van het bord later binnen, dan verschuift
//    er niets. Begrepen schrijft meteen (geen bevestiging): een kaart erboven
//    die groeit, schoof hem anders onder een tik die voor de kaart eronder was. ──
test.describe('de uren van het bord komen later binnen: de kaarten verschuiven niet', () => {
  // Safari op iOS kent geen scroll anchoring (overflow-anchor): groeit een kaart
  // boven het beeld, dan schuift alles eronder mee. Hier uitgezet, zodat
  // Chromium en de WebKit van Playwright dat nabootsen.
  const ZONDER_ANKER = '*, *::before, *::after { overflow-anchor: none !important; }';
  for (const breedte of [360, 375]) {
    for (const uitkomst of ['het bord geeft de uren', 'het bord geeft niets'] as const) {
      test(`${breedte} px, ${uitkomst}: Begrepen blijft staan en een tik op de kaart eronder bevestigt niets`, async ({ page }, testInfo) => {
        test.skip(testInfo.project.name.startsWith('Desktop'), 'een telefoonscenario: op desktop staan de blokken naast elkaar');
        const pageErrors: string[] = [];
        page.on('pageerror', (err) => pageErrors.push(err.message));
        await page.setViewportSize({ width: breedte, height: 640 });
        const M1 = dagInMaand(1, 3).slice(0, 7);
        const voorstel = (id: string, dag: number, shiftLine: string) => ({
          id, shiftId: `sh-${id}`, requesterId: ALEX_ID, targetDriverId: CHAUFFEUR.id, status: 'pending', reason: '', createdAt: nu,
          shiftDate: dagInMaand(1, dag), shiftLine, returnDate: dagInMaand(1, 20), returnCode: 'vrij',
        });
        // Twee voorstellen met een vroegere dag (drie en twee delen) boven een
        // doorgevoerde wissel die ik nog moet bevestigen, en een voorstel eronder.
        const ruilen = [
          voorstel('v1', 3, '2323'),
          voorstel('v2', 4, '2202'),
          { id: 'a1', shiftId: 'g1', requesterId: ALEX_ID, targetDriverId: CHAUFFEUR.id, status: 'approved', reason: '', createdAt: nu, decidedAt: nu, shiftDate: dagInMaand(1, 6), shiftLine: '2404', returnDate: dagInMaand(1, 21), returnCode: 'vrij' },
          voorstel('v4', 9, '2101'),
        ];
        // Na de doorvoer staat de bevestigde dienst in mijn eigen planning, in twee delen.
        const planning = [
          { id: 'g1', date: dagInMaand(1, 6), startTime: '06:00', endTime: '10:00', line: '2404', busNumber: '', loopnr: '', driverId: CHAUFFEUR.id },
          { id: 'g2', date: dagInMaand(1, 6), startTime: '15:00', endTime: '19:00', line: '2404', busNumber: '', loopnr: '', driverId: CHAUFFEUR.id },
        ];
        const bord = uitkomst === 'het bord geeft niets'
          ? { month: M1, dates: [], drivers: [], cells: {} }
          : { month: M1, dates: [], drivers: [], cells: { [ALEX_ID]: {
            [dagInMaand(1, 3)]: dienstCel('2323', ['06:45–10:00', '13:10–15:05', '18:40–22:15']),
            [dagInMaand(1, 4)]: dienstCel('2202', ['05:30–09:10', '15:45–19:35']),
            [dagInMaand(1, 9)]: dienstCel('2101', ['08:00–16:00']),
          } } };
        await seed(page, { user: CHAUFFEUR, extra: urenServer({ ruilen, planning }).extra });
        // Het bord blijft hangen tot alles gemeten is (later geregistreerd, dus vóór de fixtures).
        let laatLos!: () => void;
        const losgelaten = new Promise<void>((r) => { laatLos = r; });
        let bordGevraagd = 0;
        await page.route('**/api/month-planning**', async (route) => {
          bordGevraagd += 1;
          await losgelaten;
          await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(bord) });
        });
        const gezien: string[] = [];
        page.on('request', (r) => { if (r.method() === 'POST' && r.url().includes('/gezien')) gezien.push(r.url()); });

        await page.goto('/dienstruil');
        const kaart = (id: string) => page.locator(`[data-record="${id}"]`);
        await expect(kaart('v4')).toBeVisible();
        await expect.poll(() => page.locator('[data-record]').evaluateAll((els) => els.map((e) => e.getAttribute('data-record')))).toEqual(['v1', 'v2', 'a1', 'v4']);
        await expect.poll(() => bordGevraagd).toBe(1);
        await page.addStyleTag({ content: ZONDER_ANKER });
        const begrepen = kaart('a1').getByRole('button', { name: 'Begrepen, ik rijd deze dienst' });
        await begrepen.evaluate((el) => el.scrollIntoView({ block: 'center' }));
        await page.waitForTimeout(150);
        const hoogte = async (id: string) => (await kaart(id).boundingBox())!.height;
        const voor = { begrepen: (await begrepen.boundingBox())!, v1: await hoogte('v1'), v2: await hoogte('v2'), v4: await hoogte('v4') };
        // De plek van de tik: de kop van de kaart onder Begrepen, boven de onderbalk.
        const eronder = (await kaart('v4').boundingBox())!;
        const tik = { x: voor.begrepen.x + voor.begrepen.width / 2, y: eronder.y + 26 };
        expect(tik.y).toBeLessThan(640 - 100);

        const antwoord = page.waitForResponse((r) => r.url().includes('/api/month-planning'));
        laatLos();
        await antwoord;
        if (uitkomst === 'het bord geeft de uren') {
          await expect(kaart('v1')).toContainText('06:45–10:00 · 13:10–15:05 · 18:40–22:15');
          await expect(kaart('v2')).toContainText('05:30–09:10 · 15:45–19:35');
        } else {
          await page.waitForTimeout(300);
          await expect(kaart('v1')).not.toContainText(UREN);
        }
        // Net na het binnenkomen tikt de chauffeur op de kaart eronder.
        await page.touchscreen.tap(tik.x, tik.y);
        await page.waitForTimeout(600);
        expect(gezien, 'de tik op de kaart eronder landde op Begrepen').toEqual([]);
        // Geen kaart veranderde van hoogte, dus Begrepen staat waar hij stond.
        expect((await begrepen.boundingBox())!.y).toBeCloseTo(voor.begrepen.y, 0);
        expect(await hoogte('v1')).toBeCloseTo(voor.v1, 0);
        expect(await hoogte('v2')).toBeCloseTo(voor.v2, 0);
        expect(await hoogte('v4')).toBeCloseTo(voor.v4, 0);
        if (uitkomst === 'het bord geeft de uren') {
          // Alle delen op één regel, ook drie delen op deze breedte.
          const regels = await kaart('v1').locator('p', { hasText: '13:10–15:05' }).evaluate((el) => Math.round(el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).lineHeight)));
          expect(regels).toBe(1);
        }
        expect(pageErrors, `page errors:\n${pageErrors.join('\n')}`).toEqual([]);
      });
    }
  }
});
