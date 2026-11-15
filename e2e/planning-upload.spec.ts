import { test, expect, type Page } from '@playwright/test';
import { gunzipSync } from 'node:zlib';
import * as XLSX from 'xlsx';
import { ADMIN, seed } from './helpers';

/**
 * Planning uploaden met een werkmap boven het breekpunt van 29-09. Het .xls
 * ging als base64 in JSON en werd 4/3 groter: boven de 4,5 MB request body die
 * een Vercel-functie aanneemt, en het platform weigerde met een 413 zonder
 * JSON ("Maak het bestand kleiner"). De browser pakt het bestand nu in met
 * gzip (src/lib/bestandInpakken.ts). De API is hier nagebootst; de server-kant
 * staat in src/apiIntegratie/ (planning-import, ingepakt met gzip).
 */

const MB = ' MB';

/** Synthetische werkmap zoals die van de planning (tabblad "praktijk" plus
 *  vulbladen), als .xls boven 4 MiB. Verzonnen namen, vaste inhoud. */
let grootXlsCache: Buffer | null = null;
const grootXls = (): Buffer => {
  if (grootXlsCache) return grootXlsCache;
  let x = 20260929;
  const kans = () => { x = (Math.imul(x, 1103515245) + 12345) >>> 0; return x / 2 ** 32; };
  const CODES = ['2101', '2102', '2103', 'V', ''];
  const kies = () => CODES[Math.floor(kans() * CODES.length)];
  const chauffeurs = Array.from({ length: 24 }, (_, i) => `Testchauffeur ${String(i + 1).padStart(2, '0')}`);
  const praktijk: unknown[][] = [['datum', 'dagtype', ...chauffeurs, 'aantal']];
  // 47727 = 01/09/2030 als Excel-serial (dagen sinds 30/12/1899).
  for (let d = 0; d < 123; d++) praktijk.push([47727 + d, 'schooldag', ...chauffeurs.map(kies), 0]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(praktijk), 'praktijk');
  for (let s = 1; s <= 8; s++) {
    const blad: unknown[][] = [Array.from({ length: 20 }, (_, c) => `kolom ${c + 1}`)];
    for (let r = 0; r < 1500; r++) blad.push(Array.from({ length: 20 }, (_, c) => (c % 3 === 0 ? kies() : Math.round(kans() * 100000) / 100)));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(blad), `vulblad ${s}`);
  }
  grootXlsCache = XLSX.write(wb, { type: 'buffer', bookType: 'biff8' }) as Buffer;
  return grootXlsCache;
};

const VOORBEELD = {
  importedDays: 123, detectedDrivers: 24, generatedShifts: 1800, matchedServices: 1800, skippedAbsences: 0,
  startDate: '2030-09-01', endDate: '2031-01-01', fileStartDate: '2030-09-01', fileEndDate: '2031-01-01',
  importedDates: [], existingStart: null, existingEnd: null, replacedExistingDays: 0, retainedDays: 0,
  unknownCodes: [], unmatchedDrivers: [], verlofConflicts: [], ziekteDiensten: [], servicesWithoutSegments: [],
  perDriver: [], parserWaarschuwingen: [], chauffeursNieuw: [], chauffeursVerdwenen: [], ziekTeRegistreren: [], verwachtingsCheck: [],
};

const openBeheerPlanning = async (page: Page) => {
  await seed(page, { user: ADMIN });
  await page.goto('/beheer/planning');
  await expect(page.getByRole('heading', { name: 'Beheer planning', level: 1 })).toBeVisible({ timeout: 15_000 });
};
const kiesBestand = (page: Page, buffer: Buffer) =>
  page.locator('input[type="file"][accept*=".xls"]').setInputFiles({ name: 'Dienstregeling test.xls', mimeType: 'application/vnd.ms-excel', buffer });
const foutmelding = (page: Page) => page.getByRole('status').filter({ hasText: 'Excel-voorbeeld maken is mislukt.' });

