import { test, expect, type Page, type Route } from '@playwright/test';
import { ADMIN, gaIntern, historiekOpgeruimd, kanScrollen, seed } from './helpers';

/**
 * Panelen en pagina's (polish P2b, regels Jarno 24-09):
 * - een wachtende verlofaanvraag kan je op desktop bekijken en sluiten
 *   zonder te beslissen (kruisje en Escape);
 * - een recordlink van een koude start: sluiten of terug brengt je naar de
 *   lijst, nooit naar een lege of externe pagina, en zonder dubbele entry;
 * - onbewaarde invoer in een inline desktoppaneel is beschermd tegen de
 *   terugknop en tegen een wissel via de zijbalk, met dezelfde vraag;
 * - Annuleren sluit het paneel ook op desktop.
 *
 * Na elke flow: geen dialoog, geen scroll-lock, de pagina schuift en de
 * bovenste entry is weer een pagina (geen dode terugstap).
 */

const ALEX = 'Alex Du Priez';
const pad = (page: Page) => new URL(page.url()).pathname;
const desktop = (naam: string) => naam === 'Desktop (chromium)';
/** Het beoordelingspaneel: inline kaart (desktop) of SlideOver (telefoon). */
const verlofPaneel = (page: Page) => page.locator(`section[aria-label="${ALEX}"], [role="dialog"][aria-label="${ALEX}"]`);
const vraag = (page: Page) => page.getByRole('dialog', { name: 'Wijzigingen niet bewaren?' });

async function schoon(page: Page) {
  await kanScrollen(page);
  await historiekOpgeruimd(page);
  await expect.poll(() => page.evaluate(() => (history.state as { vhbOuderStap?: unknown } | null)?.vhbOuderStap ?? null)).toBeNull();
}

/** Eén keer terug verlaat het portaal (de pagina vóór de koude start). */
async function terugVerlaatHetPortaal(page: Page) {
  await page.goBack();
  await expect.poll(() => page.url()).toBe('about:blank');
}

