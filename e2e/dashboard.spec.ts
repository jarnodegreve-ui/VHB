import { test, expect, type Page } from '@playwright/test';

/**
 * Ingelogde rooktest op een iPhone-viewport, zónder testaccount of backend.
 *
 * Twee trucs maken dat mogelijk:
 *  1. De sessie wordt vóór het laden in localStorage gezet. supabase-js leest
 *     die bij getSession() gewoon uit (het valideert de handtekening niet
 *     lokaal), dus de app start als ingelogde chauffeur. De sleutelnaam volgt
 *     uit de host van VITE_SUPABASE_URL — in de e2e-build 'localhost'.
 *  2. Alle /api/**-calls worden onderschept met vaste fixtures, zodat de test
 *     niets van een echte server nodig heeft en deterministisch blijft.
 *
 * Vangt wat unit-tests niet zien: rendert de échte gebouwde bundel in een
 * echte browser op telefoonformaat zonder crash of horizontale overflow.
 */

const SESSION_KEY = 'sb-localhost-auth-token';

const CHAUFFEUR = {
  id: '42',
  name: 'Test Chauffeur',
  role: 'chauffeur',
  employeeId: 'VHB-000042',
  email: 'test@vhb.be',
  isActive: true,
  verlofBudget: 20,
};

/** Vandaag + n dagen als yyyy-mm-dd (lokale tijd, zoals de app rekent). */
const dayOffset = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

async function seedSessionAndApi(page: Page) {
  await page.addInitScript(
    ([key, user]) => {
      const inAnHour = Math.floor(Date.now() / 1000) + 3600;
      window.localStorage.setItem(
        key as string,
        JSON.stringify({
          access_token: 'e2e-access-token',
          refresh_token: 'e2e-refresh-token',
          token_type: 'bearer',
          expires_in: 3600,
          expires_at: inAnHour,
          user: { id: 'auth-e2e', email: (user as { email: string }).email, aud: 'authenticated' },
        }),
      );
    },
    [SESSION_KEY, CHAUFFEUR] as const,
  );

  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    const json = (body: unknown) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

    if (path.endsWith('/api/me')) return json(CHAUFFEUR);
    if (path.endsWith('/api/devices/register')) return json({ status: 'approved' });
    if (path.endsWith('/api/planning')) {
      return json([
        // Vandaag: gesplitste dienst — twee blokken met eigen loopnummer.
        {
          id: 't1', date: dayOffset(0), startTime: '04:36', endTime: '07:52',
          line: '2101', busNumber: '', loopnr: '4500', driverId: CHAUFFEUR.id,
        },
        {
          id: 't2', date: dayOffset(0), startTime: '13:39', endTime: '17:29',
          line: '2101', busNumber: '', loopnr: '4611', driverId: CHAUFFEUR.id,
        },
        {
          id: 's1', date: dayOffset(1), startTime: '06:12', endTime: '09:30',
          line: '4101', busNumber: '', loopnr: '4500', driverId: CHAUFFEUR.id,
        },
        {
          id: 's2', date: dayOffset(1), startTime: '15:41', endTime: '18:20',
          line: '4101', busNumber: '', loopnr: '4611', driverId: CHAUFFEUR.id,
        },
      ]);
    }
    if (path.endsWith('/api/users')) return json([CHAUFFEUR]);
    if (path.endsWith('/api/diversions')) {
      return json([
        { id: 'd1', line: '58', title: 'Werken Markt', description: 'Omleiding via de ring.', startDate: dayOffset(0), severity: 'medium' },
      ]);
    }
    if (path.endsWith('/api/leave')) return json([]);
    // Alle overige collecties: leeg is genoeg om te renderen.
    return json([]);
  });
}

