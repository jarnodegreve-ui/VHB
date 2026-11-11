import { test, expect, type Page } from '@playwright/test';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { CHAUFFEUR, seed } from './helpers';
import { dayOffset, PLANNING } from '../scripts/audit-fixtures.mjs';

/**
 * J (24-09): een dienst is gereden na de eindtijd van haar laatste deel.
 * Tijdonafhankelijk (geen nagebootste klok: daaronder rendert het rooster
 * niet betrouwbaar): de test geeft zelf een dienst van vandaag mee die al
 * voorbij is (00:00–00:01) of die pas morgenvroeg eindigt (busvak "30:00").
 * De andere fixture-diensten van vandaag worden weggelaten.
 */
const andere = PLANNING.filter((s) => s.date !== dayOffset(0));
const vandaag = (startTime: string, endTime: string) => [...andere, { id: 't-j', date: dayOffset(0), startTime, endTime, line: '2101', busNumber: '', loopnr: '4500', driverId: '42' }];
const planning = (rijen: unknown[]) => (pad: string) => (pad.endsWith('/api/planning') ? rijen : undefined);

test('een dienst van vandaag die nog loopt telt als komend, met ruilknop', async ({ page }) => {
  await seed(page, { user: CHAUFFEUR, extra: planning(vandaag('05:00', '30:00')) });
  await page.goto('/rooster');
  await expect(page.getByRole('heading', { name: 'Rooster', level: 1 })).toBeVisible();
  await expect(page.getByRole('button', { name: /Toon verleden/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Deze dienst ruilen' })).toBeVisible();
});

test('een dienst van vandaag die voorbij is, is gereden: verleden, geen ruilknop', async ({ page }) => {
  await seed(page, { user: CHAUFFEUR, extra: planning(vandaag('00:00', '00:01')) });
  await page.goto('/rooster');
  await expect(page.getByRole('heading', { name: 'Rooster', level: 1 })).toBeVisible();
  await expect(page.getByRole('button', { name: /Toon verleden \(1\)/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Deze dienst ruilen' })).toHaveCount(0);
});

/**
 * Ronde 6 (11-11), kortere wegen. Twee dingen op hetzelfde scherm:
 * - alleen diensten in het verleden: de lijst was leeg op "Toon verleden" na;
 * - Ritblad op een dienst: de viewer start op de pagina's van dat
 *   dienstnummer in plaats van op de hele bundel.
 * Elke test brengt zijn eigen planning mee (dagen vóór of ná vandaag), zodat
 * het uur van de dag niet meespeelt.
 */
const dienst = (id: string, dag: number, startTime: string, endTime: string, line: string, loopnr = '') => ({ id, date: dayOffset(dag), startTime, endTime, line, busNumber: '', loopnr, driverId: '42' });

test.describe('rooster met alleen diensten in het verleden', () => {
  const VERLEDEN = [dienst('v1', -3, '06:12', '14:30', '4101', '4500'), dienst('v2', -1, '15:41', '23:16', '2607')];

  test('zegt dat er niets komend gepland is; "Toon verleden" blijft werken', async ({ page }) => {
    await seed(page, { user: CHAUFFEUR, extra: planning(VERLEDEN) });
    await page.goto('/rooster');
    await expect(page.getByRole('heading', { name: 'Rooster', level: 1 })).toBeVisible();
    await expect(page.getByText('Geen komende diensten gepland.')).toBeVisible();
    // De fixture stuurt geen planningshorizon mee: dan alleen de eerste zin.
    await expect(page.getByText(/De planning loopt tot en met/)).toHaveCount(0);
    // Niet de lege staat van iemand zonder enige dienst.
    await expect(page.getByText('Nog geen diensten gepland')).toHaveCount(0);

    const toon = page.getByRole('button', { name: /Toon verleden \(2\)/ });
    await expect(toon).toBeVisible();
    await toon.click();
    await expect(page.getByRole('button', { name: /Verberg verleden \(2\)/ })).toBeVisible();
    await expect(page.getByText('15:41–23:16').locator('visible=true').first()).toBeVisible();
    await expect(page.getByText('Geen komende diensten gepland.')).toBeVisible();
  });

  test('weet het scherm tot wanneer de planning loopt, dan staat dat erbij', async ({ page }) => {
    await seed(page, { user: CHAUFFEUR });
    // Na de seed gezet, dus eerst aan de beurt: de planning mét de horizon van de server.
    await page.route((url) => url.pathname.endsWith('/api/planning'), (route) => route.fulfill({
      status: 200, contentType: 'application/json', headers: { 'x-planning-tot': '2026-11-30' }, body: JSON.stringify(VERLEDEN),
    }));
    await page.goto('/rooster');
    await expect(page.getByText('Geen komende diensten gepland.')).toBeVisible();
    await expect(page.getByText('De planning loopt tot en met 30/11/2026.')).toBeVisible();
  });

  test('met een komende dienst staat de regel er niet', async ({ page }) => {
    await seed(page, { user: CHAUFFEUR, extra: planning([...VERLEDEN, dienst('k1', 2, '06:12', '14:30', '4101')]) });
    await page.goto('/rooster');
    await expect(page.getByRole('button', { name: /Toon verleden \(2\)/ })).toBeVisible();
    await expect(page.getByText('Geen komende diensten gepland.')).toHaveCount(0);
  });

  test('zonder enige dienst blijft de bestaande lege staat', async ({ page }) => {
    await seed(page, { user: CHAUFFEUR, extra: planning([]) });
    await page.goto('/rooster');
    await expect(page.getByText('Nog geen diensten gepland')).toBeVisible();
    await expect(page.getByText('Geen komende diensten gepland.')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Toon verleden/ })).toHaveCount(0);
  });
});

const PDF_PAD = '/__test__/rooster-ritblad.pdf';
const BLADEN = ['4101', '2101', '2607'];

/** Een bundel van drie bladen, elk met zijn dienstnummer in de kop; dienst 2101 staat op pagina 2. */
async function metBundel(page: Page, baseURL: string, rijen: unknown[]) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (const nummer of BLADEN) {
    const blad = pdf.addPage([595, 842]);
    blad.drawText(`Ritblad dienst ${nummer}`, { x: 40, y: 780, size: 18, font });
    blad.drawText('Garage - Station - Markt', { x: 40, y: 745, size: 12, font });
  }
  const bytes = Buffer.from(await pdf.save());
  await page.route(`**${PDF_PAD}`, (route) => route.fulfill({ contentType: 'application/pdf', body: bytes }));
  const gevraagd: Array<string | null> = [];
  await seed(page, {
    user: CHAUFFEUR,
    extra: (pad, request) => {
      if (pad.endsWith('/api/planning')) return rijen;
      if (pad.endsWith('/api/ritblaadje')) {
        gevraagd.push(new URL(request.url()).searchParams.get('datum'));
        return { url: new URL(PDF_PAD, baseURL).href, filename: 'rooster-ritblad.pdf', uploadedAt: '2026-11-01T08:00:00Z' };
      }
      return undefined;
    },
  });
  await page.goto('/rooster');
  await expect(page.getByRole('heading', { name: 'Rooster', level: 1 })).toBeVisible();
  return gevraagd;
}

const bladen = (page: Page) => page.getByRole('dialog').getByRole('img', { name: /^Pagina \d+ van de ritblad-bundel$/ });

test.describe('Rooster → Ritblad', () => {
  // Morgen een gesplitste dienst 2101, overmorgen een code-dienst zonder ritblad.
  const KOMEND = [
    dienst('r1', 1, '06:45', '10:00', '2101', '4500'),
    dienst('r2', 1, '15:45', '19:35', '2101', '4611'),
    dienst('r3', 2, '08:00', '16:00', 'EEK'),
  ];

  test('opent de viewer op het blad van die dienst; de volledige bundel blijft één tik verder', async ({ page, baseURL }) => {
    const gevraagd = await metBundel(page, baseURL!, KOMEND);
    // De kaarten staan op datum: de eerste Ritblad-knop is die van dienst 2101.
    await page.getByRole('button', { name: 'Ritblad', exact: true }).first().click();

    const dialoog = page.getByRole('dialog', { name: 'Ritblad · dienst 2101', exact: true });
    await expect(dialoog).toBeVisible({ timeout: 15_000 });
    await expect(dialoog.getByRole('img', { name: 'Pagina 2 van de ritblad-bundel' })).toBeVisible({ timeout: 15_000 });
    await expect(bladen(page)).toHaveCount(1);
    await expect(dialoog.getByText(/^pagina 2 van 3/)).toBeVisible();
    // De bundel van de dag van die dienst (de dienstregelingversie die dan geldt).
    expect(gevraagd.at(-1)).toBe(dayOffset(1));

    await dialoog.getByRole('button', { name: 'Volledige bundel', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Ritblad · volledige bundel', exact: true })).toBeVisible();
    await expect(bladen(page)).toHaveCount(3, { timeout: 15_000 });
  });

  test('zonder bruikbaar dienstnummer (code-dienst) opent de hele bundel, zoals voorheen', async ({ page, baseURL }) => {
    const gevraagd = await metBundel(page, baseURL!, KOMEND);
    await page.getByRole('button', { name: 'Ritblad', exact: true }).nth(1).click();

    await expect(page.getByRole('dialog', { name: 'Ritblad · volledige bundel', exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(bladen(page)).toHaveCount(3, { timeout: 15_000 });
    await expect(page.getByText(/Geen apart blad gevonden/)).toHaveCount(0);
    expect(gevraagd.at(-1)).toBe(dayOffset(2));
  });
});
