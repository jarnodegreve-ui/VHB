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

  // `null as …`: toegewezen in een route-callback, zie verlof.spec.ts.
  let postedSwaps = null as any[] | null;
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

test('stap 2: naam eerst, daaronder één korte code; vrij eerst, binnen elke groep alfabetisch', async ({ page }) => {
  await seedSession(page, CHAUFFEUR);
  const collega = (id: string, name: string) => ({ ...COLLEGA, id, name, email: `${id}@vhb.be`, employeeId: `VHB-0000${id}` });
  const ZOE = collega('81', 'Zoë Verhaeghe');
  const ANNA = collega('82', 'Anna Baert');
  const BERT = collega('83', 'Bert Claeys');
  const CARL = collega('84', 'Carl Dhondt');
  const eigenDienst = { id: 's1', date: dayOffset(3), startTime: '08:00', endTime: '16:00', line: '2101', busNumber: '', driverId: CHAUFFEUR.id };
  const availability = {
    days: [{
      date: dayOffset(3), working: [CHAUFFEUR.id, BERT.id], leave: [ANNA.id, CARL.id], free: [ZOE.id],
      lines: { [CHAUFFEUR.id]: '2101', [BERT.id]: '2303' }, takeover: { [ANNA.id]: 'bv' },
    }],
  };
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    const json = (body: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    if (path.endsWith('/api/me')) return json(CHAUFFEUR);
    if (path.endsWith('/api/devices/register')) return json({ status: 'approved' });
    if (path.endsWith('/api/users')) return json([CHAUFFEUR, ZOE, CARL, BERT, ANNA]);
    if (path.endsWith('/api/planning')) return json([eigenDienst]);
    if (path.endsWith('/api/availability')) return json(availability);
    return json([]);
  });

  await page.goto('/');
  await page.getByRole('button', { name: 'Dienstruil aanvragen' }).click();
  await page.getByRole('button', { name: /Dienst 2101/ }).click();
  await expect(page.getByText('Stap 2 van 3')).toBeVisible();

  const opties = page.getByRole('dialog').getByRole('button', { name: /Verhaeghe|Baert|Claeys|Dhondt/ });
  // Vrij (en BV/TK/TA) eerst, dan wie die dag een dienst heeft of bezet is; telkens alfabetisch.
  await expect(opties).toHaveText([
    /^Anna Baert\s*BV$/,
    /^Zoë Verhaeghe\s*Vrij$/,
    /^Bert Claeys\s*Dienst 2303$/,
    /^Carl Dhondt\s*Bezet$/,
  ]);
});

test('een dienst met een lopende ruil is niet opnieuw aanvraagbaar', async ({ page }) => {
  // De server weigert een tweede verzoek op dezelfde dienst met een 409, en
  // sinds 18-09 geldt dat voor de héle dienst (ook het andere deel van een
  // gesplitste dienst). De wizard toont dat vooraf i.p.v. te laten doodlopen.
  await seedSession(page, CHAUFFEUR);
  const deel1 = { id: 's1', date: dayOffset(3), startTime: '05:00', endTime: '09:00', line: '2101', busNumber: '', driverId: CHAUFFEUR.id };
  const deel2 = { id: 's1b', date: dayOffset(3), startTime: '15:00', endTime: '19:00', line: '2101', busNumber: '', driverId: CHAUFFEUR.id };
  const vrijeDienst = { id: 's2', date: dayOffset(4), startTime: '08:00', endTime: '16:00', line: '2202', busNumber: '', driverId: CHAUFFEUR.id };
  const lopend = {
    id: 'sw-open', shiftId: deel1.id, requesterId: CHAUFFEUR.id, targetDriverId: COLLEGA.id,
    status: 'pending', reason: '', createdAt: new Date().toISOString(),
    shiftDate: deel1.date, shiftLine: deel1.line,
  };

  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    const json = (body: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    if (path.endsWith('/api/me')) return json(CHAUFFEUR);
    if (path.endsWith('/api/devices/register')) return json({ status: 'approved' });
    if (path.endsWith('/api/users')) return json([CHAUFFEUR, COLLEGA]);
    if (path.endsWith('/api/planning')) return json([deel1, deel2, vrijeDienst]);
    if (path.endsWith('/api/swaps')) return json([lopend]);
    return json([]);
  });

  await page.goto('/');
  await page.getByRole('button', { name: 'Dienstruil aanvragen' }).click();
  await expect(page.getByText('Stap 1 van 3')).toBeVisible();

  // Eén kaart per dienst: 2101 staat in 2 delen en is geblokkeerd, 2202 niet.
  // Binnen de wizard zoeken; de lijst eronder heeft dezelfde dienstnummers.
  const wizard = page.getByRole('dialog');
  const geblokkeerd = wizard.getByRole('button', { name: /Dienst 2101/ });
  await expect(geblokkeerd).toBeDisabled();
  await expect(geblokkeerd).toContainText('Ruil loopt al');
  await expect(wizard.getByRole('button', { name: /Dienst 2202/ })).toBeEnabled();
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

  // `null as …`: toegewezen in een route-callback, zie verlof.spec.ts.
  let postedSwaps = null as any[] | null;
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
  expect(nieuw?.returnDate).toBeUndefined();
  expect(nieuw?.returnCode).toBeUndefined();

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
      // De server geeft het bijgewerkte verloop mee (zie PATCH /api/swaps/:id).
      return json({ swap: { ...ruil, status: 'accepted', verloop: [
        { soort: 'aangevraagd', op: ruil.createdAt, door: 'aanvrager' },
        { soort: 'geaccepteerd', op: new Date().toISOString(), door: 'collega', van: 'pending' },
      ] } });
    }
    return json([]);
  });

  await page.goto('/');
  await expect(page.getByText('Jouw antwoord')).toBeVisible({ timeout: 15_000 });

  // Verloop per persoon: de collega (ik) is aan zet, de planner nog niet.
  const verloop = page.getByRole('region', { name: 'Verloop per persoon' });
  await expect(verloop.getByRole('listitem')).toHaveCount(3);
  await expect(verloop.getByRole('listitem').nth(0)).toContainText(COLLEGA.name);
  await expect(verloop.getByRole('listitem').nth(0)).toContainText('Aangevraagd');
  await expect(verloop.getByRole('listitem').nth(1)).toContainText('(jij)');
  await expect(verloop.getByRole('listitem').nth(1)).toContainText('Wacht op antwoord');
  await expect(verloop.getByRole('listitem').nth(1)).toContainText('Krijgt dienst 2323');
  await expect(verloop.getByRole('listitem').nth(2)).toContainText('Wacht op collega');

  // Accepteren → bevestigingsmodal → bevestigen (zelfde label, dus .last()).
  await page.getByRole('button', { name: 'Accepteren' }).click();
  await expect(page.getByText('De planner beoordeelt ze daarna nog')).toBeVisible();
  await page.getByRole('button', { name: 'Accepteren' }).last().click();

  await expect.poll(() => patched).not.toBeNull();
  expect(patched!.path).toMatch(/\/api\/swaps\/w1$/);
  expect(patched!.body).toMatchObject({ status: 'accepted', ifStatus: 'pending' });

  // Lokale update: de tussenstand "wacht op de planner" verschijnt.
  await expect(page.getByText('Je accepteerde deze ruil, de planner valideert nog (rij-/rusttijden).')).toBeVisible();
  // En het verloop volgt mee: ik accepteerde, nu is de planner aan zet.
  await expect(verloop.getByRole('listitem').nth(1)).toContainText('Geaccepteerd');
  await expect(verloop.getByRole('listitem').nth(2)).toContainText('Te beoordelen');

  expect(pageErrors, `page errors:\n${pageErrors.join('\n')}`).toEqual([]);
});