test.describe('smoke: ingelogde chauffeur', () => {
  test('dashboard rendert met dienst, omleiding en snelle acties', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));
    await seedSessionAndApi(page);

    await page.goto('/');

    // Status-strip + panelen van het chauffeursdashboard.
    await expect(page.getByText('Volgende dienst')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Verlofsaldo')).toBeVisible();
    await expect(page.getByText('Komende diensten')).toBeVisible();
    // Dienstnummer en loopnummer komen tot bij de chauffeur.
    await expect(page.getByText('4101').first()).toBeVisible();
    await expect(page.getByText(/loop 4500/).first()).toBeVisible();
    // De omleiding staat in het paneel.
    await expect(page.getByText('Werken Markt')).toBeVisible();
    // "Volgende dienst" = de eerstvolgende andere dag (de delen van vandaag
    // staan in de Vandaag-tegel): dag als waarde, dag-woord als subregel en
    // de delen van die dag als regels.
    // Subregel = "za 5 sep · morgen" (dag + afstand); het nummer staat groot erboven.
    await expect(page.getByText(/· morgen$/)).toBeVisible();
    await expect(page.getByText('06:12–09:30').first()).toBeVisible();
    // "Vandaag" toont álle blokken van de gesplitste dienst, elk met loop
    // (tijden en loopnummers in twee uitgelijnde kolommen).
    // .first(): 's ochtends staat het middagblok óók bij "Komende diensten",
    // dus de tijden kunnen meermaals voorkomen — de klok mag de test niet
    // laten omvallen.
    await expect(page.getByText('04:36–07:52').first()).toBeVisible();
    await expect(page.getByText('loop 4500').first()).toBeVisible();
    await expect(page.getByText('13:39–17:29').first()).toBeVisible();
    await expect(page.getByText('loop 4611').first()).toBeVisible();

    expect(pageErrors, `page errors:\n${pageErrors.join('\n')}`).toEqual([]);
  });

  test('geen horizontale overflow op het ingelogde dashboard', async ({ page }) => {
    await seedSessionAndApi(page);
    await page.goto('/');
    await expect(page.getByText('Volgende dienst')).toBeVisible({ timeout: 15_000 });

    const overflows = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    );
    expect(overflows, 'het dashboard scrollt horizontaal op een iPhone-viewport').toBe(false);
  });

  test('snelle actie navigeert naar het rooster', async ({ page }) => {
    await seedSessionAndApi(page);
    await page.goto('/');
    await expect(page.getByText('Komende diensten')).toBeVisible({ timeout: 15_000 });

    await page.getByText('Diensten en agenda').click();

    // Roosterweergave: op een iPhone-viewport rendert de kaartweergave (de
    // tabel is daar verborgen), dus check op de zichtbare variant.
    await expect(page.getByText('06:12–09:30').locator('visible=true').first()).toBeVisible();
  });
});

/**
 * Komende diensten per dag (ronde 6, 11-11). Het paneel nam de eerste drie
 * planningsrijen, en een gesplitste dienst vult er twee. Nu één rij per dag
 * met de uren van alle delen. Alleen dagen ná vandaag in de fixture, zodat het
 * uur van de dag niet meespeelt.
 */
test.describe('chauffeursdashboard: komende diensten per dag', () => {
  const deel = (id: string, dag: number, startTime: string, endTime: string, line: string, loopnr: string) =>
    ({ id, date: dayOffset(dag), startTime, endTime, line, busNumber: '', loopnr, driverId: CHAUFFEUR.id });
  // Morgen twee delen, overmorgen drie, dan twee gewone dagen: vijf rijen vóór de derde dag.
  const PLANNING = [
    deel('a1', 1, '06:58', '09:48', '2609', '4588'), deel('a2', 1, '14:58', '18:48', '2609', '4688'),
    deel('b1', 2, '05:10', '07:40', '2304', '4500'), deel('b2', 2, '09:15', '12:05', '2304', '4611'), deel('b3', 2, '15:45', '19:35', '2304', '4702'),
    deel('c1', 3, '08:48', '16:58', '4609', '4688'),
    deel('d1', 4, '06:12', '14:30', '4101', '4500'),
  ];
  async function open(page: Page) {
    await seedSessionAndApi(page);
    // Na de seed gezet, dus eerst aan de beurt: alleen de planning is anders.
    await page.route((url) => url.pathname.endsWith('/api/planning'), (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(PLANNING) }));
    await page.goto('/');
    const paneel = page.locator('div.surface-card').filter({ has: page.getByRole('heading', { name: 'Komende diensten' }) });
    await expect(paneel).toBeVisible({ timeout: 15_000 });
    return paneel.getByRole('button').filter({ hasNotText: 'Mijn rooster' });
  }

  test('drie dagen, één rij per dag, met de uren van alle delen en het dienstnummer', async ({ page }) => {
    const rijen = await open(page);
    await expect(rijen).toHaveCount(3);
    await expect(rijen.nth(0)).toContainText('06:58–09:48 · 14:58–18:48');
    await expect(rijen.nth(0)).toContainText('2609');
    await expect(rijen.nth(1)).toContainText('05:10–07:40 · 09:15–12:05 · 15:45–19:35');
    await expect(rijen.nth(1)).toContainText('2304');
    // Eén deel houdt zijn loopnummer; bij een gesplitste dienst vallen ze weg.
    await expect(rijen.nth(2)).toContainText('08:48–16:58 · loop 4688');
    await expect(rijen.nth(0)).not.toContainText('loop');
    await expect(rijen.nth(1)).not.toContainText('loop');
    // De vierde dag valt buiten de drie.
    await expect(rijen.filter({ hasText: '4101' })).toHaveCount(0);
    // Een rij brengt je naar het rooster, zoals voorheen.
    await rijen.nth(0).click();
    await expect(page).toHaveURL(/\/rooster$/);
  });

  for (const breedte of [375, 360]) {
    test(`op ${breedte} px wordt geen uur afgekapt: de regel loopt om tussen de tijdvakken, nooit erin`, async ({ page }) => {
      await page.setViewportSize({ width: breedte, height: 800 });
      const rijen = await open(page);
      await expect(rijen).toHaveCount(3);
      const meting = await rijen.evaluateAll((els) => els.map((rij) => {
        const spans = [...rij.querySelectorAll('span')];
        const vakken = spans.filter((s) => s.children.length === 0 && /^\d\d:\d\d–\d\d:\d\d$/.test(s.textContent ?? ''));
        return {
          vakken: vakken.length,
          // Elk tijdvak staat op één lijn (één rechthoek) en binnen de rij.
          heel: vakken.every((s) => s.getClientRects().length === 1 && s.getBoundingClientRect().right <= rij.getBoundingClientRect().right),
          // Geen enkel vak in de rij knipt zijn inhoud af.
          afgekapt: spans.some((s) => s.scrollWidth > s.clientWidth + 1 && getComputedStyle(s).overflowX !== 'visible'),
        };
      }));
      expect(meting).toEqual([
        { vakken: 2, heel: true, afgekapt: false },
        { vakken: 3, heel: true, afgekapt: false },
        { vakken: 1, heel: true, afgekapt: false },
      ]);
      const breder = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
      expect(breder, 'het dashboard scrollt horizontaal').toBe(false);
    });
  }
});

