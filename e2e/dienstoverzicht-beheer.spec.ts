import { test, expect, type Page, type Route } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { ADMIN, CHAUFFEUR, seed } from './helpers';
import { TECHNIEKER } from '../scripts/audit-fixtures.mjs';
import { logIn, zonderSessie } from './deeplinkHulp';

/**
 * 3D.2 (23-09): één Dienstoverzicht op /beheer/dienstoverzicht voor planner
 * en admin. Fixtures (scripts/audit-fixtures.mjs): diensten 1 = 2101,
 * 2 = 2607, 3 = 2515 (drie delen, loop 4515).
 *
 * - oude paden (/dienstoverzicht, ook met record en query) gaan naar het
 *   nieuwe adres; een recordlink overleeft refresh en login;
 * - een verdwenen dienst geeft de nette 3C-melding, een chauffeur of
 *   technieker komt er niet (ook niet via een recordlink);
 * - het detailpaneel sluiten laat zoekterm en sortering staan, terug sluit het;
 * - rechten per rol in de UI; verwijderen wacht op de server (geen
 *   optimistische rij-verwijdering) en een mislukking laat de rij staan.
 */

const PLANNER = { id: '7', name: 'Pieter Planner', role: 'planner', employeeId: 'VHB-000007', email: 'pieter@vhb.be', isActive: true };
const pad = (page: Page) => new URL(page.url()).pathname;
const kop = (page: Page) => page.getByRole('heading', { name: 'Dienstoverzicht', level: 1 });
const paneel = (page: Page, nummer: string) => page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: `Dienst ${nummer}`, exact: true }) });
const zoekveld = (page: Page) => page.getByRole('searchbox', { name: 'Zoek dienst of loopnummer…' });
const zichtbaar = (page: Page, tekst: string) => page.getByText(tekst, { exact: true }).filter({ visible: true });
const desktop = (naam: string) => naam === 'Desktop (chromium)';

async function openScherm(page: Page, user: Record<string, unknown>, url = '/beheer/dienstoverzicht') {
  await seed(page, { user, view: 'dienstoverzicht' });
  await page.goto(url);
  await expect(kop(page)).toBeVisible({ timeout: 15_000 });
}

/** Houdt de volgende POST /api/services vast tot `antwoord` gezet is. */
async function houdOpslaanVast(page: Page) {
  let geef!: (r: { status: number; body: unknown }) => void;
  const antwoord = new Promise<{ status: number; body: unknown }>((r) => { geef = r; });
  let gevraagd!: () => void;
  const aangevraagd = new Promise<void>((r) => { gevraagd = r; });
  await page.route('**/api/services', async (route: Route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    gevraagd();
    const { status, body } = await antwoord;
    return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  });
  return { aangevraagd, geef };
}

test.describe('adres en recordlinks', () => {
  test('/dienstoverzicht gaat naar /beheer/dienstoverzicht', async ({ page }) => {
    await openScherm(page, ADMIN, '/dienstoverzicht');
    expect(pad(page)).toBe('/beheer/dienstoverzicht');
  });

  test('oude recordlink met query gaat naar de nieuwe recordlink en opent die dienst', async ({ page }) => {
    await openScherm(page, ADMIN, '/dienstoverzicht/3?bron=mail#x');
    const u = new URL(page.url());
    expect(u.pathname + u.search + u.hash).toBe('/beheer/dienstoverzicht/3?bron=mail#x');
    await expect(paneel(page, '2515')).toBeVisible();
  });

  test('refresh op een concrete dienst houdt het paneel met haar gegevens open', async ({ page }) => {
    await openScherm(page, ADMIN, '/beheer/dienstoverzicht/3');
    await expect(paneel(page, '2515')).toBeVisible();
    await page.reload();
    await expect(paneel(page, '2515')).toBeVisible();
    expect(pad(page)).toBe('/beheer/dienstoverzicht/3');
    await expect(paneel(page, '2515').getByLabel('Loopnummer (deel 3)', { exact: true })).toHaveValue('4515');
    await expect(paneel(page, '2515').getByLabel('Eindtijd (deel 3)', { exact: true })).toHaveValue('25:10');
  });

  test('link zonder sessie: na het inloggen dezelfde dienst', async ({ page }) => {
    await zonderSessie(page, ADMIN);
    await page.goto('/beheer/dienstoverzicht/3');
    await expect(page.getByRole('button', { name: 'Inloggen' })).toBeVisible();
    expect(pad(page)).toBe('/beheer/dienstoverzicht/3');
    await logIn(page);
    await expect(paneel(page, '2515')).toBeVisible({ timeout: 15_000 });
    expect(pad(page)).toBe('/beheer/dienstoverzicht/3');
  });

  test('oude link zonder sessie: na het inloggen dezelfde dienst op het nieuwe adres', async ({ page }) => {
    await zonderSessie(page, ADMIN);
    await page.goto('/dienstoverzicht/3');
    await expect(page.getByRole('button', { name: 'Inloggen' })).toBeVisible();
    await logIn(page);
    await expect(paneel(page, '2515')).toBeVisible({ timeout: 15_000 });
    expect(pad(page)).toBe('/beheer/dienstoverzicht/3');
  });

  test('verdwenen dienst: nette melding, geen paneel, Sluiten laat de lijst staan', async ({ page }) => {
    await openScherm(page, ADMIN, '/beheer/dienstoverzicht/bestaat-niet');
    await expect(page.getByText('Deze dienst is niet beschikbaar')).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.getByRole('status').filter({ hasText: 'niet beschikbaar' }).getByRole('button', { name: 'Sluiten' }).click();
    await expect(page.getByText('Deze dienst is niet beschikbaar')).toHaveCount(0);
    expect(pad(page)).toBe('/beheer/dienstoverzicht');
    await expect(zichtbaar(page, '2515').first()).toBeVisible();
  });

  for (const [naam, user] of [['chauffeur', CHAUFFEUR], ['technieker', TECHNIEKER]] as const) {
    test(`${naam}: een recordlink omzeilt de rolgrens niet en haalt geen diensten op`, async ({ page }) => {
      let dienstenGevraagd = false;
      page.on('request', (r) => { if (new URL(r.url()).pathname === '/api/services') dienstenGevraagd = true; });
      await seed(page, { user });
      await page.goto('/beheer/dienstoverzicht/3');
      await expect.poll(() => pad(page)).toBe('/');
      await expect(page.getByText('Dit scherm is niet beschikbaar voor jouw rol')).toBeVisible();
      await expect(kop(page)).toHaveCount(0);
      await expect(page.getByRole('dialog')).toHaveCount(0);
      expect(dienstenGevraagd).toBe(false);
    });
  }
});

