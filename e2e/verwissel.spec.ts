import { test, expect, type Locator, type Page } from '@playwright/test';
import { ADMIN, CHAUFFEUR, seed, type Extra } from './helpers';

/**
 * Verwissel (ronde 6, punt 3): van skelet naar inhoud zonder leeg moment.
 * Tot 14-11 fadede het skelet eerst uit (150 ms) en kwam de inhoud pas na
 * zijn animationend in: één beeld met niets erin. Nu een cross-fade: de
 * inhoud staat er meteen op haar plaats en komt op, het skelet vervaagt er
 * absoluut bovenop en is ±150 ms later weg.
 *
 * Een init-script legt per animatieframe vast wat er te zien is (dekking van
 * skelet en kop, plaats van de kop en van wat eronder staat), plus elke
 * overlap: de laag, zijn wrapper en wat er onder het midden van de inhoud
 * ligt. De data blijft tegengehouden tot de meting loopt.
 */

type Laag = {
  start: number; eind: number | null;
  pointerEvents: string; position: string; laagOverflow: string;
  wrapperPosition: string; wrapperOverflow: string; wrapperTransform: string;
  raakSkelet: boolean | null; inhoudDekking: number;
  naPosition: string; naOverflow: string; naTransform: string; naClass: string; inDom: boolean;
};
type Frame = { t: number; overlap: boolean; skelet: number | null; skeletInLaag: boolean; kop: number | null; kopTop: number | null; onder: number[]; extra: number | null };
type Opname = { lagen: Laag[]; frames: Frame[]; shifts: Array<{ t: number; v: number }> };

function opname() {
  type LaagIntern = { laag: Element; wrapper: Element; data: Record<string, unknown> };
  const w = window as unknown as Record<string, unknown>;
  const lagen: LaagIntern[] = [];
  const frames: unknown[] = [];
  const shifts: Array<{ t: number; v: number }> = [];
  const dekking = (el: Element) => {
    let o = 1;
    for (let n: Element | null = el; n; n = n.parentElement) o *= Number(getComputedStyle(n).opacity);
    return o;
  };
  try {
    new PerformanceObserver((lijst) => {
      for (const e of lijst.getEntries() as Array<PerformanceEntry & { value: number; hadRecentInput: boolean }>) {
        if (!e.hadRecentInput) shifts.push({ t: e.startTime, v: e.value });
      }
    }).observe({ type: 'layout-shift', buffered: true });
  } catch { /* WebKit kent layout-shift niet */ }
  new MutationObserver((mutaties) => {
    for (const m of mutaties) {
      if (m.type === 'attributes') {
        const laag = m.target as Element;
        const wrapper = laag.parentElement;
        if (!wrapper || !laag.classList.contains('fade-uit') || laag.getAttribute('aria-hidden') !== 'true') continue;
        if (lagen.some((l) => l.laag === laag && l.data.eind === null)) continue;
        const inhoud = wrapper.firstElementChild!;
        const r = inhoud.getBoundingClientRect();
        const raak = document.elementFromPoint(r.left + Math.min(r.width / 2, 60), r.top + Math.min(r.height / 2, 12));
        const ls = getComputedStyle(laag);
        const ws = getComputedStyle(wrapper);
        lagen.push({ laag, wrapper, data: {
          start: performance.now(), eind: null,
          pointerEvents: ls.pointerEvents, position: ls.position, laagOverflow: ls.overflow,
          wrapperPosition: ws.position, wrapperOverflow: ws.overflow, wrapperTransform: ws.transform,
          raakSkelet: raak ? laag.contains(raak) : null, inhoudDekking: dekking(inhoud),
        } });
        (w.__bijOverlap as ((wrapper: Element) => void) | undefined)?.(wrapper);
      }
      if (m.type === 'childList') {
        for (const n of m.removedNodes) {
          const l = lagen.find((x) => x.laag === n);
          if (l && l.data.eind === null) l.data.eind = performance.now();
        }
      }
    }
  }).observe(document, { subtree: true, attributes: true, attributeFilter: ['class'], childList: true });

  const zichtbaar = (sel: string) => [...document.querySelectorAll(sel)].filter((el) => !el.closest('[aria-hidden="true"]'));
  w.__meet = (cfg: { skelet: string; kop: string; onder?: string }, duur: number) => new Promise<void>((klaar) => {
    const t0 = performance.now();
    const stap = () => {
      const sk = document.querySelector(cfg.skelet);
      const kop = zichtbaar(cfg.kop)[0];
      frames.push({
        t: performance.now(),
        overlap: lagen.some((l) => l.laag.isConnected && l.data.eind === null && l.laag.classList.contains('fade-uit')),
        skelet: sk ? dekking(sk) : null,
        skeletInLaag: !!sk?.closest('.fade-uit'),
        kop: kop ? dekking(kop) : null,
        kopTop: kop ? kop.getBoundingClientRect().top : null,
        onder: cfg.onder ? zichtbaar(cfg.onder).map((el) => el.getBoundingClientRect().top) : [],
        extra: (w.__extraMeting as (() => number | null) | undefined)?.() ?? null,
      });
      if (performance.now() - t0 < duur) requestAnimationFrame(stap);
      else klaar();
    };
    requestAnimationFrame(stap);
  });
  w.__opname = () => ({
    lagen: lagen.map((l) => {
      const ws = getComputedStyle(l.wrapper);
      return { ...l.data, naPosition: ws.position, naOverflow: ws.overflow, naTransform: ws.transform, naClass: l.wrapper.className, inDom: l.wrapper.isConnected };
    }),
    frames,
    shifts,
  });
}

