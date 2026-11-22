import { test, expect, type CDPSession, type Page, type Request } from '@playwright/test';
import { CHAUFFEUR, seed, type Extra } from './helpers';

/**
 * Ronde 6, punt 4 (deel 2): de kalender in Verlof bladert met richting en
 * volgt de vinger, zoals het Rooster (`useMaandVeeg` + `MaandWissel`).
 *
 * Met een echte vinger: Playwright kent alleen `touchscreen.tap`, een sleep
 * gaat via CDP (`Input.dispatchTouchEvent`) en bestaat dus alleen in Chromium.
 * Deze spec draait daarom alleen in iPhone 13 (chromium); de rekenregels van
 * de veeg zelf (drempel, demping, axis-lock) liggen voor elke engine vast in
 * src/lib/useMaandVeeg.test.tsx.
 *
 * Vaste klok op donderdag 12/11/2026: geen enkele verwachting hangt af van de
 * dag waarop de proef draait. `setFixedTime` zet alleen de datum vast, de
 * timers lopen gewoon (de veeg wisselt 150 ms na het loslaten).
 */
const NU = new Date('2026-11-12T08:00:00Z');
const DREMPEL = 56; // VEEG_DREMPEL in src/lib/useMaandVeeg.ts
const DEMPING = 0.6;

type Tellers = { bezetting: string[]; verlofLijst: number; schrijf: string[] };

/** Bezetting zoals de server ze geeft (zonder namen): 18/11 één van twee, 9/12 volzet. */
const AFWEZIG: Record<string, number> = { '2026-11-18': 1, '2026-12-09': 2 };
function server(tellers: Tellers): Extra {
  return (p, request: Request) => {
    // Alles wat schrijft telt, behalve de twee aanroepen van de sessie zelf
    // (toestel aanmelden, aanwezigheid): die horen bij elke start van de app.
    if (/^(POST|PUT|PATCH|DELETE)$/.test(request.method()) && !/\/api\/(devices\/register|auth\/session)$/.test(p)) tellers.schrijf.push(`${request.method()} ${p}`);
    if (p.endsWith('/api/verlof/limieten')) return { standaard: 2, periodes: [], perDag: {} };
    if (p.endsWith('/api/leave') && request.method() === 'GET') { tellers.verlofLijst += 1; return []; }
    if (!p.endsWith('/api/leave/bezetting')) return undefined;
    const q = new URL(request.url()).searchParams;
    tellers.bezetting.push(`${q.get('van')}..${q.get('tot')}`);
    const dagen: Array<{ datum: string; aantal: number; limiet: number }> = [];
    const eind = Date.parse(`${q.get('tot')}T00:00:00Z`);
    for (let ms = Date.parse(`${q.get('van')}T00:00:00Z`); ms <= eind; ms += 86_400_000) {
      const datum = new Date(ms).toISOString().slice(0, 10);
      dagen.push({ datum, aantal: AFWEZIG[datum] ?? 0, limiet: 2 });
    }
    return { dagen };
  };
}
const NOV = '2026-11-01..2026-11-30';
const DEC = '2026-12-01..2026-12-31';

/** De maanden die op dit moment in de DOM staan (tijdens een wissel even twee). */
const maanden = (page: Page) => page.locator('[data-verlofmaand]').evaluateAll((els) => els.map((el) => (el as HTMLElement).dataset.verlofmaand));
const raster = (page: Page, maand: string) => page.locator(`[data-verlofmaand="${maand}"]`);
const cel = (page: Page, maand: string, dag: number) => raster(page, maand).getByRole('button', { name: new RegExp(`^${dag}: `) });
const maandlabel = (page: Page) => page.getByRole('button', { name: 'Volgende maand' }).locator('xpath=preceding-sibling::span[1]');
const dagdetail = (page: Page) => page.locator('h3', { hasText: /^Verlof op / });
/** De doos die met de vinger meebeweegt (`veeg.ref` in MaandWissel): haar inline transform is de stand van de veeg. */
const veegStand = (page: Page) => page.evaluate(() => {
  const vak = document.querySelector<HTMLElement>('[data-verlofmaand]')!.closest<HTMLElement>('.touch-pan-y')!;
  return { transform: vak.style.transform, opacity: vak.style.opacity };
});

/**
 * Legt vast van welke kant elke nieuwe maand binnenkomt: het teken van de
 * beginstand die `RichtingWissel` op het nieuwe raster zet (+ = van rechts,
 * − = van links, 0 = zonder beweging), gelezen op het moment dat het raster
 * in de DOM komt (MutationObserver, geen beelden tellen).
 */
