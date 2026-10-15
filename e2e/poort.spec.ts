import { test, expect, type Page } from '@playwright/test';
import { ADMIN, CHAUFFEUR, seed } from './helpers';

/**
 * Poort per rol (ronde 3, 19-09): het eerste scherm wacht niet meer op de
 * uitgestelde collecties, en een scherm dat zo'n collectie leest toont zijn
 * skelet, nooit een lege staat, zolang ze onderweg is. We houden de
 * uitgestelde call kunstmatig tegen en laten hem pas los na de controle.
 */
const houdTegen = async (page: Page, pad: string) => {
  let laatLos!: () => void;
  const los = new Promise<void>((resolve) => { laatLos = resolve; });
  let gevraagd!: () => void;
  const aangevraagd = new Promise<void>((resolve) => { gevraagd = resolve; });
  // Later geregistreerd dan de fixtures in seed(), dus deze route wint; na het
  // loslaten valt hij terug op het gewone fixture-antwoord.
  await page.route(`**${pad}`, async (route) => {
    if (new URL(route.request().url()).pathname !== pad || route.request().method() !== 'GET') return route.fallback();
    gevraagd();
    await los;
    return route.fallback();
  });
  return { laatLos, aangevraagd };
};

test('chauffeur: het dashboard staat er vóór gebruikers, ruilen en documenten binnen zijn', async ({ page }) => {
  await seed(page, { user: CHAUFFEUR, view: 'dashboard' });
  const users = await houdTegen(page, '/api/users');
  const swaps = await houdTegen(page, '/api/swaps');
  const documenten = await houdTegen(page, '/api/documents');
  await page.goto('/');
  // De poort is dicht: het dashboard rendert terwijl de drie calls nog hangen.
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Test');
  await Promise.all([users.aangevraagd, swaps.aangevraagd, documenten.aangevraagd]);
  await expect(page.locator('[aria-label="Scherm wordt geladen"]')).toHaveCount(0);
  users.laatLos(); swaps.laatLos(); documenten.laatLos();
});

test('chauffeur: Contacten toont het skelet en nooit "Geen contacten gevonden" terwijl gebruikers laden', async ({ page }) => {
  await seed(page, { user: CHAUFFEUR, view: 'contacten' });
  const users = await houdTegen(page, '/api/users');
  await page.goto('/contacten');
  await users.aangevraagd;
  await expect(page.locator('[aria-label="Scherm wordt geladen"]')).toBeVisible();
  await expect(page.getByText('Geen contacten gevonden')).toHaveCount(0);
  users.laatLos();
  await expect(page.getByText('Alex Du Priez').first()).toBeVisible();
  await expect(page.getByText('Geen contacten gevonden')).toHaveCount(0);
});

test('staf: Dienstoverzicht toont het skelet en nooit "Nog geen diensten" terwijl de diensten laden', async ({ page }) => {
  await seed(page, { user: ADMIN, view: 'dienstoverzicht' });
  const services = await houdTegen(page, '/api/services');
  await page.goto('/beheer/dienstoverzicht');
  await services.aangevraagd;
  await expect(page.locator('[aria-label="Scherm wordt geladen"]')).toBeVisible();
  await expect(page.getByText('Nog geen diensten')).toHaveCount(0);
  services.laatLos();
  await expect(page.locator('[aria-label="Scherm wordt geladen"]')).toHaveCount(0);
  await expect(page.getByText('Nog geen diensten')).toHaveCount(0);
});

test('admin: de cockpit staat er vóór matrix en activiteitenlog; het activiteitspaneel toont een skelet', async ({ page }) => {
  await seed(page, { user: ADMIN, view: 'dashboard' });
  const matrix = await houdTegen(page, '/api/planning-matrix');
  const log = await houdTegen(page, '/api/activity');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Jarno');
  await Promise.all([matrix.aangevraagd, log.aangevraagd]);
  await expect(page.locator('[aria-label="Activiteit wordt geladen"]')).toBeVisible();
  log.laatLos(); matrix.laatLos();
  // De feed toont de details van de logregel (FeedRow).
  await expect(page.getByText('56 dagen verwerkt').first()).toBeVisible();
  await expect(page.locator('[aria-label="Activiteit wordt geladen"]')).toHaveCount(0);
});

