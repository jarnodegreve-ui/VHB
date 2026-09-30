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
