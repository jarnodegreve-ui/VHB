import { test, expect } from '@playwright/test';
import { CHAUFFEUR, seed } from './helpers';

/**
 * Meldingencentrum (06-09): bel met ongelezen-teller in de topbar, lijst per
 * dag met filterchips, tik = gelezen + navigatie naar het doel, "Alles
 * gelezen" als stille actie. API gemockt; de POST-body's worden vastgelegd.
 */
const nu = Date.now();
const iso = (msTerug: number) => new Date(nu - msTerug).toISOString();
const MELDINGEN = [
  { id: 'm1', titel: 'Verlof goedgekeurd', tekst: 'Betaald verlof (10 – 12 aug) — beslist door Planning.', soort: 'verlof', doel: 'verlof', createdAt: iso(3600e3) },
  { id: 'm2', titel: 'Rooster bijgewerkt', tekst: 'Je rooster is gewijzigd — bekijk je diensten.', soort: 'planning', doel: 'rooster', createdAt: iso(5 * 3600e3) },
  { id: 'm3', titel: 'Nieuwe update', tekst: 'Nieuwe zomeruniformen beschikbaar', soort: 'update', doel: 'updates', createdAt: iso(3 * 864e5), gelezenOp: iso(2 * 864e5) },
];

test.describe('meldingencentrum', () => {
  test('bel-teller, lijst per dag, tik markeert gelezen en navigeert, alles gelezen', async ({ page }) => {
    const posts: unknown[] = [];
    await seed(page, {
      user: CHAUFFEUR,
      extra: (pad, request) => {
        if (pad.endsWith('/api/meldingen/gelezen')) {
          posts.push(request.postDataJSON());
          return { success: true, gelezen: 1 };
        }
        if (pad.endsWith('/api/meldingen')) return { meldingen: MELDINGEN, ongelezen: 2 };
        return undefined;
      },
    });
    await page.goto('/');

    const bel = page.getByRole('button', { name: 'Meldingen (2 ongelezen)' });
    await expect(bel).toBeVisible({ timeout: 15_000 });
    await bel.click();

    await expect(page.getByRole('heading', { name: 'Meldingen', level: 1 })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Vandaag', level: 2 })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Ongelezen · 2' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Verlof goedgekeurd/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Nieuwe update/ })).toBeVisible();

    // Filterchip op soort.
    await page.getByRole('button', { name: 'Planning', exact: true }).click();
    await expect(page.getByRole('button', { name: /Verlof goedgekeurd/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Rooster bijgewerkt/ })).toBeVisible();
    await page.getByRole('button', { name: 'Alles', exact: true }).click();

    // Tik = gelezen (POST met het id) + naar het doel (Verlof).
    await page.getByRole('button', { name: /Verlof goedgekeurd/ }).click();
    await expect(page.getByRole('heading', { name: /Verlof/, level: 1 })).toBeVisible();
    expect(posts).toEqual([{ ids: ['m1'] }]);
    await expect(page.getByRole('button', { name: 'Meldingen (1 ongelezen)' })).toBeVisible();

    // Terug naar de lijst: "Alles gelezen" = POST zonder ids, bel zonder teller.
    await page.getByRole('button', { name: 'Meldingen (1 ongelezen)' }).click();
    await page.getByRole('button', { name: 'Alles gelezen' }).click();
    expect(posts).toEqual([{ ids: ['m1'] }, {}]);
    // Scope op de topbar: de zijbalk heeft óók een 'Meldingen'-knop.
    await expect(page.locator('header').getByRole('button', { name: 'Meldingen', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Alles gelezen' })).toHaveCount(0);
  });

  test('lege staat zonder meldingen', async ({ page }) => {
    await seed(page, { user: CHAUFFEUR, view: 'meldingen', extra: (pad) => (pad.endsWith('/api/meldingen') ? { meldingen: [], ongelezen: 0 } : undefined) });
    await page.goto('/');
    await expect(page.getByText('Nog geen meldingen')).toBeVisible({ timeout: 15_000 });
  });
});