/** Houdt GET-verzoeken op `paden` tegen tot `laatLos()`. Later geregistreerd
 *  dan de fixtures van seed(), dus deze route wint; daarna het gewone antwoord. */
async function houdTegen(page: Page, paden: string[]) {
  let laatLos!: () => void;
  const los = new Promise<void>((r) => { laatLos = r; });
  let gevraagd!: () => void;
  const aangevraagd = new Promise<void>((r) => { gevraagd = r; });
  for (const pad of paden) {
    await page.route(`**${pad}`, async (route) => {
      if (new URL(route.request().url()).pathname !== pad || route.request().method() !== 'GET') return route.fallback();
      gevraagd();
      await los;
      return route.fallback();
    });
  }
  return { laatLos, aangevraagd };
}

/** Start de meting, laat de data los en geeft de opname terug. */
async function meetWissel(page: Page, los: () => void, cfg: { skelet: string; kop: string; onder?: string }, duur = 1400): Promise<Opname> {
  const meting = page.evaluate(([c, d]) => (window as unknown as { __meet: (c: unknown, d: number) => Promise<void> }).__meet(c, d), [cfg, duur] as const);
  // Twee frames vóór het loslaten, zodat de tijdlijn met het skelet begint.
  await page.waitForTimeout(60);
  los();
  await meting;
  return page.evaluate(() => (window as unknown as { __opname: () => Opname }).__opname());
}

/** Tijdens de overlap: wat toont de toegankelijkheidsboom? Elke ronde
 *  matcht Playwright de rol en leest in dezelfde evaluatie of de overlap er
 *  op dat moment was; alleen die rondes tellen. */
async function rollenTijdensOverlap(zoek: () => Array<{ naam: string; locator: Locator }>) {
  const gezien: Array<Record<string, number>> = [];
  for (let i = 0; i < 80 && gezien.length < 3; i++) {
    const ronde: Record<string, number> = {};
    let inOverlap = true;
    for (const { naam, locator } of zoek()) {
      const r = await locator.evaluateAll((els) => ({ n: els.length, overlap: !!document.querySelector('.fade-uit[aria-hidden="true"]') }));
      ronde[naam] = r.n;
      inOverlap &&= r.overlap;
    }
    if (inOverlap) gezien.push(ronde);
  }
  return gezien;
}

const isDesktop = (naam: string) => naam.startsWith('Desktop');

