import { test, expect, type Page } from '@playwright/test';
import { ADMIN, CHAUFFEUR, seed } from './helpers';
import { dayOffset, PLANNING } from '../scripts/audit-fixtures.mjs';

/**
 * De andere lijsten die met de tijd groeien (15-10, Jarno: "kijk alle andere
 * zaken ook na"): gele boek (25 per stap, een dichte tabel), werkprestaties
 * (per dag), documenten en het verleden in het rooster tonen een deel, met
 * "Toon … oudere" en de teller eronder.
 */

const knop = (page: Page, tekst: RegExp) => page.getByRole('button', { name: tekst });
const dagenGeleden = (n: number) => new Date(Date.now() - n * 864e5).toISOString();

test('gele boek: 25 meldingen tegelijk', async ({ page }) => {
  const defecten = Array.from({ length: 30 }, (_, i) => ({
    id: `d${i}`, vehicleId: 'v26', busnr: '613 026', kortNr: 26, gemeldOp: dagenGeleden(i + 1), gemeldDoor: '42', gemeldDoorNaam: 'Test Chauffeur',
    werktype: 'T', omschrijving: `Defect ${i + 1}`, status: 'open', uitgevoerdOp: null, uitgevoerdDoor: null, uitgevoerdWerk: null, manuren: null, opmerking: null,
  }));
  await seed(page, { user: ADMIN, view: 'defecten', extra: (p) => (p.endsWith('/api/defecten') ? defecten : undefined) });
  await page.goto('/techniek/defecten');
  await expect(knop(page, /^Toon 5 oudere/)).toContainText('25 van 30');
  await knop(page, /^Toon 5 oudere/).click();
  await expect(knop(page, /^Toon \d+ oudere/)).toHaveCount(0);
});

test('werkprestaties (staf): tien dagen tegelijk', async ({ page }) => {
  const prestaties = Array.from({ length: 14 }, (_, i) => ({
    id: `w${i}`, datum: dayOffset(-i), mecanicienId: '55', mecanicienNaam: 'Jelle Technieker', vehicleId: null, busnr: null, kortNr: null,
    werkcode: 'A', omschrijving: `Werk ${i + 1}`, beginTijd: null, eindeTijd: null, werkuren: 1, kmstand: null, defectId: null,
  }));
  await seed(page, { user: ADMIN, view: 'werkprestaties', extra: (p) => (p.endsWith('/api/werkprestaties') ? prestaties : undefined) });
  await page.goto('/techniek/prestaties');
  await expect(knop(page, /^Toon 4 oudere/)).toContainText('10 van 14');
  await knop(page, /^Toon 4 oudere/).click();
  await expect(knop(page, /^Toon \d+ oudere/)).toHaveCount(0);
});

test('documenten: tien tegelijk, het nieuwste eerst', async ({ page }) => {
  const documenten = Array.from({ length: 13 }, (_, i) => ({
    id: `doc${i}`, userId: '42', filename: `loonbrief-${String(13 - i).padStart(2, '0')}.pdf`, storagePath: `42/${i}`,
    uploadedAt: dagenGeleden(i * 30), category: 'Loonbrief', sizeBytes: 12_000, url: null, openedAt: null,
  }));
  await seed(page, { user: CHAUFFEUR, view: 'documenten', extra: (p) => (p.endsWith('/api/documents') ? documenten : undefined) });
  await page.goto('/documenten');
  await expect(knop(page, /^Toon 3 oudere/).first()).toContainText('10 van 13');
});

test('rooster: het verleden toont de jongste tien diensten, dan tien per tik', async ({ page }) => {
  const verleden = Array.from({ length: 14 }, (_, i) => ({
    id: `p${i}`, date: dayOffset(-(i + 1)), startTime: '06:00', endTime: '14:00', line: String(2101 + i), busNumber: '', loopnr: '4500', driverId: '42',
  }));
  await seed(page, { user: CHAUFFEUR, view: 'rooster', extra: (p) => (p.endsWith('/api/planning') ? [...PLANNING, ...verleden] : undefined) });
  await page.goto('/rooster');
  await knop(page, /^Toon verleden/).click();
  await expect(knop(page, /^Toon \d+ oudere/)).toContainText(/10 van 1\d/);
  await knop(page, /^Toon \d+ oudere/).click();
  await expect(knop(page, /^Toon \d+ oudere/)).toHaveCount(0);
});