test.describe('paneel en navigatie', () => {
  test('sluiten laat zoekterm en sortering staan en haalt het id uit de URL', async ({ page }, info) => {
    test.skip(!desktop(info.project.name), 'kolomsortering = tabel = desktop');
    await openScherm(page, ADMIN);
    const tabel = page.getByRole('table', { name: 'Diensten' });
    await tabel.getByRole('button', { name: /Deel 1/ }).click();
    await tabel.getByRole('button', { name: /Deel 1/ }).click();
    await zoekveld(page).fill('45');
    await tabel.getByRole('button', { name: 'Dienst 2515 openen' }).click();
    await expect(paneel(page, '2515')).toBeVisible();
    expect(pad(page)).toBe('/beheer/dienstoverzicht/3');
    await paneel(page, '2515').getByRole('button', { name: 'Annuleren' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(pad(page)).toBe('/beheer/dienstoverzicht');
    await expect(zoekveld(page)).toHaveValue('45');
    await expect(tabel.getByRole('columnheader', { name: /Deel 1/ })).toHaveAttribute('aria-sort', 'descending');
    await expect.poll(() => tabel.locator('tbody tr td:first-child').allTextContents()).toEqual(['2607', '2515', '2101']);
  });

  test('terug sluit het paneel en blijft op het Dienstoverzicht; vooruit opent de dienst opnieuw', async ({ page }) => {
    await openScherm(page, ADMIN);
    await page.getByRole('button', { name: 'Dienst 2515 openen' }).filter({ visible: true }).click();
    await expect(paneel(page, '2515')).toBeVisible();
    await page.goBack();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect.poll(() => pad(page)).toBe('/beheer/dienstoverzicht');
    await expect(kop(page)).toBeVisible();
    await page.goForward();
    await expect(paneel(page, '2515')).toBeVisible();
    await expect.poll(() => pad(page)).toBe('/beheer/dienstoverzicht/3');
  });

  test('bewerken slaat op en sluit pas na een geslaagd antwoord', async ({ page }) => {
    await openScherm(page, ADMIN, '/beheer/dienstoverzicht/3');
    const p = paneel(page, '2515');
    await p.getByLabel('Loopnummer (deel 3)', { exact: true }).fill('4516');
    const opslaan = await houdOpslaanVast(page);
    await p.getByRole('button', { name: 'Dienst bijwerken' }).click();
    await opslaan.aangevraagd;
    await expect(p).toBeVisible();
    opslaan.geef({ status: 200, body: { ok: true } });
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(pad(page)).toBe('/beheer/dienstoverzicht');
    await expect(zichtbaar(page, 'Deel 3 · loop 4516').or(zichtbaar(page, '4516')).first()).toBeVisible();
  });
});

test.describe('rechten per rol', () => {
  test('planner: Nieuwe dienst, Bewerken en geschiedenis; geen Excel-import en geen Verwijderen', async ({ page }) => {
    await openScherm(page, PLANNER);
    await expect(page.getByRole('button', { name: 'Nieuwe dienst' })).toBeVisible();
    await page.getByRole('button', { name: 'Meer acties' }).click();
    await expect(page.getByRole('menuitem', { name: 'CSV downloaden' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Excel importeren' })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Acties voor dienst 2515' }).filter({ visible: true }).click();
    await expect(page.getByRole('menuitem', { name: 'Bewerken' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Wijzigingsgeschiedenis' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Verwijderen' })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menuitem')).toHaveCount(0);
    await page.getByRole('button', { name: 'Dienst 2515 openen' }).filter({ visible: true }).click();
    await expect(paneel(page, '2515')).toBeVisible();
    await expect(paneel(page, '2515').getByRole('button', { name: 'Wijzigingsgeschiedenis' })).toBeVisible();
    await expect(paneel(page, '2515').getByRole('button', { name: /verwijderen/i })).toHaveCount(0);
  });

  test('admin: ook Excel importeren en Verwijderen', async ({ page }) => {
    await openScherm(page, ADMIN);
    await page.getByRole('button', { name: 'Meer acties' }).click();
    await expect(page.getByRole('menuitem', { name: 'Excel importeren' })).toBeVisible();
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Acties voor dienst 2515' }).filter({ visible: true }).click();
    await expect(page.getByRole('menuitem', { name: 'Verwijderen' })).toBeVisible();
  });
});

test.describe('verwijderen (admin, server-confirmed)', () => {
  test('de rij blijft zichtbaar tot de server bevestigt, daarna is ze weg', async ({ page }) => {
    await openScherm(page, ADMIN);
    await page.getByRole('button', { name: 'Acties voor dienst 2515' }).filter({ visible: true }).click();
    await page.getByRole('menuitem', { name: 'Verwijderen' }).click();
    const dialoog = page.getByRole('dialog', { name: 'Dienst 2515 verwijderen' });
    await expect(dialoog).toBeVisible();
    const opslaan = await houdOpslaanVast(page);
    await dialoog.getByRole('button', { name: 'Verwijderen' }).click();
    await opslaan.aangevraagd;
    await expect(dialoog.getByRole('button', { name: 'Verwijderen' })).toHaveAttribute('aria-busy', 'true');
    await expect(zichtbaar(page, '2515').first()).toBeVisible();
    opslaan.geef({ status: 200, body: { ok: true } });
    await expect(dialoog).toHaveCount(0);
    await expect(zichtbaar(page, '2515')).toHaveCount(0);
    await expect(zichtbaar(page, '2101').first()).toBeVisible();
  });

  test('mislukt verwijderen: de dienst blijft staan en de melding noemt welke en waarom', async ({ page }) => {
    await openScherm(page, ADMIN, '/beheer/dienstoverzicht/3');
    await paneel(page, '2515').getByRole('button', { name: 'Dienst 2515 verwijderen' }).click();
    const dialoog = page.getByRole('dialog', { name: 'Dienst 2515 verwijderen' });
    const opslaan = await houdOpslaanVast(page);
    await dialoog.getByRole('button', { name: 'Verwijderen' }).click();
    await opslaan.aangevraagd;
    opslaan.geef({ status: 403, body: { error: 'Diensten verwijderen is alleen beschikbaar voor admins.' } });
    await expect(page.getByText(/Verwijderen van dienst 2515/).first()).toBeVisible();
    await expect(page.getByText(/alleen beschikbaar voor admins/).first()).toBeVisible();
    await expect(page.getByText(/geen rechten/).first()).toBeVisible();
    // Het paneel en de rij blijven: niets is weg zonder bevestiging van de server.
    await expect(paneel(page, '2515')).toBeVisible();
    expect(pad(page)).toBe('/beheer/dienstoverzicht/3');
    await paneel(page, '2515').getByRole('button', { name: 'Annuleren' }).click();
    await expect(zichtbaar(page, '2515').first()).toBeVisible();
  });
});

test.describe('toegankelijkheid', () => {
  for (const thema of ['light', 'dark'] as const) {
    test(`lijst en open detailpaneel (${thema}): geen ernstige axe-bevindingen, geen overloop`, async ({ page }) => {
      await seed(page, { user: ADMIN, view: 'dienstoverzicht', thema });
      await page.goto('/beheer/dienstoverzicht/3');
      await expect(paneel(page, '2515')).toBeVisible({ timeout: 15_000 });
      await page.waitForTimeout(400);
      const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
      const blokkerend = axe.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
      expect(blokkerend.map((v) => `${v.id}: ${JSON.stringify(v.nodes[0]?.target)}`)).toEqual([]);
      const overloop = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overloop).toBeLessThanOrEqual(0);
    });
  }
});
