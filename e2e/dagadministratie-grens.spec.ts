import { test, expect } from '@playwright/test';
import { ADMIN, historiekOpgeruimd, kanScrollen, seed } from './helpers';
import { DAG_PRESTATIES } from '../scripts/audit-fixtures.mjs';

/**
 * Dagadministratie tot en met vandaag (Jarno 23-09), desktop en iPhone:
 * het verleden blijft bewerkbaar, de toekomst niet. De grens is de
 * Brusselse kalenderdag (Playwright draait in Europe/Brussels).
 */
const brussel = (plus = 0) => {
  const d = new Date(Date.now() + plus * 864e5);
  return d.toLocaleDateString('en-CA', { timeZone: 'Europe/Brussels' });
};
const dmj = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const MELDING = 'Dagadministratie kan enkel tot en met vandaag worden aangepast.';

async function metSchrijfacties(page: import('@playwright/test').Page) {
  const schrijf: string[] = [];
  await seed(page, { user: ADMIN, extra: (p, req) => { if (req.method() !== 'GET' && p.includes('/api/dagafsluiting')) schrijf.push(`${req.method()} ${p}`); return undefined; } });
  return schrijf;
}

test('historische dag en vandaag: open; volgende dag stopt bij vandaag', async ({ page }) => {
  await metSchrijfacties(page);
  const oud = brussel(-40);
  await page.goto(`/beheer/dagadministratie/${oud}`);
  const dag = page.getByLabel('Dag', { exact: true });
  await expect(dag).toHaveValue(dmj(oud));
  await expect(page.getByRole('button', { name: 'Volgende dag' })).toBeEnabled();

  await page.goto(`/beheer/dagadministratie/${brussel(0)}`);
  await expect(dag).toHaveValue(dmj(brussel(0)));
  await expect(page.getByRole('button', { name: 'Volgende dag' })).toBeDisabled();
});

test('morgen typen: melding, de vorige dag blijft, geen schrijfactie', async ({ page }) => {
  const schrijf = await metSchrijfacties(page);
  const gisteren = brussel(-1);
  await page.goto(`/beheer/dagadministratie/${gisteren}`);
  const dag = page.getByLabel('Dag', { exact: true });
  await dag.fill(dmj(brussel(1)));
  await dag.press('Enter');
  await expect(page.getByText(`${MELDING} De vorige datum blijft staan.`)).toBeVisible();
  await expect(dag).toHaveValue(dmj(gisteren));
  await expect(page).toHaveURL(new RegExp(`/beheer/dagadministratie/${gisteren}$`));
  // In de kalender zijn dagen na vandaag uitgeschakeld.
  await dag.locator('xpath=following-sibling::button[1]').click();
  const kalender = page.getByRole('dialog', { name: 'Dag' });
  await expect(kalender.locator(`[data-iso="${brussel(1)}"]`)).toBeDisabled();
  expect(schrijf).toEqual([]);
});