test('een .xls boven 4 MB gaat gecomprimeerd onder de 4,5 MB, en het voorbeeld opent', async ({ page }) => {
  const bestand = grootXls();
  expect(bestand.length).toBeGreaterThanOrEqual(4 * 1024 * 1024);
  const verzoeken: Array<{ bytes: number; velden: string[]; uitgepakt: Buffer | null }> = [];
  await openBeheerPlanning(page);
  // Na seed geregistreerd, dus deze route wint van de algemene mock.
  await page.route('**/api/planning-matrix/preview', async (route) => {
    const body = route.request().postDataBuffer() ?? Buffer.alloc(0);
    const json = JSON.parse(body.toString('utf8'));
    verzoeken.push({
      bytes: body.length,
      velden: Object.keys(json),
      uitgepakt: typeof json.xlsxGzipBase64 === 'string' ? gunzipSync(Buffer.from(json.xlsxGzipBase64, 'base64')) : null,
    });
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(VOORBEELD) });
  });

  await kiesBestand(page, bestand);
  await expect(page.getByRole('dialog').getByText('Controleer voor je deze periode vervangt')).toBeVisible({ timeout: 15_000 });
  expect(verzoeken).toHaveLength(1);
  expect(verzoeken[0].velden).toEqual(['xlsxGzipBase64']);
  expect(verzoeken[0].bytes).toBeLessThan(4_500_000);
  // Wat de browser inpakte, is uitgepakt exact het gekozen bestand.
  expect(verzoeken[0].uitgepakt?.equals(bestand)).toBe(true);
});

test('een 413 van het platform zonder JSON zegt dat het ook gecomprimeerd te groot is, met de grens', async ({ page }) => {
  await openBeheerPlanning(page);
  await page.route('**/api/planning-matrix/preview', (route) =>
    route.fulfill({ status: 413, contentType: 'text/plain', body: 'Request Entity Too Large\n\nFUNCTION_PAYLOAD_TOO_LARGE\n' }));

  await kiesBestand(page, Buffer.from('synthetische werkmap'));
  await expect(foutmelding(page)).toContainText(`De server weigerde het bestand: ook gecomprimeerd is het verzoek groter dan de 4,5${MB} die hij aanneemt.`);
  await expect(foutmelding(page)).not.toContainText('Maak het bestand kleiner');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('zonder CompressionStream vertrekt een te groot bestand niet, en de melding noemt grootte, grens en wat te doen', async ({ page }) => {
  await page.addInitScript(() => { delete (window as { CompressionStream?: unknown }).CompressionStream; });
  let verstuurd = 0;
  await openBeheerPlanning(page);
  await page.route('**/api/planning-matrix/preview', (route) => {
    verstuurd += 1;
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(VOORBEELD) });
  });

  await kiesBestand(page, grootXls());
  await expect(foutmelding(page)).toContainText(`zonder compressie neemt de server hoogstens 3,3${MB} aan.`);
  await expect(foutmelding(page)).toContainText('Gebruik een recente browser of bewaar het bestand als .xlsx');
  expect(verstuurd).toBe(0);
});

// --- Het plan per chauffeur per dag in het voorbeeld (ronde 6, punt 18) ------
//
// De server rekent het plan (src/apiIntegratie/planning.test.ts bewijst dat het
// is wat de import doet); hier alleen wat het scherm ermee doet.

