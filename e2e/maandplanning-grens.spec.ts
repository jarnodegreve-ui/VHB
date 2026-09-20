import { test, expect } from '@playwright/test';
import { ADMIN, seed } from './helpers';
import { USERS } from '../scripts/audit-fixtures.mjs';

/**
 * De maandplanning bladert niet voorbij de geïmporteerde planning (Jarno
 * 18-09: "na 8 november kan er ook al gescrolld worden terwijl ik maar tem 8
 * november geïmporteerd heb"). Een leeg bord leest als "er staat niemand
 * ingepland", terwijl er simpelweg nog niets is. De server stuurt de grenzen
 * mee in /api/month-planning (`geimporteerd`), het bord zet de pijl uit.
 */

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const plus = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return iso(d); };
const maandVan = (d: string) => d.slice(0, 7);

test('maandplanning bladert niet voorbij de laatste geïmporteerde dag', async ({ page }) => {
  // Import loopt tot over 5 dagen; het volgende venster (+14) valt er volledig buiten.
  const laatste = plus(5);
  const dagen = Array.from({ length: 12 }, (_, i) => plus(i - 6)).filter((d) => d <= laatste && maandVan(d) === maandVan(plus(0)));
  const chauffeurs = USERS.filter((u: any) => u.role === 'chauffeur').slice(0, 3);
  await seed(page, {
    user: ADMIN,
    view: 'bezetting',
    extra: (pad) => pad.includes('/api/month-planning')
      ? {
          month: maandVan(plus(0)),
          dates: dagen,
          drivers: chauffeurs.map((u: any) => ({ id: String(u.id), name: u.name, section: null })),
          cells: Object.fromEntries(chauffeurs.map((u: any, i: number) => [
            String(u.id),
            Object.fromEntries(dagen.map((d) => [d, { code: `21${(i + 1) * 2}`, kind: 'service', label: '', segments: [] }])),
          ])),
          // Ruim vóór het venster: met `dagen[0]` (vandaag - 6) viel de eerste dag op
          // zondag precies op de maandag waarmee het tweewekenvenster begint, en
          // stond "Vorige 2 weken" terecht uit. De test faalde dus elke zondag.
          geimporteerd: { eerste: plus(-30), laatste },
        }
      : undefined,
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/maandplanning');

  // Vooruit kan niet meer, terug wel: daar staat wél planning.
  await expect(page.getByRole('button', { name: 'Volgende 2 weken' })).toBeDisabled({ timeout: 15_000 });
  await expect(page.getByRole('button', { name: 'Vorige 2 weken' })).toBeEnabled();
});
