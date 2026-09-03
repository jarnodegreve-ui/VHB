import { test, expect } from '@playwright/test';
import { ADMIN, CHAUFFEUR, seed } from './helpers';

/**
 * Desktop-viewport (1440×900, project "Desktop (chromium)"): de schermen die
 * op `lg+` een ándere DOM renderen dan mobiel — master-detail, sorteerbare
 * tabellen met bulk-selectie, paginering. De mobiele specs dekken dit niet:
 * daar is de tabel `hidden md:block` en het detail een uitklapper.
 */

test.describe('desktop: master-detail Omleidingen', () => {
  test('klik op de tweede omleiding wisselt het detail rechts', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));
    await seed(page, {
      user: CHAUFFEUR,
      view: 'omleidingen',
      // Twee actieve omleidingen: het paneel opent standaard op de eerste.
      extra: (pad) => (pad.endsWith('/api/diversions') ? [
        { id: 'd1', line: '58', title: 'Werken Markt Zottegem', description: 'Omleiding via de ring.', startDate: '2026-01-01', endDate: '2099-12-31', severity: 'medium' },
        { id: 'd2', line: '23', title: 'Wielerwedstrijd Herzele', description: 'Doortocht afgesloten tussen 12u en 18u.', startDate: '2026-01-01', endDate: '2099-12-31', severity: 'high' },
      ] : undefined),
    });
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Omleidingen', level: 1 })).toBeVisible({ timeout: 15_000 });

    // Eerste omleiding is de standaardkeuze: gemarkeerd in de lijst, detail
    // rechts (DetailPaneel = <section aria-label={titel}>).
    const eerste = page.getByRole('region', { name: 'Werken Markt Zottegem' });
    const tweede = page.getByRole('region', { name: 'Wielerwedstrijd Herzele' });
    await expect(eerste).toBeVisible();
    await expect(eerste.getByRole('heading', { level: 2 })).toHaveText('Werken Markt Zottegem');
    await expect(tweede).toHaveCount(0);
    await expect(page.locator('[aria-current="true"]')).toContainText('Werken Markt Zottegem');

    await page.getByRole('button', { name: /Wielerwedstrijd Herzele/ }).click();

    await expect(tweede).toBeVisible();
    await expect(tweede.getByRole('heading', { level: 2 })).toHaveText('Wielerwedstrijd Herzele');
    await expect(tweede).toContainText('Doortocht afgesloten tussen 12u en 18u.');
    await expect(eerste).toHaveCount(0);
    await expect(page.locator('[aria-current="true"]')).toContainText('Wielerwedstrijd Herzele');
    await expect(page.locator('[aria-current="true"]')).toHaveCount(1);
    // Geen SlideOver (mobiel patroon) op desktop: het detail staat inline.
    await expect(page.getByRole('dialog')).toHaveCount(0);

    expect(pageErrors, `page errors:\n${pageErrors.join('\n')}`).toEqual([]);
  });
});

