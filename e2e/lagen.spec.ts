import { test, expect, type Page, type Route } from '@playwright/test';
import { ADMIN, gaIntern, historiekOpgeruimd, kanScrollen, seed } from './helpers';

/**
 * De lagenstapel (polish P2a, regels Jarno 24-09; src/lib/lagen.ts).
 *
 * Eén sluitactie = één laag: Escape, de terugknop, het kruisje, de
 * achtergrond en Annuleren sluiten alleen de bovenste laag. Sluiten er
 * meerdere tegelijk ("Niet bewaren", verwijderen vanuit het paneel), dan
 * blijft er geen dode history-entry achter: één keer terug gaat daarna naar
 * het vorige scherm, niet naar dezelfde lijst.
 *
 * Elke flow opent het Dienstoverzicht vanuit het dashboard (interne vorige
 * pagina) en eindigt met: geen dialoog, geen scroll-lock, de pagina schuift,
 * de bovenste entry is weer een pagina, en één keer terug = het dashboard.
 */

const pad = (page: Page) => new URL(page.url()).pathname;
const paneel = (page: Page) => page.getByRole('dialog', { name: 'Dienst 2515', exact: true });
const vraag = (page: Page) => page.getByRole('dialog', { name: 'Wijzigingen niet bewaren?' });
const bevestiging = (page: Page) => page.getByRole('dialog', { name: 'Dienst 2515 verwijderen' });
const lijstKop = (page: Page) => page.getByRole('heading', { name: 'Dienstoverzicht', level: 1 });

/** Dashboard → Dienstoverzicht (intern) → dienst 2515 uit de lijst openen. */
async function openVanuitLijst(page: Page) {
  await seed(page, { user: ADMIN });
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 15_000 });
  await gaIntern(page, '/beheer/dienstoverzicht');
  await expect(lijstKop(page)).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Dienst 2515 openen' }).filter({ visible: true }).click();
  await expect(paneel(page)).toBeVisible();
  expect(pad(page)).toBe('/beheer/dienstoverzicht/3');
}

/** Alles dicht en schoon, en één keer terug = het dashboard (geen dode stap). */
async function schoonEnTerugNaarDashboard(page: Page) {
  await kanScrollen(page);
  await historiekOpgeruimd(page);
  expect(pad(page)).toBe('/beheer/dienstoverzicht');
  await page.goBack();
  await expect.poll(() => pad(page)).toBe('/');
  await expect(paneel(page)).toHaveCount(0);
}

const maakVuil = (page: Page) => paneel(page).getByLabel('Loopnummer (deel 3)', { exact: true }).fill('9');

const serverAntwoord = (page: Page, status: number, body: unknown) => page.route('**/api/services', (r: Route) => (r.request().method() === 'POST'
  ? r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
  : r.fallback()));

test.describe('onbewaarde invoer', () => {
  test('kruisje → Niet bewaren: vraag en paneel dicht, geen dode terugstap', async ({ page }) => {
    await openVanuitLijst(page);
    await maakVuil(page);
    await paneel(page).getByRole('button', { name: 'Sluiten', exact: true }).click();
    await page.getByRole('button', { name: 'Niet bewaren' }).click();
    await schoonEnTerugNaarDashboard(page);
  });

  test('terugknop → vraag, paneel blijft; Niet bewaren sluit; geen dode terugstap', async ({ page }) => {
    await openVanuitLijst(page);
    await maakVuil(page);
    await page.goBack();
    await expect(vraag(page)).toBeVisible();
    await expect(paneel(page)).toBeVisible();
    await expect(paneel(page).getByLabel('Loopnummer (deel 3)', { exact: true })).toHaveValue('9');
    expect(pad(page)).toBe('/beheer/dienstoverzicht/3');
    await page.getByRole('button', { name: 'Niet bewaren' }).click();
    await schoonEnTerugNaarDashboard(page);
  });

  test('Escape en achtergrond vragen eerst; Verder bewerken houdt alles', async ({ page }, info) => {
    // Op de telefoon vult het paneel de breedte: geen achtergrond om op te tikken.
    test.skip(info.project.name.startsWith('iPhone'), 'achtergrond alleen naast een smal paneel');
    await openVanuitLijst(page);
    await maakVuil(page);
    await page.keyboard.press('Escape');
    await expect(vraag(page)).toBeVisible();
    // Escape op de vraag = Verder bewerken: alleen de vraag gaat dicht.
    await page.keyboard.press('Escape');
    await expect(vraag(page)).toHaveCount(0);
    await expect(paneel(page)).toBeVisible();
    await expect(paneel(page).getByLabel('Loopnummer (deel 3)', { exact: true })).toHaveValue('9');
    await page.mouse.click(5, 300);
    await expect(vraag(page)).toBeVisible();
    await vraag(page).getByRole('button', { name: 'Verder bewerken' }).click();
    await expect(paneel(page)).toBeVisible();
    await paneel(page).getByRole('button', { name: 'Annuleren' }).click();
    await page.getByRole('button', { name: 'Niet bewaren' }).click();
    await schoonEnTerugNaarDashboard(page);
  });
});

