import { test, expect, type Page, type Route } from '@playwright/test';
import { ADMIN, kanScrollen, seed } from './helpers';

/**
 * Hotfix 24-09: na het sluiten van een overlay bleef de pagina soms op slot
 * tot een herlaad. Elke laag onthield "de vorige overflow" en zette die terug;
 * sloten twee lagen in één commit (bevestiging of geschiedenis boven een
 * zijpaneel, "Niet bewaren", Escape die beide sloot), dan zette het kind
 * 'hidden' terug. Nu één gedeelde lock met eigenaarschap (src/lib/scrollSlot.ts).
 *
 * Na elke flow: geen overlay meer open, geen actieve lock, geen inline
 * overflow op body of scroll-root, en de scroll-root schuift echt.
 */

const designsysteem = async (page: Page) => {
  await seed(page, { user: ADMIN, view: 'designsysteem' });
  await page.goto('/beheer/designsysteem');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 15_000 });
};
const openKnop = async (page: Page, naam: string) => {
  const knop = page.getByRole('button', { name: naam, exact: true });
  await knop.scrollIntoViewIfNeeded();
  await knop.click();
};

test.describe('enkele overlay', () => {
  test('Modal: kruisje, Escape en achtergrond', async ({ page }) => {
    await designsysteem(page);
    const modal = page.getByRole('dialog', { name: 'Voorbeeldmodal' });
    await openKnop(page, 'Modal openen');
    await modal.getByRole('button', { name: 'Sluiten' }).first().click();
    await kanScrollen(page);
    await openKnop(page, 'Modal openen');
    await expect(modal).toBeVisible();
    await page.keyboard.press('Escape');
    await kanScrollen(page);
    await openKnop(page, 'Modal openen');
    await expect(modal).toBeVisible();
    await page.mouse.click(5, 5);
    await kanScrollen(page);
  });

  test('ConfirmationModal: annuleren', async ({ page }) => {
    await designsysteem(page);
    await openKnop(page, 'Bevestiging');
    await page.getByRole('dialog', { name: 'Voorbeeld verwijderen?' }).getByRole('button', { name: 'Annuleren' }).click();
    await kanScrollen(page);
  });

  test('Sheet: kruisje en Escape', async ({ page }) => {
    await designsysteem(page);
    await openKnop(page, 'Sheet openen');
    await page.getByRole('dialog', { name: 'Dienst 2101' }).getByRole('button', { name: 'Sluiten' }).click();
    await kanScrollen(page);
    await openKnop(page, 'Sheet openen');
    await expect(page.getByRole('dialog', { name: 'Dienst 2101' })).toBeVisible();
    await page.keyboard.press('Escape');
    await kanScrollen(page);
  });

  test('DatePicker: openen en sluiten', async ({ page }) => {
    await designsysteem(page);
    const veld = page.getByLabel('Startdatum', { exact: true });
    await veld.scrollIntoViewIfNeeded();
    await veld.locator('xpath=following-sibling::button[1]').click();
    await expect(page.getByRole('dialog', { name: 'Datum kiezen' })).toBeVisible();
    await page.keyboard.press('Escape');
    await kanScrollen(page);
  });

  test('Meldingen: paneel openen en sluiten', async ({ page }) => {
    await designsysteem(page);
    // De bel in de topbar (niet het menu-item Meldingen in de zijbalk).
    const bel = page.locator('header').getByRole('button', { name: /^Meldingen/ }).filter({ visible: true }).first();
    await bel.click();
    await page.keyboard.press('Escape');
    await kanScrollen(page);
  });

  test('snel openen en sluiten, meerdere lagen na elkaar', async ({ page }) => {
    await designsysteem(page);
    for (let i = 0; i < 4; i++) {
      await openKnop(page, 'Modal openen');
      await page.keyboard.press('Escape');
    }
    await openKnop(page, 'Sheet openen');
    await page.keyboard.press('Escape');
    await openKnop(page, 'Bevestiging');
    await page.getByRole('button', { name: 'Annuleren' }).click();
    await kanScrollen(page);
  });
});

