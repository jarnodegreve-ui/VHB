import { test, expect, type CDPSession, type Locator, type Page } from '@playwright/test';
import { CHAUFFEUR, seed } from './helpers';

/**
 * Ronde 6, punt 5 (deel 3): slepen om te vernieuwen rekt zacht en toont
 * wanneer je mag loslaten (src/lib/usePullToRefresh.ts, de indicator in
 * src/app/AppSchil.tsx).
 *
 * Met een echte vinger: Playwright kent alleen `touchscreen.tap`, een sleep
 * gaat via CDP (`Input.dispatchTouchEvent`). Dat bestaat alleen in Chromium,
 * dus deze spec draait alleen in iPhone 13 (chromium); WebKit steunt op de
 * unit-tests (usePullToRefresh.test.tsx, useMaandVeeg.test.tsx).
 *
 * De drempel van 70 px geldt voor de rek, en de rek is tot daar de helft van
 * de vinger: de vinger moet dus 140 px zakken. 120 px vinger = 60 px rek
 * (geen drempel), 180 px vinger = ±85,7 px rek (voorbij de drempel, op de
 * uitdovende curve; de oude lineaire curve gaf hier 90).
 */

test.skip(({ browserName, isMobile }) => browserName !== 'chromium' || !isMobile, 'een slepende vinger kan alleen via CDP, op een aanraakscherm');

const OKER = 'rgb(226, 163, 35)'; // --color-oker-500
const CARBON = 'rgb(8, 9, 10)'; // --color-slate-950

type Punt = { x: number; y: number };

/** Midden van `doel`, pas als het stilstaat (twee gelijke metingen na elkaar)
 *  en als het punt ook echt op `doel` ligt: niet onder de vaste kop of het
 *  dock, waar de vinger iets anders zou raken. */
async function vingerplek(page: Page, doel: Locator): Promise<Punt> {
  let vorige = '';
  await expect.poll(async () => {
    const vak = JSON.stringify(await doel.boundingBox());
    const stil = vak === vorige && vak !== 'null';
    vorige = vak;
    return stil;
  }, 'het doel staat stil').toBe(true);
  const vak = (await doel.boundingBox())!;
  const punt = { x: Math.round(vak.x + vak.width / 2), y: Math.round(vak.y + vak.height / 2) };
  const raakt = await doel.evaluate((el, p) => el.contains(document.elementFromPoint(p.x, p.y)), punt);
  expect(raakt, `onder de vinger (${punt.x}, ${punt.y}) ligt het bedoelde element`).toBe(true);
  return punt;
}

const neer = (cdp: CDPSession, p: Punt) => cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [p] });
const los = (cdp: CDPSession) => cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
/** Schuif de vinger in stappen van 10 px van `van` naar `naar` (zoals een vinger: niet in één sprong). */
async function schuif(cdp: CDPSession, van: Punt, naar: Punt) {
  const stappen = Math.max(1, Math.round(Math.max(Math.abs(naar.x - van.x), Math.abs(naar.y - van.y)) / 10));
  for (let i = 1; i <= stappen; i++) {
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: van.x + ((naar.x - van.x) * i) / stappen, y: van.y + ((naar.y - van.y) * i) / stappen }],
    });
  }
}

/** Wat de gebruiker van de sleep ziet: hoe ver de inhoud gezakt is en hoe de indicator erbij staat. */
const stand = (page: Page) => page.evaluate(() => {
  const root = document.querySelector<HTMLElement>('[data-scroll-root]')!;
  const indicator = root.previousElementSibling as HTMLElement;
  const vlak = indicator.firstElementChild as HTMLElement;
  const icoon = indicator.querySelector<HTMLElement>('[data-ptr-icon]')!;
  const rek = /translateY\(([\d.]+)px\)/.exec(root.style.transform);
  return {
    rek: rek ? Number(rek[1]) : 0,
    transitie: root.style.transition,
    drempel: indicator.hasAttribute('data-drempel'),
    zichtbaar: indicator.style.opacity === '1',
    vlak: getComputedStyle(vlak).backgroundColor,
    icoon: getComputedStyle(icoon).color,
    draait: icoon.classList.contains('animate-spin'),
    vangtAanraking: getComputedStyle(indicator).pointerEvents !== 'none',
  };
});