test.describe('wachtende verlofaanvraag bekijken zonder te beslissen', () => {
  test('kruisje sluit het paneel, er wordt niets beslist, terug = het dashboard', async ({ page }) => {
    const beslissingen: string[] = [];
    await seed(page, { user: ADMIN });
    await page.route('**/api/leave/**', (r: Route) => { if (r.request().method() !== 'GET') beslissingen.push(r.request().method()); return r.fallback(); });
    await page.goto('/');
    await page.getByText(`Verlofaanvraag · ${ALEX}`).first().click();
    await expect(verlofPaneel(page)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Goedkeuren' })).toBeVisible();
    await verlofPaneel(page).getByRole('button', { name: 'Sluiten', exact: true }).click();
    await expect(verlofPaneel(page)).toHaveCount(0);
    expect(pad(page)).toBe('/verlof');
    expect(beslissingen).toEqual([]);
    await schoon(page);
    await page.goBack();
    await expect.poll(() => pad(page)).toBe('/');
  });

  test('Escape sluit het paneel', async ({ page }) => {
    await seed(page, { user: ADMIN });
    await page.goto('/');
    await page.getByText(`Verlofaanvraag · ${ALEX}`).first().click();
    await expect(verlofPaneel(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(verlofPaneel(page)).toHaveCount(0);
    expect(pad(page)).toBe('/verlof');
    await schoon(page);
  });
});

test.describe('recordlink van een koude start', () => {
  test('verlof: terug gaat naar de lijst, daarna het portaal uit', async ({ page }) => {
    await seed(page, { user: ADMIN });
    await page.goto('/verlof/l1');
    await expect(verlofPaneel(page)).toBeVisible({ timeout: 15_000 });
    await page.goBack();
    await expect.poll(() => pad(page)).toBe('/verlof');
    await expect(verlofPaneel(page)).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Verlof', level: 1 })).toBeVisible();
    await schoon(page);
    await terugVerlaatHetPortaal(page);
  });

  test('verlof: sluiten gaat naar de lijst zonder dubbele entry', async ({ page }) => {
    await seed(page, { user: ADMIN });
    await page.goto('/verlof/l1');
    await expect(verlofPaneel(page)).toBeVisible({ timeout: 15_000 });
    await verlofPaneel(page).getByRole('button', { name: 'Sluiten', exact: true }).click();
    await expect(verlofPaneel(page)).toHaveCount(0);
    await expect.poll(() => pad(page)).toBe('/verlof');
    await schoon(page);
    await terugVerlaatHetPortaal(page);
  });

  test('zijpaneel (Dienstoverzicht): terug en Annuleren gaan naar de lijst, zonder dubbele entry', async ({ page }) => {
    const paneel = page.getByRole('dialog', { name: 'Dienst 2515', exact: true });
    await seed(page, { user: ADMIN, view: 'dienstoverzicht' });
    await page.goto('/beheer/dienstoverzicht/3');
    await expect(paneel).toBeVisible({ timeout: 15_000 });
    await page.goBack();
    await expect(paneel).toHaveCount(0);
    await expect.poll(() => pad(page)).toBe('/beheer/dienstoverzicht');
    await schoon(page);
    await terugVerlaatHetPortaal(page);

    await page.goto('/beheer/dienstoverzicht/3');
    await expect(paneel).toBeVisible({ timeout: 15_000 });
    await paneel.getByRole('button', { name: 'Annuleren' }).click();
    await expect(paneel).toHaveCount(0);
    await expect.poll(() => pad(page)).toBe('/beheer/dienstoverzicht');
    await schoon(page);
    await page.goBack();
    // Vóór deze koude start stond de vorige ronde van deze test.
    await expect.poll(() => page.url()).toBe('about:blank');
  });

  test('zijpaneel met onbewaarde invoer: terug vraagt eerst, het record blijft in de adresbalk', async ({ page }) => {
    const paneel = page.getByRole('dialog', { name: 'Dienst 2515', exact: true });
    await seed(page, { user: ADMIN, view: 'dienstoverzicht' });
    await page.goto('/beheer/dienstoverzicht/3');
    await expect(paneel).toBeVisible({ timeout: 15_000 });
    await paneel.getByLabel('Loopnummer (deel 3)', { exact: true }).fill('9');
    await page.goBack();
    await expect(vraag(page)).toBeVisible();
    expect(pad(page)).toBe('/beheer/dienstoverzicht/3');
    await vraag(page).getByRole('button', { name: 'Verder bewerken' }).click();
    await expect(paneel.getByLabel('Loopnummer (deel 3)', { exact: true })).toHaveValue('9');
    await page.goBack();
    await vraag(page).getByRole('button', { name: 'Niet bewaren' }).click();
    await expect(paneel).toHaveCount(0);
    await expect.poll(() => pad(page)).toBe('/beheer/dienstoverzicht');
    await schoon(page);
    await terugVerlaatHetPortaal(page);
  });
});

test.describe('onbewaarde invoer in een inline paneel (desktop)', () => {
  test.beforeEach(({}, info) => {
    test.skip(!desktop(info.project.name), 'het inline paneel bestaat alleen vanaf lg; mobiel is het een zijpaneel met eigen vraag');
  });

  const titel = (page: Page) => page.getByLabel('Titel', { exact: true });

  async function openOmleiding(page: Page) {
    await seed(page, { user: ADMIN });
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 15_000 });
    await gaIntern(page, '/beheer/omleidingen');
    await expect(page.getByRole('heading', { name: 'Beheer omleidingen', level: 1 })).toBeVisible({ timeout: 15_000 });
    await page.getByRole('list', { name: 'Omleidingen' }).getByRole('button', { name: /Werken Markt Zottegem/ }).click();
    await expect(titel(page)).toHaveValue('Werken Markt Zottegem');
    await titel(page).fill('Werken Markt Zottegem, fase 2');
  }

  test('terug vraagt eerst; Verder bewerken houdt alles, Niet bewaren gaat terug', async ({ page }) => {
    await openOmleiding(page);
    await page.goBack();
    await expect(vraag(page)).toBeVisible();
    await vraag(page).getByRole('button', { name: 'Verder bewerken' }).click();
    await expect(titel(page)).toHaveValue('Werken Markt Zottegem, fase 2');
    expect(pad(page)).toBe('/beheer/omleidingen/d1');
    await page.goBack();
    await vraag(page).getByRole('button', { name: 'Niet bewaren' }).click();
    await expect.poll(() => pad(page)).toBe('/');
    await schoon(page);
  });

  test('een ander scherm kiezen in de zijbalk vraagt eerst', async ({ page }) => {
    await openOmleiding(page);
    const zijbalk = page.getByRole('navigation', { name: 'Zijbalk' });
    await zijbalk.getByRole('button', { name: 'Dashboard', exact: true }).click();
    await expect(vraag(page)).toBeVisible();
    await vraag(page).getByRole('button', { name: 'Verder bewerken' }).click();
    await expect(titel(page)).toHaveValue('Werken Markt Zottegem, fase 2');
    await zijbalk.getByRole('button', { name: 'Dashboard', exact: true }).click();
    await vraag(page).getByRole('button', { name: 'Niet bewaren' }).click();
    await expect.poll(() => pad(page)).toBe('/');
    await schoon(page);
    // Terug = het scherm dat je verliet, geen dode stap ertussen.
    await page.goBack();
    await expect.poll(() => pad(page)).toMatch(/^\/beheer\/omleidingen/);
  });

  test('een andere omleiding kiezen vraagt eerst', async ({ page }) => {
    await openOmleiding(page);
    await page.getByRole('list', { name: 'Omleidingen' }).getByRole('button', { name: /Wielerwedstrijd/ }).click();
    await expect(vraag(page)).toBeVisible();
    await vraag(page).getByRole('button', { name: 'Verder bewerken' }).click();
    await expect(titel(page)).toHaveValue('Werken Markt Zottegem, fase 2');
    await page.getByRole('list', { name: 'Omleidingen' }).getByRole('button', { name: /Wielerwedstrijd/ }).click();
    await vraag(page).getByRole('button', { name: 'Niet bewaren' }).click();
    await expect(titel(page)).toHaveValue('Wielerwedstrijd');
    expect(pad(page)).toBe('/beheer/omleidingen/d2');
    await schoon(page);
  });

  test('Annuleren vraagt eerst en sluit dan het paneel', async ({ page }) => {
    await openOmleiding(page);
    await page.getByRole('button', { name: 'Annuleren' }).click();
    await expect(vraag(page)).toBeVisible();
    await vraag(page).getByRole('button', { name: 'Niet bewaren' }).click();
    await expect(titel(page)).toHaveCount(0);
    await expect(page.getByText('Kies een omleiding om te bewerken, of maak een nieuwe.')).toBeVisible();
    expect(pad(page)).toBe('/beheer/omleidingen');
    await schoon(page);
    await page.goBack();
    await expect.poll(() => pad(page)).toBe('/');
  });
});
