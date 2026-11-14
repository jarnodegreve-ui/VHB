import { test, expect, type Page, type Request, type TestInfo } from '@playwright/test';
import { ADMIN, CHAUFFEUR, USERS, kanScrollen, seed } from './helpers';
import { MD_QUERY } from '../src/lib/useMinWidth';

/**
 * De Maandplanning tekent precies één weergave per breedte (ronde 6, punt 22,
 * deel 2): onder md de dagweergave (datumstrip + daglijst), vanaf md het
 * desktopraster (14 dagen × alle chauffeurs). Tot dan stonden ze er allebei en
 * verborg CSS er één, zodat de telefoon het hele raster opbouwde en verborg.
 * De view kiest met `MD_QUERY` (src/lib/useMinWidth.ts), letterlijk de query
 * van md in de gebouwde CSS: in rem, dus ook met een andere standaardletter
 * dezelfde grens als de `md:`-klassen in de kop. De toestand (gekozen dag,
 * zoekterm, open celdetail) woont in de view en overleeft een wissel.
 *
 * Projecten: iPhone 13 (chromium) op 360, 390 en 767 (toetssteen 1 tot 4,
 * met tik), iPhone 13 (webkit) op 390 en 767 (matchMedia met rem in de engine
 * van de iPhone; toetssteen 1 en 3), Desktop (chromium) op 768, 1024, 1280 en
 * 1440 (toetssteen 1, 2 en 4, met de muis).
 */

const IPHONE_CHROMIUM = 'iPhone 13 (chromium)';
const IPHONE_WEBKIT = 'iPhone 13 (webkit)';
const DESKTOP = 'Desktop (chromium)';
const alleenIn = (info: TestInfo, ...projecten: string[]) =>
  test.skip(!projecten.includes(info.project.name), `hoort bij ${projecten.join(' en ')}`);

/** De twee weergaven, geteld met CSS en niet met een rol: een rol-locator slaat verborgen elementen over. */
const RASTER = 'table[aria-label="Maandplanning per chauffeur en dag"]';
const STRIP = '[role="tablist"][aria-label="Kies een dag"]';

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const dagenVan = (maand: string) => {
  const [jaar, m] = maand.split('-').map(Number);
  return Array.from({ length: new Date(jaar, m, 0).getDate() }, (_, i) => `${maand}-${String(i + 1).padStart(2, '0')}`);
};
/** Zoals formatDayLong in de app, met de hoofdletter van de dagkop. */
const dagkop = (dag: string) => {
  const t = new Date(`${dag}T00:00:00`).toLocaleDateString('nl-BE', { weekday: 'long', day: 'numeric', month: 'long' });
  return t.charAt(0).toUpperCase() + t.slice(1);
};

const NAMEN = ['Bart De Smet', 'Koen Janssens', 'Sofie Van Damme', 'Peter Peeters', 'Marc Claes', 'An Willems', 'Tom De Backer', 'Luc Maes', 'Hilde Goossens'];
const RIJDERS = [
  ...USERS.filter((u: any) => u.role === 'chauffeur').map((u: any) => ({ id: String(u.id), name: String(u.name) })),
  ...NAMEN.map((name, i) => ({ id: String(200 + i), name })),
];
/** Het bord van één maand: elke chauffeur rijdt elke dag een dienst. */
const bord = (maand: string) => {
  const dates = dagenVan(maand);
  return {
    month: maand,
    dates,
    drivers: RIJDERS.map((u) => ({ ...u, section: null })),
    cells: Object.fromEntries(RIJDERS.map((u, i) => [
      u.id,
      Object.fromEntries(dates.map((d, k) => [d, { code: String(2101 + ((i + k) % 30)), kind: 'service', label: '', segments: ['05:30 - 13:45'] }])),
    ])),
    geimporteerd: { eerste: dates[0], laatste: dates[dates.length - 1] },
  };
};
const metBord = (pad: string, request: Request) => (
  request.method() === 'GET' && pad.endsWith('/api/month-planning') && !new URL(request.url()).searchParams.get('format')
    ? bord(new URL(request.url()).searchParams.get('month') ?? iso(new Date()).slice(0, 7))
    : undefined
);

async function open(page: Page, user: Record<string, unknown>, breedte: number) {
  await seed(page, { user, view: 'bezetting', thema: 'light', extra: metBord });
  await page.setViewportSize({ width: breedte, height: 900 });
  await page.goto('/maandplanning');
  await expect(page.getByRole('heading', { name: 'Maandplanning', level: 1 })).toBeVisible({ timeout: 15_000 });
}

/**
 * Precies één van de twee staat in de DOM en die is zichtbaar. Eerst de
 * verwachte zichtbaar (anders telt het skelet, waar geen van beide staat, als
 * geslaagd), dan de andere op nul.
 */
