import { test, expect } from '@playwright/test';
import { ADMIN, seed } from './helpers';

const DIENSTEN = [
  { id: 'dienst-2515', serviceNumber: '2515', loopnr: '4505', startTime: '07:08', endTime: '08:34', loopnr2: '4510', startTime2: '15:13', endTime2: '21:55', loopnr3: '4515', startTime3: '24:10', endTime3: '25:10' },
  { id: 'dienst-2101', serviceNumber: '2101', loopnr: '4500', startTime: '04:36', endTime: '07:52', loopnr2: '4611', startTime2: '13:39', endTime2: '17:29' },
  { id: 'dienst-2607', serviceNumber: '2607', loopnr: '4500', startTime: '15:41', endTime: '26:16' },
];

// 1280 activeerde vroeger het zijvak terwijl er onvoldoende breedte voor
// alle acht tabelkolommen overbleef. 1536 bewaakt de nieuwe grens.
for (const breedte of [390, 768, 1024, 1280, 1440, 1536]) {
  test(`dienstoverzicht · ${breedte}px: alle dienstgegevens en acties passen`, async ({ browser, baseURL }) => {
    const context = await browser.newContext({
      baseURL, viewport: { width: breedte, height: 1000 },
      isMobile: breedte < 768, hasTouch: breedte < 1024, serviceWorkers: 'block',
    });
    try {
      const page = await context.newPage();
      await seed(page, {
        user: ADMIN, view: 'dienstoverzicht', thema: 'dark',
        extra: (pad) => pad.endsWith('/api/services') ? DIENSTEN : undefined,
      });
      await page.goto('/beheer/dienstoverzicht');
      await expect(page.getByRole('heading', { name: 'Dienstoverzicht', level: 1 })).toBeVisible({ timeout: 15_000 });
      const acties = page.getByRole('button', { name: 'Acties voor dienst 2515', exact: true });
      await expect(acties).toBeVisible();
      await page.evaluate(() => document.fonts.ready);

      const tabel = page.getByRole('table');
      if (breedte >= 1280) await expect(tabel).toBeVisible();
      if (await tabel.count()) {
        const meting = await tabel.evaluate((el) => {
          const kaart = el.closest('.surface-table')!.getBoundingClientRect();
          const r = el.getBoundingClientRect();
          const buitenCel = [...el.querySelectorAll('th, td')].flatMap((cel) => {
            const grens = cel.getBoundingClientRect();
            const range = document.createRange();
            range.selectNodeContents(cel);
            const past = [...range.getClientRects()].every((tekst) => tekst.width === 0 || (
              tekst.left >= grens.left - 1 && tekst.right <= grens.right + 1
              && tekst.left >= kaart.left - 1 && tekst.right <= kaart.right + 1
            ));
            return past ? [] : [cel.textContent];
          });
          return { past: r.left >= kaart.left - 1 && r.right <= kaart.right + 1, buitenCel };
        });
        expect(meting.past, 'de volledige tabel blijft binnen de kaart, zonder afgeknipte rechterkolommen').toBe(true);
        expect(meting.buitenCel, 'koppen, loopnummers en uren passen volledig in hun kolom').toEqual([]);
        await expect(tabel.getByRole('columnheader', { name: 'Acties', exact: true })).toBeInViewport({ ratio: 1 });
      }

      for (const tijdvak of ['07:08–08:34', '15:13–21:55', '24:10–25:10']) {
        await expect(page.getByText(tijdvak, { exact: true }).filter({ visible: true })).toBeInViewport({ ratio: 1 });
      }
      await expect(acties).toBeInViewport({ ratio: 1 });
      const positie = await acties.boundingBox();
      expect(positie!.x + positie!.width).toBeLessThanOrEqual(breedte);
      expect(await page.locator('[data-scroll-root]').evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);

      // De rechterkolom is ook werkelijk bruikbaar. Openen leest bestaande
      // gegevens; deze regressie verstuurt geen wijziging naar de API.
      await acties.click();
      await page.getByRole('menuitem', { name: 'Bewerken', exact: true }).click();
      // Het detailpaneel (3D.2): een SlideOver op elke breedte, de tabel blijft staan.
      const dialoog = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Dienst 2515' }) });
      await expect(dialoog).toBeVisible();
      await expect(dialoog.getByLabel('Dienstnummer', { exact: true })).toHaveValue('2515');
      await expect(dialoog.getByLabel('Loopnummer (deel 3)', { exact: true })).toHaveValue('4515');
      await expect(dialoog.getByLabel('Eindtijd (deel 3)', { exact: true })).toHaveValue('25:10');
      await dialoog.getByRole('button', { name: 'Sluiten', exact: true }).click();
      await expect(dialoog).toHaveCount(0);

      await page.getByRole('searchbox', { name: 'Zoek op dienst- of loopnummer…' }).fill('4515');
      await expect(acties).toBeVisible();
      await expect(page.getByRole('button', { name: 'Acties voor dienst 2101', exact: true })).toHaveCount(0);
    } finally {
      await context.close();
    }
  });
}
