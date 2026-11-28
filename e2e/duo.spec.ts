import { test, expect, type Page } from '@playwright/test';
import { ADMIN, CHAUFFEUR, seed, type Fixture } from './helpers';

/**
 * iPhone Duo: vijf venstermaten uit "WebKit Features for Safari 27.1"
 * plus het liggende binnenscherm met zichtbare tabstrook (951 × 537),
 * gemeten in Safari op de Xcode-simulator met iOS 27.2. Op elk formaat
 * moeten de paginakop en de navigatie bereikbaar zijn, zonder overloop.
 *
 * De Duo-uitzonderingen gebruiken de fysieke schermmaat: de zijstrook
 * van Safari kleurt mee en de statusbalkinstelling blijft behouden, ook
 * voordat de app aan het beginscherm is toegevoegd.
 */
const MATEN = [
  { naam: 'buitenscherm staand', width: 382, height: 580 },
  { naam: 'buitenscherm liggend', width: 594, height: 368 },
  { naam: 'binnenscherm staand', width: 669, height: 867 },
  { naam: 'binnenscherm liggend', width: 951, height: 585 },
  { naam: 'binnenscherm liggend met Safari-tabstrook', width: 951, height: 537 },
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

test('Duo vanaf het beginscherm: de stand en het thema veranderen de statusbalkinstelling niet', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'standalone', { value: true });
    // setViewportSize verandert ook screen in Playwright. Geef de fysieke
    // maat van het binnenscherm door, los van de beschikbare paginaruimte.
    Object.defineProperties(screen, {
      width: { get: () => innerWidth > innerHeight ? 951 : 669 },
      height: { get: () => innerWidth > innerHeight ? 669 : 951 },
    });
  });
  await page.setViewportSize({ width: 669, height: 867 });
  await seed(page, { user: ADMIN, view: 'bezetting', thema: 'light' });
  await page.goto('/maandplanning');
  const account = page.getByRole('button', { name: /^Accountmenu/ });
  await expect(account).toBeVisible();
  const statusbalk = page.locator('meta[name="apple-mobile-web-app-status-bar-style"]');
  await expect(statusbalk).toHaveAttribute('content', 'black-translucent');

  await page.setViewportSize({ width: 951, height: 585 });
  await expect(page.getByRole('button', { name: 'Menu openen' })).toBeInViewport({ ratio: 1 });
  await account.tap();
  await page.getByRole('menuitem', { name: 'Donkere modus' }).tap();
  await expect(page.locator('html')).toHaveClass(/\bdark\b/);
  await expect(statusbalk).toHaveAttribute('content', 'black-translucent');

  await page.setViewportSize({ width: 669, height: 867 });
  await expect(page.getByRole('navigation', { name: 'Hoofdnavigatie' })).toBeInViewport({ ratio: 1 });
  await expect(account).toBeInViewport({ ratio: 1 });
  await account.tap();
  await expect(page.getByRole('menuitem', { name: 'Lichte modus' })).toBeVisible();
  await expect(statusbalk).toHaveAttribute('content', 'black-translucent');
});

test('gewone iPhone vanaf het beginscherm: de statusbalk blijft meekleuren', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, 'standalone', { value: true }));
  await seed(page, { user: CHAUFFEUR, view: 'mijn-dag', thema: 'light' });
  await page.goto('/mijn-dag');
  const statusbalk = page.locator('meta[name="apple-mobile-web-app-status-bar-style"]');
  await expect(statusbalk).toHaveAttribute('content', 'default');
  await page.getByRole('button', { name: /^Accountmenu/ }).tap();
  await page.getByRole('menuitem', { name: 'Donkere modus' }).tap();
  await expect(statusbalk).toHaveAttribute('content', 'black');
});

// Playwright emuleert scherm en viewport, maar levert geen veilige iOS-zones.
// Vervang alleen de opgegeven omgevingswaarden, ook als de CSS een fallback heeft.
async function metInsets(page: Page, waarden: { left?: string; right?: string; top?: string }, duoVanafBeginscherm = false) {
  await page.route('**/assets/index-*.css', async (route) => {
    const response = await route.fetch();
    let css = await response.text();
    for (const [kant, waarde] of Object.entries(waarden)) {
      css = css.replace(new RegExp(`env\\(safe-area-inset-${kant}(?:,[^)]*)?\\)`, 'g'), waarde);
    }
    if (duoVanafBeginscherm) {
      // Playwright draait een browsertab. setViewportSize verandert ook het
      // CSS-deviceformaat; op deze Duo bleef het bij draaien juist 466×678.
      css = css.replace(/\(display-mode:\s*standalone\)/g, '(min-width:0px)')
        .replace(/\(device-(width|height):\s*(\d+)px\)/g, (_, as, px) => {
          const toestelmaat = as === 'width' ? 466 : 678;
          return Number(px) === toestelmaat ? '(min-width:0px)' : '(max-width:0px)';
        });
    }
    await route.fulfill({ response, body: css });
  });
}

