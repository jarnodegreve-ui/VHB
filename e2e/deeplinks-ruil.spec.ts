import { test, expect, type Page } from '@playwright/test';
import { ADMIN, CHAUFFEUR, seed, type Extra } from './helpers';
import { SWAPS } from '../scripts/audit-fixtures.mjs';
import { logIn, vandaagIso, zonderSessie } from './deeplinkHulp';

/**
 * Deeplinks V1, dienstruil (tranche 3C, 23-09): `/dienstruil/<id>` opent die
 * ene ruil. Staf krijgt het beoordelingspaneel (een SlideOver, ook op
 * desktop); een chauffeur de ruil in zijn eigen lijst, open en in beeld, of
 * een alleen-lezen kaart als ze daar niet (meer) staat. Wat niet in zijn
 * gegevens staat geeft één nette melding.
 *
 * Fixture sw1: Alex Du Priez (43) vraagt de testchauffeur (42), pending,
 * dienst van morgen. De extra ruilen hieronder dekken de andere gevallen.
 */

const ALEX = 'Alex Du Priez';
const pad = (page: Page) => new URL(page.url()).pathname;
const paneel = (page: Page, naam = ALEX) => page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: naam, exact: true }) });
const onbekend = (page: Page) => page.getByText('Deze dienstruil is niet beschikbaar');

const nu = new Date().toISOString();
/** Eigen verzoek van de testchauffeur aan Diether (44). */
const SW2 = { id: 'sw2', shiftId: 't1', requesterId: '42', targetDriverId: '44', status: 'pending', reason: 'Afspraak', createdAt: nu, returnDate: SWAPS[0].returnDate, returnCode: 'VRIJ' };
/** Afgehandelde ruil waarin de testchauffeur de collega was: in geen lijst meer. */
const SW3 = { id: 'sw3', shiftId: 's1', requesterId: '43', targetDriverId: '42', status: 'rejected', reason: '', createdAt: nu, decidedAt: nu, returnDate: SWAPS[0].returnDate, returnCode: 'VRIJ' };
/** Ruil tussen twee collega's: een chauffeur krijgt hem nooit van de server. */
const SW9 = { id: 'sw9', shiftId: 's2', requesterId: '43', targetDriverId: '44', status: 'pending', reason: 'Geheim', createdAt: nu, returnDate: SWAPS[0].returnDate, returnCode: 'VRIJ' };
/** Geaccepteerde ruil op een dienst van vandaag (fixture t1, 2101): staat op Vandaag. */
const SW4 = { id: 'sw4', shiftId: 't1', requesterId: '42', targetDriverId: '43', status: 'accepted', reason: '', createdAt: nu, shiftDate: vandaagIso(0), shiftLine: '2101', returnDate: vandaagIso(5), returnCode: 'vrij' };
const ALLE = [...SWAPS, SW2, SW3, SW9, SW4];

/** Zoals GET /api/swaps: staf alles, een chauffeur alleen waar hij bij betrokken is. */
const ruilenVoor = (userId: string | null): Extra => (p) => {
  if (!p.endsWith('/api/swaps')) return undefined;
  return userId ? ALLE.filter((s) => s.requesterId === userId || s.targetDriverId === userId) : ALLE;
};