test.describe('verwijderen vanuit het paneel', () => {
  test('gelukt: paneel en bevestiging dicht, de dienst weg, terug gaat naar het vorige scherm', async ({ page }) => {
    await openVanuitLijst(page);
    // Na seed: een later geregistreerde route wint van de fixture-mock.
    await serverAntwoord(page, 200, { ok: true });
    await paneel(page).getByRole('button', { name: 'Dienst 2515 verwijderen' }).click();
    await bevestiging(page).getByRole('button', { name: 'Verwijderen' }).click();
    await expect(page.getByRole('button', { name: 'Dienst 2515 openen' })).toHaveCount(0);
    await schoonEnTerugNaarDashboard(page);
  });

  test('mislukt: paneel blijft open met de reden, daarna gewoon sluiten', async ({ page }) => {
    await openVanuitLijst(page);
    await serverAntwoord(page, 403, { error: 'Diensten verwijderen is alleen beschikbaar voor admins.' });
    await paneel(page).getByRole('button', { name: 'Dienst 2515 verwijderen' }).click();
    await bevestiging(page).getByRole('button', { name: 'Verwijderen' }).click();
    await expect(page.getByText(/alleen beschikbaar voor admins/).first()).toBeVisible();
    await expect(bevestiging(page)).toHaveCount(0);
    await expect(paneel(page)).toBeVisible();
    expect(pad(page)).toBe('/beheer/dienstoverzicht/3');
    await page.keyboard.press('Escape');
    await schoonEnTerugNaarDashboard(page);
  });
});

test.describe('één laag tegelijk', () => {
  test('Escape: eerst de geschiedenis, dan het paneel', async ({ page }) => {
    await openVanuitLijst(page);
    await paneel(page).getByRole('button', { name: 'Wijzigingsgeschiedenis' }).click();
    await expect(page.getByRole('dialog', { name: 'Wijzigingsgeschiedenis' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Wijzigingsgeschiedenis' })).toHaveCount(0);
    await expect(paneel(page)).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.body.dataset.scrollLocks ?? '')).toBe('slideover');
    await page.keyboard.press('Escape');
    await schoonEnTerugNaarDashboard(page);
  });

  test('bevestiging boven het paneel: Escape, achtergrond en terug sluiten alleen de bevestiging', async ({ page }) => {
    await openVanuitLijst(page);
    const open = async () => {
      await paneel(page).getByRole('button', { name: 'Dienst 2515 verwijderen' }).click();
      await expect(bevestiging(page)).toBeVisible();
    };
    const alleenBevestigingDicht = async () => {
      await expect(bevestiging(page)).toHaveCount(0);
      await expect(paneel(page)).toBeVisible();
      expect(pad(page)).toBe('/beheer/dienstoverzicht/3');
    };
    await open();
    await page.keyboard.press('Escape');
    await alleenBevestigingDicht();
    await open();
    await page.mouse.click(5, 5);
    await alleenBevestigingDicht();
    await open();
    await page.goBack();
    await alleenBevestigingDicht();
    // Daarna sluit terug het paneel en blijft de lijst.
    await page.goBack();
    await schoonEnTerugNaarDashboard(page);
  });
});

test.describe('meldingen', () => {
  test('het paneel sluit eerst (telefoon: terugknop; desktop: Escape), de pagina blijft', async ({ page }, info) => {
    await seed(page, { user: ADMIN });
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 15_000 });
    await gaIntern(page, '/beheer/dienstoverzicht');
    await expect(lijstKop(page)).toBeVisible({ timeout: 15_000 });
    const bel = page.locator('header').getByRole('button', { name: /^Meldingen/ }).filter({ visible: true }).first();
    await bel.click();
    const menu = page.getByRole('menu', { name: 'Meldingen' });
    await expect(menu).toBeVisible();
    if (info.project.name.startsWith('iPhone')) await page.goBack();
    else await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    expect(pad(page)).toBe('/beheer/dienstoverzicht');
    await expect(lijstKop(page)).toBeVisible();
    await kanScrollen(page);
    await historiekOpgeruimd(page);
    await page.goBack();
    await expect.poll(() => pad(page)).toBe('/');
  });
});

test.describe('focus blijft in een sheet', () => {
  // P6 (24-09): Sheet had focus-naar-paneel maar geen Tab-trap, dus Tab liep
  // het sheet uit naar de pagina eronder (aria-modal belooft het tegendeel).
  test('Tab en Shift+Tab draaien rond binnen het sheet, Escape geeft de focus terug', async ({ page }) => {
    await seed(page, { user: ADMIN });
    await page.goto('/beheer/designsysteem');
    const knop = page.getByRole('button', { name: 'Sheet openen' });
    await knop.scrollIntoViewIfNeeded();
    await knop.focus();
    await page.keyboard.press('Enter');
    const sheet = page.getByRole('dialog').last();
    await expect(sheet).toBeVisible();
    const binnen = () => page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'));
    for (let i = 0; i < 8; i++) { await page.keyboard.press('Tab'); expect(await binnen(), `Tab ${i + 1}`).toBe(true); }
    for (let i = 0; i < 8; i++) { await page.keyboard.press('Shift+Tab'); expect(await binnen(), `Shift+Tab ${i + 1}`).toBe(true); }
    await page.keyboard.press('Escape');
    await expect(sheet).toHaveCount(0);
    await expect(knop).toBeFocused();
  });
});