async function volgKanten(page: Page) {
  await page.evaluate(() => {
    const log: Array<{ maand: string; kant: number }> = [];
    (window as unknown as { __kanten: typeof log }).__kanten = log;
    new MutationObserver((lijst) => {
      for (const m of lijst) for (const n of m.addedNodes) {
        if (!(n instanceof HTMLElement)) continue;
        const r = n.matches('[data-verlofmaand]') ? n : n.querySelector<HTMLElement>('[data-verlofmaand]');
        if (!r) continue;
        const x = /translateX\((-?[\d.]+)px\)/.exec(r.parentElement!.style.transform)?.[1];
        log.push({ maand: r.dataset.verlofmaand!, kant: x === undefined ? 0 : Math.sign(Number(x)) });
      }
    }).observe(document.body, { childList: true, subtree: true });
  });
}
const kanten = (page: Page) => page.evaluate(() => (window as unknown as { __kanten: Array<{ maand: string; kant: number }> }).__kanten);

async function openVerlof(page: Page, opties: { hoogte?: number; minderBeweging?: boolean } = {}) {
  const tellers: Tellers = { bezetting: [], verlofLijst: 0, schrijf: [] };
  if (opties.hoogte) await page.setViewportSize({ width: 390, height: opties.hoogte });
  if (opties.minderBeweging) await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.clock.setFixedTime(NU);
  await seed(page, { user: CHAUFFEUR, extra: server(tellers) });
  await page.goto('/verlof');
  await expect(page.getByRole('heading', { name: 'Verlof', level: 1 })).toBeVisible({ timeout: 15_000 });
  await expect(maandlabel(page)).toHaveText('november 2026');
  await expect.poll(() => tellers.bezetting).toEqual([NOV]);
  await expect(cel(page, '2026-11', 18)).toHaveAttribute('aria-label', '18: deels vrij, 1 van 2 afwezig');
  await volgKanten(page);
  return tellers;
}

/**
 * Een punt midden op het raster, in beeld gebracht (midden van het scherm,
 * dus niet onder de topbar of de onderbalk) en nagekeken: wat onder het punt
 * ligt, zit in het raster.
 */
async function puntOpRaster(page: Page, inBeeld = true) {
  const punt = await page.evaluate(async (schuif) => {
    const r = document.querySelector<HTMLElement>('[data-verlofmaand]')!;
    if (schuif) r.scrollIntoView({ block: 'center' });
    // De plaats staat pas vast als ze twee keer na elkaar gelijk is.
    let vorige = -1;
    for (let i = 0; i < 40; i++) {
      const y = r.getBoundingClientRect().top;
      if (Math.abs(y - vorige) < 0.5) break;
      vorige = y;
      await new Promise((klaar) => setTimeout(klaar, 50));
    }
    const vak = r.getBoundingClientRect();
    const x = Math.round(vak.left + vak.width / 2);
    const y = Math.round(vak.top + vak.height / 2);
    return { x, y, opRaster: !!document.elementFromPoint(x, y)?.closest('[data-verlofmaand]') };
  }, inBeeld);
  expect(punt.opRaster, 'het aanraakpunt ligt op het raster van de kalender').toBe(true);
  return punt;
}

/** Een vinger via CDP: neer, in stappen naar (dx, dy) tegenover het startpunt, en los. */
async function vinger(page: Page) {
  const cdp: CDPSession = await page.context().newCDPSession(page);
  let start = { x: 0, y: 0 };
  return {
    async neer(punt: { x: number; y: number }) {
      start = punt;
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: punt.x, y: punt.y }] });
    },
    /** Sleept in stappen naar (dx, dy); de eerste stap bepaalt de richting (meer dan 6 px). */
    async sleep(dx: number, dy: number, stappen = 6) {
      for (let i = 1; i <= stappen; i++) {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: start.x + (dx * i) / stappen, y: start.y + (dy * i) / stappen }] });
      }
    },
    async los() {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    },
  };
}

const scrollTop = (page: Page) => page.evaluate(() => document.querySelector<HTMLElement>('[data-scroll-root]')!.scrollTop);

