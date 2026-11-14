import { test, expect, type Page } from '@playwright/test';
import { ADMIN, CHAUFFEUR, seed, type Fixture } from './helpers';

/**
 * iPhone Duo (14-11): het portaal op de vijf venstermaten die WebKit voor
 * Safari 27.1 op de Duo opgeeft (webkit.org, "WebKit Features for Safari
 * 27.1"; de eerste is nagemeten in de simulator). De Duo is voor een webapp
 * geen eigen toestel maar een reeks venstermaten: 382 tot 951 breed, 368 tot
 * 902 hoog. Deze spec legt vast dat de schil daar heel blijft: geen
 * horizontale overloop, de navigatie volledig in beeld en bedienbaar, en de
 * paginakop zichtbaar.
 *
 * Het portaal detecteert de Duo nergens in code. Het enige wat alleen daar
 * geldt is één CSS-regel op de schermmaat (de zijstrook van Safari krijgt de
 * paginakleur); de laatste tests bewijzen dat die regel op een ander scherm
 * niets doet.
 */
const MATEN = [
  { naam: 'buitenscherm staand', width: 382, height: 580 },
  { naam: 'buitenscherm liggend', width: 594, height: 368 },
  { naam: 'binnenscherm staand', width: 669, height: 867 },
  { naam: 'binnenscherm liggend', width: 951, height: 585 },
  { naam: 'binnenscherm, twee vensters naast elkaar', width: 385, height: 571 },
] as const;

const ROLLEN: { naam: string; user: Fixture; schermen: { view: string; pad: string }[] }[] = [
  {
    naam: 'chauffeur',
    user: CHAUFFEUR,
    schermen: [
      { view: 'mijn-dag', pad: '/mijn-dag' },
      { view: 'rooster', pad: '/rooster' },
      { view: 'verlof', pad: '/verlof' },
      { view: 'ruil-verzoeken', pad: '/dienstruil' },
      { view: 'omleidingen', pad: '/omleidingen' },
    ],
  },
  {
    naam: 'beheerder',
    user: ADMIN,
    schermen: [
      { view: 'dashboard', pad: '/' },
      { view: 'vandaag', pad: '/vandaag' },
      { view: 'bezetting', pad: '/maandplanning' },
      { view: 'werkvoorraad', pad: '/overzicht' },
      { view: 'gebruikers', pad: '/beheer/gebruikers' },
    ],
  },
];

/** Hoeveel de pagina of de scroll-root breder is dan het venster (0 = past). */
const overloop = (page: Page) => page.evaluate(() => {
  const root = document.querySelector('[data-scroll-root]');
  return {
    pagina: document.documentElement.scrollWidth - window.innerWidth,
    inhoud: root ? root.scrollWidth - root.clientWidth : 0,
  };
});

for (const maat of MATEN) {
  test.describe(`${maat.naam} (${maat.width} × ${maat.height})`, () => {
    test.use({ viewport: { width: maat.width, height: maat.height } });

    for (const rol of ROLLEN) {
      test(`${rol.naam}: de schil past en de navigatie is bedienbaar`, async ({ page }) => {
        // Eén keer aanmelden; daarna is de URL de bron van het scherm.
        await seed(page, { user: rol.user, view: rol.schermen[0].view, thema: 'light' });
        for (const scherm of rol.schermen) {
          await page.goto(scherm.pad);
          await expect(page.getByRole('heading', { level: 1 }).first(), scherm.pad).toBeVisible({ timeout: 15_000 });
          await page.evaluate(() => document.fonts.ready);

          expect(await overloop(page), `overloop op ${scherm.pad}`).toEqual({ pagina: 0, inhoud: 0 });

          // De topbar: het accountmenu staat volledig in beeld.
          await expect(page.locator('header').first(), scherm.pad).toBeInViewport();

          if (maat.width < 768) {
            // Onder 768 px: het dock, met elke tab volledig binnen het venster.
            const dock = page.getByRole('navigation', { name: 'Hoofdnavigatie' });
            await expect(dock, scherm.pad).toBeInViewport({ ratio: 1 });
            const tabs = dock.getByRole('button');
            const aantal = await tabs.count();
            expect(aantal, `dock-tabs op ${scherm.pad}`).toBeGreaterThanOrEqual(5);
            for (let i = 0; i < aantal; i++) await expect(tabs.nth(i), `${scherm.pad}, tab ${i + 1}`).toBeInViewport({ ratio: 1 });
          } else {
            // Vanaf 768 px (binnenscherm liggend): geen dock, het menu zit achter de knop in de topbar.
            await expect(page.getByRole('navigation', { name: 'Hoofdnavigatie' }), scherm.pad).toBeHidden();
            await expect(page.getByRole('button', { name: 'Menu openen' }), scherm.pad).toBeInViewport({ ratio: 1 });
          }
        }
      });
    }
  });
}

