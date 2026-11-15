import { test, expect, type Page } from '@playwright/test';
import { CHAUFFEUR, seed, type Extra } from './helpers';

/**
 * Eén korte dag en één tijdstip in elke motor (ronde 6, punt 8, deel 1). Draait
 * in iPhone 13 (chromium) en iPhone 13 (webkit): de vormen worden uit cijfers
 * en vaste tabellen opgebouwd (src/lib/format.ts), dus WebKit moet letterlijk
 * hetzelfde tonen als Chromium, zonder voorloopnul en zonder afkortingspunt.
 *
 * - De korte dag: het dashboard toonde dezelfde dag als "vr 6 nov" in de tegel
 *   Volgende dienst en als "vr 06 nov" in Komende diensten. Daarom alleen
 *   diensten op de eerste dag ná vandaag met een dagnummer onder de tien (met
 *   "13" bewijst de vergelijking niets, die heeft geen voorloopnul).
 * - Het tijdstip: een stap in het verloop van een ruil, in de vorm die de
 *   server stuurt (PostgREST: microseconden en +00:00).
 */

const WEEKDAGEN = ['zo', 'ma', 'di', 'wo', 'do', 'vr', 'za'];
const MAANDEN = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** De eerste dag ná vandaag met een dagnummer onder de tien (lokale tijd, de runner staat op Europe/Brussels). */
function eersteKleineDag(): Date {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  do d.setDate(d.getDate() + 1); while (d.getDate() >= 10);
  return d;
}

test.describe('één korte dag', () => {
  test('dashboard: Komende diensten, Volgende dienst en Wacht op jouw antwoord tonen dezelfde dag, zonder voorloopnul', async ({ page }) => {
    const dag = eersteKleineDag();
    const verwacht = `${WEEKDAGEN[dag.getDay()]} ${dag.getDate()} ${MAANDEN[dag.getMonth()]}`;
    const planning = [{ id: 'k1', date: iso(dag), startTime: '08:00', endTime: '16:00', line: '2101', busNumber: '', loopnr: '4500', driverId: CHAUFFEUR.id }];
    // Een collega vraagt een ruil van zijn dienst op diezelfde dag: de rij in
    // "Wacht op jouw antwoord" noemt de dag ook.
    const ruil = { id: 'kd1', shiftId: 'x1', requesterId: '43', targetDriverId: CHAUFFEUR.id, status: 'pending', reason: '', createdAt: new Date().toISOString(), shiftDate: iso(dag), shiftLine: '2104' };
    const extra: Extra = (p) => (p.endsWith('/api/planning') ? planning : p.endsWith('/api/swaps') ? [ruil] : undefined);
    await seed(page, { user: CHAUFFEUR, extra });
    await page.goto('/');

    const tegel = page.locator('.kpi-tegel').filter({ hasText: 'Volgende dienst' }).locator('.kpi-sub');
    await expect(tegel).toHaveText(/ · /, { timeout: 15_000 });
    const inTegel = (await tegel.innerText()).split(' · ')[0];

    const paneel = page.locator('div.surface-card').filter({ has: page.getByRole('heading', { name: 'Komende diensten' }) });
    const eersteRij = paneel.getByRole('button').filter({ hasNotText: 'Mijn rooster' }).first();
    // De eerste regel van de rij (OpsRow primary) is de dag zelf.
    await expect(eersteRij.locator('span.truncate').first()).toHaveText(inTegel);

    expect(inTegel).toBe(verwacht);
    expect(inTegel).toMatch(/^(ma|di|wo|do|vr|za|zo) [1-9] (jan|feb|mrt|apr|mei|jun|jul|aug|sep|okt|nov|dec)$/);

    const wacht = page.getByTestId('ruil-wacht-op-mij').getByRole('button');
    await expect(wacht).toHaveCount(1);
    await expect(wacht.first()).toContainText(`${verwacht} · dienst 2104`);
  });

  test('rooster: de kaart zet de weekdag en "dag maand" apart, zonder voorloopnul', async ({ page }) => {
    const dag = eersteKleineDag();
    const planning = [{ id: 'k1', date: iso(dag), startTime: '08:00', endTime: '16:00', line: '2101', busNumber: '', loopnr: '4500', driverId: CHAUFFEUR.id }];
    await seed(page, { user: CHAUFFEUR, extra: (p) => (p.endsWith('/api/planning') ? planning : undefined) });
    await page.goto('/rooster');
    await expect(page.getByRole('heading', { name: 'Rooster', level: 1 })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(`${dag.getDate()} ${MAANDEN[dag.getMonth()]}`, { exact: true })).toBeVisible();
    await expect(page.getByText(WEEKDAGEN[dag.getDay()], { exact: true }).first()).toBeVisible();
    await expect(page.getByText(`0${dag.getDate()} ${MAANDEN[dag.getMonth()]}`)).toHaveCount(0);
  });
});

test.describe('één tijdstip', () => {
  async function openVerloop(page: Page) {
    // De aanvrager bekijkt zijn eigen verzoek: de collega heeft het gezien.
    const ruil = {
      id: 'w9', shiftId: 'r9', requesterId: CHAUFFEUR.id, targetDriverId: '43', status: 'pending',
      createdAt: '2026-10-05T06:00:00.123456+00:00', shiftDate: iso(new Date(Date.now() + 5 * 864e5)), shiftLine: '2323',
      returnDate: iso(new Date(Date.now() + 9 * 864e5)), returnCode: 'vrij',
      verloop: [
        { soort: 'aangevraagd', op: '2026-10-05T06:00:00.123456+00:00', door: 'aanvrager' },
        { soort: 'bekeken', op: '2026-10-05T07:40:00.123456+00:00', door: 'collega' },
      ],
    };
    await seed(page, { user: CHAUFFEUR, view: 'ruil-verzoeken', extra: (p) => (p.endsWith('/api/swaps') ? [ruil] : undefined) });
    await page.goto('/');
    await page.getByRole('button', { name: /Dienst 2323/ }).click();
    return page.getByRole('region', { name: 'Verloop per persoon' });
  }

  test('verloop van een ruil: het moment in de vorm van de server wordt "ma 5 okt, 09:40"', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));
    const verloop = await openVerloop(page);
    const collega = verloop.getByRole('listitem').nth(1);
    await expect(collega).toContainText('Bekeken, nog geen antwoord');
    // Het jaartal staat er pas bij zodra 2026 niet meer dit jaar is.
    await expect(collega.locator('time')).toHaveText(/^ma 5 okt( 2026)?, 09:40$/);
    await expect(verloop.getByRole('listitem').nth(0).locator('time')).toHaveText(/^ma 5 okt( 2026)?, 08:00$/);
    expect(pageErrors, `page errors:\n${pageErrors.join('\n')}`).toEqual([]);
  });
});
