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

  test('vandaag ligt na de grens in dezelfde maand: de maand blijft staan, vandaag is leeg en niet te kiezen, axe is schoon', async ({ page }) => {
    await open(page, NA_GRENS, '/rooster/2027-01', LAATSTE);
    await expect(maandkop(page, 'januari 2027')).toBeVisible();
    await expect(volgende(page)).toBeDisabled();
    await expect(dagcel(page, 'zondag 3 januari')).toBeEnabled();
    await expect(dagcel(page, 'zondag 10 januari')).toBeDisabled();
    await expect(dagcel(page, 'zondag 10 januari')).toHaveAccessibleName(/nog geen planning$/);
    // Het dagdetail van vandaag (de standaardkeuze) blijft staan.
    await expect(page.getByText('Zondag 10 januari 2027')).toBeVisible();
    await axeSchoon(page);
  });

  test('een eigen dienst ná de horizon van de server verdwijnt nooit: de grens schuift mee tot die dienst', async ({ page }) => {
    // De server zegt 20/12, maar er staat een eigen dienst op 28/12 en op 02/01.
    await open(page, KLOKKEN[0], '/rooster/2026-12', '2026-12-20');
    await expect(dagcel(page, 'maandag 28 december')).toBeEnabled();
    await expect(dagcel(page, 'maandag 28 december')).toContainText('2607');
    await expect(volgende(page)).toBeEnabled();
    await volgende(page).click();
    await expect(maandkop(page, 'januari 2027')).toBeVisible();
    await expect(dagcel(page, 'zaterdag 2 januari')).toContainText('2101');
    await expect(dagcel(page, 'zondag 3 januari')).toBeDisabled();
    await expect(volgende(page)).toBeDisabled();
    await expect(volgende(page)).toHaveAttribute('title', 'De planning loopt tot en met 02/01/2027');
  });
});

test.describe('Maandplanning op de telefoon', () => {
  const RIJDERS = USERS.filter((u: any) => u.role === 'chauffeur').slice(0, 3).map((u: any) => ({ id: String(u.id), name: String(u.name) }));
  /** Elke chauffeur rijdt elke dag; de eerste heeft na de grens verlof (de cel-waarheid legt dat over een lege cel). */
  const bord = (maand: string, metGrens: boolean) => {
    const dates = dagenVan(maand);
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
      ...(metGrens ? { geimporteerd: { eerste: '2026-01-01', laatste: LAATSTE } } : {}),
    };
  };
  async function open(page: Page, user: Record<string, unknown>, nu: string, pad: string, metGrens: boolean) {
    await page.clock.setFixedTime(new Date(nu));
    await seed(page, {
      user, view: 'bezetting',
      extra: (p: string, request: Request) => (
        request.method() === 'GET' && p.endsWith('/api/month-planning') && !new URL(request.url()).searchParams.get('format')
          ? bord(new URL(request.url()).searchParams.get('month') ?? '', metGrens)
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
      test(`${user.role}: dagen na de grens zijn niet te kiezen, een dag uit het adres valt terug (klok ${nu.slice(0, 10)})`, async ({ page }) => {
        await open(page, user, nu, '/maandplanning/2027-01/2027-01-20', true);
        // De dag uit het adres (20/01) ligt voorbij de grens: de laatste dag met planning is gekozen, het adres volgt.
        await expect(gekozen(page)).toHaveText(/^zo\s*3$/i);
        await expect(page).toHaveURL(/\/maandplanning\/2027-01\/2027-01-03$/);
        await expect(page.getByText('Zondag 3 januari')).toBeVisible();
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
        // Verder vooruit kan niet (ongewijzigd), een dag vóór de grens kiezen wel.
        await expect(page.getByRole('button', { name: 'Volgende maand' })).toBeDisabled();
        await strip(page).nth(1).click();
        await expect(gekozen(page)).toHaveText(/^za\s*2$/i);
        await expect(page).toHaveURL(/\/maandplanning\/2027-01\/2027-01-02$/);
      });
    }
  }

  test('vandaag ligt na de grens in dezelfde maand: het scherm opent op de laatste dag met planning en Vandaag blijft daar, axe is schoon', async ({ page }) => {
    await open(page, ADMIN, NA_GRENS, '/maandplanning', true);
    await expect(gekozen(page)).toHaveText(/^zo\s*3$/i);
    await expect(strip(page).nth(9)).toBeDisabled();
    await page.locator('#hoofdinhoud').getByRole('button', { name: 'Vandaag', exact: true }).click();
    await expect(gekozen(page)).toHaveText(/^zo\s*3$/i);
    await expect(page.getByText('Zondag 3 januari')).toBeVisible();
    await axeSchoon(page);
  });

  test('zonder dag in het adres opent de laatste maand op een dag met planning', async ({ page }) => {
    await open(page, CHAUFFEUR, KLOKKEN[1], '/maandplanning/2027-01', true);
    await expect(gekozen(page)).toHaveText(/^vr\s*1F$/i); // 1 januari: de F van feestdag
    await expect(strip(page).nth(3)).toBeDisabled();
  });

  test('zonder grens van de server verandert er niets: elke dag is te kiezen en de dag uit het adres blijft', async ({ page }) => {
    await open(page, ADMIN, KLOKKEN[1], '/maandplanning/2027-01/2027-01-20', false);
    await expect(gekozen(page)).toHaveText(/^wo\s*20$/i);
    await expect(page).toHaveURL(/\/maandplanning\/2027-01\/2027-01-20$/);
    await expect(page.getByRole('tablist', { name: 'Kies een dag' }).locator('button:disabled')).toHaveCount(0);
    // Het verlof na 03/01 staat er dan zoals vroeger (één met verlof, twee zonder cel).
    await expect(page.getByRole('button', { name: /Vrij \/ afwezig · 3/ })).toBeVisible();
  });
});