/**
 * Zelfde rooktest voor het ADMIN-dashboard (ops-cockpit). Bestond niet — en
 * precies daardoor glipte een React-#310 (hooks na de skeleton-return) naar
 * productie: de chauffeurstest bleef groen terwijl de admin-variant crashte.
 */
async function seedAdminSessionAndApi(page: Page) {
  const ADMIN = { ...CHAUFFEUR, id: '1', name: 'Admin E2E', role: 'admin' };
  await page.addInitScript(
    ([key, user]) => {
      const inAnHour = Math.floor(Date.now() / 1000) + 3600;
      window.localStorage.setItem(key as string, JSON.stringify({
        access_token: 'e2e-access-token', refresh_token: 'e2e-refresh-token', token_type: 'bearer',
        expires_in: 3600, expires_at: inAnHour,
        user: { id: 'auth-e2e', email: (user as { email: string }).email, aud: 'authenticated' },
      }));
    },
    [SESSION_KEY, ADMIN] as const,
  );
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    const json = (body: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    if (path.endsWith('/api/me')) return json(ADMIN);
    if (path.endsWith('/api/devices/register')) return json({ status: 'approved' });
    if (path.endsWith('/api/devices/gate')) return json({ enabled: true });
    if (path.endsWith('/api/devices')) return json([{ userId: '42', deviceToken: 't', name: 'iPhone', status: 'pending', createdAt: dayOffset(0), lastSeenAt: dayOffset(0) }]);
    if (path.endsWith('/api/users')) return json([ADMIN, CHAUFFEUR]);
    if (path.endsWith('/api/activity/logins')) return json({ logins: [] });
    return json([]);
  });
}

test.describe('smoke: ingelogde admin', () => {
  test('ops-dashboard rendert zonder crash', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));
    await seedAdminSessionAndApi(page);

    await page.goto('/');
    // De cockpit is er pas ná de skeleton→data-overgang — exact het moment
    // waarop de hooks-crash optrad.
    await expect(page.getByText('Open taken').first()).toBeVisible({ timeout: 15_000 });
    // Wachtend toestel verschijnt als open taak (#252).
    await expect(page.getByText(/Toestel wacht op goedkeuring/).first()).toBeVisible();
    expect(pageErrors).toEqual([]);
  });

  test('werkvoorraad-knop in de topbar: badge, uitklapmenu en navigatie', async ({ page }) => {
    await seedAdminSessionAndApi(page);
    await page.goto('/');

    // Eén wachtend toestel in de fixtures → teller-badge "1" op de knop.
    const knop = page.getByRole('button', { name: 'Open taken (1)' });
    await expect(knop).toBeVisible({ timeout: 15_000 });

    await knop.click();
    await expect(page.getByRole('menu', { name: 'Open taken' })).toBeVisible();
    // Samenvattingsrij mét detail-subregel (naam van de wachtende collega).
    const rij = page.getByRole('menuitem', { name: /toestel wacht op goedkeuring/i });
    await expect(rij).toBeVisible();
    await expect(rij).toContainText('Test Chauffeur');

    // Rij navigeert rechtstreeks naar het Toestellen-scherm.
    await rij.click();
    await expect(page.getByRole('heading', { name: 'Toestellen', exact: true })).toBeVisible();
  });
});
