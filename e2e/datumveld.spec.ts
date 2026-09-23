import { test, expect } from '@playwright/test';
import { ADMIN, seed } from './helpers';

/**
 * Het typbare datumveld (datumtranche PR 1) in een echte browser, desktop en
 * iPhone: typen, een ongeldige datum, de kalender met toetsenbord en muis.
 * Het voorbeeldveld staat op /beheer/designsysteem (Formulier › Startdatum).
 */
test('datumveld: typen, fout bij een onbestaande dag, kiezen in de kalender', async ({ page }) => {
  await seed(page, { user: ADMIN });
  await page.goto('/beheer/designsysteem');
  const veld = page.getByLabel('Startdatum', { exact: true });
  await veld.scrollIntoViewIfNeeded();
  await expect(veld).toHaveAttribute('placeholder', 'dd/mm/jjjj');

  // Onvolledig: blijft staan, geen fout tijdens het typen.
  await veld.fill('23/0');
  await expect(page.getByText('Gebruik dd/mm/jjjj, bijvoorbeeld 23/09/2026.')).toHaveCount(0);
  // Onbestaande dag: fout bij blur, niets doorgegeven.
  await veld.fill('31/02/2026');
  await veld.blur();
  await expect(page.getByText('Die dag bestaat niet.')).toBeVisible();
  await expect(veld).toHaveAttribute('aria-invalid', 'true');
  await expect(veld).not.toHaveAttribute('data-datum', /.+/);
  // Geldig, zonder scheidingstekens (iPhone-cijferklavier): Enter bevestigt.
  await veld.fill('23092026');
  await veld.press('Enter');
  await expect(veld).toHaveValue('23/09/2026');
  await expect(veld).toHaveAttribute('data-datum', '2026-09-23');
  await expect(page.getByText('Die dag bestaat niet.')).toHaveCount(0);

  // Kalender: opent op de waarde, pijltje + Enter kiest, focus terug in het veld.
  await veld.locator('xpath=following-sibling::button[1]').click();
  const kalender = page.getByRole('dialog', { name: 'Datum kiezen' });
  await expect(kalender).toBeVisible();
  await expect(kalender.getByRole('gridcell', { name: /23 sep 2026/ })).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  await expect(kalender).toHaveCount(0);
  await expect(veld).toHaveValue('24/09/2026');
  await expect(veld).toBeFocused();

  // Esc sluit zonder te kiezen.
  await veld.press('ArrowDown');
  await expect(kalender).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(kalender).toHaveCount(0);
  await expect(veld).toHaveValue('24/09/2026');
});