/** Telt de verversingen: elke verversing haalt de planning precies één keer op. */
function telPlanning(page: Page) {
  const teller = { n: 0 };
  page.on('request', (r) => { if (r.method() === 'GET' && new URL(r.url()).pathname.endsWith('/api/planning')) teller.n += 1; });
  return teller;
}

test('120 px slepen ververst niet; 180 px toont de drempelstaat en ververst na loslaten één keer', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));
  const planning = telPlanning(page);
  await seed(page, { user: CHAUFFEUR });
  await page.goto('/');
  const kop = page.getByRole('heading', { level: 1 });
  await expect(kop).toBeVisible({ timeout: 15_000 });
  await page.waitForLoadState('networkidle');
  const geladen = planning.n;
  expect(geladen, 'de eerste lading haalde de planning op').toBeGreaterThan(0);

  const cdp = await page.context().newCDPSession(page);
  let start = await vingerplek(page, kop);
  const rust = await stand(page);
  expect(rust).toMatchObject({ rek: 0, drempel: false, zichtbaar: false, vangtAanraking: false });
  expect(rust.vlak, 'in rust is het vlak niet goud').not.toBe(OKER);

  // --- 120 px: de inhoud zakt 60 px mee, de indicator blijft wit, loslaten doet niets.
  await neer(cdp, start);
  await schuif(cdp, start, { x: start.x, y: start.y + 120 });
  await expect.poll(async () => (await stand(page)).rek, 'vinger 120 px = rek 60 px').toBe(60);
  expect(await stand(page)).toMatchObject({ drempel: false, zichtbaar: true, vlak: rust.vlak, icoon: OKER });
  await los(cdp);
  // Terugveren op de ladder; een verversing zou de inhoud op 70 px laten staan.
  await expect.poll(() => stand(page)).toMatchObject({
    rek: 0, drempel: false, zichtbaar: false, draait: false,
    transitie: 'transform var(--duration-fast) var(--ease-standard)',
  });
  expect(planning.n, 'onder de drempel loslaten ververst niet').toBe(geladen);

  // --- 180 px: voorbij de drempel, op de uitdovende curve (lineair was dit 90 px).
  // Eerst wachten tot de inhoud teruggeveerd is: zolang ze nog zakt, ligt de
  // vaste kop onder de vinger, en die laat de sleep bewust los.
  start = await vingerplek(page, kop);
  await neer(cdp, start);
  await schuif(cdp, start, { x: start.x, y: start.y + 130 });
  await expect.poll(async () => (await stand(page)).rek, 'vlak onder de drempel').toBe(65);
  expect(await stand(page)).toMatchObject({ drempel: false, vlak: rust.vlak });
  await schuif(cdp, { x: start.x, y: start.y + 130 }, { x: start.x, y: start.y + 180 });
  await expect.poll(async () => (await stand(page)).rek, 'vinger 180 px = rek ±85,7 px').toBeCloseTo(85.74, 1);
  expect(await stand(page), 'op de drempel: goud vlak, carbon icoon').toMatchObject({ drempel: true, zichtbaar: true, vlak: OKER, icoon: CARBON });

  // Terug onder de drempel schuiven neemt de staat terug, er weer over zet hem weer aan.
  await schuif(cdp, { x: start.x, y: start.y + 180 }, { x: start.x, y: start.y + 120 });
  await expect.poll(async () => (await stand(page)).rek).toBe(60);
  expect(await stand(page)).toMatchObject({ drempel: false, vlak: rust.vlak, icoon: OKER });
  await schuif(cdp, { x: start.x, y: start.y + 120 }, { x: start.x, y: start.y + 180 });
  await expect.poll(async () => (await stand(page)).drempel).toBe(true);
  expect(planning.n, 'slepen alleen ververst niet').toBe(geladen);

  // Loslaten boven de drempel: één verversing, daarna staat alles weer in rust.
  await los(cdp);
  await expect.poll(() => planning.n, 'loslaten boven de drempel ververst').toBe(geladen + 1);
  await expect.poll(() => stand(page), 'na het verversen veert de inhoud terug en is de indicator weg').toMatchObject({
    rek: 0, drempel: false, zichtbaar: false, draait: false,
  });
  await page.waitForLoadState('networkidle');
  expect(planning.n, 'precies één verversing').toBe(geladen + 1);
  await expect(kop).toBeVisible();
  expect(pageErrors, `page errors:\n${pageErrors.join('\n')}`).toEqual([]);
});

