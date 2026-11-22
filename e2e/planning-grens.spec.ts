import { test, expect, type Page, type Request } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { ADMIN, AXE_TAGS, CHAUFFEUR, USERS, seed } from './helpers';

/**
 * Planning-grens (Jarno 22-11: "ik heb ook gezien dat er na 3 januari wel kan
 * gebladerd worden omdat er verlof instaat. dit is niet de bedoeling want de
 * planning is maar geupload TEM 3 januari 2027"). Op het Rooster en op de
 * Maandplanning stopt vooruit bladeren bij de laatste dag met planning, en de
 * dagen erna tonen niets (ook geen verlof) en zijn niet te kiezen. De grens
 * komt alleen van de server: `x-planning-tot` op /api/planning (Rooster) en
 * `geimporteerd.laatste` in /api/month-planning (Maandplanning). Zonder die
 * grens verandert er niets.
 *
 * Draait in iPhone 13 (chromium); het desktopraster staat in
 * e2e/maandplanning-weergave.spec.ts. Elke proef heeft een vaste klok en eigen
 * gegevens (grens 03/01/2027), nagespeeld op het begin en het midden van de
 * maand ervoor: niets hangt af van vandaag.
 */

const LAATSTE = '2027-01-03';
const KLOKKEN = ['2026-12-01T09:00:00Z', '2026-12-15T09:00:00Z'];