async function preciesEen(page: Page, breed: boolean) {
  const wel = page.locator(breed ? RASTER : STRIP);
  await expect(wel).toBeVisible({ timeout: 15_000 });
  await expect(wel).toHaveCount(1);
  await expect(page.locator(breed ? STRIP : RASTER)).toHaveCount(0);
}

/**
 * Alle schrijfacties naar de API vanaf nu (de opstart zelf telt niet). De
 * HEAD-ping van useOnline en een foutmelding naar /api/client-errors
 * beslissen niets en tellen niet mee.
 */
function schrijfacties(page: Page) {
  const lijst: string[] = [];
  page.on('request', (r) => {
    const pad = new URL(r.url()).pathname;
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(r.method()) && pad.startsWith('/api/') && pad !== '/api/client-errors') lijst.push(`${r.method()} ${pad}`);
  });
  return lijst;
}

/** Wat ligt er op dit punt: de knop (of rij) eronder, met zijn tekst en plaats. */
const onderPunt = (page: Page, punt: { x: number; y: number }) => page.evaluate(({ x, y }) => {
  const el = document.elementFromPoint(x, y);
  const knop = el?.closest('button');
  const td = knop?.closest('td');
  const rij = knop?.closest('tr');
  return {
    knop: knop ? (knop.textContent ?? '').trim() : null,
    rijkop: rij?.querySelector('th')?.textContent?.trim() ?? null,
    kolom: td && rij ? Array.from(rij.children).indexOf(td) : null,
    inDialoog: !!el?.closest('[role="dialog"]'),
  };
}, punt);

async function midden(locator: ReturnType<Page['locator']>) {
  await locator.scrollIntoViewIfNeeded();
  const b = await locator.boundingBox();
  if (!b) throw new Error('geen vak');
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

/** Het celdetail van één chauffeur (het venster heeft geen eigen naam: de titel is de chauffeur). */
const celdetail = (page: Page, wie: string) =>
  page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: wie, exact: true }) });

/** Sluit wat er open is: Escape tot er geen venster meer staat. */
async function sluitAlles(page: Page) {
  for (let i = 0; i < 3; i += 1) {
    if (await page.getByRole('dialog').count() === 0) break;
    await page.keyboard.press('Escape');
    await page.getByRole('dialog').first().waitFor({ state: 'detached', timeout: 2_000 }).catch(() => undefined);
  }
  await expect(page.getByRole('dialog')).toHaveCount(0);
}

test.describe('toetssteen 1: precies één weergave in de DOM, en die is zichtbaar', () => {
  const MATRIX: Array<[string, number]> = [
    [IPHONE_CHROMIUM, 360], [IPHONE_CHROMIUM, 390], [IPHONE_CHROMIUM, 767],
    [IPHONE_WEBKIT, 390], [IPHONE_WEBKIT, 767],
    [DESKTOP, 768], [DESKTOP, 1024], [DESKTOP, 1280], [DESKTOP, 1440],
  ];
  for (const [project, breedte] of MATRIX) {
    test(`${breedte} px (${project})`, async ({ page }, info) => {
      alleenIn(info, project);
      await open(page, ADMIN, breedte);
      const breed = breedte >= 768;
      // De browser zelf: met de standaardletter valt 48rem op 768 px.
      expect(await page.evaluate((q) => window.matchMedia(q).matches, MD_QUERY)).toBe(breed);
      await preciesEen(page, breed);
      // De kop wisselt met CSS op dezelfde grens: het tweewekencluster alleen vanaf md.
      await expect(page.getByRole('button', { name: 'Vorige 2 weken' })).toBeVisible({ visible: breed });
    });
  }
});

