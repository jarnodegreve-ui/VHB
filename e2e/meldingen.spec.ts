import { test, expect } from '@playwright/test';
import { CHAUFFEUR, seed } from './helpers';

/**
 * Meldingencentrum (06-09, paneel sinds 21-09): bel met ongelezen-teller in de
 * topbar opent een paneel met de laatste meldingen; van daaruit naar het doel,
 * naar het volledige scherm, of een melding weg met het kruisje. Op het scherm
 * zelf: lijst per dag met filterchips, tik = gelezen + navigatie, "Markeer
 * alles als gelezen" en hetzelfde kruisje. API gemockt; de body's van POST en
 * DELETE worden vastgelegd.
 */
const nu = Date.now();
const iso = (msTerug: number) => new Date(nu - msTerug).toISOString();
const MELDINGEN = [
  { id: 'm1', titel: 'Verlof goedgekeurd', tekst: 'Betaald verlof (10 – 12 aug), beslist door Planning.', soort: 'verlof', doel: 'verlof', createdAt: iso(3600e3) },
  { id: 'm2', titel: 'Rooster bijgewerkt', tekst: 'Je rooster is gewijzigd, bekijk je diensten.', soort: 'planning', doel: 'rooster', createdAt: iso(5 * 3600e3) },
  { id: 'm3', titel: 'Nieuwe update', tekst: 'Nieuwe zomeruniformen beschikbaar', soort: 'update', doel: 'updates', createdAt: iso(3 * 864e5), gelezenOp: iso(2 * 864e5) },
];

test.describe('meldingencentrum', () => {
  test('paneel onder de bel: lijst, doel, alles gelezen en de weg naar het scherm', async ({ page }) => {
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

    // Het paneel, niet meteen het scherm.
    const paneel = page.getByRole('menu', { name: 'Meldingen' });
    await expect(paneel).toBeVisible();
    await expect(paneel.getByRole('menuitem', { name: /Verlof goedgekeurd/ })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Meldingen', level: 1 })).toHaveCount(0);

    // Een rij in het paneel brengt je naar het doel en markeert gelezen.
    await paneel.getByRole('menuitem', { name: /Verlof goedgekeurd/ }).click();
    await expect(page.getByRole('heading', { name: /Verlof/, level: 1 })).toBeVisible();
    expect(posts).toEqual([{ ids: ['m1'] }]);
    await expect(page.getByRole('button', { name: 'Meldingen (1 ongelezen)' })).toBeVisible();

    // Alles gelezen vanuit het paneel = POST zonder ids; de teller valt weg.
    await page.getByRole('button', { name: 'Meldingen (1 ongelezen)' }).click();
    await page.getByRole('menu', { name: 'Meldingen' }).getByRole('button', { name: 'Alles gelezen' }).click();
    expect(posts).toEqual([{ ids: ['m1'] }, {}]);
    // Scope op de topbar: de zijbalk heeft óók een 'Meldingen'-knop.
    await expect(page.locator('header').getByRole('button', { name: 'Meldingen', exact: true })).toBeVisible();

    // Het paneel blijft open na "Alles gelezen"; de voet brengt je naar het
    // volledige scherm.
    await page.getByRole('menuitem', { name: 'Alle meldingen' }).click();
    await expect(page.getByRole('heading', { name: 'Meldingen', level: 1 })).toBeVisible();
  });

  test('scherm: lijst per dag, filterchip en markeer alles als gelezen', async ({ page }) => {
    const posts: unknown[] = [];
    await seed(page, {
      user: CHAUFFEUR,
      view: 'meldingen',
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

    await expect(page.getByRole('heading', { name: 'Meldingen', level: 1 })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('heading', { name: 'Vandaag', level: 2 })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Ongelezen · 2' })).toBeVisible();

    // Filterchip op soort.
    await page.getByRole('button', { name: 'Planning', exact: true }).click();
    await expect(page.getByRole('button', { name: /Verlof goedgekeurd/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Rooster bijgewerkt/ })).toBeVisible();
    await page.getByRole('button', { name: 'Alles', exact: true }).click();

    await page.getByRole('button', { name: 'Markeer alles als gelezen' }).click();
    expect(posts).toEqual([{}]);
    await expect(page.getByRole('button', { name: 'Markeer alles als gelezen' })).toHaveCount(0);
  });

  test('verwijderen: meteen weg, DELETE pas na de ongedaan-toast, ongedaan houdt hem', async ({ page }) => {
    const deletes: unknown[] = [];
    await seed(page, {
      user: CHAUFFEUR,
      view: 'meldingen',
      extra: (pad, request) => {
        if (pad.endsWith('/api/meldingen') && request.method() === 'DELETE') {
          deletes.push(request.postDataJSON());
          return { success: true, verwijderd: 1 };
        }
        if (pad.endsWith('/api/meldingen')) return { meldingen: MELDINGEN, ongelezen: 2 };
        return undefined;
      },
    });
    await page.goto('/');

    const rij = page.getByRole('button', { name: /Rooster bijgewerkt/ });
    await expect(rij).toBeVisible({ timeout: 15_000 });

    // Ongedaan maken: de melding komt terug en er vertrekt geen DELETE.
    await page.getByRole('button', { name: 'Melding verwijderen' }).nth(1).click();
    await expect(rij).toHaveCount(0);
    await page.getByRole('button', { name: 'Ongedaan maken' }).click();
    await expect(rij).toBeVisible();

    // Echt verwijderen: weg uit de lijst, DELETE volgt als de toast verlopen is.
    await page.getByRole('button', { name: 'Melding verwijderen' }).nth(1).click();
    await expect(rij).toHaveCount(0);
    await expect.poll(() => deletes, { timeout: 15_000 }).toEqual([{ ids: ['m2'] }]);
  });

  test('lege staat zonder meldingen', async ({ page }) => {
    await seed(page, { user: CHAUFFEUR, view: 'meldingen', extra: (pad) => (pad.endsWith('/api/meldingen') ? { meldingen: [], ongelezen: 0 } : undefined) });
    await page.goto('/');
    await expect(page.getByText('Nog geen meldingen')).toBeVisible({ timeout: 15_000 });
  });
});
