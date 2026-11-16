import { test, expect, type Page } from '@playwright/test';
import { ADMIN, CHAUFFEUR, seed, wachtOpAnimaties, type Fixture } from './helpers';
import { TECHNIEKER } from '../scripts/audit-fixtures.mjs';

/**
 * Eén skelet per scherm (ronde 6, punt 3). Een koude start met een opgeslagen
 * sessie toonde drie vormen na elkaar: de schil van de app (AppSkeleton, vóór
 * `/api/me`), de Suspense-terugval (terwijl de code van het scherm laadt) en
 * het skelet van het scherm zelf (terwijl de gegevens laden). Deze proeven
 * houden elke fase vast (een vertraagde `/api/me`, de chunk van het scherm en
 * `/api/planning`), laten ze uitlopen en vergelijken de vakken.
 *
 * Elke fase heeft een eigen kenmerk in de DOM, want na deze ronde zien de
 * fasen er hetzelfde uit en zou "er staat een skelet" drie keer dezelfde fase
 * kunnen meten:
 *   schil               binnen "Portaal wordt geladen" (AppSkeleton)
 *   terugval            direct onder #hoofdinhoud (de Suspense van de schil)
 *   verwissel           in de wikkel van Verwissel, zonder klasse (gegevens laden)
 *   terugval-in-scherm  in de wikkel van Verwissel mét `fade-in` (de Suspense
 *                       rond een lui scherm, nadat de gegevens binnen zijn)
 * Bovendien moet elke meting op een nieuw DOM-element vallen.
 */

type Vak = { x: number; y: number; b: number; h: number };
type Plaats = 'schil' | 'terugval' | 'verwissel' | 'terugval-in-scherm';
type Meting = { kop: Vak; kopTag: string; regels: Vak[]; kaart: Vak; html: string; h1: string | null; tekst: string };

const SKELET = '[aria-label="Scherm wordt geladen"], [aria-label="Mijn dag wordt geladen"]';

/** Houdt een GET tegen tot `laatLos()`; daarna valt hij terug op het gewone antwoord. */
const houdTegen = async (page: Page, past: (url: URL) => boolean) => {
  let laatLos!: () => void;
  const los = new Promise<void>((resolve) => { laatLos = resolve; });
  let gevraagd!: () => void;
  const aangevraagd = new Promise<void>((resolve) => { gevraagd = resolve; });
  // Later geregistreerd dan de fixtures in seed(), dus deze route wint.
  await page.route((url) => past(url), async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    gevraagd();
    await los;
    return route.fallback();
  });
  return { laatLos, aangevraagd };
};
const api = (pad: string) => (url: URL) => url.pathname === pad;
const chunk = (naam: string) => (url: URL) => new RegExp(`/assets/${naam}-[^/]+\\.js$`).test(url.pathname);

/** Het zichtbare schermskelet (niet dat van de voorgerenderde schil): waar het staat en of het al gemeten is. */
const skeletStaat = (page: Page) => page.evaluate((sel) => {
  const el = [...document.querySelectorAll<HTMLElement>(sel)].find((e) => e.getClientRects().length > 0 && !e.closest('#voorschil-warm, #voorschil-koud'));
  if (!el) return null;
  const ouder = el.parentElement!;
  const plaats = el.closest('[aria-label="Portaal wordt geladen"]') ? 'schil'
    : ouder.id === 'hoofdinhoud' ? 'terugval'
    : ouder.classList.contains('fade-in') ? 'terugval-in-scherm'
    : ouder.classList.contains('fade-uit') ? 'verwissel-uit'
    : 'verwissel';
  return { plaats, nieuw: !(el as HTMLElement & { gemeten?: boolean }).gemeten };
}, SKELET);

/** Twee gelijke metingen na elkaar: de plaats staat stil. */
const stil = async <T>(page: Page, meet: () => Promise<T>): Promise<T> => {
  await wachtOpAnimaties(page);
  let vorige = '';
  await expect.poll(async () => {
    const nu = JSON.stringify(await meet());
    const gelijk = nu === vorige;
    vorige = nu;
    return gelijk;
  }, { message: 'de meting staat stil', intervals: [80, 120, 200] }).toBe(true);
  return JSON.parse(vorige) as T;
};