test.describe('toetssteen 2: de view kiest met dezelfde query als md', () => {
  test('de gebouwde CSS zet md op exact MD_QUERY, en de view vraagt die query', async ({ page }, info) => {
    alleenIn(info, IPHONE_CHROMIUM, DESKTOP);
    await page.addInitScript(() => {
      const echt = window.matchMedia.bind(window);
      (window as any).__gevraagd = [] as string[];
      window.matchMedia = (q: string) => { (window as any).__gevraagd.push(q); return echt(q); };
    });
    await open(page, ADMIN, info.project.name === DESKTOP ? 1440 : 390);
    await preciesEen(page, info.project.name === DESKTOP);
    // Elke media-regel met haar voorwaarde zoals de browser die leest, ook genest in @layer.
    const regels = await page.evaluate(() => {
      const uit: Array<{ voorwaarde: string; selectors: string[] }> = [];
      const loop = (lijst: CSSRuleList) => {
        for (const r of Array.from(lijst)) {
          if (r instanceof CSSMediaRule) {
            const selectors: string[] = [];
            const verzamel = (l: CSSRuleList) => {
              for (const k of Array.from(l)) {
                if (k instanceof CSSStyleRule) selectors.push(k.selectorText);
                if ('cssRules' in k) verzamel((k as CSSGroupingRule).cssRules);
              }
            };
            verzamel(r.cssRules);
            uit.push({ voorwaarde: r.conditionText, selectors });
          }
          if ('cssRules' in r) loop((r as CSSGroupingRule).cssRules);
        }
      };
      for (const s of Array.from(document.styleSheets)) {
        try { loop(s.cssRules); } catch { /* een blad van een ander domein is niet leesbaar */ }
      }
      return uit;
    });
    // De regel van md is die met `.md:flex` (het cluster in de kop blijft CSS): exact de constante.
    const md = regels.filter((r) => r.selectors.includes('.md\\:flex'));
    expect(md.length).toBeGreaterThan(0);
    for (const r of md) expect(r.voorwaarde).toBe(MD_QUERY);
    // En de view vroeg precies die query aan matchMedia.
    expect(await page.evaluate(() => (window as any).__gevraagd as string[])).toContain(MD_QUERY);
  });

  for (const [forceer, breedte] of [[false, 1440], [true, 390]] as const) {
    test(`de view volgt MD_QUERY en niets anders (MD_QUERY geforceerd ${forceer ? 'aan' : 'uit'} op ${breedte} px)`, async ({ page }, info) => {
      alleenIn(info, breedte === 1440 ? DESKTOP : IPHONE_CHROMIUM);
      // Alleen deze ene query krijgt een vaste uitkomst; elke andere (ook 768px) blijft de echte.
      await page.addInitScript(({ q, waarde }) => {
        const echt = window.matchMedia.bind(window);
        window.matchMedia = (query: string) => (query === q
          ? { matches: waarde, media: query, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false } as unknown as MediaQueryList
          : echt(query));
      }, { q: MD_QUERY, waarde: forceer });
      await open(page, ADMIN, breedte);
      await preciesEen(page, forceer);
    });
  }

  test('met standaardletter 20 px (Page.setFontSizes) kiezen view en CSS samen', async ({ page, context }, info) => {
    alleenIn(info, IPHONE_CHROMIUM, DESKTOP);
    const cdp = await context.newCDPSession(page);
    await cdp.send('Page.setFontSizes', { fontSizes: { standard: 20, fixed: 16 } });
    await open(page, ADMIN, 800);
    // Gemeten (14-11): in Chromium verschuift dit de rem in mediaquery's, live. Zo niet, dan zegt deze test niets.
    const stand = await page.evaluate((q) => ({ md: window.matchMedia(q).matches, px: window.matchMedia('(min-width: 768px)').matches }), MD_QUERY);
    test.skip(stand.md, 'Page.setFontSizes verschuift de rem in mediaquery\'s hier niet');
    expect(stand.px, 'op 800 px geldt 768px wel, 48rem (960 px) niet').toBe(true);
    // 800 px is onder 48rem: de dagweergave, en de kop zonder tweewekencluster, zoals de CSS het zegt.
    await preciesEen(page, false);
    await expect(page.getByRole('button', { name: 'Vorige 2 weken' })).toBeHidden();
    // 1000 px is boven 48rem: het raster, met het cluster.
    await page.setViewportSize({ width: 1000, height: 900 });
    await preciesEen(page, true);
    await expect(page.getByRole('button', { name: 'Vorige 2 weken' })).toBeVisible();
  });
});

