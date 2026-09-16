import { test, expect, type Locator, type Page } from '@playwright/test';
import { ADMIN, seed } from './helpers';
import type { LeaveRequest, Shift, User } from '../src/types';

const VANDAAG = '2026-09-16';
const BEHEERDER: User = { ...ADMIN, role: 'admin' };
const PLANNER: User = { id: 'planner', name: 'Planner E2E', employeeId: 'PL-01', email: 'planner@example.test', role: 'planner', isActive: true };
const CHAUFFEURS: User[] = [
  { id: 'alex', name: 'Alexander Van den Bossche-Verstraeten', employeeId: '001', role: 'chauffeur', isActive: true },
  { id: 'bea', name: 'Bea De Wilde', employeeId: '002', role: 'chauffeur', isActive: true },
  { id: 'cem', name: 'Cem Yilmaz', employeeId: '003', role: 'chauffeur', isActive: true },
  { id: 'dina', name: 'Dina Goossens', employeeId: '004', role: 'chauffeur', isActive: true },
];

function melding(id: string, userId: string, startDate: string, endDate = startDate, status: LeaveRequest['status'] = 'approved'): LeaveRequest {
  return { id, userId, startDate, endDate, status, type: 'ziekte', createdAt: `${startDate}T06:00:00Z` };
}

const MELDINGEN: LeaveRequest[] = [
  { ...melding('nu-alex', 'alex', '2026-09-14', '2026-09-20'), comment: 'Telefonisch gemeld. Verwachte terugkeer wordt nog bevestigd.' },
  melding('nu-bea', 'bea', VANDAAG),
  melding('straks-cem', 'cem', '2026-09-18', '2026-09-20'),
  // Meer dan de oude afkapgrens van 25: ook de oudste melding moet vindbaar zijn.
  ...Array.from({ length: 31 }, (_, i) => {
    const datum = `2026-08-${String(i + 1).padStart(2, '0')}`;
    return { ...melding(`historiek-${i + 1}`, i === 0 ? 'dina' : 'bea', datum), comment: i === 0 ? 'Oudste registratie na telefonische melding.' : undefined };
  }),
  melding('ingetrokken-cem', 'cem', '2026-09-10', '2026-09-11', 'cancelled'),
  melding('ingetrokken-dina', 'dina', '2026-09-08', '2026-09-09', 'cancelled'),
  { ...melding('verlof-dina', 'dina', VANDAAG, '2026-09-18'), type: 'betaald_verlof' },
];

function dienst(id: string, driverId: string, date: string, line: string, startTime = '06:00'): Shift {
  return { id, driverId, date, line, startTime, endTime: '14:00', busNumber: '', loopnr: '4500' };
}

const DIENSTEN = [
  dienst('alex-deel-1', 'alex', VANDAAG, '2101'),
  dienst('alex-deel-2', 'alex', VANDAAG, '2101', '16:00'),
  dienst('alex-morgen', 'alex', '2026-09-17', '2607'),
  dienst('alex-voorbij', 'alex', '2026-09-13', '2101'),
  dienst('alex-na-herstel', 'alex', '2026-09-21', '2101'),
  dienst('cem-geregistreerd', 'cem', '2026-09-18', '4101'),
];

type ZiekmeldingPayload = { userId: string; startDate: string; endDate: string; comment?: string };

