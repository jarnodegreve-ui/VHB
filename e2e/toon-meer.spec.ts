import { test, expect, type Page } from '@playwright/test';
import { ADMIN, CHAUFFEUR, seed } from './helpers';
import { dayOffset } from '../scripts/audit-fixtures.mjs';

/**
 * "Toon meer" (Jarno 15-10: "eindeloos in een lijst scrollen is gewoon niet
 * gebruiksvriendelijk"): een lijst die met de historiek groeit toont tien
 * records, de voet "Toon 10 oudere · 10 van 25" zet er telkens tien bij en
 * verdwijnt als alles er staat. Een link naar een record verderop toont de
 * lijst tot en met dat record.
 */

const dagenGeleden = (n: number) => new Date(Date.now() - n * 864e5).toISOString();
const knop = (page: Page, tekst: RegExp) => page.getByRole('button', { name: tekst });
/** De rijen van een lijst zelf, niet de stappen van een opengeklapt ruilverloop erin. */
const rijenVan = (page: Page, naam: string) => page.getByRole('list', { name: naam }).locator(':scope > li');

/** 25 afgehandelde ruilen tussen Alex (43) en Diether (44), de jongste eerst
 *  met dienst 3001; elk een eigen dienstnummer om te tellen. */
const AFGEHANDELD = Array.from({ length: 25 }, (_, i) => ({
  id: `af${i}`, shiftId: `x${i}`, requesterId: '43', targetDriverId: '44',
  status: i % 2 ? 'rejected' : 'completed', reason: '',
  createdAt: dagenGeleden(i + 2), decidedAt: dagenGeleden(i + 1),
  shiftDate: dayOffset(-(i + 1)), shiftLine: String(3001 + i),
}));

test('dienstruil, staf: Afgehandeld toont tien per keer, nieuwste eerst', async ({ page }) => {
  await seed(page, { user: ADMIN, view: 'ruil-verzoeken', extra: (p) => (p.endsWith('/api/swaps') ? AFGEHANDELD : undefined) });
  await page.goto('/dienstruil');
  const rijen = page.getByText(/^Dienst 30\d\d/);
  await expect(rijen).toHaveCount(10);
  await expect(rijen.first()).toContainText('Dienst 3001');
  await expect(knop(page, /^Toon 10 oudere/)).toContainText('10 van 25');

  await knop(page, /^Toon 10 oudere/).click();
  await expect(rijen).toHaveCount(20);
  await knop(page, /^Toon 5 oudere/).click();
  await expect(rijen).toHaveCount(25);
  await expect(knop(page, /^Toon \d+ oudere/)).toHaveCount(0);
});

/** 14 eigen verzoeken van de testchauffeur (42), allemaal al beslist. */
const MIJN = Array.from({ length: 14 }, (_, i) => ({
  id: `mv${i}`, shiftId: `y${i}`, requesterId: '42', targetDriverId: '43',
  status: 'rejected', reason: '', createdAt: dagenGeleden(i + 2), decidedAt: dagenGeleden(i + 1),
  shiftDate: dayOffset(-(i + 1)), shiftLine: String(4001 + i),
}));
const mijnVerzoeken = (p: string) => (p.endsWith('/api/swaps') ? MIJN : undefined);

test('dienstruil, chauffeur: Mijn verzoeken tien per keer, zonder eigen scrollvak', async ({ page }) => {
  await seed(page, { user: CHAUFFEUR, view: 'ruil-verzoeken', extra: mijnVerzoeken });
  await page.goto('/dienstruil');
  await expect(rijenVan(page, 'Mijn verzoeken')).toHaveCount(10);
  await knop(page, /^Toon 4 meer/).click();
  await expect(rijenVan(page, 'Mijn verzoeken')).toHaveCount(14);
});

test('dienstruil, chauffeur: een link naar een verzoek verderop toont het, open en in beeld', async ({ page }) => {
  await seed(page, { user: CHAUFFEUR, view: 'ruil-verzoeken', extra: mijnVerzoeken });
  // Mijn verzoeken sorteert op de dienstdag; mv13 ligt het verst terug.
  await page.goto('/dienstruil/mv13');
  await expect(rijenVan(page, 'Mijn verzoeken')).toHaveCount(14);
  await expect(page.locator('[data-record="mv13"]')).toBeInViewport();
});

