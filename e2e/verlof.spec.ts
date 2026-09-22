import { test, expect, type Page } from '@playwright/test';

/**
 * E2E op de belangrijkste schrijf-flow van het portaal: verlof aanvragen
 * (chauffeur) en goedkeuren (planner). De dashboards hadden al een rooktest;
 * deze flow — modal, kalender-selectie, POST-payload, beslissing via PATCH
 * met ifStatus-guard — was alleen op unit-niveau gedekt.
 *
 * Zelfde opzet als dashboard.spec.ts: sessie vooraf in localStorage,
 * alle /api/** onderschept met fixtures (zie uitleg daar).
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

const PLANNER = {
  id: '7',
  name: 'Planner E2E',
  role: 'planner',
  employeeId: 'VHB-000007',
  email: 'planner@vhb.be',
  isActive: true,
  verlofBudget: 20,
};

/** Vandaag + n dagen als yyyy-mm-dd (lokale tijd, zoals de app rekent). */
const dayOffset = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const seedSession = async (page: Page, user: { email: string }, view?: string) => {
  await page.addInitScript(
    ([key, u, v]) => {
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
      if (v) window.localStorage.setItem('vhb-current-view', v as string);
    },
    [SESSION_KEY, user, view ?? ''] as const,
  );
};

test('chauffeur vraagt verlof aan via de kalender-modal', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));
  await seedSession(page, CHAUFFEUR);

  // `null as …`: de toewijzing gebeurt in een route-callback; met een gewone
  // annotatie vernauwt de compiler de variabele hier tot null.
  let postedLeave = null as any[] | null;
  await page.route('**/api/**', async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    const json = (body: unknown) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

    if (path.endsWith('/api/me')) return json(CHAUFFEUR);
    if (path.endsWith('/api/devices/register')) return json({ status: 'approved' });
    if (path.endsWith('/api/users')) return json([CHAUFFEUR]);
    if (path.endsWith('/api/leave') && req.method() === 'POST') {
      postedLeave = JSON.parse(req.postData() ?? 'null');
      return json({});
    }
    return json([]);
  });

  await page.goto('/');
  await expect(page.getByText('Volgende dienst')).toBeVisible({ timeout: 15_000 });

  // Snelle actie op het dashboard → verlofpagina → aanvraag-modal.
  await page.getByText('Verlof aanvragen', { exact: true }).click();
  await page.getByRole('button', { name: /Verlof aanvragen/ }).click();
  await expect(page.getByText('Periode kiezen')).toBeVisible();

  // Alles binnen het modal-formulier scopen: de pagina erachter heeft zélf
  // maandnavigatie, dus ongescoped is "Volgende maand" dubbelzinnig.
  const modal = page.locator('form').filter({ hasText: 'Periode kiezen' });

  // Volgende maand: elke dag is dan klikbaar (geen verleden-disable) en de
  // gekozen data zijn deterministisch, wat de klok ook zegt.
  await modal.getByRole('button', { name: 'Volgende maand' }).click();
  await modal.getByRole('button', { name: '10', exact: true }).click();
  await modal.getByRole('button', { name: '12', exact: true }).click();
  // De gekozen periode is een selectieweergave (geen input): de ISO-datum
  // staat in data-datum, de zichtbare tekst is het korte daglabel.
  await expect(modal.getByLabel('Startdatum')).toHaveAttribute('data-datum', /-10$/);
  await expect(modal.getByLabel('Einddatum')).toHaveAttribute('data-datum', /-12$/);

  await modal.getByRole('button', { name: 'Aanvraag indienen' }).click();

  // De app bevestigt en de payload bevat één nieuwe pending-aanvraag van
  // deze chauffeur met exact de gekozen periode.
  await expect(page.getByText('Aanvraag ingediend, de planner beoordeelt ze.')).toBeVisible();
  expect(postedLeave, 'POST /api/leave is nooit verstuurd').not.toBeNull();
  const nieuwe = (postedLeave ?? []).filter((r) => r.status === 'pending' && r.userId === CHAUFFEUR.id);
  expect(nieuwe).toHaveLength(1);
  expect(nieuwe[0].startDate).toMatch(/-10$/);
  expect(nieuwe[0].endDate).toMatch(/-12$/);
  expect(nieuwe[0].type).toBe('betaald_verlof');

  expect(pageErrors, `page errors:\n${pageErrors.join('\n')}`).toEqual([]);
});

test('planner keurt een wachtende aanvraag goed (PATCH met ifStatus-guard)', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));
  // Rechtstreeks op de verlofpagina starten — navigatie is al gedekt hierboven.
  await seedSession(page, PLANNER, 'verlof');

  const aanvraag = {
    id: 'l1',
    userId: CHAUFFEUR.id,
    startDate: dayOffset(7),
    endDate: dayOffset(9),
    type: 'betaald_verlof',
    status: 'pending',
    createdAt: new Date().toISOString(),
  };

  let patched: { path: string; body: any } | null = null;
  await page.route('**/api/**', async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    const json = (body: unknown) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

    if (path.endsWith('/api/me')) return json(PLANNER);
    if (path.endsWith('/api/devices/register')) return json({ status: 'approved' });
    if (path.endsWith('/api/users')) return json([PLANNER, CHAUFFEUR]);
    if (path.endsWith('/api/leave') && req.method() === 'GET') return json([aanvraag]);
    if (path.includes('/api/leave/') && req.method() === 'PATCH') {
      patched = { path, body: JSON.parse(req.postData() ?? 'null') };
      return json({ leave: { ...aanvraag, status: 'approved' } });
    }
    return json([]);
  });

  await page.goto('/');
  await expect(page.getByText('Wachtend op goedkeuring')).toBeVisible({ timeout: 15_000 });

  // Aanvraag openen in het beoordelingspaneel en goedkeuren.
  await page.getByRole('button', { name: /Test Chauffeur/ }).click();
  await page.getByRole('button', { name: 'Goedkeuren' }).click();

  // De guard stuurt de status die de planner ZAG mee als ifStatus.
  await expect.poll(() => patched).not.toBeNull();
  expect(patched!.path).toMatch(/\/api\/leave\/l1$/);
  expect(patched!.body).toMatchObject({ status: 'approved', ifStatus: 'pending' });

  // De wachtrij is leeg zodra de beslissing lokaal is toegepast.
  await expect(page.getByRole('button', { name: /Test Chauffeur/ })).toBeHidden();

  expect(pageErrors, `page errors:\n${pageErrors.join('\n')}`).toEqual([]);
});