test('een horizontale veeg op het maandraster van het Rooster wisselt de maand en ververst niet', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));
  const planning = telPlanning(page);
  await seed(page, { user: CHAUFFEUR });
  await page.goto('/rooster');
  await expect(page.getByRole('heading', { name: 'Rooster', level: 1 })).toBeVisible({ timeout: 15_000 });
  await page.getByRole('group', { name: 'Weergave' }).getByRole('button', { name: 'maand' }).click();
  // De naam van de maand staat tussen de twee pijlen; welke maand het is doet er niet toe.
  const maandlabel = page.getByRole('button', { name: 'Volgende maand' }).locator('xpath=preceding-sibling::span[1]');
  await expect(maandlabel).toBeVisible();
  const dezeMaand = (await maandlabel.textContent())!;
  await page.waitForLoadState('networkidle');
  const geladen = planning.n;
  expect(geladen).toBeGreaterThan(0);
  await expect.poll(() => page.evaluate(() => document.querySelector('[data-scroll-root]')!.scrollTop), 'het scherm staat bovenaan: daar luistert de verversing mee').toBe(0);

  // De vinger komt neer op de rij met de weekdagen (geen knop onder de vinger).
  const raster = page.locator('div.grid-cols-7').filter({ hasText: 'ma' });
  const weekdag = (naam: string) => raster.getByText(naam, { exact: true });
  await expect(raster).toHaveCount(1);
  const cdp = await page.context().newCDPSession(page);

  // Naar links vegen: de volgende maand, en de inhoud is geen px gezakt.
  const rechts = await vingerplek(page, weekdag('za'));
  await neer(cdp, rechts);
  await schuif(cdp, rechts, { x: rechts.x - 150, y: rechts.y + 4 });
  expect(await stand(page), 'de veeg trekt de inhoud niet omlaag').toMatchObject({ rek: 0, drempel: false, zichtbaar: false });
  await los(cdp);
  await expect(maandlabel).not.toHaveText(dezeMaand);
  const volgendeMaand = (await maandlabel.textContent())!;
  expect(await stand(page)).toMatchObject({ rek: 0, drempel: false, zichtbaar: false, draait: false });

  // En terug naar rechts: weer de maand van daarnet.
  await expect(raster).toHaveCount(1);
  const links = await vingerplek(page, weekdag('di'));
  await neer(cdp, links);
  await schuif(cdp, links, { x: links.x + 150, y: links.y + 4 });
  await los(cdp);
  await expect(maandlabel).toHaveText(dezeMaand);
  expect(volgendeMaand).not.toBe(dezeMaand);
  await page.waitForLoadState('networkidle');
  expect(planning.n, 'een veeg opzij ververst niet').toBe(geladen);

  // Tegenproef op dezelfde plek: recht omlaag trekt de verversing hier wel
  // (de veeg hierboven werd dus losgelaten door de richting, niet door de plek).
  await expect(raster).toHaveCount(1);
  const midden = await vingerplek(page, weekdag('do'));
  await neer(cdp, midden);
  await schuif(cdp, midden, { x: midden.x, y: midden.y + 60 });
  await expect.poll(async () => (await stand(page)).rek, 'recht omlaag zakt de inhoud mee').toBe(30);
  await los(cdp);
  await expect.poll(() => stand(page)).toMatchObject({ rek: 0, drempel: false, zichtbaar: false });
  await expect(maandlabel).toHaveText(dezeMaand);
  expect(planning.n, 'en onder de drempel ververst ook dat niet').toBe(geladen);
  expect(pageErrors, `page errors:\n${pageErrors.join('\n')}`).toEqual([]);
});