/** Wacht op het skelet van deze fase (een nieuw element op de verwachte plaats), meet het en merkt het als gemeten. */
const meetSkelet = async (page: Page, plaats: Plaats): Promise<Meting> => {
  await expect.poll(() => skeletStaat(page), { message: `het skelet van de fase "${plaats}" staat er`, timeout: 15_000 }).toEqual({ plaats, nieuw: true });
  const meting = await stil(page, () => page.evaluate((sel) => {
    const el = [...document.querySelectorAll<HTMLElement>(sel)].find((e) => e.getClientRects().length > 0 && !e.closest('#voorschil-warm, #voorschil-koud'))!;
    const vak = (e: Element) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, b: r.width, h: r.height }; };
    // Kop: <header> met één tekstblok (ViewLoader) of het blok zelf (Mijn dag).
    const kop = el.firstElementChild!;
    const blok = kop.tagName === 'HEADER' ? kop.firstElementChild! : kop;
    return {
      kop: vak(kop),
      kopTag: kop.tagName,
      regels: [...blok.children].map(vak),
      kaart: vak(el.children[1]),
      html: el.outerHTML,
      h1: el.querySelector('h1')?.textContent ?? null,
      tekst: el.innerText.trim(),
    };
  }, SKELET));
  // Nog steeds dezelfde fase (de volgende aanvraag hangt), en nu gemerkt.
  expect(await skeletStaat(page)).toEqual({ plaats, nieuw: true });
  await page.evaluate((sel) => {
    const el = [...document.querySelectorAll<HTMLElement>(sel)].find((e) => e.getClientRects().length > 0 && !e.closest('#voorschil-warm, #voorschil-koud'))!;
    (el as HTMLElement & { gemeten?: boolean }).gemeten = true;
  }, SKELET);
  return meting;
};

const VELDEN = ['x', 'y', 'b', 'h'] as const;
const zelfdeVak = (a: Vak, b: Vak, wat: string, velden: readonly (keyof Vak)[] = VELDEN) => {
  for (const k of velden) expect(Math.abs(a[k] - b[k]), `${wat}: ${k} ${a[k].toFixed(1)} tegen ${b[k].toFixed(1)}`).toBeLessThanOrEqual(2);
};
const zelfdeVorm = (a: Meting, b: Meting, wat: string) => {
  zelfdeVak(a.kop, b.kop, `${wat}, de kop`);
  expect(a.regels.length, `${wat}: evenveel regels in de kop`).toBe(b.regels.length);
  a.regels.forEach((r, i) => zelfdeVak(r, b.regels[i], `${wat}, regel ${i + 1} van de kop`));
  zelfdeVak(a.kaart, b.kaart, `${wat}, de eerste kaart`);
};

// --- 1 en 2. Koude start: drie fasen, één vorm ---------------------------------

type Scherm = {
  naam: string; pad: string; view: string; user: Fixture; chunk: string;
  /** De twee fasen na de schil, in de volgorde waarin dit scherm ze toont. */
  fasen: [Plaats, Plaats];
  /** Wat de tweede fase op gang brengt: de code van het scherm of de gegevens. */
  eerstLos: 'chunk' | 'planning';
  /** Titel en eyebrow uit de routetabel; null = het skelet draagt geen tekst (Mijn dag). */
  titel: string | null; eyebrow?: string;
  themas: ('light' | 'dark')[];
};

const SCHERMEN: Scherm[] = [
  // Mijn dag: de schil wacht eerst op de code (Suspense), dan toont het scherm zelf zijn skelet.
  { naam: 'Mijn dag', pad: '/mijn-dag', view: 'mijn-dag', user: CHAUFFEUR, chunk: 'MijnDagView', fasen: ['terugval', 'verwissel'], eerstLos: 'chunk', titel: null, themas: ['light', 'dark'] },
  // Dienstruil: Verwissel houdt het skelet aan tot de gegevens er zijn, daarna wacht de schil op de code.
  { naam: 'Dienstruil', pad: '/dienstruil', view: 'ruil-verzoeken', user: CHAUFFEUR, chunk: 'SwapRequestsView', fasen: ['verwissel', 'terugval'], eerstLos: 'planning', titel: 'Dienstruil', themas: ['light'] },
  // Verlof en Beheer planning: Verwissel, daarna de Suspense rond het luie scherm zelf.
  { naam: 'Verlof', pad: '/verlof', view: 'verlof', user: CHAUFFEUR, chunk: 'LeaveManagementView', fasen: ['verwissel', 'terugval-in-scherm'], eerstLos: 'planning', titel: 'Verlof', themas: ['light'] },
  { naam: 'Beheer planning (staf, met eyebrow)', pad: '/beheer/planning', view: 'beheer-roosters', user: ADMIN, chunk: 'ManageSchedulesView', fasen: ['verwissel', 'terugval-in-scherm'], eerstLos: 'planning', titel: 'Beheer planning', eyebrow: 'Beheer · Planning', themas: ['light'] },
];