test.describe('geneste lagen (zijpaneel in het Dienstoverzicht)', () => {
  const paneel = (page: Page) => page.getByRole('dialog', { name: 'Dienst 2515', exact: true });
  /**
   * De bovenste laag met een eigen stap in de historiek. src/lib/lagen.ts zet
   * een laag in de stapel en in de historiek in een effect, dus ná het
   * tekenen: een Escape of een stap terug op het moment dat de laag zichtbaar
   * wordt, kan haar voor zijn en raakt dan de laag eronder. In WebKit op de
   * CI-runner gebeurde dat geregeld (op main in 6 van 14 rondes "routewissel",
   * in 2 "geschiedenis → Escape"); een mens is nooit zo snel.
   */
  const laagBoven = (page: Page) => page.evaluate(() => (history.state as { vhbOverlay?: unknown } | null)?.vhbOverlay ?? null);
  const paneelInStapel = (page: Page) => expect.poll(() => laagBoven(page), 'het paneel heeft zijn stap in de historiek').not.toBeNull();
  const openPaneel = async (page: Page) => {
    await seed(page, { user: ADMIN, view: 'dienstoverzicht' });
    await page.goto('/beheer/dienstoverzicht/3');
    await expect(paneel(page)).toBeVisible({ timeout: 15_000 });
    await paneelInStapel(page);
  };
  const serverOk = (page: Page) => page.route('**/api/services', (r: Route) => (r.request().method() === 'POST'
    ? r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' })
    : r.fallback()));

  test('bevestiging boven het paneel → verwijderen (paneel en bevestiging sluiten samen)', async ({ page }) => {
    await serverOk(page);
    await openPaneel(page);
    await paneel(page).getByRole('button', { name: 'Dienst 2515 verwijderen' }).click();
    await page.getByRole('dialog', { name: 'Dienst 2515 verwijderen' }).getByRole('button', { name: 'Verwijderen' }).click();
    await kanScrollen(page);
  });

  test('bevestiging boven het paneel → annuleren, dan paneel sluiten', async ({ page }) => {
    await openPaneel(page);
    await paneel(page).getByRole('button', { name: 'Dienst 2515 verwijderen' }).click();
    await page.getByRole('dialog', { name: 'Dienst 2515 verwijderen' }).getByRole('button', { name: 'Annuleren' }).click();
    await expect(paneel(page)).toBeVisible();
    await paneel(page).getByRole('button', { name: 'Annuleren' }).click();
    await kanScrollen(page);
  });

  test('vuil formulier → kruisje → Niet bewaren', async ({ page }) => {
    await openPaneel(page);
    await paneel(page).getByLabel('Loopnummer (deel 3)', { exact: true }).fill('9');
    await paneel(page).getByRole('button', { name: 'Sluiten', exact: true }).click();
    await page.getByRole('button', { name: 'Niet bewaren' }).click();
    await kanScrollen(page);
  });

  test('geschiedenis boven het paneel → Escape', async ({ page }) => {
    await openPaneel(page);
    const vanPaneel = await laagBoven(page);
    await paneel(page).getByRole('button', { name: 'Wijzigingsgeschiedenis' }).click();
    // Elke Escape sluit de bovenste laag: eerst de geschiedenis (zodra ze in
    // de stapel ligt), dan het paneel (zodra de geschiedenis eruit is).
    await expect.poll(() => laagBoven(page), 'de geschiedenis ligt boven het paneel').not.toBe(vanPaneel);
    await page.keyboard.press('Escape');
    await expect.poll(() => laagBoven(page), 'alleen de geschiedenis is dicht').toBe(vanPaneel);
    await page.keyboard.press('Escape');
    await kanScrollen(page);
  });

  test('opslaan sluit het paneel', async ({ page }) => {
    await serverOk(page);
    await openPaneel(page);
    await paneel(page).getByLabel('Loopnummer (deel 3)', { exact: true }).fill('4516');
    await paneel(page).getByRole('button', { name: 'Dienst bijwerken' }).click();
    await kanScrollen(page);
  });

  test('browser Terug terwijl het paneel open is', async ({ page }) => {
    await openPaneel(page);
    await page.goBack();
    await kanScrollen(page);
  });

  test('routewissel terwijl het paneel open is', async ({ page }) => {
    await seed(page, { user: ADMIN });
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 15_000 });
    // Naar een dienst (push), paneel open, dan twee stappen terug in één keer:
    // het scherm wisselt terwijl het paneel nog open staat.
    await page.evaluate(() => { history.pushState(null, '', '/beheer/dienstoverzicht/3'); dispatchEvent(new PopStateEvent('popstate')); });
    await expect(paneel(page)).toBeVisible({ timeout: 15_000 });
    // Twee stappen terug = de stap van het paneel en de dienst zelf: die van
    // het paneel moet er dus staan, anders eindigt de sprong vóór het portaal.
    await paneelInStapel(page);
    await page.evaluate(() => history.go(-2));
    await expect(page).toHaveURL(/\/$/);
    await kanScrollen(page);
  });
});

test('mobiele zijbalk: openen, sluiten en navigeren', async ({ page }, info) => {
  test.skip(!info.project.name.startsWith('iPhone'), 'de zijbalk is een lade op de telefoon');
  await seed(page, { user: ADMIN });
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 15_000 });
  // Op de telefoon opent "Meer" in de dock de zijbalk (lade).
  await page.getByRole('button', { name: 'Meer', exact: true }).click();
  await expect(page.getByRole('navigation', { name: 'Zijbalk' })).toBeVisible();
  await page.keyboard.press('Escape');
  await kanScrollen(page);
  await page.getByRole('button', { name: 'Meer', exact: true }).click();
  await page.getByRole('navigation', { name: 'Zijbalk' }).getByRole('button', { name: 'Dienstoverzicht', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Dienstoverzicht', level: 1 })).toBeVisible();
  await kanScrollen(page);
});
