import { test, expect, type Locator, type Page } from '@playwright/test';
import { ADMIN, seed } from './helpers';

/**
 * De kiezer verschijnt meteen onder zijn veld (Jarno 30-09: bij een nieuwe
 * werkprestatie en bij de periode van een planning-upload sprong de
 * maandkalender eerst naar linksboven). Oorzaak: de popover kwam op (0,0) in
 * de pagina en de cursor-cel kreeg daar al focus, in dezelfde tik als het
 * openen, vóór de gemeten plek gerenderd was. Een meting per frame zag dat
 * niet (alles gebeurt in één taak), dus deze test legt de plek vast op het
 * moment van invoegen en op het moment van elke focus. Beide projecten
 * (Chromium en WebKit) op een desktopbreedte: onder 640 px is het een sheet.
 */
test.use({ viewport: { width: 1280, height: 800 }, isMobile: false, hasTouch: false });

type Plek = { wat: 'ingevoegd' | 'focus'; top: number; left: number };

async function volgKiezer(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __kiezer: Plek[] };
    w.__kiezer = [];
    const isKiezer = (el: unknown): el is HTMLElement =>
      el instanceof HTMLElement && el.getAttribute('role') === 'dialog' && !!el.querySelector('[role="grid"]');
    // De inline plek (top/left) die de kiezer zelf zet; de rect zou de in-animatie (scale) meetellen.
    const noteer = (wat: Plek['wat'], el: HTMLElement) =>
      w.__kiezer.push({ wat, top: parseFloat(el.style.top) || 0, left: parseFloat(el.style.left) || 0 });
    // React zet de stijl vóór het invoegen: dit is de allereerste plek in de pagina.
    const append = Node.prototype.appendChild;
    Node.prototype.appendChild = function <T extends Node>(this: Node, kind: T): T {
      const uit = append.call(this, kind) as T;
      if (isKiezer(kind)) noteer('ingevoegd', kind);
      return uit;
    };
    const insert = Node.prototype.insertBefore;
    Node.prototype.insertBefore = function <T extends Node>(this: Node, kind: T, voor: Node | null): T {
      const uit = insert.call(this, kind, voor) as T;
      if (isKiezer(kind)) noteer('ingevoegd', kind);
      return uit;
    };
    const focus = HTMLElement.prototype.focus;
    HTMLElement.prototype.focus = function (this: HTMLElement, opties?: FocusOptions) {
      const kiezer = this.closest('[role="dialog"]');
      if (isKiezer(kiezer)) noteer('focus', kiezer);
      return focus.call(this, opties);
    };
  });
}

/** Plek na de in-animatie, plus alles wat onderweg genoteerd werd. */
async function metingen(page: Page, kiezer: Locator) {
  await kiezer.evaluate(async (el) => {
    await Promise.all(el.getAnimations({ subtree: true }).map((a) => a.finished.catch(() => undefined)));
  });
  const eind = await kiezer.evaluate((el) => ({ top: parseFloat((el as HTMLElement).style.top), left: parseFloat((el as HTMLElement).style.left) }));
  const plekken = await page.evaluate(() => (window as unknown as { __kiezer: Plek[] }).__kiezer);
  return { eind, plekken };
}

const opEind = (p: Plek, eind: { top: number; left: number }) => Math.abs(p.top - eind.top) <= 1 && Math.abs(p.left - eind.left) <= 1;

/** Op mobiele schaal kan afronding aan een rand een fractie van een
 * CSS-pixel kosten. IntersectionObserver ziet ook wat de kiezer zelf afknipt. */
async function volledigInBeeld(doel: Locator) {
  await expect.poll(() => doel.evaluate(el => new Promise<number>(klaar => {
    const waarnemer = new IntersectionObserver(([meting]) => {
      waarnemer.disconnect();
      const vak = meting.boundingClientRect;
      const zicht = meting.intersectionRect;
      klaar(meting.isIntersecting && vak.width > 0 && vak.height > 0
        ? Math.max(zicht.left - vak.left, vak.right - zicht.right, zicht.top - vak.top, vak.bottom - zicht.bottom)
        : Infinity);
    });
    waarnemer.observe(el);
  })), 'geen rand valt meer dan één CSS-pixel buiten beeld').toBeLessThanOrEqual(1);
}