test.describe('desktop: gebruikerslijst', () => {
  test('sorteren op Laatst actief wisselt aria-sort', async ({ page }) => {
    await seed(page, {
      user: ADMIN,
      view: 'gebruikers',
      extra: (pad) => (pad.endsWith('/api/users') ? [
        { ...ADMIN, lastLogin: '2026-09-02T08:00:00.000Z' },
        { ...CHAUFFEUR, lastLogin: '2026-09-01T08:00:00.000Z' },
        { id: '43', name: 'Alex Du Priez', role: 'chauffeur', employeeId: 'VHB-000043', email: 'alex@vhb.be', isActive: true, lastLogin: '2026-08-15T08:00:00.000Z' },
        { id: '44', name: 'Diether Van Haute', role: 'chauffeur', employeeId: 'VHB-000044', email: 'diether@vhb.be', isActive: true },
      ] : undefined),
    });
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Gebruikers', level: 1 })).toBeVisible({ timeout: 15_000 });

    const naam = page.getByRole('columnheader', { name: 'Medewerker' });
    const laatst = page.getByRole('columnheader', { name: 'Laatst actief' });
    // Standaard: op naam, oplopend.
    await expect(naam).toHaveAttribute('aria-sort', 'ascending');
    await expect(laatst).not.toHaveAttribute('aria-sort', /.+/);

    await laatst.getByRole('button').click();
    await expect(laatst).toHaveAttribute('aria-sort', 'ascending');
    await expect(naam).not.toHaveAttribute('aria-sort', /.+/);
    // Oplopend: oudste eerst; "nooit" (null) altijd achteraan.
    const rijen = page.locator('tbody tr');
    await expect(rijen.first()).toContainText('Alex Du Priez');
    await expect(rijen.last()).toContainText('Diether Van Haute');

    await laatst.getByRole('button').click();
    await expect(laatst).toHaveAttribute('aria-sort', 'descending');
    await expect(rijen.first()).toContainText('Jarno De Greve');
    await expect(rijen.last()).toContainText('Diether Van Haute');
  });

  test('"Alles selecteren" toont de bulk-balk', async ({ page }) => {
    await seed(page, { user: ADMIN, view: 'gebruikers' });
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Gebruikers', level: 1 })).toBeVisible({ timeout: 15_000 });

    const bulk = page.getByRole('region', { name: 'Bulkacties' });
    await expect(bulk).toHaveCount(0);

    // De echte <input> is sr-only achter het getekende vinkje: klik het label
    // (zoals een gebruiker doet) i.p.v. check() op het verborgen veld.
    const alles = page.getByRole('checkbox', { name: 'Alles selecteren' });
    await page.locator('label').filter({ has: alles }).click();
    await expect(alles).toBeChecked();
    await expect(bulk).toBeVisible();
    // Drie chauffeurs selecteerbaar; de enige actieve admin is beschermd.
    await expect(bulk).toContainText('3 geselecteerd');
    await expect(bulk.getByRole('button', { name: 'Pauzeren' })).toBeVisible();

    await bulk.getByRole('button', { name: 'Selectie wissen' }).click();
    await expect(bulk).toHaveCount(0);
    await expect(alles).not.toBeChecked();
  });
});

test.describe('desktop: activiteitenlog', () => {
  test('60 rijen → tweede pagina via de paginering', async ({ page }) => {
    // 60 regels binnen het standaardvenster van 7 dagen, elk 1 uur ouder.
    const rijen = Array.from({ length: 60 }, (_, i) => ({
      id: `a${i}`,
      createdAt: new Date(Date.now() - i * 3600e3).toISOString(),
      actorName: 'Jarno De Greve',
      actorRole: 'admin',
      category: i % 2 ? 'users' : 'planning',
      action: `Actie ${String(i + 1).padStart(2, '0')}`,
      details: `Regel ${i + 1} van 60.`,
    }));
    await seed(page, {
      user: ADMIN,
      view: 'activiteit',
      extra: (pad) => (pad.endsWith('/api/activity') ? rijen : undefined),
    });
    await page.goto('/');
    await expect(page.getByText('Recente activiteit')).toBeVisible({ timeout: 15_000 });

    await expect(page.getByText('1–50 van 60')).toBeVisible();
    await expect(page.locator('tbody tr')).toHaveCount(50);
    await expect(page.getByText('Actie 01', { exact: true })).toBeVisible();
    await expect(page.getByText('Actie 60', { exact: true })).toHaveCount(0);

    await page.getByRole('button', { name: 'Volgende pagina' }).click();
    await expect(page.getByText('51–60 van 60')).toBeVisible();
    await expect(page.locator('tbody tr')).toHaveCount(10);
    await expect(page.getByText('Actie 60', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Volgende pagina' })).toBeDisabled();

    await page.getByRole('button', { name: 'Vorige pagina' }).click();
    await expect(page.getByText('1–50 van 60')).toBeVisible();
  });
});