test('de collega opent het ruilscherm, de aanvrager ziet daarna "Bekeken" in het verloop', async ({ page }) => {
  // Eén gedeelde "server": COLLEGA vroeg de ruil aan, CHAUFFEUR is de
  // aangezochte collega. `wie` bepaalt wie er ingelogd is; de bekeken-regel die
  // de ene schrijft, komt bij de andere terug in GET /api/swaps › verloop.
  const pageErrors: string[] = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));
  await seedSession(page, CHAUFFEUR);

  // Vast aanmaakmoment ná BEKEKEN_BIJGEHOUDEN_SINDS (shared/ruilVerloop.ts):
  // alleen dan mag er "Nog niet bekeken" staan.
  const ruil = {
    id: 'w9',
    shiftId: 'r9',
    requesterId: COLLEGA.id,
    targetDriverId: CHAUFFEUR.id,
    status: 'pending',
    createdAt: '2026-10-05T06:00:00.000Z',
    shiftDate: dayOffset(5),
    shiftLine: '2323',
    returnDate: dayOffset(9),
    returnCode: 'vrij',
  };
  const BEKEKEN_OP = '2026-10-05T07:40:00.000Z'; // 09:40 in België
  let wie: typeof CHAUFFEUR = COLLEGA;
  const bekekenAanroepen: Array<{ methode: string; pad: string; door: string }> = [];
  const foutAanroepen: string[] = [];

  await page.route('**/api/**', async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    const json = (body: unknown) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

    if (path.endsWith('/api/me')) return json(wie);
    if (path.endsWith('/api/devices/register')) return json({ status: 'approved' });
    if (path.endsWith('/api/users')) return json([CHAUFFEUR, COLLEGA]);
    if (path.endsWith('/bekeken')) {
      bekekenAanroepen.push({ methode: req.method(), pad: path, door: wie.id });
      return json({ success: true, nieuw: bekekenAanroepen.length === 1 });
    }
    // Het bestaande bevestig-endpoint betekent iets anders en mag hier nooit vuren.
    if (path.endsWith('/gezien')) { foutAanroepen.push(path); return json({ success: true }); }
    if (path.endsWith('/api/swaps') && req.method() === 'GET') {
      return json([{
        ...ruil,
        verloop: [
          { soort: 'aangevraagd', op: ruil.createdAt, door: 'aanvrager' },
          ...(bekekenAanroepen.length > 0 ? [{ soort: 'bekeken', op: BEKEKEN_OP, door: 'collega' }] : []),
        ],
      }]);
    }
    return json([]);
  });

  const verloop = page.getByRole('region', { name: 'Verloop per persoon' });
  const opCollegaRegel = () => verloop.getByRole('listitem').nth(1);

  // 1. De aanvrager kijkt eerst: nog niemand heeft de aanvraag gezien.
  await page.goto('/');
  await page.getByRole('button', { name: /Dienst 2323/ }).click();
  await expect(opCollegaRegel()).toContainText(CHAUFFEUR.name);
  await expect(opCollegaRegel()).toContainText('Nog niet bekeken');
  // De aanvrager zelf registreert niets, ook niet na het verblijf in beeld.
  await page.waitForTimeout(1200);
  expect(bekekenAanroepen).toEqual([]);

  // 2. De collega opent het ruilscherm: de kaart staat in beeld → één melding.
  wie = CHAUFFEUR;
  await page.reload();
  await expect(page.getByText('Jouw antwoord')).toBeVisible({ timeout: 15_000 });
  await expect.poll(() => bekekenAanroepen.length, { timeout: 10_000 }).toBe(1);
  expect(bekekenAanroepen[0]).toEqual({ methode: 'POST', pad: '/api/swaps/w9/bekeken', door: CHAUFFEUR.id });
  // Zijn eigen regel zegt gewoon dat hij nog moet antwoorden.
  await expect(opCollegaRegel()).toContainText('(jij)');
  await expect(opCollegaRegel()).toContainText('Wacht op antwoord');
  await expect(verloop).not.toContainText('ekeken');

  // Opnieuw openen: de server kent de regel al, dus er vuurt niets meer.
  await page.reload();
  await expect(page.getByText('Jouw antwoord')).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(1500);
  expect(bekekenAanroepen).toHaveLength(1);

  // 3. Terug bij de aanvrager: bekeken, met het moment (dd/mm uu:mm, 24-uurs).
  wie = COLLEGA;
  await page.reload();
  await page.getByRole('button', { name: /Dienst 2323/ }).click();
  await expect(opCollegaRegel()).toContainText('Bekeken, nog geen antwoord');
  // (formatMomentKort zet het jaartal erbij zodra het niet meer dit jaar is.)
  await expect(opCollegaRegel()).toContainText(/05\/10(\/2026)? 09:40/);
  await expect(verloop).not.toContainText('Nog niet bekeken');
  // De planner wacht nog altijd op de collega: bekeken is geen antwoord.
  await expect(verloop.getByRole('listitem').nth(2)).toContainText('Wacht op collega');

  expect(foutAanroepen, 'het bevestig-endpoint /gezien hoort hier niet te vuren').toEqual([]);
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

  // Op de telefoon staat elke ruil dicht in de beheerlijst (28-09): eerst openklappen.
  const beheer = page.getByRole('list', { name: 'Beheer dienstruilen' });
  await beheer.getByRole('button', { name: /Dienst 2505/ }).click();
  await beheer.getByRole('button', { name: 'Goedkeuren' }).click();
  await expect.poll(() => patched).not.toBeNull();
  expect(patched!.path).toMatch(/\/api\/swaps\/a1$/);
  expect(patched!.body).toMatchObject({ status: 'approved', ifStatus: 'accepted' });

  expect(pageErrors, `page errors:\n${pageErrors.join('\n')}`).toEqual([]);
});