const metZijInsets = (page: Page, links: number, rechts: number) =>
  metInsets(page, { left: `${links}px`, right: `${rechts}px` });

test.describe('Maandplanning bij draaien van het geopende Duo-binnenscherm', () => {
  // De geïnstalleerde webapp kan de iOS-zijstrook al buiten het venster hebben.
  const liggend = { width: 867, height: 669 };
  const staand = { width: 669, height: 951 };
  test.use({ viewport: liggend, screen: { width: 466, height: 678 }, reducedMotion: 'reduce' });

  for (const terug of [
    { naam: 'actuele boveninset', breedte: 867, hoogte: 669, boven: 0 },
    { naam: 'achtergebleven boveninset', breedte: 951, hoogte: 669, boven: 82 },
    { naam: 'achtergebleven boveninset en verkorte CSS-hoogte', breedte: 951, hoogte: 587, boven: 82 },
  ]) {
    test(`liggend, staand en terug met ${terug.naam}: de kop, periode en scrollpositie blijven op hun plaats`, async ({ page }) => {
      await page.addInitScript(() => {
        Object.defineProperty(navigator, 'standalone', { value: true });
        Object.defineProperties(screen, { width: { value: 466 }, height: { value: 678 } });
      });
      await page.clock.setFixedTime(new Date('2026-11-02T10:00:00+01:00'));
      // Beide insets aan de zijkanten waren in deze Web.app-metingen nul.
      await metInsets(page, { top: 'var(--test-boven, 0px)', left: '0px', right: '0px' }, true);
      const dates = Array.from({ length: 30 }, (_, i) => `2026-11-${String(i + 1).padStart(2, '0')}`);
      const drivers = Array.from({ length: 24 }, (_, i) => ({ id: String(i + 1), name: `Chauffeur ${i + 1}`, section: null }));
      const cells = Object.fromEntries(drivers.map(({ id }) => [id, {
        '2026-11-16': { code: '2101', kind: 'service', label: '', segments: ['05:30 - 13:45'] },
      }]));
      await seed(page, {
        user: ADMIN, view: 'bezetting',
        extra: (pad) => pad.endsWith('/api/month-planning')
          ? { month: '2026-11', dates, drivers, cells, geimporteerd: { eerste: dates[0], laatste: dates[29] } }
          : undefined,
      });
      await page.goto('/maandplanning');
      const kop = page.locator('[data-scroll-root] header.topbar');
      const titel = page.getByRole('heading', { name: 'Maandplanning', level: 1 });
      const scroll = page.locator('[data-scroll-root]');
      const raster = page.getByRole('table', { name: 'Maandplanning per chauffeur en dag' });
      const eersteDag = raster.getByRole('columnheader').nth(1);
      await expect(eersteDag).toContainText('maandag 2 november');
      await page.getByRole('button', { name: 'Volgende 2 weken' }).tap();
      await expect(eersteDag).toContainText('maandag 16 november');
      await page.evaluate(() => document.fonts.ready);
      await scroll.evaluate(el => { el.scrollTop = 20; });
      const scrollY = () => scroll.evaluate(el => el.scrollTop);
      const kopY = () => kop.evaluate(el => el.getBoundingClientRect().y);
      const titelY = () => titel.evaluate(el => el.getBoundingClientRect().y);
      await expect.poll(scrollY).toBe(20);
      await expect.poll(kopY).toBe(0);
      const eersteTitelY = await titelY();
      await scroll.evaluate(el => { el.scrollTop = 0; });

      const draai = async (maat: typeof liggend, boven: number) => {
        await page.evaluate(px => document.documentElement.style.setProperty('--test-boven', `${px}px`), boven);
        await page.setViewportSize(maat);
      };
      await draai(staand, 82);
      const strip = page.getByRole('tablist', { name: 'Kies een dag' });
      await expect(strip.getByRole('tab').nth(15)).toHaveAttribute('aria-selected', 'true');
      await expect.poll(scrollY).toBe(0);
      await expect.poll(kopY).toBe(82);
      const onderKop = await kop.evaluate(el => el.getBoundingClientRect().bottom);
      await expect.poll(titelY).toBeGreaterThanOrEqual(onderKop);
      await scroll.evaluate(el => { el.scrollTop = 20; });
      await expect.poll(scrollY).toBe(20);

      // Bij de zichtbare terugrotatie mat CSS 587 px terwijl JS nog 669 px zag.
      if (terug.hoogte !== liggend.height) {
        await page.evaluate(px => Object.defineProperty(window, 'innerHeight', { value: px }), liggend.height);
      }
      await draai({ width: terug.breedte, height: terug.hoogte }, terug.boven);
      expect(await page.evaluate(px => ({
        cssHoogteKlopt: matchMedia(`(height: ${px}px)`).matches,
        vensterhoogte: innerHeight,
      }), terug.hoogte)).toEqual({ cssHoogteKlopt: true, vensterhoogte: liggend.height });
      await expect(eersteDag).toContainText('maandag 16 november');
      await expect(raster.getByRole('columnheader').last()).toContainText('zondag 29 november');
      await expect.poll(scrollY).toBe(20);
      await expect.poll(kopY).toBe(0);
      await expect.poll(async () => Math.abs(await titelY() - eersteTitelY)).toBeLessThanOrEqual(1);
      const account = kop.getByRole('button', { name: /^Accountmenu/ });
      const menu = page.getByRole('menu', { name: 'Account' });
      await expect.poll(() => account.evaluate(el => el.getBoundingClientRect().right)).toBeLessThanOrEqual(867 + 0.5);
      await account.tap();
      await expect(menu).toBeVisible();
      await expect.poll(() => menu.evaluate(el => el.getBoundingClientRect().right)).toBeLessThanOrEqual(867 + 0.5);
    });
  }
});