const dienst = (nr: string, van: string, tot: string) => `dienst ${nr}, ${van} tot ${tot}`;
const PLAN = {
  diensten: 1800, dagenInMatrix: 123, periode: { van: '2030-09-01', tot: '2031-01-01' },
  ruilen: { toegepast: 0, nietToepasbaar: 1 },
  chauffeurs: [
    { id: 'c1', naam: 'Testchauffeur 01', dagen: [{ dag: '2030-09-16', was: [dienst('2101', '05:42', '13:10')], wordt: [], soort: 'weg' }] },
    { id: 'c2', naam: 'Testchauffeur 02', dagen: [{ dag: '2030-09-16', was: [], wordt: [dienst('2101', '05:42', '13:10')], soort: 'erbij' }] },
    { id: 'c3', naam: 'Testchauffeur 03', dagen: [
      { dag: '2030-09-17', was: [dienst('2102', '06:10', '14:02')], wordt: [dienst('2103', '13:55', '21:40')], soort: 'gewijzigd' },
      { dag: '2030-09-18', was: [dienst('2102', '06:10', '14:02')], wordt: [dienst('2103', '13:55', '21:40')], soort: 'gewijzigd' },
    ] },
  ],
  totaal: { chauffeurs: 3, dagen: 4, erbij: 1, weg: 1, gewijzigd: 2 },
};
const GEEN_WIJZIGINGEN = { ...PLAN, chauffeurs: [], totaal: { chauffeurs: 0, dagen: 0, erbij: 0, weg: 0, gewijzigd: 0 } };
const planVan = (naam: string) => ({
  ...PLAN,
  chauffeurs: [{ id: naam, naam, dagen: [{ dag: '2030-09-16', was: [], wordt: [dienst('2101', '05:42', '13:10')], soort: 'erbij' }] }],
  totaal: { chauffeurs: 1, dagen: 1, erbij: 1, weg: 0, gewijzigd: 0 },
});
const RUIL = { id: 's-1', van: 'Testchauffeur 04', naar: 'Testchauffeur 01', dienst: '2101', dag: '2030-09-16', been: 'aangeboden', dienstBij: ['Testchauffeur 02'], handmatig: false };

const voorbeeldMet = (page: Page, antwoord: Record<string, unknown>) =>
  page.route('**/api/planning-matrix/preview', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(antwoord) }));
const venster = (page: Page) => page.getByRole('dialog').filter({ hasText: 'Controleer voor je deze periode vervangt' });
const planVak = (page: Page) => venster(page).getByRole('region', { name: 'Wat verandert voor de chauffeurs' });
const importKnop = (page: Page) => venster(page).getByRole('button', { name: 'Vervang deze periode' });
const KLEIN = Buffer.from('synthetische werkmap');
const GRENS = 'Codes zonder uren (bureau, schoolrit, garage) en ruilen daarvan staan niet in dit overzicht.';

test('het voorbeeld toont per chauffeur de dagen die veranderen, de waarschuwing over de ruil en de knop blijven', async ({ page }) => {
  await openBeheerPlanning(page);
  await voorbeeldMet(page, { ...VOORBEELD, ruilenNietToepasbaar: [RUIL], plan: PLAN });
  await kiesBestand(page, KLEIN);

  const vak = planVak(page);
  await expect(vak).toBeVisible({ timeout: 15_000 });
  await expect(vak).toContainText('3 chauffeurs, 4 dagen veranderen (1 erbij, 1 weg, 2 gewijzigd).');
  // De ruil die de import zou terugdraaien: de dienst gaat weg bij wie hem kreeg en komt bij een derde.
  const rijen = vak.getByRole('listitem');
  await expect(rijen.filter({ hasText: 'Testchauffeur 01' }).first()).toContainText('16/09/2030');
  await expect(rijen.filter({ hasText: 'Testchauffeur 01' }).first()).toContainText('weg');
  await expect(rijen.filter({ hasText: 'Testchauffeur 02' }).first()).toContainText('erbij');
  await expect(rijen.filter({ hasText: 'Testchauffeur 03' }).first()).toContainText('dienst 2102, 06:10 tot 14:02, wordt dienst 2103, 13:55 tot 21:40');
  await expect(vak.getByRole('button', { name: /Toon/ })).toHaveCount(0);
  // Onder elk plan staat wat er niet in staat: codes zonder uren hebben geen rijen in de planning.
  await expect(vak).toContainText(GRENS);
  // De bestaande waarschuwing en de knop staan er zoals altijd.
  await expect(venster(page).getByText('Doorgevoerde ruilen die niet in deze Excel passen')).toBeVisible();
  await expect(venster(page).getByText('Klaar voor import')).toBeVisible();
  await expect(importKnop(page)).toBeEnabled();
});

