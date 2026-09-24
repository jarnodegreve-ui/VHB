import { test, expect, type Page } from '@playwright/test';
import { ADMIN, gaIntern, historiekOpgeruimd, kanScrollen, seed, type Extra } from './helpers';
import { VEHICLES } from '../scripts/audit-fixtures.mjs';

/**
 * Recordlink Voertuigen (P6, 24-09): `/techniek/voertuigen/<id>` volgt
 * hetzelfde patroon als Verlof, Dienstruil en Dienstoverzicht (3C/P2). De
 * fiche is een Modal die de URL volgt: een koude link en een refresh openen
 * ze, sluiten en Terug halen het id uit de URL zonder dode terugstap, en een
 * id dat niet (meer) in de lijst staat geeft de nette melding.
 *
 * Fixture v26 = "Bus 26" (MAN 12E, actief).
 */

const pad = (page: Page) => new URL(page.url()).pathname;
const fiche = (page: Page) => page.getByRole('dialog', { name: 'Voertuig Bus 26' });
const onbekend = (page: Page) => page.getByText('Dit voertuig is niet beschikbaar');
const vraag = (page: Page) => page.getByRole('dialog', { name: 'Wijzigingen niet bewaren?' });
const LIJST = '/techniek/voertuigen';
/** De rij van Bus 26: op desktop de celknop "Bus 26 openen", onder md de kaartknop. */
const rij = (page: Page) => page.getByRole('button', { name: /^Bus 26( openen| ·)/ }).first();

async function schoon(page: Page) {
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await kanScrollen(page);
  await historiekOpgeruimd(page);
  await expect.poll(() => page.evaluate(() => (history.state as { vhbOuderStap?: unknown } | null)?.vhbOuderStap ?? null)).toBeNull();
}

/** Eén keer terug verlaat het portaal (de pagina vóór de koude start). */
async function terugVerlaatHetPortaal(page: Page) {
  await page.goBack();
  await expect.poll(() => page.url()).toBe('about:blank');
}

test('koude link opent de fiche, ook na herladen', async ({ page }) => {
  await seed(page, { user: ADMIN });
  await page.goto(`${LIJST}/v26`);
  await expect(fiche(page)).toBeVisible({ timeout: 15_000 });
  await page.reload();
  await expect(fiche(page)).toBeVisible({ timeout: 15_000 });
  expect(pad(page)).toBe(`${LIJST}/v26`);
  await expect(page.getByRole('dialog')).toHaveCount(1);
});

test('sluiten gaat naar de lijst zonder dubbele entry', async ({ page }) => {
  await seed(page, { user: ADMIN });
  await page.goto(`${LIJST}/v26`);
  await expect(fiche(page)).toBeVisible({ timeout: 15_000 });
  await fiche(page).getByRole('button', { name: 'Sluiten', exact: true }).first().click();
  await expect(fiche(page)).toHaveCount(0);
  await expect.poll(() => pad(page)).toBe(LIJST);
  await schoon(page);
  await terugVerlaatHetPortaal(page);
});

test('terug vanaf een koude link: eerst de lijst, daarna het portaal uit', async ({ page }) => {
  await seed(page, { user: ADMIN });
  await page.goto(`${LIJST}/v26`);
  await expect(fiche(page)).toBeVisible({ timeout: 15_000 });
  await page.goBack();
  await expect(fiche(page)).toHaveCount(0);
  await expect.poll(() => pad(page)).toBe(LIJST);
  await expect(page.getByRole('heading', { name: 'Voertuigen', level: 1 })).toBeVisible();
  await schoon(page);
  await terugVerlaatHetPortaal(page);
});

test('onbekend id: nette melding, Sluiten gaat naar de lijst', async ({ page }) => {
  await seed(page, { user: ADMIN });
  await page.goto(`${LIJST}/bestaat-niet`);
  await expect(onbekend(page)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('dialog')).toHaveCount(0);
  // De lijst staat er gewoon onder.
  await expect(rij(page)).toBeVisible();
  await page.getByRole('status').filter({ hasText: 'niet beschikbaar' }).getByRole('button', { name: 'Sluiten' }).click();
  await expect(onbekend(page)).toHaveCount(0);
  await expect.poll(() => pad(page)).toBe(LIJST);
  await schoon(page);
});

