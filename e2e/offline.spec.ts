import { test, expect } from '@playwright/test';
import { CHAUFFEUR, seed } from './helpers';

/**
 * Offline-gedrag van Mijn dag (next-level 2, 06-09), zonder service worker
 * (die staat in de e2e-config uit — de SW-cache zelf zit in
 * src/lib/swRitbladen.test.ts en de handmatige PWA-check). Wat hier telt:
 * valt het netwerk weg ná de eerste load, dan blijft het scherm staan met
 * de al geladen dienst en verschijnt alleen een stil label met de versheid.
 */
test.describe('offline: Mijn dag', () => {
  test('stil offline-label met versheid; de dienst blijft zichtbaar', async ({ page, context }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));
    await seed(page, { user: CHAUFFEUR, view: 'mijn-dag' });
    await page.goto('/');

    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('2101').first()).toBeVisible();
    await expect(page.getByText(/Offline · /)).toHaveCount(0);

    await context.setOffline(true);
    // navigator.onLine → false + offline-event: chip "Offline · gegevens van hh:mm".
    await expect(page.getByText(/Offline · (gegevens van \d{2}:\d{2}|opgeslagen gegevens)/)).toBeVisible();
    await expect(page.getByText('2101').first()).toBeVisible();
    await expect(page.getByText('04:36–07:52').first()).toBeVisible();

    await context.setOffline(false);
    await expect(page.getByText(/Offline · /)).toHaveCount(0);
    expect(pageErrors, `page errors:\n${pageErrors.join('\n')}`).toEqual([]);
  });
});