// Xcode 27.2 houdt bij openvouwen soms de fysieke 466×678 aan, terwijl
// het venster 951×669 wordt. De klok rechts krijgt dan 84 px via de safe-area.
for (const geval of [
  { naam: 'Duo na openvouwen', screen: { width: 466, height: 678 }, hoogte: 669, rechts: 84, marge: 84 },
  { naam: 'Duo binnen zonder systeemstrook in Safari', screen: { width: 669, height: 951 }, hoogte: 585, rechts: 0, marge: 28 },
  { naam: 'Duo in Safari bij dezelfde CSS-hoogte als de gedraaide webapp', screen: { width: 466, height: 678 }, hoogte: 587, rechts: 0, marge: 28 },
  { naam: 'andere tablet met dezelfde vensterbreedte', screen: { width: 820, height: 1180 }, hoogte: 669, rechts: 84, marge: 28 },
]) {
  test.describe(geval.naam, () => {
    test.use({ viewport: { width: 951, height: geval.hoogte }, screen: geval.screen });
    test('de accountknop en het geopende menu respecteren de marge van de planner', async ({ page }) => {
      await metZijInsets(page, 0, geval.rechts);
      await seed(page, { user: ADMIN, view: 'bezetting' });
      await page.goto('/maandplanning');
      const kop = page.locator('[data-plannerschil] header.topbar');
      const account = kop.getByRole('button', { name: /^Accountmenu/ });
      await expect(account).toBeVisible();
      await expect(kop).toHaveCSS('padding-left', '28px');
      await expect(kop).toHaveCSS('padding-right', `${geval.marge}px`);
      await expect(page.locator('[data-scroll-root]')).toHaveCSS('padding-right', '28px');
      await account.tap();
      const menu = page.getByRole('menu', { name: 'Account' });
      await expect(menu).toBeVisible();
      for (const doel of [account, menu]) {
        await expect.poll(() => doel.evaluate(el => el.getBoundingClientRect().right)).toBeLessThanOrEqual(951 - geval.marge + 0.5);
      }
      if (geval.marge === 84) {
        await account.tap();
        await page.getByRole('button', { name: 'Bekijk als chauffeur' }).tap();
        await expect(page.locator('[data-scroll-root] header.topbar')).toHaveCSS('padding-right', '28px');
      }
    });
  });
}

