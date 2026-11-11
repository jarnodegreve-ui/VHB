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
          await page.waitForTimeout(300);
          expect(schrijf, `de ${keer} klik op dezelfde plek beslist niets`).toEqual([]);
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
        await page.waitForTimeout(300);
        expect(schrijf, `de ${keer} klik op dezelfde plek beslist niets`).toEqual([]);
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
      for (const keer of ['tweede', 'derde']) {
        await expect.poll(() => ligtOp(voetKnop, klik), { message: `vóór de ${keer} tik: Goedkeuren van de voet ligt op het punt van de rijknop en de tijdgrendel is voorbij` }).toBe(true);
        await page.touchscreen.tap(klik.x, klik.y);
        await page.waitForTimeout(300);
        expect(schrijf, `de ${keer} tik op dezelfde plek beslist niets`).toEqual([]);
        await expect(page.getByRole('dialog')).toHaveCount(1);
      }

      const opzij = await opzijOpKnop(voetKnop, klik);
      await page.touchscreen.tap(opzij.x, opzij.y);
      await expect.poll(() => schrijf).toEqual([GOEDKEURING]);
      await expect(open).toHaveCount(0);
    });
  }
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