for (const s of SCHERMEN) {
  for (const thema of s.themas) {
    test(`koude start op ${s.naam} (${thema}): schil, terugval en scherm tonen één skelet`, async ({ page }) => {
      await seed(page, { user: s.user, view: s.view, thema });
      const me = await houdTegen(page, api('/api/me'));
      const code = await houdTegen(page, chunk(s.chunk));
      const planning = await houdTegen(page, api('/api/planning'));
      await page.goto(s.pad);

      // Fase 1, de schil van de app: React heeft de voorgerenderde laag
      // vervangen en wacht op het profiel.
      await me.aangevraagd;
      await expect(page.locator('#voorschil-warm')).toHaveCount(0);
      const schil = await meetSkelet(page, 'schil');
      // De rol is nog onbekend: geen titel of sectiewoord als tekst (toetssteen 2).
      expect(schil.h1, 'de schil toont geen titeltekst').toBeNull();
      expect(schil.tekst, 'de schil toont geen tekst in het skelet').toBe('');

      // Fase 2: het profiel is er, code en gegevens hangen nog.
      me.laatLos();
      await expect(page.locator('[aria-label="Portaal wordt geladen"]')).toHaveCount(0);
      const tweede = await meetSkelet(page, s.fasen[0]);

      // Fase 3: één van de twee komt binnen, de andere hangt nog (de code van
      // een scherm achter Verwissel wordt pas gevraagd als de gegevens er zijn).
      const [eerst, laatst] = s.eerstLos === 'chunk' ? [code, planning] : [planning, code];
      eerst.laatLos();
      const derde = await meetSkelet(page, s.fasen[1]);
      await laatst.aangevraagd;

      zelfdeVorm(schil, tweede, 'schil tegen de volgende fase');
      zelfdeVorm(tweede, derde, 'tweede tegen derde fase');
      zelfdeVorm(schil, derde, 'schil tegen derde fase');

      if (s.titel === null) {
        // Mijn dag: letterlijk hetzelfde skelet, dezelfde DOM-opbouw in de drie fasen.
        expect(tweede.html).toBe(schil.html);
        expect(derde.html).toBe(schil.html);
        expect(schil.regels).toHaveLength(3);
      } else {
        // Vanaf de terugval staat de echte titel uit de routetabel er, zoals vroeger.
        expect(tweede.h1).toBe(s.titel);
        expect(derde.h1).toBe(s.titel);
        expect(derde.html).toBe(tweede.html);
        // toUpperCase: het sectiewoord staat in kapitalen (text-micro), innerText volgt de opmaak.
        if (s.eyebrow) expect(tweede.tekst.toUpperCase()).toContain(s.eyebrow.toUpperCase());
        expect(schil.regels).toHaveLength(tweede.regels.length);
      }

      // Daarna de inhoud: het skelet is weg en het scherm staat er.
      laatst.laatLos();
      await expect(page.locator(SKELET).filter({ visible: true })).toHaveCount(0, { timeout: 15_000 });
      await expect(page.locator('#hoofdinhoud').getByRole('heading', { level: 1 })).toBeVisible();
    });
  }
}

// --- Rooster: dezelfde rijvorm in terugval en scherm -----------------------------