test('verandert er niets, dan zegt het voorbeeld dat; zonder plan staat er één neutrale regel en kan de import gewoon door', async ({ page }) => {
  await openBeheerPlanning(page);
  await voorbeeldMet(page, { ...VOORBEELD, plan: GEEN_WIJZIGINGEN });
  await kiesBestand(page, KLEIN);
  // Het plan vergelijkt de rijen van de planning: de lege staat belooft dus
  // alleen iets over de diensten met uren, en zegt erbij wat er niet in staat
  // (een schoolrit of bureaudag die van chauffeur wisselt; tegenlezing ronde 6).
  await expect(planVak(page)).toContainText('Geen wijzigingen in de diensten met uren.', { timeout: 15_000 });
  await expect(planVak(page)).not.toContainText('Geen wijzigingen voor de chauffeurs');
  await expect(planVak(page)).toContainText(GRENS);
  await expect(importKnop(page)).toBeEnabled();
  await venster(page).getByRole('button', { name: 'Annuleren' }).click();
  await expect(venster(page)).toHaveCount(0);

  // Geen plan in het antwoord, een plan dat null is, of een plan in een
  // onverwachte vorm: nooit "geen wijzigingen", nooit een halve lijst.
  const kapot = [
    VOORBEELD,
    { ...VOORBEELD, plan: null },
    { ...VOORBEELD, plan: { chauffeurs: [], totaal: {} } },
    { ...VOORBEELD, plan: { ...PLAN, totaal: { ...PLAN.totaal, chauffeurs: 0 } } },
    { ...VOORBEELD, plan: { ...PLAN, chauffeurs: [{ id: 'c1', naam: 'Testchauffeur 01', dagen: [{ dag: 'morgen', was: [], wordt: ['x'], soort: 'erbij' }] }], totaal: { chauffeurs: 1, dagen: 1, erbij: 1, weg: 0, gewijzigd: 0 } } },
  ];
  for (const antwoord of kapot) {
    await page.unroute('**/api/planning-matrix/preview');
    await voorbeeldMet(page, antwoord);
    await kiesBestand(page, KLEIN);
    await expect(planVak(page)).toContainText('Het verschil per chauffeur kon niet berekend worden.', { timeout: 15_000 });
    await expect(planVak(page)).not.toContainText('Geen wijzigingen');
    // Zonder plan ook geen regel over wat er niet in staat.
    await expect(planVak(page)).not.toContainText(GRENS);
    await expect(planVak(page).getByRole('listitem')).toHaveCount(0);
    await expect(importKnop(page)).toBeEnabled();
    await venster(page).getByRole('button', { name: 'Annuleren' }).click();
    await expect(venster(page)).toHaveCount(0);
  }
});

test('een geblokkeerde import toont geen plan', async ({ page }) => {
  await openBeheerPlanning(page);
  await voorbeeldMet(page, { ...VOORBEELD, unknownCodes: ['xyz'], plan: null });
  await kiesBestand(page, KLEIN);
  await expect(venster(page).getByText('Import geblokkeerd')).toBeVisible({ timeout: 15_000 });
  await expect(planVak(page)).toHaveCount(0);
  await expect(venster(page).getByText('Het verschil per chauffeur kon niet berekend worden.')).toHaveCount(0);
});