test('toetssteen 3: van 767 naar 768 px en terug blijven de gekozen dag, de zoekterm en een open celdetail', async ({ page }, info) => {
  alleenIn(info, IPHONE_CHROMIUM, IPHONE_WEBKIT);
  await open(page, CHAUFFEUR, 767);
  await preciesEen(page, false);
  const vandaag = iso(new Date());
  const maand = vandaag.slice(0, 7);
  const dagen = dagenVan(maand);
  // Een andere dag dan vandaag, ver in de strip: de laatste van de maand (of de eerste als dat vandaag is).
  const dag = dagen[dagen.length - 1] === vandaag ? dagen[0] : dagen[dagen.length - 1];
  const strip = page.locator(STRIP);
  await strip.getByRole('tab').nth(dagen.indexOf(dag)).tap();
  await expect(page.getByText(dagkop(dag), { exact: true })).toBeVisible();
  const zoek = page.getByRole('searchbox', { name: 'Zoek chauffeur of dienst' });
  const wie = RIJDERS[5].name;
  await zoek.fill(wie);
  await page.getByRole('button', { name: new RegExp(wie) }).tap();
  const venster = celdetail(page, wie);
  await expect(venster).toBeVisible();
  await expect(venster).toContainText(dagkop(dag).toLowerCase());

  // Naar 768: het raster, het venster blijft open met dezelfde cel, de zoekterm staat er nog.
  await page.setViewportSize({ width: 768, height: 900 });
  await preciesEen(page, true);
  await expect(venster).toBeVisible();
  await expect(venster).toContainText(dagkop(dag).toLowerCase());
  await expect(zoek).toHaveValue(wie);
  await expect(page.locator(RASTER).getByRole('rowheader')).toHaveText([wie]);

  // En terug naar 767: de dagweergave op dezelfde dag, het venster nog altijd open.
  await page.setViewportSize({ width: 767, height: 900 });
  await preciesEen(page, false);
  await expect(venster).toBeVisible();
  await expect(venster).toContainText(dagkop(dag).toLowerCase());
  await sluitAlles(page);
  await kanScrollen(page);
  await expect(strip.getByRole('tab', { selected: true })).toHaveCount(1);
  await expect(strip.getByRole('tab').nth(dagen.indexOf(dag))).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByText(dagkop(dag), { exact: true })).toBeVisible();
  await expect(zoek).toHaveValue(wie);
  await expect(page.getByRole('button', { name: new RegExp(wie) })).toBeVisible();
  // De dag staat in het adres en de strip brengt hem na het terugkomen weer in beeld.
  expect(new URL(page.url()).pathname).toBe(`/maandplanning/${maand}/${dag}`);
  await expect(strip.getByRole('tab', { selected: true })).toBeInViewport();
});

test.describe('toetssteen 4: klik en tik openen het celdetail zoals vandaag, en onder de klik verandert niets', () => {
  /**
   * Eén proef: wat ligt onder het punt, open met een klik of tik, wat ligt er
   * dan (een tweede klik na 0,3, 1 en 2 s en Enter of spatie schrijven niets),
   * sluit, en onder het punt ligt weer dezelfde knop.
   */
  async function proef(page: Page, punt: { x: number; y: number }, wie: string, tik: boolean) {
    const voor = await onderPunt(page, punt);
    expect(voor.knop, 'onder het punt ligt een cel of rij').toBeTruthy();
    const druk = () => (tik ? page.touchscreen.tap(punt.x, punt.y) : page.mouse.click(punt.x, punt.y));
    const schrijf = schrijfacties(page);
    await druk();
    await expect(celdetail(page, wie)).toBeVisible();
    await sluitAlles(page);
    await expect.poll(() => onderPunt(page, punt), 'na het sluiten ligt dezelfde knop onder het punt').toEqual(voor);
    // Vaste toetssteen 1: een tweede klik op dezelfde plek en Enter of spatie beslissen niets.
    for (const wacht of [300, 1000, 2000]) {
      await druk();
      await expect(celdetail(page, wie)).toBeVisible();
      await page.waitForTimeout(wacht);
      await druk();
      await page.waitForTimeout(200);
      await sluitAlles(page);
    }
    for (const toets of ['Enter', ' ']) {
      await druk();
      await expect(celdetail(page, wie)).toBeVisible();
      await page.keyboard.press(toets);
      await page.waitForTimeout(200);
      await sluitAlles(page);
    }
    expect(schrijf, 'geen enkele schrijfactie').toEqual([]);
    await expect.poll(() => onderPunt(page, punt)).toEqual(voor);
  }

  for (const breedte of [768, 1024, 1280, 1440]) {
    test(`desktop ${breedte} px, muis`, async ({ page }, info) => {
      alleenIn(info, DESKTOP);
      await open(page, ADMIN, breedte);
      await preciesEen(page, true);
      const raster = page.locator(RASTER);
      for (const [wie, kolom] of [[RIJDERS[3].name, 0], [RIJDERS[8].name, 6]] as const) {
        const cel = raster.getByRole('row').filter({ has: page.getByRole('rowheader', { name: wie, exact: true }) }).getByRole('button').nth(kolom);
        await proef(page, await midden(cel), wie, false);
      }
    });
  }

  for (const user of [CHAUFFEUR, ADMIN]) {
    test(`telefoon 390 px, tik (${user.role})`, async ({ page }, info) => {
      alleenIn(info, IPHONE_CHROMIUM);
      await open(page, user, 390);
      await preciesEen(page, false);
      for (const wie of [RIJDERS[3].name, RIJDERS[8].name]) {
        const rij = page.getByRole('button', { name: new RegExp(wie) });
        await proef(page, await midden(rij), wie, true);
      }
    });
  }
});
