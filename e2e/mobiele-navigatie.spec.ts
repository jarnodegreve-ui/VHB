import { test, expect, type Page } from '@playwright/test';
import { ADMIN, CHAUFFEUR, historiekOpgeruimd, seed } from './helpers';

/** Mobiele regressies: dashboard-popup, routegebonden detail en dock.
 *  Beide engines draaien de echte gebouwde app met dezelfde API-fixtures. */
const scrollPositie = (page: Page) => page.locator('[data-scroll-root]').evaluate((el) => ({
  top: el.scrollTop,
  links: el.scrollLeft,
  paginaTop: window.scrollY,
  paginaLinks: window.scrollX,
}));

test('planner kan het laatste menu-item bereiken na het dichtvouwen naar liggende stand', async ({ page }) => {
  const meldingen = Array.from({ length: 6 }, (_, i) => ({
    id: String(i + 1), titel: `Planning ${i + 1}`, tekst: 'De dagplanning is bijgewerkt.',
    soort: 'planning', createdAt: new Date().toISOString(),
  }));
  await page.setViewportSize({ width: 669, height: 867 });
  // De fysieke schermmaat staat los van de beschikbare Safari-viewport.
  await page.addInitScript(() => {
    Object.defineProperties(screen, {
      width: { get: () => innerWidth === 669 ? 669 : 678 },
      height: { get: () => innerWidth === 669 ? 951 : 466 },
    });
  });
  await seed(page, {
    user: { ...ADMIN, role: 'planner' }, view: 'vandaag',
    extra: pad => pad.endsWith('/api/meldingen') ? { meldingen, ongelezen: 6 } : undefined,
  });
  await page.goto('/vandaag');
  const bel = page.getByRole('button', { name: 'Meldingen (6 ongelezen)' });
  await bel.tap();
  const menu = page.getByRole('menu', { name: 'Meldingen' });
  await expect(menu).toBeVisible();
  await page.setViewportSize({ width: 594, height: 368 });
  await page.goBack();
  await expect(menu).toBeHidden();
  await expect(page).toHaveURL(/\/vandaag$/);
  await expect(bel).toBeFocused();
  await bel.tap();

  const dock = page.getByRole('navigation', { name: 'Hoofdnavigatie' });
  const overzicht = menu.getByRole('menuitem', { name: 'Alle meldingen' });
  const eersteMelding = menu.getByRole('menuitem', { name: /Planning 1/ });
  const laatsteMelding = menu.getByRole('menuitem', { name: /Planning 6/ });
  for (const maat of [{ width: 594, height: 368 }, { width: 678, height: 466 }]) {
    await page.setViewportSize(maat);
    await expect.poll(async () => {
      const vlak = await menu.boundingBox();
      const balk = await dock.boundingBox();
      return !!vlak && !!balk && vlak.y + vlak.height <= balk.y;
    }).toBe(true);
    await eersteMelding.scrollIntoViewIfNeeded();
    await expect(overzicht).toBeInViewport({ ratio: 1 });
    await laatsteMelding.scrollIntoViewIfNeeded();
    await expect(laatsteMelding).toBeInViewport({ ratio: 1 });
    await expect.poll(async () => {
      const rij = await laatsteMelding.boundingBox();
      const voet = await overzicht.boundingBox();
      return !!rij && !!voet && rij.y + rij.height <= voet.y;
    }).toBe(true);
    await laatsteMelding.tap({ trial: true });
  }
  await overzicht.tap();
  await expect(page.getByRole('heading', { level: 1, name: 'Meldingen' })).toBeVisible();
});