// "Niet bewaren" gooit het concept echt weg (beslissing Jarno 22-09): het
// aanvraagvenster houdt zijn invoer over sluiten heen, maar wie bij
// "Wijzigingen niet bewaren?" voor "Niet bewaren" kiest, begint daarna leeg.
const routeLeeg = async (page: Page, me: typeof CHAUFFEUR, onPost?: (body: unknown) => void) => {
  await page.route('**/api/**', async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    const json = (body: unknown) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    if (path.endsWith('/api/me')) return json(me);
    if (path.endsWith('/api/devices/register')) return json({ status: 'approved' });
    if (path.endsWith('/api/users')) return json(me.id === CHAUFFEUR.id ? [CHAUFFEUR] : [me, CHAUFFEUR]);
    if (path.endsWith('/api/leave') && req.method() === 'POST') {
      onPost?.(JSON.parse(req.postData() ?? 'null'));
      return json({});
    }
    return json([]);
  });
};

test('chauffeur: "Niet bewaren" wist het concept, heropenen start leeg', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));
  await seedSession(page, CHAUFFEUR, 'verlof');
  await routeLeeg(page, CHAUFFEUR);

  await page.goto('/');
  const openKnop = page.getByRole('button', { name: /Verlof aanvragen/ });
  await expect(openKnop).toBeVisible({ timeout: 15_000 });
  await openKnop.click();
  const modal = page.locator('form').filter({ hasText: 'Periode kiezen' });
  await modal.getByRole('button', { name: 'Volgende maand' }).click();
  await modal.getByRole('button', { name: '10', exact: true }).click();
  await modal.getByRole('button', { name: '12', exact: true }).click();
  await expect(modal.getByLabel('Startdatum')).toHaveAttribute('data-datum', /-10$/);

  await page.keyboard.press('Escape');
  await expect(page.getByRole('heading', { name: 'Wijzigingen niet bewaren?' })).toBeVisible();
  await page.getByRole('button', { name: 'Niet bewaren' }).click();
  await expect(page.getByText('Periode kiezen')).toBeHidden();

  await openKnop.click();
  await expect(page.getByText('Periode kiezen')).toBeVisible();
  await expect(modal.getByLabel('Startdatum')).not.toHaveAttribute('data-datum', /.+/);
  await expect(modal.getByLabel('Einddatum')).not.toHaveAttribute('data-datum', /.+/);

  expect(pageErrors, `page errors:\n${pageErrors.join('\n')}`).toEqual([]);
});

test('planner: schoon sluiten na vastleggen houdt het concept, "Niet bewaren" wist het', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));
  await seedSession(page, PLANNER, 'verlof');
  let gepost = false;
  await routeLeeg(page, PLANNER, () => { gepost = true; });

  await page.goto('/');
  const openKnop = page.getByRole('button', { name: 'Verlof registreren' });
  await expect(openKnop).toBeVisible({ timeout: 15_000 });
  await openKnop.click();
  const modal = page.locator('form').filter({ hasText: 'Periode kiezen' });
  const chauffeur = modal.getByLabel(/Chauffeur/);
  await chauffeur.selectOption(CHAUFFEUR.id);
  await modal.getByRole('button', { name: 'Volgende maand' }).click();
  await modal.getByRole('button', { name: '10', exact: true }).click();
  await modal.getByRole('button', { name: '12', exact: true }).click();
  await modal.getByRole('button', { name: 'Vastleggen' }).click();
  await expect.poll(() => gepost).toBe(true);
  // Na vastleggen is het venster schoon: sluiten vraagt niets.
  await expect(modal.getByLabel('Startdatum')).not.toHaveAttribute('data-datum', /.+/);
  await page.keyboard.press('Escape');
  await expect(page.getByText('Periode kiezen')).toBeHidden();
  await expect(page.getByRole('heading', { name: 'Wijzigingen niet bewaren?' })).toBeHidden();

  // Heropenen: de gekozen chauffeur staat er nog (gedrag van vandaag).
  await openKnop.click();
  await expect(chauffeur).toHaveValue(CHAUFFEUR.id);

  // Nieuwe invoer, dan "Niet bewaren": heropenen start leeg.
  await modal.getByRole('button', { name: 'Volgende maand' }).click();
  await modal.getByRole('button', { name: '10', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('heading', { name: 'Wijzigingen niet bewaren?' })).toBeVisible();
  await page.getByRole('button', { name: 'Niet bewaren' }).click();
  await expect(page.getByText('Periode kiezen')).toBeHidden();
  await openKnop.click();
  await expect(chauffeur).toHaveValue('');

  expect(pageErrors, `page errors:\n${pageErrors.join('\n')}`).toEqual([]);
});
