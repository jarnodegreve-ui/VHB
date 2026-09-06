import { test, expect } from '@playwright/test';
import { ADMIN, CHAUFFEUR, seed } from './helpers';

/**
 * Dashboard op maat (06-09): "…" → Dashboard aanpassen → per tegel een
 * schakelaar en pijltjes; het dashboard erachter volgt meteen en de
 * voorkeur gaat als PATCH /api/me/voorkeuren naar de server.
 */
test.describe('dashboard aanpassen', () => {
  test('chauffeur: tegel verbergen en verplaatsen, essentiële tegel vast, opslaan via PATCH', async ({ page }) => {
    const patches: unknown[] = [];
    await seed(page, {
      user: CHAUFFEUR,
      extra: (pad, request) => {
        if (pad.endsWith('/api/me/voorkeuren') && request.method() === 'PATCH') {
          patches.push(request.postDataJSON());
          return { success: true, dashboardVoorkeuren: (request.postDataJSON() as { dashboard: unknown }).dashboard };
        }
        return undefined;
      },
    });
    await page.goto('/');
    // Scope op de inhoud: de dialoog heeft straks óók 'Deze maand omhoog/omlaag'-knoppen.
    const inhoud = page.locator('#hoofdinhoud');
    await expect(inhoud.getByRole('button', { name: /^Deze maand/ })).toBeVisible({ timeout: 15_000 });

    await page.getByRole('button', { name: 'Meer acties' }).click();
    await page.getByRole('menuitem', { name: 'Dashboard aanpassen' }).click();
    const dialoog = page.getByRole('dialog', { name: 'Dashboard aanpassen' });
    await expect(dialoog).toBeVisible();

    // Essentiële tegel: geen schakelaar te bedienen.
    await expect(dialoog.getByRole('switch', { name: 'Vandaag tonen' })).toBeDisabled();
    await expect(dialoog.getByText('Altijd zichtbaar')).toBeVisible();

    // Verbergen: de tegel verdwijnt achter de dialoog.
    await dialoog.getByRole('switch', { name: 'Deze maand tonen' }).click();
    await expect(inhoud.getByRole('button', { name: /^Deze maand/ })).toHaveCount(0);

    // Verplaatsen: Verlofsaldo omhoog → vóór Volgende dienst.
    await dialoog.getByRole('button', { name: 'Verlofsaldo omhoog' }).click();
    await dialoog.getByRole('button', { name: 'Klaar' }).click();
    await expect(dialoog).toHaveCount(0);

    // Tegels zijn knoppen "<label> <waarde> <sub>"; de bottom-nav-tab
    // "Omleidingen" blijft buiten de regex.
    const tegels = await inhoud.getByRole('button', { name: /^(Vandaag|Volgende dienst|Verlofsaldo)\b/ }).allTextContents();
    const rang = (label: string) => tegels.findIndex((t) => t.startsWith(label));
    expect(rang('Verlofsaldo')).toBeGreaterThanOrEqual(0);
    expect(rang('Verlofsaldo')).toBeLessThan(rang('Volgende dienst'));

    // Eén gebundelde PATCH met de eindstand.
    await expect.poll(() => patches.length, { timeout: 5_000 }).toBeGreaterThan(0);
    const laatste = patches[patches.length - 1] as { dashboard: { verborgen: string[]; volgorde: string[] } };
    expect(laatste.dashboard.verborgen).toEqual(['deze-maand']);
    expect(laatste.dashboard.volgorde.indexOf('verlofsaldo')).toBeLessThan(laatste.dashboard.volgorde.indexOf('volgende-dienst'));
  });

  test('opgeslagen voorkeuren uit het profiel gelden meteen bij het laden', async ({ page }) => {
    await seed(page, { user: { ...CHAUFFEUR, dashboardVoorkeuren: { verborgen: ['omleidingen', 'snelle-acties'], volgorde: [] } } });
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Komende diensten' })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('actieve omleiding', { exact: false })).toHaveCount(0);
    await expect(page.getByText('Diensten en agenda')).toHaveCount(0);
  });

  test('admin: cockpit-paneel verbergen', async ({ page }) => {
    await seed(page, { user: ADMIN, extra: (pad, request) => (pad.endsWith('/api/me/voorkeuren') && request.method() === 'PATCH' ? { success: true } : undefined) });
    await page.goto('/');
    await expect(page.getByText('Open taken').first()).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: 'Meer acties' }).click();
    await page.getByRole('menuitem', { name: 'Dashboard aanpassen' }).click();
    const dialoog = page.getByRole('dialog', { name: 'Dashboard aanpassen' });
    await expect(dialoog.getByRole('switch', { name: 'Open taken tonen' })).toBeDisabled();
    await dialoog.getByRole('switch', { name: 'Beschikbaar tonen' }).click();
    await dialoog.getByRole('button', { name: 'Klaar' }).click();
    await expect(page.getByText('vrij en inzetbaar', { exact: false })).toHaveCount(0);
    await expect(page.getByText('Open taken').first()).toBeVisible();
  });
});