test.describe('ruil-deeplink met sessie', () => {
  test('staf: de link opent het beoordelingspaneel van die ruil, ook na herladen', async ({ page }) => {
    await seed(page, { user: ADMIN, extra: ruilenVoor(null) });
    await page.goto('/dienstruil/sw1');
    await expect(paneel(page)).toBeVisible();
    await page.reload();
    await expect(paneel(page)).toBeVisible();
    expect(pad(page)).toBe('/dienstruil/sw1');
    await expect(page.getByRole('dialog')).toHaveCount(1);
  });

  test('staf: sluiten haalt het id uit de URL', async ({ page }) => {
    await seed(page, { user: ADMIN, extra: ruilenVoor(null) });
    await page.goto('/dienstruil/sw1');
    await expect(paneel(page)).toBeVisible();
    await paneel(page).getByRole('button', { name: 'Sluiten' }).first().click();
    await expect(paneel(page)).toHaveCount(0);
    await expect.poll(() => pad(page)).toBe('/dienstruil');
  });

  test('chauffeur als collega: de openstaande vraag in beeld, met de focus erop', async ({ page }) => {
    await seed(page, { user: CHAUFFEUR, extra: ruilenVoor('42') });
    await page.goto('/dienstruil/sw1');
    const kaart = page.locator('[data-record="sw1"]');
    await expect(kaart).toBeInViewport();
    await expect(kaart).toBeFocused();
    // Een chauffeur krijgt nooit het staf-paneel met beslisknoppen.
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('chauffeur als aanvrager: zijn eigen verzoek open en in beeld', async ({ page }) => {
    await seed(page, { user: CHAUFFEUR, extra: ruilenVoor('42') });
    await page.goto('/dienstruil/sw2');
    const titel = page.locator('[data-record="sw2"]');
    await expect(titel).toBeInViewport();
    await expect(titel.locator('xpath=ancestor::button[1]')).toHaveAttribute('aria-expanded', 'true');
  });

  test('afgehandelde ruil die in geen lijst meer staat: alleen-lezen kaart', async ({ page }) => {
    await seed(page, { user: CHAUFFEUR, extra: ruilenVoor('42') });
    await page.goto('/dienstruil/sw3');
    const kaart = page.locator('[data-record="sw3"]');
    await expect(kaart).toBeVisible();
    await expect(kaart.getByRole('heading', { name: 'Dienstruil' })).toBeVisible();
    await expect(kaart.getByRole('button', { name: /goedkeuren|afwijzen|accepteren|weigeren/i })).toHaveCount(0);
    await kaart.getByRole('button', { name: 'Sluiten' }).click();
    await expect(kaart).toHaveCount(0);
    expect(pad(page)).toBe('/dienstruil');
  });

  test('niet-bestaand record: nette melding', async ({ page }) => {
    await seed(page, { user: ADMIN, extra: ruilenVoor(null) });
    await page.goto('/dienstruil/bestaat-niet');
    await expect(onbekend(page)).toBeVisible();
    await page.getByRole('status').filter({ hasText: 'niet beschikbaar' }).getByRole('button', { name: 'Sluiten' }).click();
    await expect(onbekend(page)).toHaveCount(0);
    expect(pad(page)).toBe('/dienstruil');
  });

  test('verwijderd record: na herladen verdwenen, dezelfde nette melding', async ({ page }) => {
    let weg = false;
    await seed(page, { user: ADMIN, extra: (p) => (p.endsWith('/api/swaps') ? (weg ? ALLE.filter((s) => s.id !== 'sw1') : ALLE) : undefined) });
    await page.goto('/dienstruil/sw1');
    await expect(paneel(page)).toBeVisible();
    weg = true;
    await page.reload();
    await expect(onbekend(page)).toBeVisible();
    await expect(paneel(page)).toHaveCount(0);
  });

  test('geen recht: een chauffeur op een ruil tussen twee collega’s ziet er niets van', async ({ page }) => {
    await seed(page, { user: CHAUFFEUR, extra: ruilenVoor('42') });
    await page.goto('/dienstruil/sw9');
    await expect(onbekend(page)).toBeVisible();
    await expect(page.getByText('Geheim')).toHaveCount(0);
    await expect(page.locator('[data-record="sw9"]')).toHaveCount(0);
  });
});

test.describe('ruil-deeplink vanuit het portaal', () => {
  /** Het paneel is een SlideOver (ook op desktop): eerst sluit terug het paneel, dan ben je terug. */
  async function terugNaar(page: Page, herkomst: string) {
    await page.goBack();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    if (pad(page) !== herkomst) await page.goBack();
    await expect.poll(() => pad(page)).toBe(herkomst);
  }

  test('dashboard → ruil, terug = dashboard', async ({ page }) => {
    await seed(page, { user: ADMIN, extra: ruilenVoor(null) });
    await page.goto('/');
    await page.getByText(`Dienstruil · ${ALEX} → Test Chauffeur`).first().click();
    await expect(paneel(page)).toBeVisible();
    expect(pad(page)).toBe('/dienstruil/sw1');
    await terugNaar(page, '/');
  });

  test('Vandaag → dezelfde ruil', async ({ page }) => {
    await seed(page, { user: ADMIN, extra: ruilenVoor(null) });
    await page.goto('/vandaag');
    await page.getByRole('button', { name: /Dienst 2101/ }).filter({ hasText: 'wacht op validatie' }).click();
    await expect(paneel(page, 'Test Chauffeur')).toBeVisible();
    expect(pad(page)).toBe('/dienstruil/sw4');
    await terugNaar(page, '/vandaag');
  });

  test('melding → dezelfde ruil', async ({ page }) => {
    await seed(page, {
      user: ADMIN,
      extra: (p, r) => (p.endsWith('/api/meldingen')
        ? { meldingen: [{ id: 'm1', titel: 'Dienstruil wacht op validatie', tekst: 'Rij- en rusttijden checken.', soort: 'ruil', doel: 'dienstruil/sw1', createdAt: nu }], ongelezen: 1 }
        : ruilenVoor(null)(p, r)),
    });
    await page.goto('/meldingen');
    await page.getByText('Dienstruil wacht op validatie').click();
    await expect(paneel(page)).toBeVisible();
    expect(pad(page)).toBe('/dienstruil/sw1');
    await terugNaar(page, '/meldingen');
  });
});

test.describe('ruil-deeplink zonder sessie', () => {
  test('link → inloggen → dezelfde ruil', async ({ page }) => {
    await zonderSessie(page, ADMIN, ruilenVoor(null));
    await page.goto('/dienstruil/sw1');
    await expect(page.getByRole('button', { name: 'Inloggen' })).toBeVisible();
    await logIn(page);
    await expect(paneel(page)).toBeVisible();
    expect(pad(page)).toBe('/dienstruil/sw1');
  });
});
