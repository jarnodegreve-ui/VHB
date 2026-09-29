import { test, expect } from '@playwright/test';
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

// Jarno 29-09 (28e): het einde van een deel volgt deelVenster. 22:00–06:00
// van vandaag eindigt morgenvroeg, dus vandaag is ze op elk uur nog komend
// (vroeger gold ze vanaf 06:00 al als gereden, 16 uur voor ze begon). De klok
// staat vast op 07:00 (setFixedTime: alleen Date, de timers lopen door, dus
// het rooster rendert gewoon): zonder die klok slaagde de test vóór 06:00 ook
// op de oude regel.
test('een nachtdienst in gewone uren (22:00–06:00) van vandaag loopt tot morgenvroeg: om 07:00 komend, met ruilknop', async ({ page }) => {
  await page.clock.setFixedTime(new Date(`${dayOffset(0)}T07:00:00`));
  await seed(page, { user: CHAUFFEUR, extra: planning(vandaag('22:00', '06:00')) });
  await page.goto('/rooster');
  await expect(page.getByRole('heading', { name: 'Rooster', level: 1 })).toBeVisible();
  await expect(page.getByRole('button', { name: /Toon verleden/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Deze dienst ruilen' })).toBeVisible();
});

// Jarno 29-09 (28a): een deel met gelijke begin- en eindtijd is ongeldig in de
// berekening, maar de dienst blijft in het rooster staan: de dag is een
// dienstdag met 0 minuten gepland (vroeger 24 uur).
test('een dienst met gelijke begin- en eindtijd blijft in het rooster, met 0 minuten gepland', async ({ page }) => {
  const morgen = dayOffset(1);
  const rij = { id: 't-gelijk', date: morgen, startTime: '08:00', endTime: '08:00', line: '2102', busNumber: '', loopnr: '4501', driverId: '42' };
  await seed(page, { user: CHAUFFEUR, extra: planning([...PLANNING, rij]) });
  await page.goto(`/rooster/${morgen.slice(0, 7)}`);
  await expect(page.getByRole('heading', { name: 'Rooster', level: 1 })).toBeVisible();
  await expect(page.getByRole('button', { name: `${morgen}, dienst, 0min gepland`, exact: true })).toBeVisible();
});