test('de collega ziet vóór het accepteren dat hij te weinig rust overhoudt', async ({ page }) => {
  // Rusttijd bij een dienstruil (22-09): de server rekent per ruil na hoeveel
  // rust er overblijft en stuurt de collega alleen de regel over hemzelf.
  const pageErrors: string[] = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));
  await seedSession(page, CHAUFFEUR);

  const dag = dayOffset(5);
  const ruil = {
    id: 'rust1', shiftId: 'r1', requesterId: COLLEGA.id, targetDriverId: CHAUFFEUR.id,
    status: 'pending', createdAt: new Date().toISOString(),
    shiftDate: dag, shiftLine: '2101', returnDate: dayOffset(9), returnCode: 'vrij',
    rust: [{ wie: 'collega', datum: dag, dienst: '2101', rustVoor: 340, rustNa: null, teKort: true }],
  };

  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    const json = (body: unknown) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    if (path.endsWith('/api/me')) return json(CHAUFFEUR);
    if (path.endsWith('/api/devices/register')) return json({ status: 'approved' });
    if (path.endsWith('/api/users')) return json([CHAUFFEUR, COLLEGA]);
    if (path.endsWith('/api/swaps') && route.request().method() === 'GET') return json([ruil]);
    return json([]);
  });

  await page.goto('/');
  await expect(page.getByText('Jouw antwoord')).toBeVisible({ timeout: 15_000 });

  const rust = page.getByRole('region', { name: 'Rusttijd' });
  await expect(rust.getByRole('listitem')).toHaveCount(1);
  await expect(rust).toContainText('Te weinig rust: Jij, dienst 2101');
  await expect(rust).toContainText('5u40 na de dienst van de dag ervoor');
  await expect(rust).toContainText('(minimum 8u)');
  // Een waarschuwing, geen blokkade: accepteren blijft mogelijk.
  await expect(page.getByRole('button', { name: 'Accepteren' })).toBeEnabled();

  expect(pageErrors, `page errors:\n${pageErrors.join('\n')}`).toEqual([]);
});

