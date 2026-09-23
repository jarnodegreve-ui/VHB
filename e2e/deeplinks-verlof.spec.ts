import { test, expect, type Page } from '@playwright/test';
import { ADMIN, CHAUFFEUR, seed, type Extra } from './helpers';
import { LEAVE } from '../scripts/audit-fixtures.mjs';
import { logIn, vandaagIso, zonderSessie } from './deeplinkHulp';

/**
 * Deeplinks V1, verlof (tranche 3C, 23-09): `/verlof/<id>` opent die ene
 * aanvraag. Staf krijgt het beoordelingspaneel (desktop inline, telefoon een
 * SlideOver), een chauffeur zijn eigen rij open en in beeld. Een id dat niet
 * in je gegevens staat (weg, of van een collega) geeft één nette melding die
 * niet verraadt of het record bestaat.
 *
 * Fixtures: l1 = pending van Alex Du Priez (43), l2 = goedgekeurd verlof
 * van de testchauffeur (42) in het verleden.
 */

const ALEX = 'Alex Du Priez';
const DIETHER = 'Diether Van Haute';
const paneelKop = (page: Page, naam: string) => page.getByRole('heading', { name: naam, exact: true });
const pad = (page: Page) => new URL(page.url()).pathname;
const onbekend = (page: Page) => page.getByText('Deze verlofaanvraag is niet beschikbaar');
const sluitOnbekend = (page: Page) => page.getByRole('status').filter({ hasText: 'niet beschikbaar' }).getByRole('button', { name: 'Sluiten' });
/**
 * Terug vanaf een aanvraag die je van elders opende. Desktop: het paneel staat
 * in de pagina, één keer terug = waar je vandaan kwam. Telefoon: het paneel is
 * een SlideOver, en zoals elke overlay in het portaal (useHistoryDismiss)
 * sluit de eerste keer terug het paneel en toont de lijst; de tweede keer
 * brengt je terug.
 */
async function terugNaar(page: Page, herkomst: string) {
  const telefoon = (page.viewportSize()?.width ?? 1440) < 1024;
  await page.goBack();
  if (telefoon) {
    await expect.poll(() => pad(page)).toBe('/verlof');
    await page.goBack();
  }
  await expect.poll(() => pad(page)).toBe(herkomst);
}

/** Goedgekeurd verlof van Diether (geen dienst vandaag): een rustige afwezige op Vandaag. */
const L3 = { id: 'l3', userId: '44', startDate: vandaagIso(0), endDate: vandaagIso(2), type: 'betaald_verlof', status: 'approved', createdAt: new Date().toISOString(), decidedAt: new Date().toISOString() };
const metL3: Extra = (p) => (p.endsWith('/api/leave') ? [...LEAVE, L3] : undefined);

