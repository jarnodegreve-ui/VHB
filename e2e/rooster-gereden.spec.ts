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