test('Rooster: het laadskelet onder de kop heeft dezelfde rijen als de terugval', async ({ page }) => {
  await seed(page, { user: CHAUFFEUR, view: 'rooster', thema: 'light' });
  const code = await houdTegen(page, chunk('ScheduleView'));
  const planning = await houdTegen(page, api('/api/planning'));
  await page.goto('/rooster');

  const lijst = (wortel: string) => stil(page, () => page.evaluate((sel) => {
    const kaart = [...document.querySelectorAll<HTMLElement>(sel)].find((e) => e.getClientRects().length > 0 && e.querySelector('.skeleton'))!;
    const vak = (e: Element) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, b: r.width, h: r.height }; };
    return { kaart: vak(kaart), rijen: [...kaart.children].map(vak), html: kaart.outerHTML };
  }, wortel));

  // Terugval: de code van het Rooster hangt nog; het skelet van de schil met de echte kop.
  await expect.poll(() => skeletStaat(page), { timeout: 15_000 }).toEqual({ plaats: 'terugval', nieuw: true });
  const terugval = await lijst('[aria-label="Scherm wordt geladen"] > .surface-card');
  expect(terugval.rijen).toHaveLength(5);

  // Scherm: het Rooster staat er met zijn eigen kop en laadt zijn gegevens.
  await planning.aangevraagd;
  code.laatLos();
  await expect(page.locator('#hoofdinhoud').getByRole('heading', { level: 1, name: 'Rooster' })).toBeVisible();
  await expect(page.locator('[aria-label="Scherm wordt geladen"]').filter({ visible: true })).toHaveCount(0);
  const scherm = await lijst('#hoofdinhoud .surface-card');

  // Zelfde kaart, zelfde rijen (vorm en aantal). De plaats in de hoogte mag
  // verschillen: tussen kop en kaart staat hier de weergaveschakelaar.
  expect(scherm.html).toBe(terugval.html);
  expect(scherm.rijen).toHaveLength(terugval.rijen.length);
  zelfdeVak(scherm.kaart, terugval.kaart, 'de lijstkaart', ['x', 'b', 'h']);
  scherm.rijen.forEach((r, i) => zelfdeVak(r, terugval.rijen[i], `rij ${i + 1}`, ['x', 'b', 'h']));

  planning.laatLos();
  await expect(page.locator('#hoofdinhoud .skeleton').filter({ visible: true })).toHaveCount(0, { timeout: 15_000 });
});

// --- 3. Cockpit: elk skeletvak valt samen met de tegel die volgt -------------------

type Strip = { raster: Vak; richting: string; tegels: { vak: Vak; klassen: string; subHoogte: number; skelet: boolean }[] };

const meetStrip = (page: Page) => stil<Strip>(page, () => page.evaluate(() => {
  const raster = document.querySelector<HTMLElement>('#hoofdinhoud section .kpi-raster')!;
  const vak = (e: Element) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, b: r.width, h: r.height }; };
  return {
    raster: vak(raster),
    richting: getComputedStyle(raster).display === 'flex' ? getComputedStyle(raster).flexDirection : getComputedStyle(raster).display,
    tegels: [...raster.children].map((t) => ({
      vak: vak(t),
      // De plaats in het raster: de klassen uit stripKlassen.
      klassen: [...t.classList].filter((c) => /col-span/.test(c)).join(' '),
      subHoogte: t.querySelector('.kpi-sub')!.getBoundingClientRect().height,
      skelet: !!t.querySelector('.skeleton'),
    })),
  };
}));

const VERBORGEN = ['beschikbaar', 'omleidingen'];
for (const breedte of [390, 768, 1280, 1440]) {
  for (const variant of ['vijf tegels', 'twee tegels verborgen'] as const) {
    test(`cockpit op ${breedte} px, ${variant}: elk skeletvak valt samen met zijn tegel`, async ({ page, isMobile }) => {
      // De telefoonprojecten meten hun eigen breedte; de andere breedtes horen bij het desktopproject.
      test.skip(isMobile && breedte !== 390, 'alleen op het desktopproject');
      const aantal = variant === 'vijf tegels' ? 5 : 3;
      const user = variant === 'vijf tegels' ? ADMIN : { ...ADMIN, dashboardVoorkeuren: { verborgen: VERBORGEN, volgorde: [] } };
      if (!isMobile) await page.setViewportSize({ width: breedte, height: 900 });
      await seed(page, { user, view: 'dashboard', thema: 'light' });
      const planning = await houdTegen(page, api('/api/planning'));
      await page.goto('/');

      // Het skelet van de cockpit zelf (isInitialLoad): tegels in het echte raster.
      await planning.aangevraagd;
      await expect(page.locator('#hoofdinhoud section .kpi-raster > .kpi-tegel .skeleton').first()).toBeVisible({ timeout: 15_000 });
      const skelet = await meetStrip(page);
      expect(skelet.tegels).toHaveLength(aantal);
      expect(skelet.tegels.every((t) => t.skelet)).toBe(true);

      planning.laatLos();
      await expect(page.locator('#hoofdinhoud section .kpi-raster > button.kpi-tegel')).toHaveCount(aantal, { timeout: 15_000 });
      const strip = await meetStrip(page);
      expect(strip.tegels.some((t) => t.skelet)).toBe(false);

      // Zelfde rasterklassen (één berekening, stripKlassen) en zelfde vorm van het raster.
      expect(skelet.tegels.map((t) => t.klassen)).toEqual(strip.tegels.map((t) => t.klassen));
      expect(skelet.richting).toBe(strip.richting);
      // Op de telefoon is de strip één kaart met rijen, het skelet dus ook.
      if (breedte < 640) expect(skelet.richting).toBe('column');
      else expect(skelet.richting).toBe('grid');

      // Plaats en breedte altijd; de hoogte zolang de subregel van de echte
      // tegel op één regel past (op de telefoon mag ze omlopen, en dan zakt
      // ook alles eronder).
      const omloop = strip.tegels.findIndex((t) => t.subHoogte > 24);
      strip.tegels.forEach((t, i) => {
        const past = omloop === -1 || i < omloop;
        zelfdeVak(skelet.tegels[i].vak, t.vak, `tegel ${i + 1}`, past ? VELDEN : i === omloop ? ['x', 'y', 'b'] : ['x', 'b']);
      });
      if (omloop !== -1) test.info().annotations.push({ type: 'subregel loopt om', description: `tegel ${omloop + 1} op ${breedte} px` });
      else zelfdeVak(skelet.raster, strip.raster, 'het raster');
    });
  }
}