async function openZiekte(page: Page, { user = BEHEERDER, records = MELDINGEN, users = CHAUFFEURS }: { user?: User; records?: LeaveRequest[]; users?: User[] } = {}) {
  await page.clock.setFixedTime(new Date(`${VANDAAG}T08:00:00Z`));
  let opgeslagen = records.map((r) => ({ ...r }));
  const registraties: ZiekmeldingPayload[] = [];
  const wijzigingen: LeaveRequest[][] = [];
  const dienstwissels: unknown[] = [];
  await seed(page, {
    user: { ...user }, view: 'ziekte', thema: 'dark',
    extra: (pad, request) => {
      if (pad.endsWith('/api/users')) return [BEHEERDER, PLANNER, ...users];
      if (pad.endsWith('/api/planning')) return DIENSTEN;
      if (pad.endsWith('/api/ziekte-zonder-registratie')) return { reeksen: [] };
      if (pad.endsWith('/api/leave/sick-report') && request.method() === 'POST') {
        const payload: ZiekmeldingPayload = request.postDataJSON();
        registraties.push(payload);
        opgeslagen.push({ ...melding('nieuw-geregistreerd', payload.userId, payload.startDate, payload.endDate), comment: payload.comment });
        return { ok: true };
      }
      if (pad.endsWith('/api/leave')) {
        if (request.method() === 'POST') {
          opgeslagen = request.postDataJSON();
          wijzigingen.push(opgeslagen);
          return { ok: true };
        }
        return opgeslagen;
      }
      if (pad.endsWith('/api/admin/shift-swap')) {
        dienstwissels.push(request.postDataJSON());
        return { ok: true };
      }
      return undefined;
    },
  });
  await page.goto('/beheer/ziekte');
  await expect(page.getByRole('heading', { level: 1, name: 'Ziekte', exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('region', { name: 'Actueel', exact: true })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  return { registraties, wijzigingen, dienstwissels };
}

function rij(scope: Page | Locator, chauffeur: number, vanaf: string) {
  return scope.getByRole('button', { name: `Bekijk ziekmelding van ${CHAUFFEURS[chauffeur].name} vanaf ${vanaf}`, exact: true });
}

async function pastBinnenScherm(page: Page) {
  const breedtes = await page.evaluate(() => {
    const inhoud = document.querySelector<HTMLElement>('[data-scroll-root]')!;
    return { document: document.documentElement.scrollWidth - window.innerWidth, inhoud: inhoud.scrollWidth - inhoud.clientWidth };
  });
  expect(breedtes.document, 'het scherm heeft geen horizontale overflow').toBeLessThanOrEqual(1);
  expect(breedtes.inhoud, 'de ziekte-inhoud blijft binnen de beschikbare breedte').toBeLessThanOrEqual(1);
}

test('ziekte: actuele filters, zoeken en diensten op naam blijven bruikbaar', async ({ page }) => {
  await openZiekte(page);
  const actueel = page.getByRole('region', { name: 'Actueel', exact: true });
  await expect(rij(actueel, 0, '2026-09-14')).toBeVisible();
  await expect(rij(actueel, 1, VANDAAG)).toBeVisible();
  await expect(rij(actueel, 2, '2026-09-18')).toHaveCount(0);
  await expect(rij(actueel, 0, '2026-09-14')).toContainText('2 diensten');
  await expect(rij(actueel, 0, '2026-09-14')).toHaveAccessibleDescription(/14 sep 2026.*20 sep 2026.*3 dagen.*t\/m vandaag.*2 diensten op naam/);
  await expect(rij(actueel, 3, VANDAAG)).toHaveCount(0);
  const kengetallen = page.getByRole('region', { name: 'Ziekte vandaag', exact: true });
  for (const [label, waarde] of [['Nu ziek', '2'], ['Diensten op naam', '3'], ['Loopt vandaag af', '1']]) {
    await expect(kengetallen.getByLabel(label, { exact: true }).locator('.text-stat')).toHaveText(waarde);
  }
  await pastBinnenScherm(page);

  const metDiensten = actueel.getByRole('button', { name: 'Met diensten op naam', exact: true });
  await metDiensten.click();
  await expect(rij(actueel, 0, '2026-09-14')).toBeVisible();
  await expect(rij(actueel, 1, VANDAAG)).toHaveCount(0);
  await actueel.getByRole('button', { name: /^Alles/ }).click();
  await expect(rij(actueel, 2, '2026-09-18')).toBeVisible();
  await expect(actueel.getByRole('button', { name: /^Bekijk ziekmelding/ })).toHaveCount(2);
  await metDiensten.click();
  await expect(actueel.getByRole('button', { name: /^Bekijk ziekmelding/ })).toHaveCount(3);
  const zoek = actueel.getByRole('textbox', { name: 'Zoek actuele ziekmeldingen' });
  await zoek.fill('Bossche-Verstraeten');
  await expect(actueel.getByRole('button', { name: /^Bekijk ziekmelding/ })).toHaveCount(1);
  await expect(rij(actueel, 0, '2026-09-14')).toBeVisible();
  await zoek.fill('onbestaande chauffeur');
  await expect(actueel.getByRole('button', { name: /^Bekijk ziekmelding/ })).toHaveCount(0);
  await zoek.fill('');
  await expect(actueel.getByRole('button', { name: /^Bekijk ziekmelding/ })).toHaveCount(3);
  await pastBinnenScherm(page);
});

test('ziekte: volledige historiek blijft bereikbaar via paginering, zoeken en status', async ({ page }) => {
  await openZiekte(page);
  const historiek = page.getByRole('region', { name: 'Historiek', exact: true });
  const rijen = historiek.getByRole('button', { name: /^Bekijk ziekmelding/ });
  await expect(rijen).toHaveCount(10);
  const volgende = historiek.getByRole('button', { name: 'Volgende pagina', exact: true });
  for (let i = 0; i < 3; i++) await volgende.click();
  await expect(rijen).toHaveCount(3);
  await expect(volgende).toBeDisabled();
  await expect(rij(historiek, 3, '2026-08-01')).toBeVisible();

  const zoek = historiek.getByRole('textbox', { name: 'Zoek in ziektehistoriek' });
  await zoek.fill('Dina Goossens');
  await expect(rijen).toHaveCount(2);
  const status = historiek.getByRole('combobox', { name: 'Status ziektehistoriek' });
  await status.selectOption({ label: 'Afgelopen' });
  await expect(rijen).toHaveCount(1);
  await expect(rij(historiek, 3, '2026-08-01')).toBeVisible();
  await zoek.fill('');
  await status.selectOption({ label: 'Ingetrokken' });
  await expect(rijen).toHaveCount(2);
  await expect(rij(historiek, 2, '2026-09-10')).toBeVisible();
  await expect(rij(historiek, 3, '2026-09-08')).toBeVisible();
  await rij(historiek, 2, '2026-09-10').click();
  const detail = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: CHAUFFEURS[2].name, exact: true }) });
  await expect(detail.getByText('Deze melding is ingetrokken.', { exact: true })).toBeVisible();
  await expect(detail.getByRole('button', { name: 'Opslaan', exact: true })).toHaveCount(0);
  await detail.getByRole('button', { name: 'Sluiten', exact: true }).click();
  await expect(detail).toHaveCount(0);
  await pastBinnenScherm(page);
});