/** Vandaag ná de grens, in dezelfde maand: de planning loopt achter. */
const NA_GRENS = '2027-01-10T09:00:00Z';
/** axe op het scherm zoals het er staat, met de gedempte dagen erbij. */
const axeSchoon = async (page: Page) => {
  const { violations } = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
  expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`)).toEqual([]);
};

const dagenVan = (maand: string) => {
  const [jaar, m] = maand.split('-').map(Number);
  return Array.from({ length: new Date(jaar, m, 0).getDate() }, (_, i) => `${maand}-${String(i + 1).padStart(2, '0')}`);
};

test.describe('Rooster', () => {
  const dienst = (id: string, date: string, line: string) => ({ id, date, startTime: '06:12', endTime: '14:30', line, busNumber: '', loopnr: '', driverId: '42' });
  const DIENSTEN = [dienst('d1', '2026-12-16', '4101'), dienst('d2', '2026-12-28', '2607'), dienst('d3', '2027-01-02', '2101')];
  // Goedgekeurd verlof vóór de grens (30/12) en erna (05/01 tot 08/01), en een aanvraag erna (12/01).
  const VERLOF = [
    { id: 'v1', userId: '42', startDate: '2026-12-30', endDate: '2026-12-30', type: 'betaald_verlof', status: 'approved', createdAt: '2026-11-01T08:00:00Z' },
    { id: 'v2', userId: '42', startDate: '2027-01-05', endDate: '2027-01-08', type: 'betaald_verlof', status: 'approved', createdAt: '2026-11-01T08:00:00Z' },
    { id: 'v3', userId: '42', startDate: '2027-01-12', endDate: '2027-01-12', type: 'betaald_verlof', status: 'pending', createdAt: '2026-11-01T08:00:00Z' },
  ];

  async function open(page: Page, nu: string, pad: string, planningTot: string | null, diensten = DIENSTEN) {
    await page.clock.setFixedTime(new Date(nu));
    await seed(page, { user: CHAUFFEUR, extra: (p) => (p.endsWith('/api/leave') ? VERLOF : undefined) });
    // Na de seed gezet, dus eerst aan de beurt: de planning met (of zonder) de horizon van de server.
    await page.route((url) => url.pathname.endsWith('/api/planning'), (route) => route.fulfill({
      status: 200, contentType: 'application/json', headers: planningTot ? { 'x-planning-tot': planningTot } : {}, body: JSON.stringify(diensten),
    }));
    await page.goto(pad);
    await expect(page.getByRole('heading', { name: 'Rooster', level: 1 })).toBeVisible({ timeout: 15_000 });
  }
  const maandkop = (page: Page, tekst: string) => page.getByText(tekst, { exact: true });
  const volgende = (page: Page) => page.getByRole('button', { name: 'Volgende maand' });
  const vorige = (page: Page) => page.getByRole('button', { name: 'Vorige maand' });
  /** De dagcel van het maandraster, gezocht op haar voorgelezen datum ("zaterdag 2 januari"). */
  const dagcel = (page: Page, dag: string) => page.getByRole('button', { name: new RegExp(`, ${dag}(,|$)`) });
  /** Het vak dat met de vinger meebeweegt (MaandWissel). */
  const veegvak = (page: Page) => page.locator('div.touch-pan-y');
  /**
   * Een veeg met echte touch-events op het veegvak (de hook luistert daar).
   * Geeft terug of de kaart onderweg meebewoog. De wissel zelf gebeurt, als hij
   * gebeurt, pas na de doorveer: de aanroeper wacht op de maandkop.
   */
  const veeg = (page: Page, dx: number) => veegvak(page).evaluate((el, afstand) => {
    const rect = el.getBoundingClientRect();
    const x0 = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const stuur = (type: string, x: number) => {
      const t = new Touch({ identifier: 1, target: el, clientX: x, clientY: y });
      el.dispatchEvent(new TouchEvent(type, { bubbles: true, cancelable: true, touches: type === 'touchend' ? [] : [t], changedTouches: [t] }));
    };
    stuur('touchstart', x0);
    for (let i = 1; i <= 5; i += 1) stuur('touchmove', x0 + (afstand * i) / 5);
    const bewoog = (el as HTMLElement).style.transform !== '';
    stuur('touchend', x0 + afstand);
    return bewoog;
  }, dx);
  /** De kaart staat weer stil op haar plaats (geen transform, niet vervaagd). */
  const stil = (page: Page) => expect.poll(() => veegvak(page).evaluate((el) => {
    const s = getComputedStyle(el);
    return `${s.transform}|${s.opacity}`;
  }), 'het veegvak staat stil').toBe('none|1');

  for (const nu of KLOKKEN) {
    test(`vooruit stopt bij de maand van de grens, met pijl en met veeg (klok ${nu.slice(0, 10)})`, async ({ page }) => {
      await open(page, nu, '/rooster/2026-12', LAATSTE);
      await expect(maandkop(page, 'december 2026')).toBeVisible();
      // December ligt vóór de grens: alles zoals altijd, ook het verlof van 30/12.
      await expect(volgende(page)).toBeEnabled();
      await expect(dagcel(page, 'woensdag 30 december')).toBeEnabled();
      await expect(dagcel(page, 'woensdag 30 december')).toHaveAccessibleName(/verlof/);
      await expect(dagcel(page, 'donderdag 31 december')).toBeEnabled();

      await volgende(page).click();
      await expect(maandkop(page, 'januari 2027')).toBeVisible();
      // De laatste maand: de pijl staat uit en zegt waarom. Terug blijft werken.
      await expect(volgende(page)).toBeDisabled();
      await expect(volgende(page)).toHaveAttribute('title', 'De planning loopt tot en met 03/01/2027');
      await expect(vorige(page)).toBeEnabled();

      // Tot en met 03/01 zoals altijd: de dienst van 02/01 staat er, 03/01 is te kiezen.
      await expect(dagcel(page, 'zaterdag 2 januari')).toBeEnabled();
      await expect(dagcel(page, 'zaterdag 2 januari')).toContainText('2101');
      await expect(dagcel(page, 'zondag 3 januari')).toBeEnabled();
      // Vanaf 04/01: uit, met een naam die zegt waarom, en zonder verlof (goedgekeurd op 05/01, aangevraagd op 12/01).
      const cellen = page.locator('div.touch-pan-y button');
      await expect(cellen).toHaveCount(31);
      await expect(page.locator('div.touch-pan-y button:disabled')).toHaveCount(28);
      for (const dag of ['maandag 4 januari', 'dinsdag 5 januari', 'dinsdag 12 januari', 'zondag 31 januari']) {
        await expect(dagcel(page, dag)).toBeDisabled();
        await expect(dagcel(page, dag)).toHaveAccessibleName(/nog geen planning$/);
        await expect(dagcel(page, dag)).not.toHaveAccessibleName(/verlof|dienst/);
        // Alleen het dagcijfer en de toelichting: geen stip, geen code, geen tint van verlof.
        await expect(dagcel(page, dag).locator('span')).toHaveCount(2);
        await expect(dagcel(page, dag)).not.toHaveClass(/bg-(emerald|amber|rose|blue)/);
      }

      // Het dagdetail van een eerder gekozen dag blijft staan; een dag na de grens kiest niets.
      await dagcel(page, 'zaterdag 2 januari').click();
      await expect(page.getByText('Zaterdag 2 januari 2027')).toBeVisible();
      await dagcel(page, 'dinsdag 5 januari').click({ force: true });
      await expect(page.getByText('Zaterdag 2 januari 2027')).toBeVisible();
      await expect(page.getByText('Dinsdag 5 januari 2027')).toHaveCount(0);

      // Een veeg naar links (vooruit) veert mee en komt terug: de maand blijft januari.
      expect(await veeg(page, -160), 'de kaart veert mee').toBe(true);
      await stil(page);
      await expect(maandkop(page, 'januari 2027')).toBeVisible();
      await expect(page).toHaveURL(/\/rooster\/2027-01$/);
      // Was die veeg toch doorgegaan (februari), dan bracht deze veeg terug ons naar januari, niet naar december.
      await veeg(page, 160);
      await expect(maandkop(page, 'december 2026')).toBeVisible();
      await stil(page);
      // En vanuit december kan je weer vooruit vegen tot januari, niet verder.
      await veeg(page, -160);
      await expect(maandkop(page, 'januari 2027')).toBeVisible();
      await expect(volgende(page)).toBeDisabled();
    });

    test(`een maand uit het adres voorbij de grens valt terug op de maand van de grens (klok ${nu.slice(0, 10)})`, async ({ page }) => {
      await open(page, nu, '/rooster/2027-03', LAATSTE);
      await expect(maandkop(page, 'januari 2027')).toBeVisible();
      await expect(page).toHaveURL(/\/rooster\/2027-01$/);
      await expect(volgende(page)).toBeDisabled();
      await expect(dagcel(page, 'zondag 3 januari')).toBeEnabled();
      await expect(dagcel(page, 'maandag 4 januari')).toBeDisabled();
    });
  }

  test('zonder horizon van de server verandert er niets: verder bladeren kan en het verlof staat er', async ({ page }) => {
    await open(page, KLOKKEN[1], '/rooster/2027-01', null);
    await expect(maandkop(page, 'januari 2027')).toBeVisible();
    await expect(volgende(page)).toBeEnabled();
    await expect(volgende(page)).toHaveAttribute('title', 'Volgende maand');
    await expect(page.locator('div.touch-pan-y button:disabled')).toHaveCount(0);
    await expect(dagcel(page, 'dinsdag 5 januari')).toHaveAccessibleName(/verlof/);
    await expect(dagcel(page, 'dinsdag 12 januari')).toHaveAccessibleName(/verlof/);
    // Vegen en de pijl gaan gewoon door, ook een maand uit het adres ver vooruit blijft staan.
    await veeg(page, -160);
    await expect(maandkop(page, 'februari 2027')).toBeVisible();
    await stil(page);
    await volgende(page).click();
    await expect(maandkop(page, 'maart 2027')).toBeVisible();
  });

  test('loopt de planning achter op vandaag, dan blijft de lopende maand staan en kan je alleen terug', async ({ page }) => {
    // Vandaag 15/12, planning tot 20/11: geen terugval naar november, wel geen stap vooruit.
    await open(page, KLOKKEN[1], '/rooster/2026-12', '2026-11-20', [dienst('o1', '2026-11-10', '4101')]);
    await expect(maandkop(page, 'december 2026')).toBeVisible();
    await expect(volgende(page)).toBeDisabled();
    await vorige(page).click();
    await expect(maandkop(page, 'november 2026')).toBeVisible();
    await expect(dagcel(page, 'vrijdag 20 november')).toBeEnabled();
    await expect(dagcel(page, 'zaterdag 21 november')).toBeDisabled();
    // Terug vooruit tot de lopende maand, niet verder.
    await expect(volgende(page)).toBeEnabled();
    await volgende(page).click();
    await expect(maandkop(page, 'december 2026')).toBeVisible();
    await expect(volgende(page)).toBeDisabled();
  });

  test('vandaag ligt na de grens in dezelfde maand: de maand blijft staan, vandaag is leeg maar blijft te kiezen, axe is schoon', async ({ page }) => {
    await open(page, NA_GRENS, '/rooster/2027-01', LAATSTE);
    await expect(maandkop(page, 'januari 2027')).toBeVisible();
    await expect(volgende(page)).toBeDisabled();
    await expect(dagcel(page, 'zondag 3 januari')).toBeEnabled();
    // Vandaag (10/01) is leeg en gedempt zoals de andere dagen na de grens, maar niet uitgeschakeld.
    await expect(dagcel(page, 'zondag 10 januari')).toBeEnabled();
    await expect(dagcel(page, 'zondag 10 januari')).toHaveAccessibleName(/nog geen planning$/);
    await expect(dagcel(page, 'zaterdag 9 januari')).toBeDisabled();
    await expect(dagcel(page, 'maandag 11 januari')).toBeDisabled();
    await expect(page.locator('div.touch-pan-y button:disabled')).toHaveCount(27);
    // Het dagdetail van vandaag (de standaardkeuze) staat er, en je kan er na een andere dag naar terug.
    await expect(page.getByText('Zondag 10 januari 2027')).toBeVisible();
    await dagcel(page, 'zaterdag 2 januari').click();
    await expect(page.getByText('Zaterdag 2 januari 2027')).toBeVisible();
    await dagcel(page, 'zondag 10 januari').click();
    await expect(page.getByText('Zondag 10 januari 2027')).toBeVisible();
    await axeSchoon(page);
  });

  test('de grens komt alleen van de server: een eigen dienst erna blijft staan als losse dag, het verlof ernaast niet', async ({ page }) => {
    // De server zegt 20/12; er staat een eigen dienst op 28/12 en op 02/01 (met de hand toegewezen),
    // goedgekeurd verlof op 30/12 en van 05/01 tot 08/01.
    await open(page, KLOKKEN[0], '/rooster/2026-12', '2026-12-20');
    await expect(dagcel(page, 'zondag 20 december')).toBeEnabled();
    await expect(dagcel(page, 'maandag 21 december')).toBeDisabled();
    // De dag met de eigen dienst blijft zichtbaar en te kiezen; de grens zelf schuift niet mee.
    await expect(dagcel(page, 'maandag 28 december')).toBeEnabled();
    await expect(dagcel(page, 'maandag 28 december')).toContainText('2607');
    await expect(dagcel(page, 'dinsdag 29 december')).toBeDisabled();
    await expect(dagcel(page, 'woensdag 30 december')).toBeDisabled();
    await expect(dagcel(page, 'woensdag 30 december')).not.toHaveAccessibleName(/verlof/);
    // De maand van die late dienst blijft bereikbaar, verder niet.
    await expect(volgende(page)).toBeEnabled();
    await volgende(page).click();
    await expect(maandkop(page, 'januari 2027')).toBeVisible();
    await expect(dagcel(page, 'zaterdag 2 januari')).toBeEnabled();
    await expect(dagcel(page, 'zaterdag 2 januari')).toContainText('2101');
    await expect(page.locator('div.touch-pan-y button:disabled')).toHaveCount(30);
    await expect(dagcel(page, 'dinsdag 5 januari')).not.toHaveAccessibleName(/verlof/);
    await dagcel(page, 'zaterdag 2 januari').click();
    await expect(page.getByText('Zaterdag 2 januari 2027')).toBeVisible();
    // Eén datum in de kop van het scherm en op de pijl: die van de server.
    await expect(volgende(page)).toBeDisabled();
    await expect(volgende(page)).toHaveAttribute('title', 'De planning loopt tot en met 20/12/2026');
    await expect(page.getByText('Planning bijgewerkt t/m 20/12/2026.')).toBeVisible();
  });
});

test.describe('Maandplanning op de telefoon', () => {
  const RIJDERS = USERS.filter((u: any) => u.role === 'chauffeur').slice(0, 3).map((u: any) => ({ id: String(u.id), name: String(u.name) }));
  /**
   * Het bord zoals de server het geeft (api/_lib/celWaarheid.ts): `dates` zijn
   * de dagen met een matrixrij, dus met een grens tot en met `laatste`, en na
   * die dag bestaat er geen cel, ook geen verlofcel. `vorm: 'vol'` is het
   * vangnet: een bord dat tóch dagen en verlofcellen na de grens meestuurt
   * (wat de server vandaag niet doet), om de uitgeschakelde dagen te toetsen.
   * `vorm: 'zonder'` is een server zonder grens: de volle maand, alles bereikbaar.
   */
  type Vorm = 'server' | 'vol' | 'zonder';
  const bord = (maand: string, vorm: Vorm) => {
    const dates = dagenVan(maand).filter((d) => vorm !== 'server' || d <= LAATSTE);
    return {
      month: maand,
      dates,
      drivers: RIJDERS.map((u) => ({ ...u, section: null })),
      cells: Object.fromEntries(RIJDERS.map((u, i) => [
        u.id,
        Object.fromEntries(dates.map((d): [string, unknown] => [d, d > LAATSTE
          ? (i === 0 ? { code: 'bv', kind: 'leave', label: 'Betaald verlof', segments: [] } : null)
          : { code: String(2101 + i), kind: 'service', label: '', segments: ['05:30 - 13:45'] }]).filter(([, c]) => c)),
      ])),
      ...(vorm !== 'zonder' ? { geimporteerd: { eerste: '2026-01-01', laatste: LAATSTE } } : {}),
    };
  };
  async function open(page: Page, user: Record<string, unknown>, nu: string, pad: string, vorm: Vorm) {
    await page.clock.setFixedTime(new Date(nu));
    await seed(page, {
      user, view: 'bezetting',
      extra: (p: string, request: Request) => (
        request.method() === 'GET' && p.endsWith('/api/month-planning') && !new URL(request.url()).searchParams.get('format')
          ? bord(new URL(request.url()).searchParams.get('month') ?? '', vorm)
          : undefined
      ),
    });
    await page.goto(pad);
    await expect(page.getByRole('heading', { name: 'Maandplanning', level: 1 })).toBeVisible({ timeout: 15_000 });
  }
  const strip = (page: Page) => page.getByRole('tablist', { name: 'Kies een dag' }).getByRole('tab');
  const gekozen = (page: Page) => page.getByRole('tablist', { name: 'Kies een dag' }).getByRole('tab', { selected: true });

  for (const user of [CHAUFFEUR, ADMIN]) {
    for (const nu of KLOKKEN) {
      test(`${user.role}: de strip stopt op de grens en een dag uit het adres voorbij de grens valt op de laatste dag (klok ${nu.slice(0, 10)})`, async ({ page }) => {
        await open(page, user, nu, '/maandplanning/2027-01/2027-01-20', 'server');
        // De dag uit het adres (20/01) ligt voorbij de grens en staat niet in de dagen van de server:
        // de laatste dag met planning is gekozen (niet de eerste van de maand), het adres volgt.
        await expect(gekozen(page)).toHaveText(/^zo\s*3$/i);
        await expect(page).toHaveURL(/\/maandplanning\/2027-01\/2027-01-03$/);
        await expect(page.getByText('Zondag 3 januari')).toBeVisible();
        // De strip toont de dagen van de server: 01 tot 03, alle drie te kiezen, niets erna.
        await expect(strip(page)).toHaveCount(3);
        await expect(page.getByRole('tablist', { name: 'Kies een dag' }).locator('button:disabled')).toHaveCount(0);
        // Verder vooruit kan niet (ongewijzigd), een dag vóór de grens kiezen wel.
        await expect(page.getByRole('button', { name: 'Volgende maand' })).toBeDisabled();
        await strip(page).nth(1).click();
        await expect(gekozen(page)).toHaveText(/^za\s*2$/i);
        await expect(page).toHaveURL(/\/maandplanning\/2027-01\/2027-01-02$/);
      });
    }
  }

  test('een dag uit een andere maand of een typefout in het adres gaat stil weg, zoals vroeger', async ({ page }) => {
    await open(page, ADMIN, KLOKKEN[1], '/maandplanning/2027-01/2027-02-20', 'server');
    await expect(gekozen(page)).toHaveText(/^vr\s*1F$/i); // 1 januari: de F van feestdag
    await expect(page).toHaveURL(/\/maandplanning\/2027-01$/);
  });

  test('vandaag ligt na de grens in dezelfde maand: het scherm opent op de laatste dag met planning en Vandaag blijft daar, axe is schoon', async ({ page }) => {
    await open(page, ADMIN, NA_GRENS, '/maandplanning', 'server');
    await expect(gekozen(page)).toHaveText(/^zo\s*3$/i);
    await expect(strip(page)).toHaveCount(3);
    await page.locator('#hoofdinhoud').getByRole('button', { name: 'Vandaag', exact: true }).click();
    await expect(gekozen(page)).toHaveText(/^zo\s*3$/i);
    await expect(page.getByText('Zondag 3 januari')).toBeVisible();
    await axeSchoon(page);
  });

  test('zonder dag in het adres opent de laatste maand op een dag met planning', async ({ page }) => {
    await open(page, CHAUFFEUR, KLOKKEN[1], '/maandplanning/2027-01', 'server');
    await expect(gekozen(page)).toHaveText(/^vr\s*1F$/i); // 1 januari: de F van feestdag
    await expect(strip(page)).toHaveCount(3);
  });

  test('vangnet: stuurt de server toch dagen en verlof na de grens mee, dan zijn die dagen uit en valt het adres terug', async ({ page }) => {
    await open(page, ADMIN, KLOKKEN[1], '/maandplanning/2027-01/2027-01-20', 'vol');
    await expect(gekozen(page)).toHaveText(/^zo\s*3$/i);
    await expect(page).toHaveURL(/\/maandplanning\/2027-01\/2027-01-03$/);
    // De strip toont de hele maand; 01 tot 03 zijn te kiezen, 04 tot 31 niet, met de bestaande uitleg.
    await expect(strip(page)).toHaveCount(31);
    for (const k of [0, 1, 2]) await expect(strip(page).nth(k)).toBeEnabled();
    for (const k of [3, 4, 19, 30]) {
      await expect(strip(page).nth(k)).toBeDisabled();
      await expect(strip(page).nth(k)).toHaveAttribute('title', 'De planning is geïmporteerd tot 03/01/2027');
    }
    // Een tik op zo'n dag kiest niets: de dag en het adres blijven staan.
    await strip(page).nth(4).click({ force: true });
    await expect(gekozen(page)).toHaveText(/^zo\s*3$/i);
    await expect(page).toHaveURL(/\/maandplanning\/2027-01\/2027-01-03$/);
    await axeSchoon(page);
  });

  test('zonder grens van de server verandert er niets: elke dag is te kiezen en de dag uit het adres blijft', async ({ page }) => {
    await open(page, ADMIN, KLOKKEN[1], '/maandplanning/2027-01/2027-01-20', 'zonder');
    await expect(gekozen(page)).toHaveText(/^wo\s*20$/i);
    await expect(page).toHaveURL(/\/maandplanning\/2027-01\/2027-01-20$/);
    await expect(page.getByRole('tablist', { name: 'Kies een dag' }).locator('button:disabled')).toHaveCount(0);
    // Het verlof na 03/01 staat er dan zoals vroeger (één met verlof, twee zonder cel).
    await expect(page.getByRole('button', { name: /Vrij \/ afwezig · 3/ })).toBeVisible();
  });
});