// --- 4. Gele-boektegel (technieker): de terugval heeft de maat van de tegel -------

test('technieker: de terugval van de gele-boektegel heeft de maat en de plaats van de tegel die volgt', async ({ page }) => {
  await seed(page, { user: TECHNIEKER, view: 'dashboard', thema: 'light' });
  const code = await houdTegen(page, chunk('GeleBoekTegel'));
  await page.goto('/');

  await code.aangevraagd;
  const terugval = page.locator('#hoofdinhoud .kpi-tegel').filter({ has: page.locator('.skeleton') });
  await expect(terugval).toHaveCount(1, { timeout: 15_000 });
  const meet = (sel: string) => stil(page, () => page.evaluate((s) => {
    const el = [...document.querySelectorAll<HTMLElement>(s)].find((e) => e.getClientRects().length > 0)!;
    const r = el.getBoundingClientRect();
    return { vak: { x: r.x, y: r.y, b: r.width, h: r.height }, klassen: [...el.classList].filter((c) => /col-span/.test(c)).sort().join(' ') };
  }, sel));
  const skelet = await meet('#hoofdinhoud .kpi-tegel:has(.skeleton)');

  code.laatLos();
  const tegel = page.locator('#hoofdinhoud').getByRole('button', { name: /^Gele boek/ });
  await expect(tegel).toBeVisible({ timeout: 15_000 });
  await expect(terugval).toHaveCount(0);
  const echt = await meet('#hoofdinhoud button.kpi-tegel');

  // De eerste kleine tegel van de technieker is de gele-boektegel zelf.
  await expect(page.locator('#hoofdinhoud button.kpi-tegel').first()).toHaveAccessibleName(/^Gele boek/);
  expect(skelet.klassen).toBe(echt.klassen);
  zelfdeVak(skelet.vak, echt.vak, 'de gele-boektegel');
});

// --- 7. Geen titeltekst die daarna een ander scherm blijkt ------------------------

test('chauffeur met een stafscherm als laatst geopende pagina: de schil toont geen titel, daarna het dashboard', async ({ page }) => {
  // Oude bladwijzer of gedeeld toestel: de router zet de start op /beheer/planning.
  await seed(page, { user: CHAUFFEUR, view: 'beheer-roosters', thema: 'light' });
  const me = await houdTegen(page, api('/api/me'));
  await page.goto('/');
  await me.aangevraagd;
  await expect(page.locator('#voorschil-warm')).toHaveCount(0);

  expect(new URL(page.url()).pathname).toBe('/beheer/planning');

  const schil = await meetSkelet(page, 'schil');
  // De kop van het stafscherm (een <header>, niet het dashboardraster) als
  // skeletregels: eyebrow en titel, geen woord tekst.
  expect(schil.kopTag).toBe('HEADER');
  expect(schil.regels).toHaveLength(2);
  expect(schil.h1).toBeNull();
  expect(schil.tekst).toBe('');
  await expect(page.getByRole('status', { name: 'Portaal wordt geladen' }).locator('header.topbar')).toHaveText('');
  await expect(page.getByText('Beheer planning', { exact: true })).toHaveCount(0);

  me.laatLos();
  // Een chauffeur mag dat scherm niet: hij krijgt het dashboard.
  await expect(page.locator('#hoofdinhoud').getByRole('heading', { level: 1 })).toContainText('Test', { timeout: 15_000 });
  await expect(page.getByText('Beheer planning', { exact: true })).toHaveCount(0);
  expect(new URL(page.url()).pathname).toBe('/');
});