test.describe('verlof-deeplink met sessie', () => {
  test('staf: de link opent het beoordelingspaneel van die aanvraag, ook na herladen', async ({ page }) => {
    await seed(page, { user: ADMIN });
    await page.goto('/verlof/l1');
    await expect(paneelKop(page, ALEX)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Goedkeuren' })).toBeVisible();
    await page.reload();
    await expect(paneelKop(page, ALEX)).toBeVisible();
    expect(pad(page)).toBe('/verlof/l1');
    // Eén paneel, geen tweede eroverheen.
    await expect(paneelKop(page, ALEX)).toHaveCount(1);
  });

  test('staf: sluiten haalt het id uit de URL en laat de lijst staan', async ({ page }) => {
    await seed(page, { user: ADMIN });
    await page.goto('/verlof/l2');
    await expect(paneelKop(page, 'Test Chauffeur')).toBeVisible();
    await page.getByRole('button', { name: 'Sluiten' }).last().click();
    await expect(paneelKop(page, 'Test Chauffeur')).toHaveCount(0);
    expect(pad(page)).toBe('/verlof');
  });

  test('staf: een afgehandelde aanvraag uit het verleden opent gewoon, zonder beslisknoppen', async ({ page }) => {
    await seed(page, { user: ADMIN });
    await page.goto('/verlof/l2');
    await expect(paneelKop(page, 'Test Chauffeur')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Goedkeuren' })).toHaveCount(0);
  });

  test('chauffeur: de link klapt zijn eigen aanvraag open en brengt ze in beeld', async ({ page }) => {
    await seed(page, { user: CHAUFFEUR });
    await page.goto('/verlof/l2');
    const rij = page.locator('[data-record="l2"]');
    await expect(rij).toBeInViewport();
    await expect(page.getByText(/^Aangevraagd op /).first()).toBeVisible();
    await expect(page.locator('[data-record="l2"]').locator('xpath=ancestor::button[1]')).toBeFocused();
  });

  test('niet-bestaand record: nette melding, sluiten brengt je naar de lijst', async ({ page }) => {
    await seed(page, { user: ADMIN });
    await page.goto('/verlof/bestaat-niet');
    await expect(onbekend(page)).toBeVisible();
    await sluitOnbekend(page).click();
    await expect(onbekend(page)).toHaveCount(0);
    expect(pad(page)).toBe('/verlof');
  });

  test('verwijderd record: na herladen verdwenen, dezelfde nette melding', async ({ page }) => {
    let weg = false;
    await seed(page, { user: ADMIN, extra: (p) => (p.endsWith('/api/leave') && weg ? LEAVE.filter((l) => l.id !== 'l1') : undefined) });
    await page.goto('/verlof/l1');
    await expect(paneelKop(page, ALEX)).toBeVisible();
    weg = true;
    await page.reload();
    await expect(onbekend(page)).toBeVisible();
    await expect(paneelKop(page, ALEX)).toHaveCount(0);
  });

  test('geen recht: een chauffeur op de aanvraag van een collega ziet niets van die aanvraag', async ({ page }) => {
    // De server geeft een chauffeur alleen zijn eigen verlof (de fixture ook).
    await seed(page, { user: CHAUFFEUR });
    await page.goto('/verlof/l1');
    await expect(onbekend(page)).toBeVisible();
    await expect(page.getByText(ALEX)).toHaveCount(0);
  });
});

test.describe('verlof-deeplink vanuit het portaal', () => {
  test('dashboard → aanvraag, terug = dashboard, vooruit = weer de aanvraag', async ({ page }) => {
    await seed(page, { user: ADMIN });
    await page.goto('/');
    await page.getByText(`Verlofaanvraag · ${ALEX}`).first().click();
    await expect(paneelKop(page, ALEX)).toBeVisible();
    expect(pad(page)).toBe('/verlof/l1');
    await terugNaar(page, '/');
    await expect(paneelKop(page, ALEX)).toHaveCount(0);
    await page.goForward();
    await expect.poll(() => pad(page)).toMatch(/^\/verlof/);
    if ((page.viewportSize()?.width ?? 1440) >= 1024) {
      expect(pad(page)).toBe('/verlof/l1');
      await expect(paneelKop(page, ALEX)).toBeVisible();
    }
  });

  test('Vandaag → de aanvraag achter een afwezigheid', async ({ page }) => {
    await seed(page, { user: ADMIN, extra: metL3 });
    await page.goto('/vandaag');
    await page.getByRole('button', { name: `Verlofaanvraag van ${DIETHER} openen` }).click();
    await expect(paneelKop(page, DIETHER)).toBeVisible();
    expect(pad(page)).toBe('/verlof/l3');
    await terugNaar(page, '/vandaag');
  });

  test('melding → dezelfde aanvraag als vanuit het dashboard', async ({ page }) => {
    await seed(page, {
      user: ADMIN,
      extra: (p) => (p.endsWith('/api/meldingen')
        ? { meldingen: [{ id: 'm1', titel: 'Nieuwe verlofaanvraag', tekst: `${ALEX} vroeg betaald verlof aan.`, soort: 'verlof', doel: 'verlof/l1', createdAt: new Date().toISOString() }], ongelezen: 1 }
        : undefined),
    });
    await page.goto('/meldingen');
    await page.getByText('Nieuwe verlofaanvraag').click();
    await expect(paneelKop(page, ALEX)).toBeVisible();
    expect(pad(page)).toBe('/verlof/l1');
    await terugNaar(page, '/meldingen');
  });

  test('melding met een oud of ongeldig id: nette melding, geen fout', async ({ page }) => {
    const fouten: string[] = [];
    page.on('pageerror', (e) => fouten.push(e.message));
    await seed(page, {
      user: CHAUFFEUR,
      extra: (p) => (p.endsWith('/api/meldingen')
        ? { meldingen: [{ id: 'm9', titel: 'Verlof goedgekeurd', tekst: 'Oud bericht', soort: 'verlof', doel: 'verlof/allang-weg', createdAt: new Date().toISOString() }], ongelezen: 1 }
        : undefined),
    });
    await page.goto('/meldingen');
    await page.getByText('Verlof goedgekeurd').click();
    await expect(onbekend(page)).toBeVisible();
    expect(fouten).toEqual([]);
  });
});

test.describe('verlof-deeplink zonder sessie', () => {
  test('link → inloggen → dezelfde aanvraag', async ({ page }) => {
    await zonderSessie(page, ADMIN);
    await page.goto('/verlof/l1');
    await expect(page.getByRole('button', { name: 'Inloggen' })).toBeVisible();
    await logIn(page);
    await expect(paneelKop(page, ALEX)).toBeVisible();
    expect(pad(page)).toBe('/verlof/l1');
  });
});
