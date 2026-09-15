import { test, expect, type Locator } from '@playwright/test';
import { ADMIN, seed } from './helpers';

const LANGE_NAAM = 'Jean-Christophe Van Den Broeck-De Smet';
const NU = new Date('2026-09-15T12:00:00+02:00');
// Een gebruikelijke werkweek: herhaalde sessies, 12 mensen vandaag,
// 37 verschillende mensen in zeven dagen en 438 aanmeldingen totaal.
const LOGINS = Array.from({ length: 438 }, (_, i) => {
  const dag = i < 60 ? 0 : 1 + ((i - 60) % 6);
  const persoon = i < 60 ? i % 12 : (i - 60) % 37;
  return {
    id: `login-layout-${i}`,
    actorName: persoon === 0 ? LANGE_NAAM : `Testgebruiker ${persoon + 1}`,
    actorRole: 'chauffeur',
    entityId: `gebruiker-${persoon}`,
    action: 'Aangemeld', category: 'auth', details: '',
    createdAt: new Date(NU.getTime() - dag * 864e5 - i * 10_000).toISOString(),
  };
});

/** Meet de getekende tekstregels, niet alleen de breedte van het element.
 *  Een ellipsis of overflow:hidden maakt een te lange tekst hiermee niet
 *  onzichtbaar voor de test. Omloop naar meerdere regels is wel toegestaan. */
async function tekstBinnenVak(tekst: Locator) {
  return tekst.evaluate((el) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    const regels = [...range.getClientRects()].filter((r) => r.width > 0 && r.height > 0);
    const vak = el.getBoundingClientRect();
    return regels.every((r) => r.left >= vak.left - 1 && r.right <= vak.right + 1
      && r.top >= vak.top - 1 && r.bottom <= vak.bottom + 1);
  });
}

const PROFIELEN = [
  { naam: 'mobiel 320', width: 320, height: 780 },
  { naam: 'mobiel 402', width: 402, height: 874 },
  { naam: 'desktop', width: 1440, height: 1000 },
] as const;

for (const profiel of PROFIELEN) {
  test(`activiteit · ${profiel.naam}: volledige tegeltekst, namen en dagdetails`, async ({ browser, baseURL }) => {
    const context = await browser.newContext({
      baseURL, viewport: { width: profiel.width, height: profiel.height },
      isMobile: profiel.width < 768, hasTouch: profiel.width < 768,
      timezoneId: 'Europe/Brussels', serviceWorkers: 'block',
    });
    try {
      const page = await context.newPage();
      await page.clock.setFixedTime(NU);
      await seed(page, {
        user: ADMIN, view: 'activiteit', thema: 'dark',
        extra: (pad) => pad.endsWith('/api/activity/logins') ? { logins: LOGINS } : undefined,
      });
      await page.goto('/beheer/activiteit');
      const gebruik = page.locator('section').filter({
        has: page.getByRole('heading', { name: 'Actieve gebruikers', exact: true }),
      });
      await expect(gebruik).toBeVisible({ timeout: 15_000 });
      const kpis = gebruik.locator('dl');
      for (const waarde of ['12', '37', '438']) {
        await expect(kpis.getByText(waarde, { exact: true })).toBeVisible();
      }
      await page.evaluate(() => document.fonts.ready);

      const buitenTegel = await kpis.evaluate((dl) => [...dl.querySelectorAll('dt')].flatMap((dt) => {
        const tegel = dt.parentElement!;
        const grens = tegel.getBoundingClientRect();
        return [...tegel.querySelectorAll('dt, dd')].flatMap((tekst) => {
          const range = document.createRange();
          range.selectNodeContents(tekst);
          const eigenVak = tekst.getBoundingClientRect();
          const past = [...range.getClientRects()].every((r) => r.width === 0 || (
            r.left >= Math.max(grens.left, eigenVak.left) - 1
            && r.right <= Math.min(grens.right, eigenVak.right) + 1
            && r.top >= Math.max(grens.top, eigenVak.top) - 1
            && r.bottom <= Math.min(grens.bottom, eigenVak.bottom) + 1
          ));
          return past ? [] : [tekst.textContent];
        });
      }));
      expect(buitenTegel, 'ieder label, getal en onderschrift blijft volledig binnen zijn tegel').toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);

      const recenteNaam = gebruik.getByText(LANGE_NAAM, { exact: true }).first();
      await expect(recenteNaam).toBeVisible();
      expect(await tekstBinnenVak(recenteNaam), 'de volledige naam past in de recente aanmelding').toBe(true);

      // Een dag blijft aanklikbaar, ook wanneer de grafiek mobiel compacter
      // wordt. Namen zijn ook in het geopende venster volledig leesbaar.
      await gebruik.getByRole('button', { name: 'vandaag: 12 actief', exact: true }).click();
      const dagvenster = page.getByRole('dialog').filter({
        has: page.getByRole('heading', { name: 'Vandaag', exact: true }),
      });
      await expect(dagvenster).toBeVisible();
      const dagNaam = dagvenster.getByText(LANGE_NAAM, { exact: true });
      await expect(dagNaam).toBeVisible();
      expect(await tekstBinnenVak(dagNaam), 'de volledige naam past in het dagvenster').toBe(true);
      await dagvenster.getByRole('button', { name: 'Sluiten', exact: true }).click();
      await expect(dagvenster).toHaveCount(0);

      await gebruik.getByRole('button', { name: /^Alle dagen \(7\)$/ }).click();
      const alleDagen = page.getByRole('dialog').filter({
        has: page.getByRole('heading', { name: 'Actieve gebruikers per dag', exact: true }),
      });
      await expect(alleDagen).toBeVisible();
      await alleDagen.getByRole('button', { name: /^vandaag/ }).click();
      await expect(dagvenster).toBeVisible();
      await expect(dagvenster.getByText(LANGE_NAAM, { exact: true })).toBeVisible();
      await dagvenster.getByRole('button', { name: 'Sluiten', exact: true }).click();
      await expect(alleDagen).toBeVisible();
      await alleDagen.getByRole('button', { name: 'Sluiten', exact: true }).click();
      await expect(page.getByRole('dialog')).toHaveCount(0);
    } finally {
      await context.close();
    }
  });
}