test('datumkiezer in een modal (nieuwe werkprestatie): nooit op (0,0), focus pas op de eindplek', async ({ page }) => {
  await volgKiezer(page);
  await seed(page, { user: ADMIN });
  await page.goto('/techniek/prestaties');
  await page.getByRole('button', { name: 'Prestatie registreren' }).first().click();
  const modal = page.getByRole('dialog').first();
  const knop = modal.getByRole('button', { name: 'Kalender openen' });
  await expect(knop).toBeVisible();
  // De modal zelf schuift binnen (scale/y); pas daarna staat het veld op zijn plek.
  await expect.poll(() => modal.evaluate((el) => getComputedStyle(el).transform)).toBe('none');
  await page.evaluate(() => { (window as unknown as { __kiezer: Plek[] }).__kiezer = []; });

  await knop.click();
  const kiezer = page.getByRole('dialog', { name: 'Datum kiezen' });
  await expect(kiezer.locator('[data-iso]:focus')).toHaveCount(1);
  const { eind, plekken } = await metingen(page, kiezer);

  // De kiezer hangt onder het veld, niet in de hoek.
  const veld = await knop.evaluate((el) => el.parentElement!.getBoundingClientRect().toJSON());
  expect(Math.abs(eind.top - (veld.bottom + 6))).toBeLessThanOrEqual(1);
  // Er is plaats onder het veld: de voorlopige plek is meteen de eindplek,
  // en elke focus valt op die plek.
  expect(plekken.filter((p) => p.wat === 'ingevoegd')).toHaveLength(1);
  expect(plekken.some((p) => p.wat === 'focus')).toBe(true);
  for (const p of plekken) expect(opEind(p, eind), `${p.wat} op ${p.left},${p.top}, eindplek ${eind.left},${eind.top}`).toBe(true);
});

test('maandkiezer op een gescrolde pagina (print per chauffeur): nooit op (0,0), focus pas op de eindplek', async ({ page }) => {
  await volgKiezer(page);
  await seed(page, { user: ADMIN });
  await page.goto('/beheer/planning');
  const maand = page.getByLabel('Maand', { exact: true });
  await maand.scrollIntoViewIfNeeded();
  await page.evaluate(() => { (window as unknown as { __kiezer: Plek[] }).__kiezer = []; });

  await page.getByRole('button', { name: 'Maand kiezen' }).click();
  const kiezer = page.getByRole('dialog', { name: 'Maand kiezen' });
  await expect(kiezer.locator('[data-maand]:focus')).toHaveCount(1);
  const { eind, plekken } = await metingen(page, kiezer);

  const ingevoegd = plekken.filter((p) => p.wat === 'ingevoegd');
  expect(ingevoegd).toHaveLength(1);
  // Onder of boven het veld mag (de meting klapt om als het onderaan niet past), de hoek nooit.
  expect(ingevoegd[0].top).toBeGreaterThan(0);
  const focussen = plekken.filter((p) => p.wat === 'focus');
  expect(focussen.length).toBeGreaterThan(0);
  for (const p of focussen) expect(opEind(p, eind), `focus op ${p.left},${p.top}, eindplek ${eind.left},${eind.top}`).toBe(true);
});

test.describe('een beheerder vouwt een open kiezer op de Duo', () => {
  test.use({ viewport: { width: 669, height: 867 }, isMobile: true, hasTouch: true });

  for (const soort of ['werkprestatie', 'printmaand'] as const) {
    test(soort + ': de hele kiezer blijft bereikbaar en dezelfde keuze blijft actief', async ({ page }) => {
      const dag = soort === 'werkprestatie';
      await seed(page, { user: ADMIN });
      await page.goto(dag ? '/techniek/prestaties' : '/beheer/planning');
      if (dag) await page.getByRole('button', { name: 'Prestatie registreren' }).first().click();
      const knop = dag
        ? page.getByRole('dialog').getByRole('button', { name: 'Kalender openen' })
        : page.getByRole('button', { name: 'Maand kiezen' });
      await knop.click();
      const kiezer = page.getByRole('dialog', { name: dag ? 'Datum kiezen' : 'Maand kiezen', exact: true });
      const cursor = kiezer.locator('[role="gridcell"]:focus');
      const kenmerk = dag ? 'data-iso' : 'data-maand';
      await expect(cursor).toHaveCount(1);
      const keuze = await cursor.getAttribute(kenmerk);
      await expect.poll(() => page.evaluate(() => history.state?.vhbOverlay)).toBeTruthy();
      const stap = await page.evaluate(() => history.state.vhbOverlay);

      await page.setViewportSize({ width: 594, height: 368 });
      await expect(kiezer).toHaveAttribute('aria-modal', 'true');
      await volledigInBeeld(kiezer);
      await expect(cursor).toHaveAttribute(kenmerk, keuze!);
      // Ook op de korte buitenkant kan de planner van de bovenste knop naar de laatste actie scrollen.
      for (const knop of [kiezer.getByRole('button').first(), kiezer.getByRole('button').last()]) {
        await knop.scrollIntoViewIfNeeded();
        await volledigInBeeld(knop);
        await expect.poll(() => knop.evaluate(el => {
          const vak = el.getBoundingClientRect();
          return el.contains(document.elementFromPoint(vak.x + vak.width / 2, vak.y + vak.height / 2));
        }), 'de tik op het midden bereikt de knop').toBe(true);
      }

      await page.setViewportSize({ width: 951, height: 585 });
      await expect(kiezer).not.toHaveAttribute('aria-modal', 'true');
      await volledigInBeeld(kiezer);
      await expect(cursor).toHaveAttribute(kenmerk, keuze!);
      expect(await page.evaluate(() => history.state.vhbOverlay)).toBe(stap);
      await page.keyboard.press('Escape');
      await expect(kiezer).toHaveCount(0);
      await expect(knop).toBeFocused();
    });
  }
});