test('een link naar een dag in de toekomst gaat naar vandaag, met de melding', async ({ page }) => {
  const schrijf = await metSchrijfacties(page);
  await page.goto(`/beheer/dagadministratie/${brussel(5)}`);
  await expect(page.getByText(MELDING)).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/beheer/dagadministratie/${brussel(0)}$`));
  await expect(page.getByLabel('Dag', { exact: true })).toHaveValue(dmj(brussel(0)));
  expect(schrijf.filter((s) => s.includes(brussel(5)))).toEqual([]);
});

/**
 * Afsluiten en door (ronde 6, 11-11): de bevestiging van het afsluiten heeft
 * een tweede knop die na een GESLAAGDE afsluiting naar de volgende dag gaat,
 * hoogstens tot en met vandaag. Op een afgesloten dag staat "Volgende dag"
 * ook in de kop. De gedeelde fixtures: eergisteren afgesloten, gisteren open,
 * vandaag nog niet geopend.
 */
const dagRecord = (datum: string, status: 'open' | 'afgesloten') => ({
  datum, status, geopendOp: new Date().toISOString(), geopendDoor: '1',
  afgeslotenOp: status === 'afgesloten' ? new Date().toISOString() : null, afgeslotenDoor: status === 'afgesloten' ? '1' : null,
  heropendOp: null, heropendDoor: null, heropendReden: null,
});

/** Sessie + mocks; het afsluiten slaagt en elke aanroep ervan wordt geteld. */
async function metAfsluiten(page: import('@playwright/test').Page, opties: { vandaagOpen?: boolean } = {}) {
  const afsluit: string[] = [];
  await seed(page, {
    user: ADMIN,
    view: 'dagafsluiting',
    extra: (p, req) => {
      if (p.endsWith('/afsluiten') && req.method() === 'POST') { afsluit.push(p); return dagRecord(p.split('/').slice(-2)[0], 'afgesloten'); }
      if (opties.vandaagOpen && req.method() === 'GET' && p.endsWith(`/api/dagafsluiting/${brussel(0)}`)) {
        return { dag: dagRecord(brussel(0), 'open'), rijen: DAG_PRESTATIES.map((r) => ({ ...r, datum: brussel(0) })), planningAfwijkingen: [], ontbrekendeCodes: [], inPlanning: true };
      }
      return undefined;
    },
  });
  return afsluit;
}

/** De kop van het scherm (PageHeader): daar staan de acties van de dag. */
const kop = (page: import('@playwright/test').Page) => page.locator('header').filter({ has: page.getByRole('heading', { level: 1, name: 'Dagadministratie' }) });

test('Afsluiten en volgende dag: één afsluit-aanroep, daarna staat de volgende dag er', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));
  const afsluit = await metAfsluiten(page);
  const gisteren = brussel(-1);
  const vandaag = brussel(0);
  await page.goto(`/beheer/dagadministratie/${gisteren}`);
  await expect(page.getByText('3 rijen')).toBeVisible({ timeout: 15_000 });

  await page.getByRole('button', { name: 'Dag afsluiten' }).click();
  const venster = page.getByRole('dialog', { name: 'Dag afsluiten' });
  // De gewone knop blijft er; de tweede staat ernaast.
  await expect(venster.getByRole('button', { name: 'Afsluiten', exact: true })).toBeVisible();
  await venster.getByRole('button', { name: 'Afsluiten en volgende dag' }).click();

  // De volgende dag (vandaag, nog niet geopend), ook in de adresbalk.
  await expect(page).toHaveURL(new RegExp(`/beheer/dagadministratie/${vandaag}$`));
  const dag = page.getByLabel('Dag', { exact: true });
  await expect(dag).toHaveValue(dmj(vandaag));
  await expect(page.getByRole('button', { name: 'Dag openen' })).toBeVisible();
  await expect(page.getByText('3 rijen')).toHaveCount(0);
  // Vandaag is de laatste dag: de pijl staat uit en de kop heeft geen eigen knop.
  await expect(page.getByRole('button', { name: 'Volgende dag', exact: true })).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Volgende dag', exact: true })).toBeDisabled();

  // Het venster is weg en zijn stap in de historiek ook; de dagwissel
  // overleeft dat opruimen (de terugstap mag de oude dag niet terugzetten).
  await kanScrollen(page);
  await historiekOpgeruimd(page);
  await expect(page).toHaveURL(new RegExp(`/beheer/dagadministratie/${vandaag}$`));
  await expect(dag).toHaveValue(dmj(vandaag));
  expect(afsluit).toEqual([`/api/dagafsluiting/${gisteren}/afsluiten`]);
  expect(pageErrors, `page errors:\n${pageErrors.join('\n')}`).toEqual([]);
});

test('vandaag afsluiten: geen "Afsluiten en volgende dag", en geen "Volgende dag" in de kop', async ({ page }) => {
  const afsluit = await metAfsluiten(page, { vandaagOpen: true });
  const vandaag = brussel(0);
  await page.goto(`/beheer/dagadministratie/${vandaag}`);
  await expect(page.getByText('3 rijen')).toBeVisible({ timeout: 15_000 });

  await page.getByRole('button', { name: 'Dag afsluiten' }).click();
  const venster = page.getByRole('dialog', { name: 'Dag afsluiten' });
  await expect(venster.getByRole('button', { name: 'Afsluiten', exact: true })).toBeVisible();
  await expect(venster.getByRole('button', { name: 'Afsluiten en volgende dag' })).toHaveCount(0);

  await venster.getByRole('button', { name: 'Afsluiten', exact: true }).click();
  await expect(page.getByText('Afgesloten', { exact: true })).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/beheer/dagadministratie/${vandaag}$`));
  await expect(kop(page).getByRole('button', { name: 'Volgende dag' })).toHaveCount(0);
  expect(afsluit).toEqual([`/api/dagafsluiting/${vandaag}/afsluiten`]);
});