test.describe('Mijn dag (telefoon)', () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(isDesktop(testInfo.project.name), 'Mijn dag meet de telefoon; Beheer › Mails en de tabelkop meten desktop');
  });

  test('het skelet vervaagt terwijl de inhoud opkomt: nooit een frame zonder beide, de kop staat meteen op haar plaats', async ({ page, browserName }) => {
    await seed(page, { user: CHAUFFEUR, view: 'mijn-dag' });
    await page.addInitScript(opname);
    // Verlof zit in de poort: zolang het onderweg is, blijft Mijn dag op zijn skelet.
    const poort = await houdTegen(page, ['/api/leave']);
    await page.goto('/mijn-dag');
    await poort.aangevraagd;
    const skelet = page.locator('[aria-label="Mijn dag wordt geladen"]');
    await expect(skelet).toBeVisible({ timeout: 15_000 });
    // Ruim voorbij de 180 ms: de wissel begint meteen bij het antwoord.
    await page.waitForTimeout(400);

    const [opnameUit, rollen] = await Promise.all([
      meetWissel(page, poort.laatLos, { skelet: '[aria-label="Mijn dag wordt geladen"]', kop: '#hoofdinhoud h1' }),
      (async () => {
        await page.waitForFunction(() => !!document.querySelector('.fade-uit[aria-hidden="true"]'), undefined, { polling: 'raf', timeout: 10_000 });
        return rollenTijdensOverlap(() => [
          { naam: 'status', locator: page.getByRole('status', { name: 'Mijn dag wordt geladen' }) },
          // Het skelet zelf staat er op dat moment wel: in de DOM, verborgen.
          { naam: 'skeletInDom', locator: page.locator('[aria-label="Mijn dag wordt geladen"]') },
          { naam: 'kop', locator: page.getByRole('heading', { level: 1 }) },
          { naam: 'dagkeuze', locator: page.getByRole('group', { name: 'Dag kiezen' }).getByRole('button', { name: 'Morgen' }) },
        ]);
      })(),
    ]);
    const { frames, lagen, shifts } = opnameUit;

    // Eén overlap, met een laag die geen klik vangt en niet voorgelezen wordt.
    expect(lagen).toHaveLength(1);
    const [laag] = lagen;
    expect(laag.pointerEvents).toBe('none');
    expect(laag.position).toBe('absolute');
    expect(laag.laagOverflow).toBe('clip');
    expect(laag.wrapperPosition).toBe('relative');
    expect(laag.wrapperOverflow, 'de wrapper zelf knipt niet').toBe('visible');
    expect(laag.wrapperTransform).toBe('none');
    expect(laag.raakSkelet, 'een tik op de inhoud raakt de inhoud, niet het skelet').toBe(false);

    // De tijdlijn begint met het skelet en zonder inhoud.
    expect(frames.length).toBeGreaterThan(20);
    expect(frames[0].skelet).not.toBeNull();
    expect(frames[0].kop).toBeNull();
    // In het frame waarin het skelet begint te vervagen staat de inhoud er al.
    const i0 = frames.findIndex((f) => f.skeletInLaag);
    expect(i0, 'er is een frame met het vervagende skelet').toBeGreaterThan(0);
    const f0 = frames[i0];
    expect(f0.kop, 'de kop staat in de DOM in het eerste frame van de overlap').not.toBeNull();
    expect(f0.kop!).toBeGreaterThanOrEqual(0.019);
    expect(frames.slice(0, i0).every((f) => f.kop === null), 'vóór de overlap nog geen inhoud').toBe(true);
    // Nooit een frame waarin skelet én inhoud allebei weg of onzichtbaar zijn.
    for (const f of frames) {
      expect(Math.max(f.skelet ?? 0, f.kop ?? 0), `frame op ${Math.round(f.t - f0.t)} ms`).toBeGreaterThan(0.3);
    }
    // De kop staat vanaf het eerste frame op haar eindplaats.
    const eind = frames[frames.length - 1];
    expect(eind.kop).toBeCloseTo(1, 3);
    for (const f of frames.slice(i0)) expect(Math.abs(f.kopTop! - eind.kopTop!), `kop op ${Math.round(f.t - f0.t)} ms`).toBeLessThanOrEqual(1);
    // ±220 ms later: inhoud volledig, skelet uit de DOM.
    const na = frames.filter((f) => f.t - f0.t >= 320);
    expect(na.length).toBeGreaterThan(5);
    expect(na[0].kop!, 'na de fade-in van 220 ms is de inhoud volledig').toBeCloseTo(1, 3);
    expect(frames.filter((f) => f.t - f0.t >= 450).every((f) => f.skelet === null), 'het skelet is uit de DOM').toBe(true);
    expect(laag.eind).not.toBeNull();
    expect(laag.eind! - laag.start).toBeLessThan(400);

    // Na de overlap is de wrapper weer kaal.
    expect(laag.inDom).toBe(true);
    expect([laag.naPosition, laag.naOverflow, laag.naTransform, laag.naClass]).toEqual(['static', 'visible', 'none', '']);

    // Tijdens de overlap ziet een schermlezer alleen de inhoud.
    expect(rollen.length, 'de rollen zijn tijdens de overlap gelezen').toBeGreaterThan(0);
    for (const r of rollen) expect(r).toEqual({ status: 0, skeletInDom: 1, kop: 1, dagkeuze: 1 });

    // Geen verschuiving tijdens de overlap (WebKit kent layout-shift niet).
    if (browserName === 'chromium') {
      const tijdens = shifts.filter((s) => s.t > laag.start + 20);
      expect(tijdens, 'geen layout shift tijdens of na de overlap').toEqual([]);
    }
  });

  test('reduced motion: meteen de inhoud, geen laag en geen tweede beeld', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await seed(page, { user: CHAUFFEUR, view: 'mijn-dag' });
    await page.addInitScript(opname);
    const poort = await houdTegen(page, ['/api/leave']);
    await page.goto('/mijn-dag');
    await poort.aangevraagd;
    await expect(page.locator('[aria-label="Mijn dag wordt geladen"]')).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(400);
    const { frames, lagen } = await meetWissel(page, poort.laatLos, { skelet: '[aria-label="Mijn dag wordt geladen"]', kop: '#hoofdinhoud h1' }, 800);
    expect(lagen).toHaveLength(0);
    const i = frames.findIndex((f) => f.kop !== null);
    expect(i).toBeGreaterThan(0);
    for (const f of frames.slice(i)) {
      expect(f.kop).toBe(1);
      expect(f.skelet).toBeNull();
    }
    expect(frames.every((f) => !f.skeletInLaag)).toBe(true);
  });
});