test('de planner ziet de rust van beide chauffeurs bij een te beoordelen ruil', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));
  await seedSession(page, PLANNER);

  const dag = dayOffset(4);
  const terug = dayOffset(9);
  const ruil = {
    id: 'rust2', shiftId: 'p1', requesterId: CHAUFFEUR.id, targetDriverId: COLLEGA.id,
    status: 'accepted', createdAt: new Date().toISOString(),
    shiftDate: dag, shiftLine: '2101', returnDate: terug, returnCode: '2230',
    rust: [
      { wie: 'collega', datum: dag, dienst: '2101', rustVoor: 340, rustNa: null, teKort: true },
      { wie: 'aanvrager', datum: terug, dienst: '2230', rustVoor: null, rustNa: 660, teKort: false },
    ],
  };

  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    const json = (body: unknown) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    if (path.endsWith('/api/me')) return json(PLANNER);
    if (path.endsWith('/api/devices/register')) return json({ status: 'approved' });
    if (path.endsWith('/api/users')) return json([PLANNER, CHAUFFEUR, COLLEGA]);
    if (path.endsWith('/api/swaps') && route.request().method() === 'GET') return json([ruil]);
    return json([]);
  });

  await page.goto('/');
  await expect(page.getByText('Beheer dienstruilen')).toBeVisible({ timeout: 15_000 });

  // Dicht (28-09): de waarschuwing staat al op de rij, de details nog niet.
  const beheer = page.getByRole('list', { name: 'Beheer dienstruilen' });
  const rij = beheer.getByRole('button', { name: /Dienst 2101/ });
  await expect(rij).toContainText('Te weinig rust');
  await expect(beheer.getByRole('region', { name: 'Rusttijd' })).toHaveCount(0);
  await rij.click();

  const rust = beheer.getByRole('region', { name: 'Rusttijd' });
  await expect(rust.getByRole('listitem')).toHaveCount(2);
  await expect(rust.getByRole('listitem').nth(0)).toContainText(`Te weinig rust: ${COLLEGA.name}, dienst 2101`);
  await expect(rust.getByRole('listitem').nth(1)).toContainText(`${CHAUFFEUR.name}, dienst 2230`);
  await expect(rust.getByRole('listitem').nth(1)).toContainText('11u tot de dienst van de dag erna');
  await expect(rust.getByRole('listitem').nth(1)).not.toContainText('Te weinig rust');
  // De planner beslist: goedkeuren blijft beschikbaar.
  await expect(beheer.getByRole('button', { name: 'Goedkeuren' })).toBeEnabled();

  expect(pageErrors, `page errors:\n${pageErrors.join('\n')}`).toEqual([]);
});

test('beheerlijst op de telefoon: wat op een beslissing wacht bovenaan, elke ruil dicht tot je hem opent', async ({ page }) => {
  // Jarno 28-09: de lijst volgde de database (op id) en elke kaart stond
  // volledig open. Nu: collega akkoord, wacht op collega, goedgekeurd; per
  // groep de vroegste dienst eerst; dicht tot je erop tikt.
  const pageErrors: string[] = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));
  await seedSession(page, PLANNER);

  const basis = { requesterId: CHAUFFEUR.id, targetDriverId: COLLEGA.id, createdAt: new Date().toISOString(), returnDate: dayOffset(20), returnCode: 'vrij' };
  const ruilen = [
    { ...basis, id: 'g-laat', shiftId: 'x1', status: 'approved', shiftDate: dayOffset(8), shiftLine: '2303' },
    { ...basis, id: 'wacht', shiftId: 'x2', status: 'pending', shiftDate: dayOffset(6), shiftLine: '2202' },
    {
      ...basis, id: 'akkoord', shiftId: 'x3', status: 'accepted', shiftDate: dayOffset(10), shiftLine: '2505', reason: 'Trouwfeest van mijn zus',
      rust: [{ wie: 'collega', datum: dayOffset(10), dienst: '2505', rustVoor: 340, rustNa: null, teKort: true }],
    },
    { ...basis, id: 'g-vroeg', shiftId: 'x4', status: 'approved', shiftDate: dayOffset(3), shiftLine: '2101' },
  ];

  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    const json = (body: unknown) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    if (path.endsWith('/api/me')) return json(PLANNER);
    if (path.endsWith('/api/devices/register')) return json({ status: 'approved' });
    if (path.endsWith('/api/users')) return json([PLANNER, CHAUFFEUR, COLLEGA]);
    if (path.endsWith('/api/swaps') && route.request().method() === 'GET') return json(ruilen);
    return json([]);
  });

  await page.goto('/');
  const beheer = page.getByRole('list', { name: 'Beheer dienstruilen' });
  await expect(beheer).toBeVisible({ timeout: 15_000 });

  const rijen = beheer.locator(':scope > li');
  await expect(rijen).toHaveCount(4);
  await expect(rijen.nth(0)).toContainText('Dienst 2505');
  await expect(rijen.nth(1)).toContainText('Dienst 2202');
  await expect(rijen.nth(2)).toContainText('Dienst 2101');
  await expect(rijen.nth(3)).toContainText('Dienst 2303');

  // Dicht: wie, welke dienst en de stand, plus de rustwaarschuwing; geen verloop, geen knoppen.
  await expect(rijen.nth(0)).toContainText(`${CHAUFFEUR.name} → ${COLLEGA.name}`);
  await expect(rijen.nth(0)).toContainText('Te weinig rust');
  await expect(beheer.getByRole('region', { name: 'Verloop per persoon' })).toHaveCount(0);
  await expect(beheer.getByRole('button', { name: 'Goedkeuren' })).toHaveCount(0);

  // Open: verloop, toelichting en de knoppen, afwijzen links (C, 24-09).
  const eerste = rijen.nth(0).getByRole('button', { name: /Dienst 2505/ });
  await eerste.click();
  await expect(eerste).toHaveAttribute('aria-expanded', 'true');
  await expect(rijen.nth(0).getByRole('region', { name: 'Verloop per persoon' })).toBeVisible();
  await expect(rijen.nth(0)).toContainText('Trouwfeest van mijn zus');
  await expect(rijen.nth(0).getByRole('button', { name: /^(Afwijzen|Goedkeuren)$/ })).toHaveText(['Afwijzen', 'Goedkeuren']);
  await expect(rijen.nth(1).getByRole('button', { name: /Dienst 2202/ })).toHaveAttribute('aria-expanded', 'false');

  expect(pageErrors, `page errors:\n${pageErrors.join('\n')}`).toEqual([]);
});