test('dashboard: een tegel openen en sluiten houdt de pagina en het logo op hun plaats', async ({ page }) => {
  await seed(page, { user: ADMIN, view: 'dashboard', thema: 'dark' });
  await page.goto('/');
  const tegel = page.getByRole('button', { name: /^Chauffeurs actief/ });
  await expect(tegel).toBeVisible({ timeout: 15_000 });
  await page.evaluate(() => document.fonts.ready);
  const logo = page.locator('header').getByRole('img', { name: 'VHB', exact: true });
  await expect(logo).toBeInViewport({ ratio: 1 });
  const voor = await scrollPositie(page);
  expect(voor).toEqual({ top: 0, links: 0, paginaTop: 0, paginaLinks: 0 });

  await tegel.tap();
  const dialoog = page.getByRole('dialog');
  await expect(dialoog).toBeVisible();
  await expect(dialoog.getByRole('heading', { name: 'Chauffeurs actief' })).toBeVisible();
  await dialoog.getByRole('button', { name: 'Sluiten', exact: true }).tap();
  await expect(dialoog).toHaveCount(0);
  await historiekOpgeruimd(page);
  expect(await scrollPositie(page)).toEqual(voor);
  await expect(logo).toBeVisible();
  await expect(logo).toBeInViewport({ ratio: 1 });
  await expect(page.getByRole('heading', { level: 1 })).toBeInViewport({ ratio: 1 });

  // Ook na refresh mag een door focus/historiek verschoven positie niet
  // opnieuw worden teruggezet. Een tweede opening bewaakt hergebruik.
  await page.reload();
  await expect(tegel).toBeVisible({ timeout: 15_000 });
  await expect(logo).toBeInViewport({ ratio: 1 });
  expect(await scrollPositie(page)).toEqual(voor);
  await tegel.tap();
  await expect(dialoog).toBeVisible();
  await dialoog.getByRole('button', { name: 'Sluiten', exact: true }).tap();
  await expect(dialoog).toHaveCount(0);
  await historiekOpgeruimd(page);
  expect(await scrollPositie(page)).toEqual(voor);
});

for (const sluitMet of ['sluitknop', 'terugknop'] as const) {
  test(`omleiding: ${sluitMet} sluit het detail; terug heropent de omleiding niet`, async ({ page }) => {
    await seed(page, { user: CHAUFFEUR, view: 'mijn-dag' });
    await page.goto('/mijn-dag');
    const dock = page.getByRole('navigation', { name: 'Hoofdnavigatie' });
    await expect(dock).toBeVisible({ timeout: 15_000 });
    await dock.getByRole('button', { name: 'Omleidingen', exact: true }).tap();
    await expect(page).toHaveURL(/\/omleidingen$/);
    // De URL wisselt vóór het scherm: zolang de chunk van Omleidingen laadt,
    // staat Mijn dag er nog, mét zijn eigen omleidingskaart "Werken Markt
    // Zottegem". Onder belasting tikte de test die kaart aan (en scrolde Mijn
    // dag ervoor omlaag) in plaats van de rij in de lijst, en bleef het
    // detail weg (1 op ±30 runs). Wacht dus op de kop van het nieuwe scherm.
    await expect(page.getByRole('heading', { level: 1, name: 'Omleidingen' })).toBeVisible();
    const rij = page.getByRole('button', { name: /Werken Markt Zottegem/ });
    await expect(rij).toBeVisible();
    await rij.tap();

    const dialoog = page.getByRole('dialog', { name: 'Werken Markt Zottegem' });
    await expect(dialoog).toBeVisible();
    await expect(page).toHaveURL(/\/omleidingen\/d1$/);
    if (sluitMet === 'sluitknop') {
      const sluiten = dialoog.getByRole('button', { name: 'Sluiten', exact: true });
      await expect(sluiten).toBeInViewport({ ratio: 1 });
      await sluiten.tap();
    } else {
      await page.goBack();
    }

    await expect(dialoog).toHaveCount(0);
    await expect(page).toHaveURL(/\/omleidingen$/);
    await historiekOpgeruimd(page);
    await expect(rij).toBeVisible();
    // De app moet weer bedienbaar zijn; een verdwenen backdrop alleen is
    // onvoldoende als de scroll-root door de overlay op slot blijft staan.
    await expect.poll(() => page.locator('[data-scroll-root]').evaluate(
      (el) => getComputedStyle(el).overflowY,
    )).toBe('auto');

    await page.goBack();
    await expect(page).toHaveURL(/\/mijn-dag$/);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(dock.getByRole('button', { name: 'Mijn dag', exact: true })).toHaveAttribute('aria-current', 'page');
  });
}