test('ziekte: registreren verstuurt de gekozen chauffeur en verschijnt direct in actueel', async ({ page }) => {
  const writes = await openZiekte(page);
  await page.getByRole('button', { name: 'Ziek melden', exact: true }).click();
  const modal = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Ziekmelding registreren', exact: true }) });
  await modal.getByRole('combobox', { name: 'Chauffeur' }).selectOption('dina');
  await modal.getByRole('textbox', { name: 'Opmerking (optioneel)' }).fill('Om 06:15 telefonisch doorgegeven.');
  await modal.getByRole('button', { name: 'Ziekmelding registreren', exact: true }).click();
  await expect(modal).toHaveCount(0);
  expect(writes.registraties).toEqual([{ userId: 'dina', startDate: VANDAAG, endDate: VANDAAG, comment: 'Om 06:15 telefonisch doorgegeven.' }]);
  await expect(rij(page.getByRole('region', { name: 'Actueel', exact: true }), 3, VANDAAG)).toBeVisible();
  await pastBinnenScherm(page);
});

test('ziekte: planner kan einddatum opslaan en ziet geen dienstwisselacties', async ({ page }) => {
  const writes = await openZiekte(page, { user: PLANNER });
  await rij(page.getByRole('region', { name: 'Actueel', exact: true }), 0, '2026-09-14').click();
  const modal = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: CHAUFFEURS[0].name, exact: true }) });
  await expect(modal.getByText('Dienst 2101', { exact: true })).toHaveCount(1);
  await expect(modal.getByText('Dienst 2607', { exact: true })).toBeVisible();
  await expect(modal.getByRole('button', { name: 'Vraag een admin', exact: true })).toBeVisible();
  await expect(modal.getByRole('button', { name: /Zet over|Verdeel alles|Stel kandidaten voor|Maandplanning/ })).toHaveCount(0);
  await expect(modal.getByRole('combobox', { name: /^Vervanger voor dienst/ })).toHaveCount(0);

  await modal.getByLabel('Ziek tot en met', { exact: true }).click();
  const kalender = page.getByRole('dialog', { name: 'Datum kiezen', exact: true });
  await kalender.getByRole('button', { name: 'Wissen', exact: true }).click();
  await expect(modal.getByRole('button', { name: 'Opslaan', exact: true })).toBeDisabled();
  await modal.getByLabel('Ziek tot en met', { exact: true }).click();
  await kalender.getByRole('gridcell', { name: /17 sep 2026/ }).click();
  await expect(kalender).toHaveCount(0);
  await modal.getByRole('button', { name: 'Opslaan', exact: true }).click();
  await expect(modal).toHaveCount(0);
  expect(writes.wijzigingen).toHaveLength(1);
  expect(writes.wijzigingen[0].find((r) => r.id === 'nu-alex')).toMatchObject({ endDate: '2026-09-17' });
  expect(writes.wijzigingen[0].find((r) => r.id === 'verlof-dina')).toEqual(MELDINGEN.find((r) => r.id === 'verlof-dina'));
  expect(writes.dienstwissels).toEqual([]);
  await rij(page.getByRole('region', { name: 'Actueel', exact: true }), 0, '2026-09-14').click();
  await expect(modal.getByLabel('Ziek tot en met', { exact: true })).toHaveAttribute('data-datum', '2026-09-17');
});