test('chauffeur: wat op zijn antwoord wacht bovenaan, lopende verzoeken boven afgeronde', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));
  await seedSession(page, CHAUFFEUR);

  const nu = new Date().toISOString();
  const ruilen = [
    // Mijn verzoeken: een afgeronde en een lopende.
    { id: 'mv-klaar', shiftId: 'm1', requesterId: CHAUFFEUR.id, targetDriverId: COLLEGA.id, status: 'completed', createdAt: nu, decidedAt: nu, shiftDate: dayOffset(-10), shiftLine: '2101', returnDate: dayOffset(-9), returnCode: 'vrij' },
    { id: 'mv-lopend', shiftId: 'm2', requesterId: CHAUFFEUR.id, targetDriverId: COLLEGA.id, status: 'pending', createdAt: nu, shiftDate: dayOffset(12), shiftLine: '2202', returnDate: dayOffset(13), returnCode: 'vrij' },
    // Aan hem gericht: een die bij de planner ligt (vroegere dienst) en een die op zijn antwoord wacht.
    { id: 'os-planner', shiftId: 'o1', requesterId: COLLEGA.id, targetDriverId: CHAUFFEUR.id, status: 'accepted', createdAt: nu, shiftDate: dayOffset(2), shiftLine: '2303', returnDate: dayOffset(4), returnCode: 'vrij' },
    { id: 'os-antwoord', shiftId: 'o2', requesterId: COLLEGA.id, targetDriverId: CHAUFFEUR.id, status: 'pending', createdAt: nu, shiftDate: dayOffset(9), shiftLine: '2404', returnDate: dayOffset(11), returnCode: 'vrij' },
  ];

  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    const json = (body: unknown) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    if (path.endsWith('/api/me')) return json(CHAUFFEUR);
    if (path.endsWith('/api/devices/register')) return json({ status: 'approved' });
    if (path.endsWith('/api/users')) return json([CHAUFFEUR, COLLEGA]);
    if (path.endsWith('/api/swaps') && route.request().method() === 'GET') return json(ruilen);
    return json([]);
  });

  await page.goto('/');
  await expect(page.getByText('Jouw antwoord')).toBeVisible({ timeout: 15_000 });
  // Mijn verzoeken staat eerst op de pagina, dan de ruilen die aan hem gericht zijn.
  await expect.poll(() => page.locator('[data-record]').evaluateAll((els) => els.map((e) => e.getAttribute('data-record'))))
    .toEqual(['mv-lopend', 'mv-klaar', 'os-antwoord', 'os-planner']);

  expect(pageErrors, `page errors:\n${pageErrors.join('\n')}`).toEqual([]);
});

/**
 * Controle 29-09, nr. 18: het scrollvak van Mijn verzoeken (max. 420 px) vult
 * op een telefoon bijna het scherm en hield met overscroll-contain de veeg
 * vast; de ruilen die op antwoord wachten staan eronder.
 *
 * Drie bewijzen, van omgevingsonafhankelijk naar gedrag:
 *  1. de berekende stijl (geen contain onder md, wel vanaf md) en de maten;
 *  2. het muiswiel boven het vak op zijn einde scrolt de pagina door;
 *  3. hetzelfde met echte touch-events (Input.dispatchTouchEvent).
 * Bewust NIET met Input.synthesizeScrollGesture: die doet in headless Chromium
 * op Linux (de CI) helemaal niets, ook niet op de pagina zelf, en slaagde
 * alleen op macOS (PR #660).
 */