/** Verlof van drie collega's: 12 voorbij en goedgekeurd, 1 afgewezen, 1 nog open. */
const VERLOF = [
  ...Array.from({ length: 12 }, (_, i) => ({
    id: `vh${i}`, userId: i % 3 === 0 ? '44' : '43', startDate: dayOffset(-(30 + i * 7)), endDate: dayOffset(-(28 + i * 7)),
    type: 'betaald_verlof', status: 'approved', createdAt: dagenGeleden(60 + i * 7), decidedAt: dagenGeleden(59 + i * 7),
  })),
  { id: 'vr1', userId: '43', startDate: dayOffset(-10), endDate: dayOffset(-9), type: 'betaald_verlof', status: 'rejected', createdAt: dagenGeleden(20), decidedAt: dagenGeleden(19) },
  { id: 'vp1', userId: '44', startDate: dayOffset(20), endDate: dayOffset(22), type: 'betaald_verlof', status: 'pending', createdAt: dagenGeleden(1) },
];

test('verlof, staf: historiek van iedereen, tien per keer en te filteren per persoon', async ({ page }) => {
  await seed(page, { user: ADMIN, view: 'verlof', extra: (p) => (p.endsWith('/api/leave') ? VERLOF : undefined) });
  await page.goto('/verlof');
  const historiek = page.getByRole('list', { name: 'Historiek' });
  // 13 beslist (12 voorbij + 1 afgewezen); de open aanvraag staat bij Wachtend.
  await expect(historiek.getByRole('listitem')).toHaveCount(10);
  await expect(knop(page, /^Toon 3 oudere/)).toContainText('10 van 13');
  await knop(page, /^Toon 3 oudere/).click();
  await expect(historiek.getByRole('listitem')).toHaveCount(13);

  // Diether (44) heeft vier voorbije verloven: de filter begint weer bij het begin.
  await page.getByRole('combobox', { name: 'Historiek van' }).selectOption({ label: 'Diether Van Haute' });
  await expect(historiek.getByRole('listitem')).toHaveCount(4);
  await expect(knop(page, /^Toon \d+ oudere/)).toHaveCount(0);
});

/** 15 updates: de UI schrijft de datum als '3/9/2026', oudere rijen als ISO. */
const UPDATES = Array.from({ length: 15 }, (_, i) => {
  const dag = new Date(Date.UTC(2026, 9, 15 - i * 2));
  const nl = `${dag.getUTCDate()}/${dag.getUTCMonth() + 1}/${dag.getUTCFullYear()}`;
  return { id: String(1760000000000 + (15 - i) * 1000), title: `Bericht ${String(i + 1).padStart(2, '0')}`, content: 'Tekst', date: i % 4 === 3 ? dag.toISOString().slice(0, 10) : nl, isUrgent: false, category: 'algemeen' };
});

test('updates: nieuwste eerst (ook over de maandgrens), tien per keer', async ({ page }) => {
  await seed(page, { user: CHAUFFEUR, view: 'updates', extra: (p) => (p.endsWith('/api/updates') ? [...UPDATES].reverse() : undefined) });
  await page.goto('/updates');
  const lijst = page.getByRole('list', { name: 'Berichten' });
  await expect(lijst.getByRole('listitem')).toHaveCount(10);
  // Bericht 01 is van 15/10, bericht 08 van 1/10, bericht 09 van 29/9.
  await expect(lijst.getByRole('listitem').first()).toContainText('Bericht 01');
  await expect(lijst.getByRole('listitem').nth(7)).toContainText('Bericht 08');
  await expect(lijst.getByRole('listitem').nth(8)).toContainText('Bericht 09');
  await knop(page, /^Toon 5 oudere/).click();
  await expect(lijst.getByRole('listitem')).toHaveCount(15);
});

/** 12 omleidingen die de afgelopen drie weken afliepen (de chauffeur ziet 30 dagen terug). */
const VOORBIJ = Array.from({ length: 12 }, (_, i) => ({
  id: `ov${i}`, line: String(50 + i), title: `Werken ${i + 1}`, description: 'Omleiding', startDate: dayOffset(-(25 + i)), endDate: dayOffset(-(1 + i)), severity: 'low',
}));

test('omleidingen: Voorbij toont tien per keer', async ({ page }) => {
  await seed(page, { user: CHAUFFEUR, view: 'omleidingen', extra: (p) => (p.endsWith('/api/diversions') ? VOORBIJ : undefined) });
  await page.goto('/omleidingen');
  await page.getByRole('button', { name: /Voorbij/ }).click();
  const lijst = page.getByRole('list', { name: 'Voorbij' });
  await expect(lijst.getByRole('listitem')).toHaveCount(10);
  await knop(page, /^Toon 2 oudere/).click();
  await expect(lijst.getByRole('listitem')).toHaveCount(12);
});