test.describe('staande Duo met een veilige zone op het buitenscherm', () => {
  test.use({ viewport: { width: 466, height: 678 }, screen: { width: 466, height: 678 } });

  for (const zone of [
    { kant: 'links', links: 84, rechts: 0, user: { ...ADMIN, role: 'planner' } },
    { kant: 'rechts', links: 0, rechts: 84, user: ADMIN },
  ]) {
    test(`${zone.user.role}, systeemstrook ${zone.kant}: inhoud, topbar en dock gebruiken de vrije zijde`, async ({ page }) => {
      await metZijInsets(page, zone.links, zone.rechts);
      await seed(page, { user: zone.user, view: 'dashboard', thema: 'dark' });
      await page.goto('/');
      await expect(page.locator('#hoofdinhoud h1')).toBeVisible();

      const links = Math.max(16, zone.links);
      const rechts = Math.max(16, zone.rechts);
      expect(await page.locator('#hoofdinhoud').boundingBox()).toMatchObject({ x: links, width: 466 - links - rechts });
      const kop = page.locator('header.topbar');
      expect(await kop.boundingBox()).toMatchObject({ x: 0, width: 466 });
      await expect(kop).toHaveCSS('padding-left', `${links}px`);
      await expect(kop).toHaveCSS('padding-right', `${rechts}px`);
      const dock = page.getByRole('navigation', { name: 'Hoofdnavigatie' });
      expect(await dock.boundingBox()).toMatchObject({ x: Math.max(8, zone.links), width: 466 - 84 - 8 });
      expect(await overloop(page)).toEqual({ pagina: 0, inhoud: 0 });
    });
  }

  test('een chauffeur behoudt de bestaande paginamarges', async ({ page }) => {
    await metZijInsets(page, 0, 84);
    await seed(page, { user: CHAUFFEUR, view: 'mijn-dag' });
    await page.goto('/mijn-dag');
    const inhoud = page.locator('[data-scroll-root]');
    await expect(inhoud).toHaveCSS('padding-left', '84px');
    await expect(inhoud).toHaveCSS('padding-right', '84px');
  });

  for (const start of [
    { naam: 'terugkerende planner', eigenaar: 'auth-e2e', user: { ...ADMIN, role: 'planner' }, links: '16px' },
    { naam: 'chauffeur na een andere planner', eigenaar: 'vorige-gebruiker', user: CHAUFFEUR, links: '84px' },
  ]) {
    test(`warme start, ${start.naam}: zelfde marge van de eerste schil tot het dashboard`, async ({ page }) => {
      await metZijInsets(page, 0, 84);
      await seed(page, { user: start.user, view: 'dashboard' });
      await page.addInitScript((eigenaar) => {
        localStorage.setItem('vhb-last-auth-id', eigenaar);
        localStorage.setItem('vhb-last-role', 'planner');
      }, start.eigenaar);
      const pauzeer = async (patroon: string) => {
        let hervat!: () => void;
        const wacht = new Promise<void>((resolve) => { hervat = resolve; });
        await page.route(patroon, async (route) => { await wacht; await route.fallback(); });
        return hervat;
      };
      const startReact = await pauzeer('**/assets/index-*.js');
      const toonProfiel = await pauzeer('**/api/me');
      try {
        await page.goto('/', { waitUntil: 'commit' });
        const voor = page.locator('#voorschil-warm .topbar');
        await expect(voor).toBeVisible();
        await expect(voor).toHaveCSS('padding-left', start.links);
        startReact();
        await expect(page.locator('#voorschil-warm')).toHaveCount(0);
        await expect(page.locator('.opstartschil .topbar')).toHaveCSS('padding-left', start.links);
        toonProfiel();
        await expect(page.getByRole('button', { name: /^Accountmenu/ })).toBeVisible();
        await expect(page.locator('[data-scroll-root] .topbar')).toHaveCSS('padding-left', start.links);
      } finally {
        startReact();
        toonProfiel();
      }
    });
  }

  test('bekijken als chauffeur en weer terug wisselt de paginamarges mee', async ({ page }) => {
    await metZijInsets(page, 0, 84);
    await seed(page, { user: ADMIN, view: 'dashboard' });
    await page.goto('/');
    await page.getByRole('button', { name: 'Bekijk als chauffeur' }).tap();
    const inhoud = page.locator('[data-scroll-root]');
    await expect(inhoud).toHaveCSS('padding-left', '84px');
    await page.getByRole('button', { name: 'Chauffeurs-weergave uit' }).tap();
    await expect(inhoud).toHaveCSS('padding-left', '16px');
    await expect(inhoud).toHaveCSS('padding-right', '84px');
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
    test('Safari kleurt de zijstrook mee en de statusbalkinstelling ligt al klaar voor installatie', async ({ page }) => {
      await start(page);
      expect(await paginaKleur(page)).toBe('rgb(242, 243, 244)');
      await expect(page.locator('meta[name="apple-mobile-web-app-status-bar-style"]')).toHaveAttribute('content', 'black-translucent');
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
      if (ander.naam === 'iPhone 13' || ander.naam === 'Pixel 7') {
        test('de bestaande gelijke paginamarges blijven behouden bij een ongelijke veilige zone', async ({ page }) => {
          await metZijInsets(page, 0, 34);
          await seed(page, { user: ADMIN, view: 'dashboard' });
          await page.goto('/');
          const inhoud = page.locator('[data-scroll-root]');
          await expect(inhoud).toHaveCSS('padding-left', '34px');
          await expect(inhoud).toHaveCSS('padding-right', '34px');
        });
      }
    });
  }
});