test('tijdens het laden geen melding: leeg is niet "niet gevonden"', async ({ page }) => {
  let vrijgeven: () => void = () => {};
  const wacht = new Promise<void>((r) => { vrijgeven = r; });
  await seed(page, { user: ADMIN });
  await page.route('**/api/vehicles', async (r) => { await wacht; return r.fallback(); });
  await page.goto(`${LIJST}/v26`);
  await expect(page.getByRole('heading', { name: 'Voertuigen', level: 1 })).toBeVisible();
  await page.waitForTimeout(800);
  await expect(onbekend(page)).toHaveCount(0);
  vrijgeven();
  await expect(fiche(page)).toBeVisible({ timeout: 15_000 });
});

test('klik in de lijst zet het id in de URL; terug sluit de fiche, nog eens terug = herkomst', async ({ page }) => {
  await seed(page, { user: ADMIN });
  await page.goto('/');
  await gaIntern(page, LIJST);
  await rij(page).click();
  await expect(fiche(page)).toBeVisible();
  expect(pad(page)).toBe(`${LIJST}/v26`);
  await page.goBack();
  await expect(fiche(page)).toHaveCount(0);
  await expect.poll(() => pad(page)).toBe(LIJST);
  await schoon(page);
  await page.goBack();
  await expect.poll(() => pad(page)).toBe('/');
});

test('onbewaarde invoer: terug vraagt eerst, het record blijft in de adresbalk', async ({ page }) => {
  await seed(page, { user: ADMIN });
  await page.goto(`${LIJST}/v26`);
  await expect(fiche(page)).toBeVisible({ timeout: 15_000 });
  await fiche(page).getByLabel(/^Opmerking /).first().fill('2 stuks');
  await page.goBack();
  await expect(vraag(page)).toBeVisible();
  expect(pad(page)).toBe(`${LIJST}/v26`);
  await vraag(page).getByRole('button', { name: 'Verder bewerken' }).click();
  await expect(fiche(page).getByLabel(/^Opmerking /).first()).toHaveValue('2 stuks');
  await page.goBack();
  await vraag(page).getByRole('button', { name: 'Niet bewaren' }).click();
  await expect(fiche(page)).toHaveCount(0);
  await expect.poll(() => pad(page)).toBe(LIJST);
  await schoon(page);
  await terugVerlaatHetPortaal(page);
});

test('verwijderd record: na herladen dezelfde nette melding', async ({ page }) => {
  let weg = false;
  const extra: Extra = (p) => (p.endsWith('/api/vehicles') ? (weg ? VEHICLES.filter((v) => v.id !== 'v26') : VEHICLES) : undefined);
  await seed(page, { user: ADMIN, extra });
  await page.goto(`${LIJST}/v26`);
  await expect(fiche(page)).toBeVisible({ timeout: 15_000 });
  weg = true;
  await page.reload();
  await expect(onbekend(page)).toBeVisible({ timeout: 15_000 });
  await expect(fiche(page)).toHaveCount(0);
});

test('gele boek "Open bus": fiche open, terug sluit ze, nog eens terug = gele boek', async ({ page }) => {
  await seed(page, { user: ADMIN });
  await page.goto('/techniek/defecten');
  await expect(page.getByRole('heading', { name: 'Gele boek', level: 1 })).toBeVisible();
  await page.getByRole('button', { name: 'Meer acties' }).first().click();
  await page.getByRole('menuitem', { name: 'Open bus' }).click();
  await expect(fiche(page)).toBeVisible();
  expect(pad(page)).toBe(`${LIJST}/v26`);
  await page.goBack();
  await expect(fiche(page)).toHaveCount(0);
  await expect.poll(() => pad(page)).toBe(LIJST);
  await schoon(page);
  await page.goBack();
  await expect.poll(() => pad(page)).toBe('/techniek/defecten');
});