test('ziekte: jaarinzicht telt overlap één keer en rekent toekomstige dagen niet mee', async ({ page }) => {
  await openZiekte(page, { records: [
    melding('jaargrens', 'alex', '2025-12-30', '2026-01-03'),
    melding('overlap', 'alex', '2026-01-02', '2026-01-05'),
    melding('andere-chauffeur', 'bea', '2026-01-03', '2026-01-04'),
    melding('lopend', 'alex', '2026-09-14', '2026-09-20'),
    melding('toekomst', 'cem', '2026-09-20', '2026-09-22'),
    melding('ingetrokken', 'dina', '2026-09-10', '2026-09-11', 'cancelled'),
  ] });
  const inzicht = page.getByLabel('Jaaroverzicht ziekte', { exact: true });
  const totaal = (label: string) => inzicht.getByLabel('Jaartotalen', { exact: true }).locator('dt').filter({ hasText: new RegExp(`^${label}$`) }).locator('..').locator('dd').first();
  await expect(totaal('Kalenderdagen')).toHaveText('10');
  await expect(totaal('Geregistreerde meldingen')).toHaveText('4');
  await expect(totaal('Chauffeurs')).toHaveText('2');
  await expect(inzicht.getByLabel('Januari: 7 kalenderdagen', { exact: true })).toBeVisible();
  await expect(inzicht.getByLabel('September: 3 kalenderdagen', { exact: true })).toBeVisible();
  await expect(inzicht.getByLabel('Oktober: nog niet begonnen', { exact: true })).toBeVisible();
  const chauffeurs = inzicht.getByLabel('Ziekte per chauffeur in 2026', { exact: true }).filter({ visible: true });
  await expect(chauffeurs.getByText(CHAUFFEURS[0].name, { exact: true })).toBeVisible();
  await expect(chauffeurs.getByText(CHAUFFEURS[1].name, { exact: true })).toBeVisible();
  await expect(chauffeurs.getByText(CHAUFFEURS[2].name, { exact: true })).toHaveCount(0);
  await inzicht.getByRole('searchbox', { name: 'Zoek chauffeur', exact: true }).fill('Bea');
  await expect(chauffeurs.getByText(CHAUFFEURS[0].name, { exact: true })).toHaveCount(0);
  await expect(chauffeurs.getByText(CHAUFFEURS[1].name, { exact: true })).toBeVisible();
  await expect(totaal('Kalenderdagen')).toHaveText('10');
  await inzicht.getByRole('searchbox', { name: 'Zoek chauffeur', exact: true }).fill('');
  await inzicht.getByRole('combobox', { name: 'Jaar', exact: true }).selectOption('2025');
  await expect(totaal('Kalenderdagen')).toHaveText('2');
  await expect(totaal('Geregistreerde meldingen')).toHaveText('1');
  await expect(totaal('Chauffeurs')).toHaveText('1');
  await expect(inzicht.getByLabel('December: 2 kalenderdagen', { exact: true })).toBeVisible();
  await pastBinnenScherm(page);
});

