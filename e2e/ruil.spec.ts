import { test, expect, type Page } from '@playwright/test';

/**
 * E2E op de tweede schrijf-flow: dienstruil. De verlofflow heeft al een spec;
 * dit dekt de 3-staps ruilwizard (eigen dienst → collega → tegenprestatie,
 * met de availability-matching) en het accepteren door de collega (PATCH met
 * ifStatus-guard). Zelfde opzet als dashboard/verlof: sessie in localStorage,
 * alle /api/** gemockt.
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

const COLLEGA = {
  id: '7',
  name: 'Collega E2E',
  role: 'chauffeur',
  employeeId: 'VHB-000007',
  email: 'collega@vhb.be',
  isActive: true,
  verlofBudget: 20,
};

const PLANNER = {
  id: '2',
  name: 'Planner E2E',
  role: 'planner',
  employeeId: 'VHB-000002',
  email: 'planner@vhb.be',
  isActive: true,
};

const dayOffset = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const seedSession = async (page: Page, user: { email: string }) => {
  await page.addInitScript(
    ([key, u]) => {
      const inAnHour = Math.floor(Date.now() / 1000) + 3600;
      window.localStorage.setItem(
        key as string,
        JSON.stringify({
          access_token: 'e2e-access-token',
          refresh_token: 'e2e-refresh-token',
          token_type: 'bearer',
          expires_in: 3600,
          expires_at: inAnHour,
          user: { id: 'auth-e2e', email: (u as { email: string }).email, aud: 'authenticated' },
        }),
      );
      window.localStorage.setItem('vhb-current-view', 'ruil-verzoeken');
    },
    [SESSION_KEY, user] as const,
  );
};

test('chauffeur stelt een ruil voor via de 3-staps wizard', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));
  await seedSession(page, CHAUFFEUR);

  const eigenDienst = {
    id: 's1', date: dayOffset(3), startTime: '08:00', endTime: '16:00',
    line: '2101', busNumber: '', driverId: CHAUFFEUR.id,
  };
  // Collega is vrij op de dag van de eigen dienst (stap 2 toont "vrij") en
  // rijdt dienst 2202 op +10 (stap 3 biedt die als tegenprestatie aan).
  const availability = {
    days: [
      { date: dayOffset(3), working: [CHAUFFEUR.id], leave: [], free: [COLLEGA.id], lines: { [CHAUFFEUR.id]: '2101' } },
      { date: dayOffset(10), working: [COLLEGA.id], leave: [], free: [], lines: { [COLLEGA.id]: '2202' } },
    ],
  };

  let postedSwaps: any[] | null = null;
  await page.route('**/api/**', async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    const json = (body: unknown) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

    if (path.endsWith('/api/me')) return json(CHAUFFEUR);
    if (path.endsWith('/api/devices/register')) return json({ status: 'approved' });
    if (path.endsWith('/api/users')) return json([CHAUFFEUR, COLLEGA]);
    if (path.endsWith('/api/planning')) return json([eigenDienst]);
    if (path.endsWith('/api/availability')) return json(availability);
    if (path.endsWith('/api/swaps') && req.method() === 'POST') {
      postedSwaps = JSON.parse(req.postData() ?? 'null');
      return json({});
    }
    return json([]);
  });

  await page.goto('/');
  await page.getByRole('button', { name: 'Dienstruil aanvragen' }).click();
  await expect(page.getByText('Stap 1 van 3')).toBeVisible();

  // Stap 1: eigen dienst kiezen.
  await page.getByRole('button', { name: /Dienst 2101/ }).click();
  await expect(page.getByText('Stap 2 van 3')).toBeVisible();

  // Stap 2: de vrije collega kiezen.
  await page.getByRole('button', { name: /Collega E2E/ }).click();
  await expect(page.getByText('Stap 3 van 3')).toBeVisible();

  // Stap 3: zonder tegenprestatie kan hier niet — de collega staat niet op
  // vrij/bv/tk/ta (geen takeover-lijst in het availability-antwoord).
  await expect(page.getByRole('button', { name: /Zonder tegenprestatie/ })).toBeDisabled();

  // Stap 3: tegenprestatie kiezen en versturen.
  await page.getByRole('button', { name: /Dienst 2202/ }).click();
  await page.getByRole('button', { name: 'Ruilverzoek versturen' }).click();

  // De wizard sluit en de POST bevat exact de gekozen ruil.
  await expect(page.getByText('Stap 3 van 3')).toBeHidden();
  expect(postedSwaps, 'POST /api/swaps is nooit verstuurd').not.toBeNull();
  const nieuw = (postedSwaps ?? []).at(-1);
  expect(nieuw).toMatchObject({
    shiftId: 's1',
    requesterId: CHAUFFEUR.id,
    targetDriverId: COLLEGA.id,
    status: 'pending',
    returnDate: dayOffset(10),
    returnCode: '2202',
  });

  expect(pageErrors, `page errors:\n${pageErrors.join('\n')}`).toEqual([]);
});

test('chauffeur geeft een dienst door zonder tegenprestatie', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));
  await seedSession(page, CHAUFFEUR);

  const eigenDienst = {
    id: 's1', date: dayOffset(3), startTime: '08:00', endTime: '16:00',
    line: '2101', busNumber: '', driverId: CHAUFFEUR.id,
  };
  // De collega staat die dag op 'bv': niet "vrij" (verlof), maar wél iemand
  // die de dienst zonder tegenprestatie mag overnemen — de server zet hem
  // daarom in `takeover`.
  const availability = {
    days: [
      {
        date: dayOffset(3), working: [CHAUFFEUR.id], leave: [COLLEGA.id], free: [],
        lines: { [CHAUFFEUR.id]: '2101' }, takeover: { [COLLEGA.id]: 'bv' },
      },
    ],
  };

  let postedSwaps: any[] | null = null;
  await page.route('**/api/**', async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    const json = (body: unknown) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

    if (path.endsWith('/api/me')) return json(CHAUFFEUR);
    if (path.endsWith('/api/devices/register')) return json({ status: 'approved' });
    if (path.endsWith('/api/users')) return json([CHAUFFEUR, COLLEGA]);
    if (path.endsWith('/api/planning')) return json([eigenDienst]);
    if (path.endsWith('/api/availability')) return json(availability);
    if (path.endsWith('/api/swaps') && req.method() === 'POST') {
      postedSwaps = JSON.parse(req.postData() ?? 'null');
      return json({});
    }
    return json([]);
  });

  await page.goto('/');
  await page.getByRole('button', { name: 'Dienstruil aanvragen' }).click();
  await page.getByRole('button', { name: /Dienst 2101/ }).click();

  // Stap 2: de collega staat op 'bv' en blijft dus kiesbaar, mét die code.
  await page.getByRole('button', { name: /Collega E2E/ }).click();
  await expect(page.getByText('Stap 3 van 3')).toBeVisible();

  // Stap 3: zonder tegenprestatie — geen dienstenlijst meer, direct versturen.
  await page.getByRole('button', { name: /Zonder tegenprestatie/ }).click();
  await page.getByRole('button', { name: 'Vraag om over te nemen' }).click();

  await expect(page.getByText('Stap 3 van 3')).toBeHidden();
  const nieuw = (postedSwaps ?? []).at(-1);
  expect(nieuw).toMatchObject({
    shiftId: 's1',
    requesterId: CHAUFFEUR.id,
    targetDriverId: COLLEGA.id,
    status: 'pending',
    swapType: 'overname',
  });
  expect(nieuw.returnDate).toBeUndefined();
  expect(nieuw.returnCode).toBeUndefined();

  expect(pageErrors, `page errors:\n${pageErrors.join('\n')}`).toEqual([]);
});

test('collega accepteert een aan hem gerichte ruil (PATCH met ifStatus-guard)', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));
  await seedSession(page, CHAUFFEUR);

  const ruil = {
    id: 'w1',
    shiftId: 'r1',
    requesterId: COLLEGA.id,
    targetDriverId: CHAUFFEUR.id,
    status: 'pending',
    createdAt: new Date().toISOString(),
    returnDate: dayOffset(9),
    returnCode: 'vrij',
  };
  const collegaDienst = {
    id: 'r1', date: dayOffset(5), startTime: '06:00', endTime: '14:00',
    line: '2323', busNumber: '', driverId: COLLEGA.id,
  };

  let patched: { path: string; body: any } | null = null;
  await page.route('**/api/**', async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    const json = (body: unknown) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

    if (path.endsWith('/api/me')) return json(CHAUFFEUR);
    if (path.endsWith('/api/devices/register')) return json({ status: 'approved' });
    if (path.endsWith('/api/users')) return json([CHAUFFEUR, COLLEGA]);
    if (path.endsWith('/api/planning')) return json([collegaDienst]);
    if (path.endsWith('/api/swaps') && req.method() === 'GET') return json([ruil]);
    if (path.includes('/api/swaps/') && req.method() === 'PATCH') {
      patched = { path, body: JSON.parse(req.postData() ?? 'null') };
      return json({ swap: { ...ruil, status: 'accepted' } });
    }
    return json([]);
  });

  await page.goto('/');
  await expect(page.getByText('Jouw antwoord')).toBeVisible({ timeout: 15_000 });

  // Accepteren → bevestigingsmodal → bevestigen (zelfde label, dus .last()).
  await page.getByRole('button', { name: 'Accepteren' }).click();
  await expect(page.getByText('De planner beoordeelt ze daarna nog')).toBeVisible();
  await page.getByRole('button', { name: 'Accepteren' }).last().click();

  await expect.poll(() => patched).not.toBeNull();
  expect(patched!.path).toMatch(/\/api\/swaps\/w1$/);
  expect(patched!.body).toMatchObject({ status: 'accepted', ifStatus: 'pending' });

  // Lokale update: de tussenstand "wacht op de planner" verschijnt.
  await expect(page.getByText('Je accepteerde deze ruil, de planner valideert nog (rij-/rusttijden).')).toBeVisible();

  expect(pageErrors, `page errors:\n${pageErrors.join('\n')}`).toEqual([]);
});

test('de wizard biedt geen dag aan waarop de collega twee diensten rijdt', async ({ page }) => {
  // Blok 3 (#21): rijdt de collega die dag twee verschillende diensten, dan
  // plakt /api/availability ze samen tot "2202/2303". Zo'n code matcht geen
  // enkele planning-rij, dus de terugruil zou bij de doorvoer stil niets
  // verplaatsen — de 1-op-1 ruil werd dan feitelijk een eenzijdige overname.
  // De server weigert hem nu; hier controleren we dat de wizard hem niet eens
  // aanbiedt, zodat de aanvrager geen doodlopend pad in gaat.
  const pageErrors: string[] = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));
  await seedSession(page, CHAUFFEUR);

  const eigenDienst = {
    id: 's1', date: dayOffset(3), startTime: '08:00', endTime: '16:00',
    line: '2101', busNumber: '', driverId: CHAUFFEUR.id,
  };
  const availability = {
    days: [
      { date: dayOffset(3), working: [CHAUFFEUR.id], leave: [], free: [COLLEGA.id], lines: { [CHAUFFEUR.id]: '2101' } },
      // Twee diensten op één dag → samengestelde code, mag niet aangeboden.
      { date: dayOffset(10), working: [COLLEGA.id], leave: [], free: [], lines: { [COLLEGA.id]: '2202/2303' } },
      // Eén dienst op een andere dag → moet er wél staan.
      { date: dayOffset(11), working: [COLLEGA.id], leave: [], free: [], lines: { [COLLEGA.id]: '2404' } },
    ],
  };

  await page.route('**/api/**', async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    const json = (body: unknown) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

    if (path.endsWith('/api/me')) return json(CHAUFFEUR);
    if (path.endsWith('/api/devices/register')) return json({ status: 'approved' });
    if (path.endsWith('/api/users')) return json([CHAUFFEUR, COLLEGA]);
    if (path.endsWith('/api/planning')) return json([eigenDienst]);
    if (path.endsWith('/api/availability')) return json(availability);
    return json([]);
  });

  await page.goto('/');
  await page.getByRole('button', { name: 'Dienstruil aanvragen' }).click();
  await page.getByRole('button', { name: /Dienst 2101/ }).click();
  await page.getByRole('button', { name: /Collega E2E/ }).click();
  await expect(page.getByText('Stap 3 van 3')).toBeVisible();

  // De enkelvoudige dienst staat er; de samengestelde niet.
  await expect(page.getByRole('button', { name: /Dienst 2404/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /2202\/2303/ })).toHaveCount(0);

  expect(pageErrors, `page errors:\n${pageErrors.join('\n')}`).toEqual([]);
});

test('planner keurt een geaccepteerde ruil goed (PATCH met ifStatus accepted)', async ({ page }) => {
  // Blok 3 (#15/#18): de goedkeuring gaat via PATCH met een ifStatus-guard, en
  // de server voert de planning pas door ná die guard. Hier controleren we de
  // kant die de planner echt aanraakt: de knop stuurt status+ifStatus mee.
  const pageErrors: string[] = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));
  await seedSession(page, PLANNER);

  const dienst = {
    id: 'p1', date: dayOffset(4), startTime: '06:00', endTime: '14:00',
    line: '2505', busNumber: '', driverId: CHAUFFEUR.id,
  };
  const ruil = {
    id: 'a1',
    shiftId: 'p1',
    requesterId: CHAUFFEUR.id,
    targetDriverId: COLLEGA.id,
    status: 'accepted',
    createdAt: new Date().toISOString(),
    shiftDate: dienst.date,
    shiftLine: '2505',
    returnDate: dayOffset(9),
    returnCode: 'vrij',
  };

  let patched: { path: string; body: any } | null = null;
  await page.route('**/api/**', async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    const json = (body: unknown) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

    if (path.endsWith('/api/me')) return json(PLANNER);
    if (path.endsWith('/api/devices/register')) return json({ status: 'approved' });
    if (path.endsWith('/api/users')) return json([PLANNER, CHAUFFEUR, COLLEGA]);
    if (path.endsWith('/api/planning')) return json([dienst]);
    if (path.endsWith('/api/swaps') && req.method() === 'GET') return json([ruil]);
    if (path.includes('/api/swaps/') && req.method() === 'PATCH') {
      patched = { path, body: JSON.parse(req.postData() ?? 'null') };
      return json({ swap: { ...ruil, status: 'approved' } });
    }
    return json([]);
  });

  await page.goto('/');
  // De ruil staat in "Beheer dienstruilen" — dienst-info komt van shiftDate/
  // shiftLine op de ruil zelf (blok 1 #13), niet uit de eigen planning.
  await expect(page.getByText('Beheer dienstruilen')).toBeVisible({ timeout: 15_000 });

  await page.getByRole('button', { name: 'Goedkeuren' }).first().click();
  await expect.poll(() => patched).not.toBeNull();
  expect(patched!.path).toMatch(/\/api\/swaps\/a1$/);
  expect(patched!.body).toMatchObject({ status: 'approved', ifStatus: 'accepted' });

  expect(pageErrors, `page errors:\n${pageErrors.join('\n')}`).toEqual([]);
});