test('mislukt het afsluiten, dan blijft de dag staan met de foutmelding en wisselt er niets', async ({ page }) => {
  const afsluit = await metAfsluiten(page);
  const gisteren = brussel(-1);
  // De gedeelde fixtures antwoorden altijd met 200; de weigering van de
  // server (iemand sloot de dag intussen af) komt daarom uit een eigen route.
  const geweigerd: string[] = [];
  await page.route('**/api/dagafsluiting/*/afsluiten', (route) => {
    geweigerd.push(new URL(route.request().url()).pathname);
    return route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: 'Deze dag is afgesloten. Heropen hem eerst.' }) });
  });
  await page.goto(`/beheer/dagadministratie/${gisteren}`);
  await expect(page.getByText('3 rijen')).toBeVisible({ timeout: 15_000 });

  await page.getByRole('button', { name: 'Dag afsluiten' }).click();
  const venster = page.getByRole('dialog', { name: 'Dag afsluiten' });
  await venster.getByRole('button', { name: 'Afsluiten en volgende dag' }).click();

  await expect(page.getByText('Afsluiten is mislukt. Deze dag is afgesloten. Heropen hem eerst.')).toBeVisible();
  // Zelfde dag, de bevestiging staat er nog, en de knoppen zijn weer bruikbaar.
  await expect(venster.getByRole('button', { name: 'Afsluiten en volgende dag' })).toBeEnabled();
  await expect(page).toHaveURL(new RegExp(`/beheer/dagadministratie/${gisteren}$`));
  await venster.getByRole('button', { name: 'Annuleren' }).click();
  await expect(venster).toHaveCount(0);
  await expect(page.getByLabel('Dag', { exact: true })).toHaveValue(dmj(gisteren));
  await expect(page.getByText('3 rijen')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Dag afsluiten' })).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/beheer/dagadministratie/${gisteren}$`));
  expect(geweigerd).toEqual([`/api/dagafsluiting/${gisteren}/afsluiten`]);
  expect(afsluit).toEqual([]);
});

/**
 * De laatste cel typen, "Dag afsluiten", door: komt de autosave van die cel
 * pas na de afsluiting aan, dan weigert de server hem (409). Het scherm mag
 * dan niet al op de volgende dag staan, anders is het enige spoor een toast
 * van tien seconden. Loopt er bij het afsluiten nog een cel (of is er een
 * mislukt), dan blijft de planner op de afgesloten dag en toont de cel haar
 * uitkomst.
 */
test('Afsluiten en volgende dag terwijl een cel nog bewaart: je blijft op de dag en de weigering staat bij de cel', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));
  const afsluit = await metAfsluiten(page);
  const gisteren = brussel(-1);
  // De PUT van de cel blijft hangen tot de test hem loslaat (een trage
  // opstart); intussen is de dag afgesloten en weigert de server hem.
  let laatLos = () => {};
  const wacht = new Promise<void>((klaar) => { laatLos = klaar; });
  const puts: string[] = [];
  await page.route('**/api/dagafsluiting/*/rijen/*', async (route) => {
    if (route.request().method() !== 'PUT') return route.fallback();
    puts.push(new URL(route.request().url()).pathname);
    await wacht;
    return route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: 'Deze dag is afgesloten. Heropen hem eerst.' }) });
  });
  await page.goto(`/beheer/dagadministratie/${gisteren}`);
  await expect(page.getByText('3 rijen')).toBeVisible({ timeout: 15_000 });

  const rij = page.getByRole('row').filter({ hasText: 'Test Chauffeur' });
  const over = rij.getByRole('textbox', { name: 'Overminuten', exact: true });
  await over.fill('45');
  await rij.getByRole('textbox', { name: 'Opmerking voor Test Chauffeur' }).focus();
  await expect.poll(() => puts.length).toBe(1);

  await page.getByRole('button', { name: 'Dag afsluiten' }).click();
  const venster = page.getByRole('dialog', { name: 'Dag afsluiten' });
  await venster.getByRole('button', { name: 'Afsluiten en volgende dag' }).click();

  // De afsluiting zelf is gelukt: het venster is weg en de dag is afgesloten.
  await expect(venster).toHaveCount(0);
  await expect(page.getByText('Afgesloten', { exact: true })).toBeVisible();
  expect(afsluit).toEqual([`/api/dagafsluiting/${gisteren}/afsluiten`]);
  // Maar het scherm wisselt niet, en zegt waarom; verder kan via de kop.
  await expect(page.getByText('Een cel was nog niet bewaard. Je blijft op deze dag, kijk de rijen na.')).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/beheer/dagadministratie/${gisteren}$`));
  await expect(page.getByLabel('Dag', { exact: true })).toHaveValue(dmj(gisteren));
  await expect(kop(page).getByRole('button', { name: 'Volgende dag' })).toBeVisible();

  // De weigering van de server staat bij de cel, op de dag zelf.
  laatLos();
  await expect(rij.getByText('Niet bewaard. Deze dag is afgesloten. Heropen hem eerst.')).toBeVisible();
  await expect(over).toHaveValue('45');
  await expect(page).toHaveURL(new RegExp(`/beheer/dagadministratie/${gisteren}$`));
  expect(puts).toEqual([`/api/dagafsluiting/${gisteren}/rijen/p1`]);
  expect(pageErrors, `page errors:\n${pageErrors.join('\n')}`).toEqual([]);
});

test('tijdens het afsluiten blijft de bevestiging staan: Escape en Annuleren sluiten haar niet', async ({ page }) => {
  await metAfsluiten(page);
  const gisteren = brussel(-1);
  // De afsluiting blijft hangen tot de test haar loslaat.
  let laatLos = () => {};
  const wacht = new Promise<void>((klaar) => { laatLos = klaar; });
  let gevraagd = 0;
  await page.route('**/api/dagafsluiting/*/afsluiten', async (route) => {
    gevraagd += 1;
    await wacht;
    return route.fallback();
  });
  await page.goto(`/beheer/dagadministratie/${gisteren}`);
  await expect(page.getByText('3 rijen')).toBeVisible({ timeout: 15_000 });

  await page.getByRole('button', { name: 'Dag afsluiten' }).click();
  const venster = page.getByRole('dialog', { name: 'Dag afsluiten' });
  await venster.getByRole('button', { name: 'Afsluiten', exact: true }).click();
  await expect.poll(() => gevraagd).toBe(1);

  await page.keyboard.press('Escape');
  await expect(venster).toBeVisible();
  await expect(venster.getByRole('button', { name: 'Annuleren' })).toBeDisabled();

  laatLos();
  await expect(venster).toHaveCount(0);
  await expect(page.getByText('Afgesloten', { exact: true })).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/beheer/dagadministratie/${gisteren}$`));
  expect(gevraagd).toBe(1);
});

