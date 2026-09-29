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
 * staat in src/apiIntegration.test.ts (planning-import, ingepakt met gzip).
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