test('een lang plan: de eerste tien chauffeurs, de rest met Toon meer', async ({ page }) => {
  const chauffeurs = Array.from({ length: 12 }, (_, i) => ({
    id: `c${i + 1}`, naam: `Testchauffeur ${String(i + 1).padStart(2, '0')}`,
    dagen: [{ dag: '2030-09-16', was: [], wordt: [dienst('2101', '05:42', '13:10')], soort: 'erbij' }],
  }));
  await openBeheerPlanning(page);
  await voorbeeldMet(page, { ...VOORBEELD, plan: { ...PLAN, chauffeurs, totaal: { chauffeurs: 12, dagen: 12, erbij: 12, weg: 0, gewijzigd: 0 } } });
  await kiesBestand(page, KLEIN);

  const vak = planVak(page);
  await expect(vak).toContainText('12 chauffeurs, 12 dagen veranderen (12 erbij).', { timeout: 15_000 });
  await expect(vak.getByText('Testchauffeur 10', { exact: true })).toBeVisible();
  await expect(vak.getByText('Testchauffeur 11', { exact: true })).toHaveCount(0);
  const meer = vak.getByRole('button', { name: /Toon 2 meer/ });
  await expect(meer).toContainText('10 van 12');
  await meer.click();
  await expect(vak.getByText('Testchauffeur 12', { exact: true })).toBeVisible();
  await expect(vak.getByRole('button', { name: /Toon/ })).toHaveCount(0);
  // Meer tonen is geen beslissing: de knop Importeren staat waar hij stond.
  await expect(importKnop(page)).toBeEnabled();
});

test('een ander bestand terwijl het vorige nog rekent: alleen het antwoord van het laatste bestand telt', async ({ page }) => {
  await openBeheerPlanning(page);
  let laatLos: () => void = () => {};
  const vastgehouden = new Promise<void>((klaar) => { laatLos = klaar; });
  let uploads = 0;
  let laatAntwoordVerstuurd = false;
  await page.route('**/api/planning-matrix/preview', async (route) => {
    const body = JSON.parse(route.request().postData() ?? '{}');
    if (body.periode) {
      // De herberekening van het EERSTE bestand: komt pas terug nadat het tweede bestand er al staat.
      await vastgehouden;
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...VOORBEELD, startDate: body.periode.van, generatedShifts: 111, plan: planVan('Vorig Bestand') }) });
      laatAntwoordVerstuurd = true;
      return;
    }
    uploads += 1;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...VOORBEELD, plan: planVan(uploads === 1 ? 'Eerste Bestand' : 'Tweede Bestand') }) });
  });

  await kiesBestand(page, KLEIN);
  await expect(planVak(page)).toContainText('Eerste Bestand', { timeout: 15_000 });
  // Een andere periode: het plan van de vorige periode verdwijnt meteen.
  const van = venster(page).getByLabel('Van', { exact: true });
  await van.fill('02/09/2030');
  await van.press('Enter');
  await expect(planVak(page)).toContainText('Het verschil per chauffeur wordt opnieuw berekend…');
  await expect(planVak(page)).not.toContainText('Eerste Bestand');
  await expect(importKnop(page)).toBeDisabled();

  // Het venster sluiten en een ander bestand kiezen terwijl die herberekening nog loopt.
  await van.blur();
  await page.keyboard.press('Escape');
  await expect(venster(page)).toHaveCount(0);
  await kiesBestand(page, Buffer.from('een andere werkmap'));
  await expect(planVak(page)).toContainText('Tweede Bestand', { timeout: 15_000 });

  // Nu pas komt het antwoord van het eerste bestand: het raakt niets meer.
  laatLos();
  await expect.poll(() => laatAntwoordVerstuurd).toBe(true);
  await page.waitForTimeout(400);
  await expect(planVak(page)).toContainText('Tweede Bestand');
  await expect(venster(page)).not.toContainText('Vorig Bestand');
  await expect(venster(page).getByLabel('Van', { exact: true })).toHaveValue('01/09/2030');
  // En de knop wacht niet eeuwig op een herberekening die niet meer meetelt.
  await expect(importKnop(page)).toBeEnabled();
});