test.describe('Verlof: de kalender bladert met richting en volgt de vinger', () => {
  test.beforeEach(({ browserName }) => {
    test.skip(browserName !== 'chromium', 'een vinger die sleept kan alleen via CDP');
  });

  test('vegen voorbij de drempel: de kalender volgt de vinger en de nieuwe maand komt van de juiste kant', async ({ page }) => {
    const tellers = await openVerlof(page);
    const v = await vinger(page);

    // Naar links: de kalender schuift getemperd mee (0,6 keer de vinger) en wisselt nog niet.
    await v.neer(await puntOpRaster(page));
    await v.sleep(-90, 4);
    expect(await veegStand(page)).toEqual({ transform: `translateX(${-90 * DEMPING}px)`, opacity: '' });
    expect(await maanden(page)).toEqual(['2026-11']);
    expect(tellers.bezetting).toEqual([NOV]);
    await v.los();
    await expect(maandlabel(page)).toHaveText('december 2026');
    await expect.poll(() => maanden(page)).toEqual(['2026-12']);
    expect(await kanten(page)).toEqual([{ maand: '2026-12', kant: 1 }]);
    // De veeg laat niets achter op de doos: de nieuwe maand staat op haar plaats.
    await expect.poll(() => veegStand(page)).toEqual({ transform: '', opacity: '' });
    await expect.poll(() => tellers.bezetting).toEqual([NOV, DEC]);
    await expect(cel(page, '2026-12', 9)).toHaveAttribute('aria-label', '9: volzet, 2 van 2 afwezig');

    // Naar rechts: terug naar november, van links.
    await v.neer(await puntOpRaster(page));
    await v.sleep(90, -3);
    expect(await veegStand(page)).toEqual({ transform: `translateX(${90 * DEMPING}px)`, opacity: '' });
    await v.los();
    await expect(maandlabel(page)).toHaveText('november 2026');
    await expect.poll(() => maanden(page)).toEqual(['2026-11']);
    expect(await kanten(page)).toEqual([{ maand: '2026-12', kant: 1 }, { maand: '2026-11', kant: -1 }]);
    await expect.poll(() => tellers.bezetting).toEqual([NOV, DEC, NOV]);
    expect(tellers.schrijf, 'bladeren schrijft niets').toEqual([]);
  });

  test('een veeg die onder de drempel blijft, veert terug zonder maandwissel', async ({ page }) => {
    const tellers = await openVerlof(page);
    const v = await vinger(page);
    await v.neer(await puntOpRaster(page));
    await v.sleep(-(DREMPEL - 6), 2);
    expect(await veegStand(page)).toEqual({ transform: `translateX(${-(DREMPEL - 6) * DEMPING}px)`, opacity: '' });
    await v.los();
    await expect.poll(() => veegStand(page)).toEqual({ transform: '', opacity: '' });
    // Ruim voorbij de 150 ms waarna een geslaagde veeg zou wisselen.
    await page.waitForTimeout(400);
    await expect(maandlabel(page)).toHaveText('november 2026');
    expect(await maanden(page)).toEqual(['2026-11']);
    expect(await kanten(page)).toEqual([]);
    expect(tellers.bezetting).toEqual([NOV]);
  });

  test('verticaal scrollen over de kalender start nooit een maandwissel', async ({ page }) => {
    const tellers = await openVerlof(page);
    const v = await vinger(page);
    const punt = await puntOpRaster(page);
    const voor = await scrollTop(page);
    // Omhoog vegen met wat zijwaartse drift: de pagina scrolt, de kalender blijft staan.
    await v.neer(punt);
    await v.sleep(14, -160, 8);
    expect((await veegStand(page)).transform).toBe('');
    await v.los();
    await expect.poll(() => scrollTop(page), 'de pagina scrolde mee met de vinger').toBeGreaterThan(voor + 40);
    await page.waitForTimeout(400);
    await expect(maandlabel(page)).toHaveText('november 2026');
    expect(await kanten(page)).toEqual([]);
    expect(tellers.bezetting).toEqual([NOV]);

    // Begint de vinger verticaal en gaat ze daarna opzij, dan blijft de veeg losgelaten.
    await v.neer(await puntOpRaster(page, false));
    await v.sleep(2, -20, 2);
    await v.sleep(-120, -24, 6);
    expect((await veegStand(page)).transform).toBe('');
    await v.los();
    await page.waitForTimeout(400);
    await expect(maandlabel(page)).toHaveText('november 2026');
    expect(await kanten(page)).toEqual([]);
    expect(tellers.bezetting).toEqual([NOV]);
  });

  test('trekken om te vernieuwen werkt met de vinger op de kalender zoals op de rest van de pagina', async ({ page }) => {
    // Hoog scherm: voor een chauffeur staan saldo en aanvragen boven de kalender,
    // en de trek start alleen als de pagina helemaal bovenaan staat.
    const tellers = await openVerlof(page, { hoogte: 1300 });
    const v = await vinger(page);
    const punt = await puntOpRaster(page, false);
    expect(await scrollTop(page)).toBe(0);
    const lijstVoor = tellers.verlofLijst;
    await v.neer(punt);
    await v.sleep(5, 190, 8);
    // De pagina zakt mee (usePullToRefresh schuift de scroll-container), de kalender zelf beweegt niet opzij.
    expect(await page.evaluate(() => document.querySelector<HTMLElement>('[data-scroll-root]')!.style.transform)).toMatch(/^translateY\(\d+(\.\d+)?px\)$/);
    expect((await veegStand(page)).transform).toBe('');
    await v.los();
    await expect.poll(() => tellers.verlofLijst, 'loslaten voorbij de drempel ververst de gegevens').toBeGreaterThan(lijstVoor);
    await expect(maandlabel(page)).toHaveText('november 2026');
    expect(await kanten(page)).toEqual([]);
  });

  test('pijlen en Vandaag: de nieuwe maand komt van de juiste kant', async ({ page }) => {
    const tellers = await openVerlof(page);
    const stap = async (knop: string, maand: string, label: string) => {
      await page.getByRole('button', { name: knop, exact: true }).click();
      await expect(maandlabel(page)).toHaveText(label);
      // Pas verder als de vertrekkende maand weg is: de volgende klik valt dan op een kalender die stilstaat.
      await expect.poll(() => maanden(page)).toEqual([maand]);
    };
    await expect(page.getByRole('button', { name: 'Vandaag', exact: true })).toHaveCount(0);
    await stap('Volgende maand', '2026-12', 'december 2026');
    await stap('Volgende maand', '2027-01', 'januari 2027');
    // Vandaag vanuit een latere maand: terug in de tijd, dus van links.
    await stap('Vandaag', '2026-11', 'november 2026');
    await expect(page.getByRole('button', { name: 'Vandaag', exact: true })).toHaveCount(0);
    await stap('Vorige maand', '2026-10', 'oktober 2026');
    await stap('Vorige maand', '2026-09', 'september 2026');
    // Vandaag vanuit een vroegere maand: vooruit, dus van rechts.
    await stap('Vandaag', '2026-11', 'november 2026');
    expect(await kanten(page)).toEqual([
      { maand: '2026-12', kant: 1 },
      { maand: '2027-01', kant: 1 },
      { maand: '2026-11', kant: -1 },
      { maand: '2026-10', kant: -1 },
      { maand: '2026-09', kant: -1 },
      { maand: '2026-11', kant: 1 },
    ]);
    // Eén bezettingsvraag per getoonde maand, in de volgorde van het bladeren.
    expect(tellers.bezetting).toEqual([NOV, DEC, '2027-01-01..2027-01-31', NOV, '2026-10-01..2026-10-31', '2026-09-01..2026-09-30', NOV]);
    expect(tellers.schrijf).toEqual([]);
  });

  test('na een veeg zet Vandaag de kant opnieuw: geen stille uitgang van de vorige veeg', async ({ page }) => {
    await openVerlof(page);
    const v = await vinger(page);
    await v.neer(await puntOpRaster(page));
    await v.sleep(-90, 0);
    await v.los();
    await expect.poll(() => maanden(page)).toEqual(['2026-12']);
    await page.getByRole('button', { name: 'Vandaag', exact: true }).click();
    await expect(maandlabel(page)).toHaveText('november 2026');
    await expect.poll(() => maanden(page)).toEqual(['2026-11']);
    expect(await kanten(page)).toEqual([{ maand: '2026-12', kant: 1 }, { maand: '2026-11', kant: -1 }]);
  });

  test('de gekozen dag, het dagdetail en de stippen blijven zoals ze waren', async ({ page }) => {
    const tellers = await openVerlof(page);
    await cel(page, '2026-11', 18).click();
    await expect(dagdetail(page)).toHaveText('Verlof op wo 18 november');
    await expect(page.locator('[data-dagstand]')).toHaveText('Nog 1 plaats, 1 van 2 afwezig');

    // Een maand verder: het dagdetail van de gekozen dag blijft staan, de stippen van december komen van de server.
    const v = await vinger(page);
    await v.neer(await puntOpRaster(page));
    await v.sleep(-90, 0);
    await v.los();
    await expect.poll(() => maanden(page)).toEqual(['2026-12']);
    await expect(dagdetail(page)).toHaveText('Verlof op wo 18 november');
    await expect(cel(page, '2026-12', 9)).toHaveAttribute('aria-label', '9: volzet, 2 van 2 afwezig');
    await expect(cel(page, '2026-12', 10)).toHaveAttribute('aria-label', '10: vrij');

    // Een dag in de nieuwe maand kiezen opent haar dagdetail.
    await cel(page, '2026-12', 9).click();
    await expect(dagdetail(page)).toHaveText('Verlof op wo 9 december');
    await expect(page.locator('[data-dagstand]')).toHaveText('Volzet, 2 van 2 afwezig');

    // Terug: de gekozen dag van december blijft, november toont zijn stippen weer.
    await page.getByRole('button', { name: 'Vorige maand', exact: true }).click();
    await expect.poll(() => maanden(page)).toEqual(['2026-11']);
    await expect(dagdetail(page)).toHaveText('Verlof op wo 9 december');
    await expect(cel(page, '2026-11', 18)).toHaveAttribute('aria-label', '18: deels vrij, 1 van 2 afwezig');
    expect(tellers.bezetting).toEqual([NOV, DEC, NOV]);
    expect(tellers.schrijf).toEqual([]);
  });

  test('minder beweging: de kalender beweegt niet mee, de maand wisselt wel op de drempel', async ({ page }) => {
    const tellers = await openVerlof(page, { minderBeweging: true });
    const v = await vinger(page);
    await v.neer(await puntOpRaster(page));
    await v.sleep(-90, 2);
    expect(await veegStand(page)).toEqual({ transform: '', opacity: '' });
    expect(await maanden(page)).toEqual(['2026-11']);
    await v.los();
    await expect(maandlabel(page)).toHaveText('december 2026');
    await expect.poll(() => maanden(page)).toEqual(['2026-12']);
    // Zonder beweging komt de maand van geen enkele kant: ze staat er meteen.
    expect(await kanten(page)).toEqual([{ maand: '2026-12', kant: 0 }]);
    await expect.poll(() => tellers.bezetting).toEqual([NOV, DEC]);

    // Onder de drempel gebeurt er niets.
    await v.neer(await puntOpRaster(page));
    await v.sleep(DREMPEL - 6, 0);
    await v.los();
    await page.waitForTimeout(300);
    await expect(maandlabel(page)).toHaveText('december 2026');
    expect(tellers.bezetting).toEqual([NOV, DEC]);
  });

  // Vaste toetssteen 1: tijdens de wissel staan er even twee maanden. Een tik
  // op een dag van de vertrekkende maand opent alleen het dagdetail van die
  // dag, er wordt niets beslist of geschreven. De wissel en de tik gebeuren in
  // één taak van de pagina, zodat de proef niet van de snelheid van de machine
  // afhangt (de vertrekkende maand staat er maar ±150 ms).
  test('een dag van de vertrekkende maand opent alleen het dagdetail', async ({ page }) => {
    const tellers = await openVerlof(page);
    const uit = await page.evaluate(async () => {
      document.querySelector<HTMLElement>('button[aria-label="Volgende maand"]')!.click();
      // React tekent de klik in een microtaak; daarna staan beide maanden er, nog vóór het eerste beeld.
      await Promise.resolve();
      await Promise.resolve();
      const staan = [...document.querySelectorAll<HTMLElement>('[data-verlofmaand]')].map((el) => el.dataset.verlofmaand);
      const oud = document.querySelector<HTMLElement>('[data-verlofmaand="2026-11"]');
      const dag = oud ? [...oud.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.getAttribute('aria-label')?.startsWith('17: ')) : null;
      dag?.click();
      return { staan, getikt: !!dag };
    });
    expect(uit.staan, 'de vertrekkende en de nieuwe maand staan er tegelijk').toEqual(expect.arrayContaining(['2026-11', '2026-12']));
    expect(uit.getikt).toBe(true);
    await expect(dagdetail(page)).toHaveText('Verlof op di 17 november');
    await expect.poll(() => maanden(page)).toEqual(['2026-12']);
    await expect(maandlabel(page)).toHaveText('december 2026');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(tellers.schrijf, 'de tik schreef niets').toEqual([]);
  });
});