// Sinds 15-10 (snelheidsonderzoek) zitten de omleidingen voor geen enkele rol
// in de poort, en voor een chauffeur ook updates en meldingen niet: het
// eerste scherm staat er terwijl die calls nog lopen, en een scherm dat ze
// leest toont zijn skelet of een laadstand, nooit "Vrije baan" of een lege lijst.
test('chauffeur: het dashboard staat er vóór de omleidingen binnen zijn, en zegt "omleidingen laden", nooit "Vrije baan"', async ({ page }) => {
  await seed(page, { user: CHAUFFEUR, view: 'dashboard' });
  const diversions = await houdTegen(page, '/api/diversions');
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Test');
  await diversions.aangevraagd;
  await expect(page.locator('[aria-label="Scherm wordt geladen"]')).toHaveCount(0);
  await expect(page.getByText('omleidingen laden').first()).toBeVisible();
  await expect(page.getByText('Vrije baan')).toHaveCount(0);
  diversions.laatLos();
  await expect(page.getByText('omleidingen laden')).toHaveCount(0);
});

test('chauffeur: Mijn dag staat er vóór de omleidingen binnen zijn', async ({ page }) => {
  await seed(page, { user: CHAUFFEUR, view: 'mijn-dag' });
  const diversions = await houdTegen(page, '/api/diversions');
  await page.goto('/mijn-dag');
  await diversions.aangevraagd;
  // De kop van de inhoud is de dag ("Donderdag 15 oktober"). "Mijn dag" is de
  // kop van de laadweergave zolang de chunk onderweg is: daarop wachten
  // slaagde alleen als de test die tussenstand nog ving.
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/^(Maandag|Dinsdag|Woensdag|Donderdag|Vrijdag|Zaterdag|Zondag) \d/);
  await expect(page.locator('[aria-label="Scherm wordt geladen"]')).toHaveCount(0);
  diversions.laatLos();
});

test('chauffeur: Omleidingen toont het skelet en nooit "Geen omleidingen" terwijl ze laden', async ({ page }) => {
  await seed(page, { user: CHAUFFEUR, view: 'omleidingen' });
  const diversions = await houdTegen(page, '/api/diversions');
  await page.goto('/omleidingen');
  await diversions.aangevraagd;
  await expect(page.locator('[aria-label="Scherm wordt geladen"]')).toBeVisible();
  await expect(page.getByText('Geen omleidingen')).toHaveCount(0);
  diversions.laatLos();
  await expect(page.locator('[aria-label="Scherm wordt geladen"]')).toHaveCount(0);
  await expect(page.getByText('Geen omleidingen')).toHaveCount(0);
});

test('chauffeur: Updates en Meldingen tonen het skelet en nooit een lege lijst terwijl ze laden', async ({ page }) => {
  await seed(page, { user: CHAUFFEUR, view: 'updates' });
  const updates = await houdTegen(page, '/api/updates');
  const meldingen = await houdTegen(page, '/api/meldingen');
  await page.goto('/updates');
  await updates.aangevraagd;
  await expect(page.locator('[aria-label="Scherm wordt geladen"]')).toBeVisible();
  await expect(page.getByText('Geen updates')).toHaveCount(0);
  updates.laatLos();
  await expect(page.locator('[aria-label="Scherm wordt geladen"]')).toHaveCount(0);
  await page.goto('/meldingen');
  await meldingen.aangevraagd;
  await expect(page.locator('[aria-label="Scherm wordt geladen"]')).toBeVisible();
  await expect(page.getByText('Nog geen meldingen')).toHaveCount(0);
  meldingen.laatLos();
  await expect(page.locator('[aria-label="Scherm wordt geladen"]')).toHaveCount(0);
});

test('staf: de cockpit en Vandaag staan er vóór de omleidingen binnen zijn, zonder "Geen omleidingen"', async ({ page }) => {
  await seed(page, { user: ADMIN, view: 'dashboard' });
  const diversions = await houdTegen(page, '/api/diversions');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Jarno');
  await diversions.aangevraagd;
  await expect(page.getByText('omleidingen laden').first()).toBeVisible();
  await page.goto('/vandaag');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.getByText('Geen omleidingen op deze dag.')).toHaveCount(0);
  diversions.laatLos();
  await expect(page.getByText('omleidingen laden')).toHaveCount(0);
});