test('mislukt de herberekening voor een andere periode, dan staat er geen plan van de vorige periode', async ({ page }) => {
  await openBeheerPlanning(page);
  await page.route('**/api/planning-matrix/preview', (route) => {
    const body = JSON.parse(route.request().postData() ?? '{}');
    return body.periode
      ? route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Import-voorbeeld maken is mislukt.' }) })
      : route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...VOORBEELD, plan: PLAN }) });
  });
  await kiesBestand(page, KLEIN);
  await expect(planVak(page)).toContainText('Testchauffeur 03', { timeout: 15_000 });

  const van = venster(page).getByLabel('Van', { exact: true });
  await van.fill('02/09/2030');
  await van.press('Enter');
  await expect(planVak(page)).toContainText('Het verschil per chauffeur kon niet berekend worden.');
  await expect(planVak(page)).not.toContainText('Testchauffeur');
  await expect(planVak(page)).not.toContainText(GRENS);
});

test('Opnieuw proberen van een mislukte herberekening raakt het voorbeeld van een ander bestand niet', async ({ page }) => {
  await openBeheerPlanning(page);
  let uploads = 0;
  let herberekeningen = 0;
  await page.route('**/api/planning-matrix/preview', (route) => {
    const body = JSON.parse(route.request().postData() ?? '{}');
    if (body.periode) {
      herberekeningen += 1;
      // De eerste herberekening mislukt; een volgende zou het plan van het EERSTE bestand geven.
      return herberekeningen === 1
        ? route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Import-voorbeeld maken is mislukt.' }) })
        : route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...VOORBEELD, startDate: body.periode.van, generatedShifts: 111, plan: planVan('Vorig Bestand') }) });
    }
    uploads += 1;
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...VOORBEELD, plan: planVan(uploads === 1 ? 'Eerste Bestand' : 'Tweede Bestand') }) });
  });

  await kiesBestand(page, KLEIN);
  await expect(planVak(page)).toContainText('Eerste Bestand', { timeout: 15_000 });
  const van = venster(page).getByLabel('Van', { exact: true });
  await van.fill('02/09/2030');
  await van.press('Enter');
  const opnieuw = page.getByRole('button', { name: 'Opnieuw proberen' });
  await expect(opnieuw).toBeVisible();

  // Het venster sluiten en een ander bestand kiezen; de melding van het vorige bestand staat er nog.
  await van.blur();
  await page.keyboard.press('Escape');
  await expect(venster(page)).toHaveCount(0);
  await kiesBestand(page, Buffer.from('een andere werkmap'));
  await expect(planVak(page)).toContainText('Tweede Bestand', { timeout: 15_000 });
  await expect(opnieuw).toBeVisible();
  await opnieuw.click();

  // Die knop hoort bij het vorige bestand: er vertrekt niets en er verandert niets.
  await page.waitForTimeout(400);
  expect(herberekeningen).toBe(1);
  await expect(planVak(page)).toContainText('Tweede Bestand');
  await expect(venster(page)).not.toContainText('Vorig Bestand');
  await expect(venster(page).getByLabel('Van', { exact: true })).toHaveValue('01/09/2030');
  await expect(importKnop(page)).toBeEnabled();
});

// --- Het herstel van een import noemt overal hetzelfde moment (ronde 6, punt 8, deel 3) ---
//
// De importlijst, de bevestiging van "Zet terug" en de melding erna noemen de
// import waarnaar de planning teruggaat. Ze schreven dat moment elk anders
// ("05/11/2026, 00:30" in de lijst en de bevestiging, "05/11, 00:30" in de
// melding) en de laatste import stond er als "9/11/2026, 08:15". Nu overal het
// ene tijdstip van src/lib/format.ts op dezelfde createdAt: de Brusselse dag
// en het Brusselse uur, ook voor een import om 23:30 UTC (bij ons al de
// volgende dag).