test.describe('het menu op het laagste venster (buitenscherm liggend, 368 px hoog)', () => {
  test.use({ viewport: { width: 594, height: 368 } });

  test('beheerder: elk menu-item is bereikbaar, ook het laatste', async ({ page }) => {
    await seed(page, { user: ADMIN, view: 'dashboard', thema: 'light' });
    await page.goto('/');
    const dock = page.getByRole('navigation', { name: 'Hoofdnavigatie' });
    await expect(dock).toBeVisible({ timeout: 15_000 });
    await dock.getByRole('button', { name: /^Meer/ }).tap();
    const zijbalk = page.getByRole('complementary', { name: 'Zijbalk' });
    await expect(zijbalk).toBeInViewport();
    const laatste = zijbalk.getByRole('button', { name: 'Systeemstatus', exact: true });
    await laatste.scrollIntoViewIfNeeded();
    await expect(laatste).toBeInViewport({ ratio: 1 });
  });
});

/** De achtergrondkleur van <html> zelf (onder het verloop). */
const paginaKleur = (page: Page) => page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor);

test.describe('de Duo-regel geldt alleen op de schermen van de Duo', () => {
  const start = async (page: Page) => {
    await seed(page, { user: CHAUFFEUR, view: 'mijn-dag', thema: 'light' });
    await page.goto('/mijn-dag');
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible({ timeout: 15_000 });
  };

  test.describe('buitenscherm van de Duo (466 × 678)', () => {
    test.use({ viewport: { width: 382, height: 580 }, screen: { width: 466, height: 678 } });
    test('de pagina draagt de canvaskleur, zodat de zijstrook van Safari meekleurt', async ({ page }) => {
      await start(page);
      expect(await paginaKleur(page)).toBe('rgb(242, 243, 244)');
    });
  });

  test.describe('binnenscherm van de Duo (669 × 951)', () => {
    test.use({ viewport: { width: 669, height: 867 }, screen: { width: 669, height: 951 } });
    test('de pagina draagt de canvaskleur', async ({ page }) => {
      await start(page);
      expect(await paginaKleur(page)).toBe('rgb(242, 243, 244)');
    });
  });

  for (const ander of [
    { naam: 'iPhone 13', viewport: { width: 390, height: 664 }, screen: { width: 390, height: 844 } },
    { naam: 'iPhone SE', viewport: { width: 375, height: 553 }, screen: { width: 375, height: 667 } },
    { naam: 'iPhone 18 Pro Max', viewport: { width: 440, height: 780 }, screen: { width: 440, height: 956 } },
    { naam: 'Pixel 7', viewport: { width: 412, height: 783 }, screen: { width: 412, height: 915 } },
    { naam: 'iPad staand', viewport: { width: 820, height: 1106 }, screen: { width: 820, height: 1180 } },
  ]) {
    test.describe(`${ander.naam} (${ander.screen.width} × ${ander.screen.height})`, () => {
      test.use({ viewport: ander.viewport, screen: ander.screen });
      test('de pagina heeft geen eigen kleur onder het verloop, zoals altijd', async ({ page }) => {
        await start(page);
        expect(await paginaKleur(page)).toBe('rgba(0, 0, 0, 0)');
      });
    });
  }
});