const openMijnVerzoeken = async (page: Page) => {
  await seedSession(page, CHAUFFEUR);
  const nu = new Date().toISOString();
  // Eén lopend verzoek (staat bovenaan) en dertien afgeronde.
  const eigen = Array.from({ length: 14 }, (_, i) => ({
    id: `mv-${i}`, shiftId: `m${i}`, requesterId: CHAUFFEUR.id, targetDriverId: COLLEGA.id,
    ...(i === 0
      ? { status: 'pending', shiftDate: dayOffset(12), returnDate: dayOffset(13) }
      : { status: 'completed', decidedAt: nu, shiftDate: dayOffset(-(i + 2)), returnDate: dayOffset(-(i + 1)) }),
    createdAt: nu, shiftLine: String(2101 + i), returnCode: 'vrij',
  }));
  const aanMij = { id: 'os-antwoord', shiftId: 'o1', requesterId: COLLEGA.id, targetDriverId: CHAUFFEUR.id, status: 'pending', createdAt: nu, shiftDate: dayOffset(9), shiftLine: '2404', returnDate: dayOffset(11), returnCode: 'vrij' };

  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    const json = (body: unknown) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    if (path.endsWith('/api/me')) return json(CHAUFFEUR);
    if (path.endsWith('/api/devices/register')) return json({ status: 'approved' });
    if (path.endsWith('/api/users')) return json([CHAUFFEUR, COLLEGA]);
    if (path.endsWith('/api/swaps') && route.request().method() === 'GET') return json([...eigen, aanMij]);
    return json([]);
  });

  await page.goto('/');
  const lijst = page.getByRole('list', { name: 'Mijn verzoeken' });
  await expect(lijst).toBeVisible({ timeout: 15_000 });
  await expect(lijst.locator(':scope > li')).toHaveCount(14);
  await expect(page.getByText('Jouw antwoord')).toBeAttached();

  // Het scrollvak = de dichtste voorouder van de lijst die zelf schuift.
  const gevonden = await lijst.evaluate((ul) => {
    let vak = ul.parentElement;
    while (vak && !['auto', 'scroll'].includes(getComputedStyle(vak).overflowY)) vak = vak.parentElement;
    if (!vak || vak.hasAttribute('data-scroll-root')) return false;
    vak.setAttribute('data-test-scrollvak', '');
    return true;
  });
  expect(gevonden, 'Mijn verzoeken staat in een eigen scrollvak').toBe(true);
  const vak = page.locator('[data-test-scrollvak]');

  const stand = () => page.evaluate(() => {
    const v = document.querySelector<HTMLElement>('[data-test-scrollvak]')!;
    const root = document.querySelector<HTMLElement>('[data-scroll-root]')!;
    return {
      vak: Math.round(v.scrollTop),
      eindeVak: Math.round(v.scrollHeight - v.clientHeight),
      pagina: Math.round(root.scrollTop),
      eindePagina: Math.round(root.scrollHeight - root.clientHeight),
    };
  });
  /** Zet vak en pagina op een vaste stand en wacht tot de browser die getekend heeft. */
  const zet = (waar: 'begin' | 'einde') => page.evaluate(async (w) => {
    const v = document.querySelector<HTMLElement>('[data-test-scrollvak]')!;
    document.querySelector<HTMLElement>('[data-scroll-root]')!.scrollTop = 0;
    v.scrollTop = w === 'einde' ? v.scrollHeight : 0;
    await new Promise<void>((klaar) => requestAnimationFrame(() => requestAnimationFrame(() => klaar())));
  }, waar);
  /** Een punt in het zichtbare deel van het vak, dat ook echt het vak raakt (niet het dock of de topbar). */
  const puntInVak = async () => {
    const punt = await vak.evaluate((v) => {
      const k = v.getBoundingClientRect();
      const x = Math.round(k.left + k.width / 2);
      const y = Math.round(k.top + 150);
      return { x, y, raakt: v.contains(document.elementFromPoint(x, y)) };
    });
    expect(punt.raakt, 'het punt ligt in het scrollvak').toBe(true);
    return punt;
  };
  return { lijst, vak, stand, zet, puntInVak };
};