test('ziekte: op 320px blijven overzicht, filters en historiek binnen beeld', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'De smalle viewport is een mobiele regressie.');
  await page.setViewportSize({ width: 320, height: 800 });
  await openZiekte(page);
  await pastBinnenScherm(page);
  for (const veld of [
    page.getByRole('textbox', { name: 'Zoek actuele ziekmeldingen' }),
    page.getByRole('textbox', { name: 'Zoek in ziektehistoriek' }),
    page.getByRole('combobox', { name: 'Status ziektehistoriek' }),
  ]) {
    const rect = await veld.boundingBox();
    expect(rect!.x).toBeGreaterThanOrEqual(0);
    expect(rect!.x + rect!.width).toBeLessThanOrEqual(321);
  }
  await page.getByRole('region', { name: 'Historiek', exact: true }).getByRole('button', { name: 'Volgende pagina', exact: true }).click();
  await pastBinnenScherm(page);
});

test('ziekte: chauffeurpaginering houdt zoeken, jaartotalen en jaarwissel samen', async ({ page }) => {
  const users: User[] = Array.from({ length: 8 }, (_, i) => ({
    id: `chauffeur-${i + 1}`, name: `Chauffeur ${String(i + 1).padStart(2, '0')}`,
    employeeId: String(i + 1), role: 'chauffeur', isActive: true,
  }));
  const records = users.flatMap((user, i) => [
    melding(`dit-jaar-${i}`, user.id, `2026-01-${String(i + 1).padStart(2, '0')}`),
    melding(`vorig-jaar-${i}`, user.id, '2025-02-01', '2025-02-02'),
  ]);
  await openZiekte(page, { users, records });
  const inzicht = page.getByLabel('Jaaroverzicht ziekte', { exact: true });
  const lijst = (jaar: number) => inzicht.getByLabel(`Ziekte per chauffeur in ${jaar}`, { exact: true }).filter({ visible: true });
  const totaal = inzicht.getByLabel('Jaartotalen', { exact: true }).locator('dt').filter({ hasText: /^Kalenderdagen$/ }).locator('..').locator('dd').first();
  const volgende = inzicht.getByRole('button', { name: 'Volgende pagina', exact: true });
  const zoek = inzicht.getByRole('searchbox', { name: 'Zoek chauffeur', exact: true });
  await expect(lijst(2026).getByText(/^Chauffeur \d{2}$/)).toHaveCount(6);
  await expect(lijst(2026).getByText('Chauffeur 01', { exact: true })).toBeVisible();
  await expect(totaal).toHaveText('8');

  await volgende.click();
  await expect(lijst(2026).getByText(/^Chauffeur \d{2}$/)).toHaveCount(2);
  await expect(lijst(2026).getByText('Chauffeur 08', { exact: true })).toBeVisible();
  await expect(volgende).toBeDisabled();
  await zoek.fill('Chauffeur 01');
  await expect(lijst(2026).getByText(/^Chauffeur \d{2}$/)).toHaveCount(1);
  await expect(lijst(2026).getByText('Chauffeur 01', { exact: true })).toBeVisible();
  await expect(totaal).toHaveText('8');

  await zoek.fill('');
  await expect(lijst(2026).getByText(/^Chauffeur \d{2}$/)).toHaveCount(6);
  await expect(lijst(2026).getByText('Chauffeur 01', { exact: true })).toBeVisible();
  await volgende.click();
  await expect(lijst(2026).getByText(/^Chauffeur \d{2}$/)).toHaveCount(2);
  await inzicht.getByRole('combobox', { name: 'Jaar', exact: true }).selectOption('2025');
  await expect(lijst(2025).getByText(/^Chauffeur \d{2}$/)).toHaveCount(6);
  await expect(lijst(2025).getByText('Chauffeur 01', { exact: true })).toBeVisible();
  await expect(totaal).toHaveText('16');
  await pastBinnenScherm(page);
});