const importRij = (id: string, createdAt: string, filename: string) => ({
  id, createdAt, importedDays: 61, detectedDrivers: 24, generatedShifts: 1349, matchedServices: 1349, skippedAbsences: 0,
  unknownCodes: [], unmatchedDrivers: [], filename, importedBy: 'Jarno De Greve', periodStart: null, periodEnd: null,
  snapshotPath: `herstel/${id}.json`,
});
// De vorm van de server (PostgREST: microseconden en +00:00), het nieuwste eerst.
const IMPORTS = [
  importRij('i3', '2026-11-09T07:15:00.123456+00:00', 'november v2.xlsx'),
  importRij('i2', '2026-11-04T23:30:00.000000+00:00', 'november v1.xlsx'),
  importRij('i1', '2026-10-08T12:02:00.123456+00:00', 'oktober.xlsx'),
];

test('herstel: de importlijst, de bevestiging en de melding erna noemen hetzelfde moment, ook voor een import rond middernacht', async ({ page }) => {
  // Vaste klok in 2026: het jaartal staat er alleen buiten het lopende jaar bij.
  await page.clock.setFixedTime(new Date('2026-11-12T08:00:00Z'));
  const herstelVerzoeken: unknown[] = [];
  await seed(page, {
    user: ADMIN,
    extra: (pad, request) => {
      if (pad.endsWith('/api/planning-matrix/history')) return IMPORTS;
      if (pad.endsWith('/api/planning-matrix/changes-since-import')) return { lastImport: { createdAt: IMPORTS[0].createdAt, importedDays: 61 }, approvedLeave: [], approvedSwaps: [] };
      if (pad.endsWith('/api/planning-matrix/restore')) { herstelVerzoeken.push(request.postDataJSON()); return { ok: true }; }
      return undefined;
    },
  });
  await page.goto('/beheer/planning');
  await expect(page.getByRole('heading', { name: 'Beheer planning', level: 1 })).toBeVisible({ timeout: 15_000 });

  // De laatste import staat in dezelfde vorm, niet meer als "9/11/2026, 08:15".
  await expect(page.getByText(/Laatste import: /)).toContainText('Laatste import: ma 9 nov, 08:15.');

  // De importlijst: één rij per import, elk met haar moment.
  const rij = (bestand: string) => page.locator('div.surface-muted').filter({ hasText: bestand }).filter({ has: page.getByRole('button', { name: 'Zet terug' }) }).last();
  const momentVan = (bestand: string) => rij(bestand).locator('p.tabular-nums').first();
  await expect(momentVan('oktober.xlsx')).toHaveText('do 8 okt, 14:02');
  // 23:30 UTC op woensdag 4 november is in Brussel donderdag 5 november, 00:30.
  await expect(momentVan('november v1.xlsx')).toHaveText('do 5 nov, 00:30');
  const moment = (await momentVan('november v1.xlsx').innerText()).trim();

  // De bevestiging noemt de import waarnaar de planning teruggaat: exact dat moment.
  await rij('november v1.xlsx').getByRole('button', { name: 'Zet terug' }).click();
  const bevestiging = page.getByRole('dialog').filter({ hasText: 'Planning terugzetten?' });
  await expect(bevestiging).toContainText(`de stand van vóór de import van ${moment} (november v1.xlsx).`);
  await expect(bevestiging).toContainText('de import van do 5 nov, 00:30 (november v1.xlsx)');

  // En de melding na het herstel ook.
  await bevestiging.getByRole('button', { name: 'Zet terug' }).click();
  const melding = page.getByRole('status').filter({ hasText: 'Planning teruggezet' });
  await expect(melding).toContainText(`Planning teruggezet naar de stand van vóór de import van ${moment}.`);
  await expect(melding).toContainText('de import van do 5 nov, 00:30.');
  expect(herstelVerzoeken).toEqual([{ historyId: 'i2' }]);
  await expect(bevestiging).toHaveCount(0);
});