test.describe('Desktop', () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(!isDesktop(testInfo.project.name), 'Beheer › Mails en de plakkende tabelkop meten desktop');
  });

  const LOG = Array.from({ length: 5 }, (_, i) => ({ id: `m-${i}`, verzondenOp: `2026-09-2${i}T10:00:00Z`, soort: 'ziekmelding', aantal: 2, gelukt: true, door: 'Els Goossens' }));
  const mails: Extra = (pad, request) => {
    if (pad.endsWith('/api/mails') && request.method() === 'GET') {
      return {
        soorten: [
          { soort: 'welkom', naam: 'Welkomstmail', wanneer: 'Bij een nieuw account', ontvangers: 'De nieuwe gebruiker', altijdAan: true, aan: true, laatst: null },
          { soort: 'ziekmelding', naam: 'Ziekmelding', wanneer: 'Als een planner iemand ziek meldt', ontvangers: 'Planners en admins', push: true, aan: true, laatst: { op: '2026-09-23T10:00:00Z', aantal: 2, gelukt: true } },
          { soort: 'dringende-update', naam: 'Dringende update', wanneer: 'Bij het publiceren van een dringende update', ontvangers: 'Alle actieve gebruikers', push: true, aan: false, laatst: null },
        ],
        instellingen: { uit: ['dringende-update'] },
        verzendlijsten: [{ id: 'l-1', naam: 'De Lijn', adressen: ['dispatching@delijn.be'] }],
        log: LOG,
      };
    }
    return undefined;
  };

  test('Beheer › Mails: elke Verwissel cross-fadet, en wat eronder staat verschuift niet tijdens de overlap', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-09-25T09:00:00Z'));
    await seed(page, { user: ADMIN, view: 'beheer-mails', extra: mails });
    await page.addInitScript(opname);
    const data = await houdTegen(page, ['/api/mails']);
    await page.goto('/beheer/mails');
    await data.aangevraagd;
    await expect(page.locator('[aria-label="Verzendlog wordt geladen"]')).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(400);

    const [opnameUit, rollen] = await Promise.all([
      meetWissel(page, data.laatLos, {
        skelet: '[aria-label="Verzendlijsten worden geladen"]',
        kop: '[aria-label="Verzendlijsten"]',
        // Wat onder (of naast) een Verwissel staat: de kaartkoppen en de knoppen Voorbeeld.
        onder: '#hoofdinhoud h2, #hoofdinhoud button',
      }),
      (async () => {
        await page.waitForFunction(() => !!document.querySelector('.fade-uit[aria-hidden="true"]'), undefined, { polling: 'raf', timeout: 10_000 });
        return rollenTijdensOverlap(() => [
          { naam: 'status', locator: page.getByRole('status', { name: /wordt geladen|worden geladen/ }) },
          { naam: 'skeletInDom', locator: page.locator('[role="status"][aria-busy="true"]') },
          { naam: 'lijsten', locator: page.getByRole('list', { name: 'Verzendlijsten' }) },
          { naam: 'log', locator: page.getByRole('table', { name: 'Verzendlog' }) },
          { naam: 'schakelaars', locator: page.getByRole('switch') },
        ]);
      })(),
    ]);
    const { frames, lagen, shifts } = opnameUit;

    // Elke Verwissel van het scherm: drie regels "laatst verstuurd", twee
    // schakelaars (de welkomstmail staat altijd aan, zonder schakelaar), de
    // verzendlijsten en het verzendlog.
    expect(lagen.length).toBe(7);
    for (const l of lagen) {
      expect([l.pointerEvents, l.position, l.laagOverflow, l.wrapperPosition, l.wrapperOverflow]).toEqual(['none', 'absolute', 'clip', 'relative', 'visible']);
      expect(l.raakSkelet).not.toBe(true);
      expect([l.naPosition, l.naOverflow, l.naTransform, l.naClass, l.inDom]).toEqual(['static', 'visible', 'none', '', true]);
    }
    // Verzendlijsten: in het eerste frame van de overlap staat de lijst er al.
    const i0 = frames.findIndex((f) => f.skeletInLaag);
    expect(i0).toBeGreaterThan(0);
    expect(frames[i0].kop).not.toBeNull();
    for (const f of frames) expect(Math.max(f.skelet ?? 0, f.kop ?? 0)).toBeGreaterThan(0.3);
    const eind = frames[frames.length - 1];
    for (const f of frames.slice(i0)) expect(Math.abs(f.kopTop! - eind.kopTop!)).toBeLessThanOrEqual(1);
    // Wat onder de Verwissels staat: vanaf het eerste overlapframe op zijn eindplaats.
    for (const f of frames.slice(i0)) {
      expect(f.onder.length).toBe(eind.onder.length);
      f.onder.forEach((top, j) => expect(Math.abs(top - eind.onder[j]), `element ${j} op ${Math.round(f.t - frames[i0].t)} ms`).toBeLessThanOrEqual(1));
    }
    expect(shifts.filter((s) => s.t > Math.min(...lagen.map((l) => l.start)) + 20), 'geen layout shift tijdens of na de overlap').toEqual([]);

    // Alleen de inhoud in de toegankelijkheidsboom: geen laadstatus, wel de lijst, de tabel en de schakelaars.
    expect(rollen.length).toBeGreaterThan(0);
    // De skeletten van verzendlijsten en verzendlog staan op dat moment wel in de DOM, verborgen.
    for (const r of rollen) expect(r).toEqual({ status: 0, skeletInDom: 2, lijsten: 1, log: 1, schakelaars: 2 });
    await expect(page.locator('.fade-uit')).toHaveCount(0);
  });

  test('Planningscodes: de plakkende tabelkop staat tijdens en na de overlap goed, met gescrolde tabel', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 700 });
    const codes = Array.from({ length: 40 }, (_, i) => ({ code: `C${String(i).padStart(2, '0')}`, category: 'service', description: `Code ${i + 1}`, countsAsShift: true, isPaidAbsence: false, isDayOff: false }));
    await seed(page, { user: ADMIN, view: 'planning-codes', extra: (pad, request) => (pad.endsWith('/api/planning-codes') && request.method() === 'GET' ? codes : undefined) });
    await page.addInitScript(opname);
    // Zodra de overlap begint (vóór de browser tekent): de pagina zo ver
    // schuiven dat de kop van de tabel moet plakken, en vanaf dan per frame
    // meten hoe ver de kop van zijn plakplaats staat.
    await page.addInitScript(() => {
      const w = window as unknown as Record<string, unknown>;
      w.__bijOverlap = (wrapper: Element) => {
        const thead = wrapper.querySelector('thead');
        const root = document.querySelector<HTMLElement>('[data-scroll-root]');
        if (!thead || !root) return;
        root.scrollTop += thead.getBoundingClientRect().top + 300;
        w.__extraMeting = () => {
          const kop = thead.getBoundingClientRect();
          const plak = parseFloat(getComputedStyle(thead).top) + (root === document.scrollingElement ? 0 : root.getBoundingClientRect().top);
          const rijen = [...thead.parentElement!.querySelectorAll('tbody tr')].map((r) => r.getBoundingClientRect().top);
          // Afwijking van de plakplaats. Rijen boven de kop bewijzen dat er
          // echt onder geschoven is; anders telt het als niet geplakt.
          return getComputedStyle(thead).position === 'sticky' && rijen.some((t) => t < kop.top) ? Math.abs(kop.top - plak) : 999;
        };
      };
    });
    const data = await houdTegen(page, ['/api/planning-codes']);
    await page.goto('/beheer/planningscodes');
    await data.aangevraagd;
    await expect(page.locator('[aria-label="Scherm wordt geladen"]')).toBeAttached({ timeout: 15_000 });
    // De sessiestart laadt de code van het open scherm al voor (prefetchView,
    // niet voor Gebruikers en Beheer planning: die slepen xlsx mee), dus bij
    // het begin van de overlap staat de tabel er meteen, zonder Suspense.
    await page.waitForTimeout(400);
    const { frames, lagen } = await meetWissel(page, data.laatLos, { skelet: '[aria-label="Scherm wordt geladen"]', kop: '#hoofdinhoud thead' });
    expect(lagen).toHaveLength(1);
    expect(lagen[0].laagOverflow).toBe('clip');
    expect(lagen[0].wrapperOverflow, 'geen overflow op de wrapper: de kop plakt aan de pagina').toBe('visible');
    const i0 = frames.findIndex((f) => f.extra !== null);
    expect(i0, 'de tabel stond er bij het begin van de overlap').toBeGreaterThanOrEqual(0);
    const metKop = frames.slice(i0);
    expect(metKop[0].overlap, 'gemeten vanaf het eerste overlapframe').toBe(true);
    expect(metKop.some((f) => !f.overlap), 'en erna').toBe(true);
    for (const f of metKop) expect(f.extra!, `tabelkop op ${Math.round(f.t - metKop[0].t)} ms`).toBeLessThanOrEqual(1);
    expect([lagen[0].naPosition, lagen[0].naOverflow, lagen[0].naTransform]).toEqual(['static', 'visible', 'none']);
  });
});