test('Mijn verzoeken: het scrollvak blijft, maar aan het einde van de lijst scrolt de pagina door', async ({ page, browserName }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));
  const { vak, stand, zet, puntInVak } = await openMijnVerzoeken(page);

  // 1. Zonder invoer: het vak bestaat en schuift (wens Jarno), de pagina eronder
  //    is langer dan het scherm, en op de telefoon houdt het vak de veeg niet vast.
  const begin = await stand();
  expect(begin.eindeVak, 'de lijst is langer dan het vak').toBeGreaterThan(100);
  expect(begin.eindePagina, 'de pagina is langer dan het scherm').toBeGreaterThan(100);
  expect(begin).toMatchObject({ vak: 0, pagina: 0 });
  expect(await vak.evaluate((v) => getComputedStyle(v).overscrollBehaviorY), 'telefoon: de veeg gaat door naar de pagina').toBe('auto');
  await zet('einde');
  expect(await stand(), 'het vak schuift tot het einde van de lijst').toMatchObject({ vak: begin.eindeVak, pagina: 0 });
  // Wat op antwoord wacht staat onder het vak en is met de pagina te bereiken.
  const onder = await page.getByText('Jouw antwoord').evaluate((el) => {
    const v = document.querySelector<HTMLElement>('[data-test-scrollvak]')!;
    const root = document.querySelector<HTMLElement>('[data-scroll-root]')!;
    const top = el.getBoundingClientRect().top;
    return { onderVak: top >= v.getBoundingClientRect().bottom, bereikbaar: top - window.innerHeight < root.scrollHeight - root.clientHeight };
  });
  expect(onder).toEqual({ onderVak: true, bereikbaar: true });

  // 2. Met het wiel (in Chromium ook op de telefoon-emulatie; mobiel WebKit kent het niet).
  if (browserName === 'chromium') {
    await zet('begin');
    await expect(async () => {
      const punt = await puntInVak();
      await page.mouse.move(punt.x, punt.y);
      await page.mouse.wheel(0, 120);
      const s = await stand();
      expect(s.vak, 'midden in de lijst schuift het vak').toBeGreaterThan(0);
      expect(s.pagina, 'en de pagina niet').toBe(0);
    }).toPass({ timeout: 10_000 });

    await expect(async () => {
      await zet('einde');
      const punt = await puntInVak();
      // De muis even weg en terug: een nieuwe wielbeurt, niet het staartje van de vorige.
      await page.mouse.move(punt.x, punt.y - 40);
      await page.mouse.move(punt.x, punt.y);
      await page.mouse.wheel(0, 200);
      await expect.poll(async () => (await stand()).pagina, { timeout: 1_500, message: 'de pagina scrolt door naar wat onder het vak staat' }).toBeGreaterThan(0);
    }).toPass({ timeout: 15_000 });
  }

  // Op een breed scherm staan de twee lijsten naast elkaar: daar blijft het vak de veeg vasthouden.
  await page.setViewportSize({ width: 1024, height: 800 });
  await expect.poll(() => vak.evaluate((v) => getComputedStyle(v).overscrollBehaviorY)).toBe('contain');

  expect(pageErrors, `page errors:\n${pageErrors.join('\n')}`).toEqual([]);
});

test.describe('Mijn verzoeken met de vinger', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'touch-events lopen via het Chrome DevTools Protocol (Input.dispatchTouchEvent)');

  /** Eén veeg omhoog met echte touch-events; de vinger staat stil voor hij loslaat, dus geen uitloop. */
  const maakVeeg = async (page: Page) => {
    const cdp = await page.context().newCDPSession(page);
    return async (punt: { x: number; y: number }, afstand: number) => {
      const van = punt.y + afstand / 2;
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: punt.x, y: van }] });
      const stappen = 12;
      for (let i = 1; i <= stappen; i++) {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: punt.x, y: van - (afstand * i) / stappen }] });
        await page.waitForTimeout(16);
      }
      await page.waitForTimeout(150);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    };
  };

  test('midden in de lijst schuift het vak, aan het einde scrolt de pagina door', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));
    const { stand, zet, puntInVak } = await openMijnVerzoeken(page);
    const veeg = await maakVeeg(page);

    await expect(async () => {
      await zet('begin');
      await veeg(await puntInVak(), 160);
      await expect.poll(async () => (await stand()).vak, { timeout: 1_500, message: 'midden in de lijst schuift het vak' }).toBeGreaterThan(0);
      expect((await stand()).pagina, 'en de pagina niet').toBe(0);
    }).toPass({ timeout: 15_000 });

    await expect(async () => {
      await zet('einde');
      await veeg(await puntInVak(), 160);
      await expect.poll(async () => (await stand()).pagina, { timeout: 1_500, message: 'de pagina scrolt door naar wat onder het vak staat' }).toBeGreaterThan(0);
    }).toPass({ timeout: 15_000 });

    expect(pageErrors, `page errors:\n${pageErrors.join('\n')}`).toEqual([]);
  });

  test('een overlay vanuit de lijst zet de pagina nog altijd op slot', async ({ page }) => {
    // De scroll-lock van #637/#638: met een bevestiging open schuift er niets onder.
    const pageErrors: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));
    const { lijst, stand, puntInVak } = await openMijnVerzoeken(page);
    const veeg = await maakVeeg(page);
    const punt = await puntInVak();

    const rij = lijst.locator(':scope > li').first();
    const kop = rij.getByRole('button', { name: /Dienst 2101/ });
    await kop.click();
    await expect(kop).toHaveAttribute('aria-expanded', 'true');
    // Eerst de uitklap laten uitlopen: schuift de knop nog onder de muis weg,
    // dan valt het loslaten naast de knop en komt er geen klik.
    await rij.evaluate((li) => Promise.all(li.getAnimations({ subtree: true }).map((a) => a.finished.catch(() => undefined))));
    await rij.getByRole('button', { name: 'Aanvraag intrekken' }).click();
    const dialoog = page.getByRole('dialog');
    await expect(dialoog).toBeVisible({ timeout: 10_000 });
    expect(await page.evaluate(() => document.body.dataset.scrollLocks ?? '')).not.toBe('');

    const { vak: vakVoor, pagina: paginaVoor } = await stand();
    await veeg(punt, 160);
    await page.mouse.move(punt.x, punt.y);
    await page.mouse.wheel(0, 200);
    await page.waitForTimeout(300);
    expect(await stand(), 'met een overlay open schuift er niets onder').toMatchObject({ vak: vakVoor, pagina: paginaVoor });

    await expect(dialoog).toBeVisible();
    await dialoog.getByRole('button', { name: 'Annuleren' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => document.body.dataset.scrollLocks ?? '')).toBe('');

    expect(pageErrors, `page errors:\n${pageErrors.join('\n')}`).toEqual([]);
  });
});

