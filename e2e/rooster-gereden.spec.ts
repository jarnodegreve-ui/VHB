import { test, expect } from '@playwright/test';
import { CHAUFFEUR, seed } from './helpers';

/**
 * J (24-09): een dienst is gereden na de eindtijd van haar laatste deel.
 * Fixture t1/t2: vandaag 2101, delen 04:36–07:52 en 13:39–17:29.
 * - Om 10:00 is het eerste deel voorbij maar de dienst niet: ze staat bij de
 *   komende diensten en is te ruilen.
 * - Om 18:00 is ze gereden: ze staat bij het verleden en de ruilknop is weg.
 */

const vandaagOm = (uur: number) => { const d = new Date(); d.setHours(uur, 0, 0, 0); return d; };

test('om 10:00 telt de dienst van vandaag nog als komend, met ruilknop', async ({ page }) => {
  await seed(page, { user: CHAUFFEUR });
  await page.clock.setFixedTime(vandaagOm(10));
  await page.goto('/rooster');
  await expect(page.getByRole('heading', { name: 'Rooster', level: 1 })).toBeVisible();
  await expect(page.getByRole('button', { name: /Toon verleden/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Deze dienst ruilen' })).toBeVisible();
});

test('om 18:00 is de dienst van vandaag gereden: verleden, geen ruilknop', async ({ page }) => {
  await seed(page, { user: CHAUFFEUR });
  await page.clock.setFixedTime(vandaagOm(18));
  await page.goto('/rooster');
  await expect(page.getByRole('heading', { name: 'Rooster', level: 1 })).toBeVisible();
  await expect(page.getByRole('button', { name: /Toon verleden \(1\)/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Deze dienst ruilen' })).toHaveCount(0);
});
