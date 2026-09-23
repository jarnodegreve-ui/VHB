import { test, expect } from '@playwright/test';
import { CHAUFFEUR, seed } from './helpers';

/**
 * De print-modus laadt sinds P5 (23-09) lui. Een URL met een printblad dat de
 * rol niet mag zien (maandrooster van een collega als chauffeur) toont
 * gewoon het portaal, zoals vroeger, geen leeg blad.
 */
test('chauffeur met een staf-printlink ziet het portaal', async ({ page }) => {
  await seed(page, { user: CHAUFFEUR, view: 'dashboard' });
  await page.goto('/?print-driver=43&print-month=2026-09');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('navigation').first()).toBeVisible();
});