test('beheerlijst op een smalle telefoon: twee lange namen blijven allebei leesbaar', async ({ page }) => {
  // Controle 29-09, nr. 23: de titel "aanvrager → ontvanger" werd op 320 px
  // afgekapt, bij twee lange namen viel de ontvanger weg.
  const pageErrors: string[] = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));
  await page.setViewportSize({ width: 320, height: 568 });
  await seedSession(page, PLANNER);

  const AANVRAGER = { ...CHAUFFEUR, id: '51', name: 'Maximiliaan Vandenbroucke', email: 'lang1@vhb.be' };
  const ONTVANGER = { ...COLLEGA, id: '52', name: 'Christophe Vanderstraeten', email: 'lang2@vhb.be' };
  expect([AANVRAGER.name.length, ONTVANGER.name.length]).toEqual([25, 25]);

  const basis = { createdAt: new Date().toISOString(), returnDate: dayOffset(20), returnCode: 'vrij' };
  const ruilen = [
    {
      ...basis, id: 'lang', shiftId: 'x1', requesterId: AANVRAGER.id, targetDriverId: ONTVANGER.id, status: 'accepted', shiftDate: dayOffset(5), shiftLine: '2505',
      rust: [{ wie: 'collega', datum: dayOffset(5), dienst: '2505', rustVoor: 340, rustNa: null, teKort: true }],
    },
    { ...basis, id: 'kort', shiftId: 'x2', requesterId: CHAUFFEUR.id, targetDriverId: COLLEGA.id, status: 'accepted', shiftDate: dayOffset(6), shiftLine: '2202' },
  ];

  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    const json = (body: unknown) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    if (path.endsWith('/api/me')) return json(PLANNER);
    if (path.endsWith('/api/devices/register')) return json({ status: 'approved' });
    if (path.endsWith('/api/users')) return json([PLANNER, CHAUFFEUR, COLLEGA, AANVRAGER, ONTVANGER]);
    if (path.endsWith('/api/swaps') && route.request().method() === 'GET') return json(ruilen);
    return json([]);
  });

  await page.goto('/');
  const beheer = page.getByRole('list', { name: 'Beheer dienstruilen' });
  await expect(beheer).toBeVisible({ timeout: 15_000 });
  const rijen = beheer.locator(':scope > li');
  await expect(rijen).toHaveCount(2);

  // De titelregel van een rij: wat ervan zichtbaar is, en over hoeveel regels.
  const meetTitel = (naam: string) => beheer.getByText(naam).evaluate((el) => {
    let titel = el as HTMLElement;
    while (getComputedStyle(titel).display !== 'block') titel = titel.parentElement!;
    const kader = titel.getBoundingClientRect();
    const bereik = document.createRange();
    bereik.selectNodeContents(titel);
    const stukken = [...bereik.getClientRects()].filter((r) => r.width > 0);
    const ontvanger = el.getBoundingClientRect();
    return {
      // De ontvanger (met zijn pijl) staat vooraan op een regel en is zelf niet gebroken.
      ontvangerVooraan: Math.abs(ontvanger.left - kader.left) < 1,
      ontvangerOpEenRegel: ontvanger.height < 30,
      tekst: titel.textContent,
      afgekapt: titel.scrollWidth > titel.clientWidth,
      weglating: getComputedStyle(titel).textOverflow === 'ellipsis',
      buitenKader: stukken.filter((r) => r.left < kader.left - 0.5 || r.right > kader.right + 0.5 || r.bottom > kader.bottom + 0.5).length,
      binnenScherm: kader.left >= 0 && kader.right <= window.innerWidth,
      // Stukken op dezelfde regel beginnen binnen een halve regelhoogte van elkaar.
      regels: stukken.map((r) => r.top).sort((x, y) => x - y).filter((top, i, alle) => i === 0 || top - alle[i - 1] > 8).length,
    };
  });

  const lang = rijen.nth(0);
  await expect(lang).toContainText(`${AANVRAGER.name} → ${ONTVANGER.name}`);
  expect(await meetTitel(ONTVANGER.name)).toEqual({
    ontvangerVooraan: true,
    ontvangerOpEenRegel: true,
    tekst: `${AANVRAGER.name} → ${ONTVANGER.name}`,
    afgekapt: false,
    weglating: false,
    buitenKader: 0,
    binnenScherm: true,
    // Elke naam op zijn eigen regel, de pijl bij de ontvanger.
    regels: 2,
  });
  // Dicht staat er nog altijd: de dienst, de stand en de rustwaarschuwing.
  await expect(lang).toContainText('Dienst 2505');
  await expect(lang.getByText('Wacht op planner')).toBeVisible();
  await expect(lang.getByText('Te weinig rust')).toBeVisible();
  await expect(lang.getByRole('button', { name: /Dienst 2505/ })).toHaveAttribute('aria-expanded', 'false');

  // Twee korte namen blijven op één regel, zoals voorheen.
  expect(await meetTitel(COLLEGA.name)).toMatchObject({ afgekapt: false, buitenKader: 0, regels: 1, ontvangerVooraan: false });

  // Niets duwt de pagina breder dan het scherm.
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  expect(pageErrors, `page errors:\n${pageErrors.join('\n')}`).toEqual([]);
});