test('een laat antwoord van een andere dag komt niet onder de dag in beeld', async ({ page }) => {
  await metSchrijfacties(page);
  const eergisteren = brussel(-2);
  const gisteren = brussel(-1);
  // Het laden van eergisteren (afgesloten) blijft hangen tot de test het loslaat.
  let laatLos = () => {};
  const wacht = new Promise<void>((klaar) => { laatLos = klaar; });
  let gevraagd = 0;
  await page.route(`**/api/dagafsluiting/${eergisteren}`, async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    gevraagd += 1;
    await wacht;
    return route.fallback();
  });
  await page.goto(`/beheer/dagadministratie/${gisteren}`);
  await expect(page.getByRole('button', { name: 'Dag afsluiten' })).toBeVisible({ timeout: 15_000 });

  // Een dag terug (laadt traag) en meteen weer vooruit naar gisteren.
  await page.getByRole('button', { name: 'Vorige dag' }).click();
  await expect.poll(() => gevraagd).toBe(1);
  await page.getByRole('button', { name: 'Volgende dag', exact: true }).click();
  const dag = page.getByLabel('Dag', { exact: true });
  await expect(dag).toHaveValue(dmj(gisteren));
  await expect(page.getByRole('button', { name: 'Dag afsluiten' })).toBeVisible();

  // Nu pas komt eergisteren binnen: gisteren blijft staan zoals het is (open).
  const laat = page.waitForResponse((r) => r.url().endsWith(`/api/dagafsluiting/${eergisteren}`));
  laatLos();
  await (await laat).finished();
  await page.evaluate(() => new Promise((klaar) => requestAnimationFrame(() => requestAnimationFrame(() => klaar(null)))));
  await expect(page.getByText('Afgesloten', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Open', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Dag afsluiten' })).toBeVisible();
  await expect(dag).toHaveValue(dmj(gisteren));
});

test('afgesloten dag: "Volgende dag" in de kop gaat een dag verder, zonder schrijfactie', async ({ page }) => {
  const schrijf = await metSchrijfacties(page);
  const eergisteren = brussel(-2);
  const gisteren = brussel(-1);
  await page.goto(`/beheer/dagadministratie/${eergisteren}`);
  await expect(page.getByText('Afgesloten', { exact: true })).toBeVisible({ timeout: 15_000 });

  await kop(page).getByRole('button', { name: 'Volgende dag' }).click();
  await expect(page).toHaveURL(new RegExp(`/beheer/dagadministratie/${gisteren}$`));
  await expect(page.getByLabel('Dag', { exact: true })).toHaveValue(dmj(gisteren));
  // Gisteren is open: daar staat de afsluitknop en geen "Volgende dag" in de kop.
  await expect(page.getByRole('button', { name: 'Dag afsluiten' })).toBeVisible();
  await expect(kop(page).getByRole('button', { name: 'Volgende dag' })).toHaveCount(0);
  expect(schrijf).toEqual([]);
});
