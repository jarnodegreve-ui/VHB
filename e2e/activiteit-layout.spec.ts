import { test, expect, type Locator } from '@playwright/test';
import { ADMIN, seed } from './helpers';

const LANGE_NAAM = 'Jean-Christophe Van Den Broeck-De Smet';
const NU = new Date('2026-09-15T12:00:00+02:00');
const UUR = 3600_000;

const naamVan = (p: number) => (p === 0 ? LANGE_NAAM : `Testgebruiker ${p + 1}`);
// Plaats van aanmelden (20-09): iedereen in België, behalve het eerste blok
// van person 3, dat uit Frankrijk kwam. Person 5 heeft geen plaats (een sessie
// van vóór de migratie), zodat ook die toestand getoetst wordt.
const GENT = { land: 'BE', regio: 'VOV', stad: 'Gent' };
const LILLE = { land: 'FR', regio: 'HDF', stad: 'Lille' };
const sessie = (p: number, van: Date, duurMin: number, plaats: Record<string, string> = p === 5 ? {} : GENT) => ({
  userId: `gebruiker-${p}`,
  naam: naamVan(p),
  rol: 'chauffeur',
  van: van.toISOString(),
  tot: new Date(van.getTime() + duurMin * 60_000).toISOString(),
  ...plaats,
});

/**
 * Een gebruikelijke werkweek: 12 mensen vandaag (van wie er 3 nu nog online
 * zijn), en 37 verschillende mensen over zeven dagen. Person 0 draagt de lange
 * naam, zodat elke plek waar een naam staat op 320 px getoetst wordt.
 */
const SESSIES = [
  // Nu bezig: hun laatste teken van leven is het huidige moment.
  ...[0, 1, 2].map((p) => sessie(p, new Date(NU.getTime() - 2 * UUR), 120)),
  // Vandaag geweest, intussen weg. Alle offsets blijven onder de twaalf uur,
  // anders schuift een sessie over middernacht naar de vorige dag en klopt de
  // dagtelling niet meer.
  ...[3, 4, 5, 6, 7, 8, 9, 10, 11].map((p) => sessie(p, new Date(NU.getTime() - (p - 2) * UUR), 45)),
  // Person 3 rijdt een gesplitste dienst: twee losse periodes op dezelfde dag,
  // die niet tot één balk samengeplakt mogen worden.
  sessie(3, new Date(NU.getTime() - 11 * UUR), 50, LILLE),
  // De zes dagen ervoor, samen goed voor 37 unieke mensen over de week.
  ...Array.from({ length: 25 }, (_, i) => {
    const p = 12 + i;
    const dagenTerug = 1 + (i % 6);
    return sessie(p, new Date(NU.getTime() - dagenTerug * 24 * UUR - 4 * UUR), 60);
  }),
];

// Echte aanmeldingen zijn een ándere vraag met een andere bron: wie zich
// opnieuw moest aanmelden. Blijft in de rechterkolom staan.
const LOGINS = Array.from({ length: 30 }, (_, i) => ({
  id: `login-layout-${i}`,
  actorName: i === 0 ? LANGE_NAAM : `Testgebruiker ${(i % 12) + 1}`,
  actorRole: 'chauffeur',
  entityId: `gebruiker-${i % 12}`,
  action: 'Aangemeld', category: 'auth', details: '',
  createdAt: new Date(NU.getTime() - i * 600_000).toISOString(),
}));

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
  test(`activiteit · ${profiel.naam}: volledige tegeltekst, namen en tijdbalken`, async ({ browser, baseURL }) => {
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
        extra: (pad) => {
          if (pad.endsWith('/api/activity/logins')) return { logins: LOGINS };
          if (pad.endsWith('/api/activity/presence')) return { days: 14, sessies: SESSIES };
          return undefined;
        },
      });
      await page.goto('/beheer/activiteit');
      const aanwezigheid = page.locator('section').filter({
        has: page.getByRole('heading', { name: 'Wie was wanneer actief', exact: true }),
      });
      await expect(aanwezigheid).toBeVisible({ timeout: 15_000 });

      // De vier kengetallen: nu online, vandaag actief, uniek deze week, en
      // wie zich van buiten België aanmeldde.
      const kpis = aanwezigheid.locator('dl');
      for (const waarde of ['3', '12', '37', '1']) {
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

      const recenteNaam = aanwezigheid.getByText(LANGE_NAAM, { exact: true }).first();
      await expect(recenteNaam).toBeVisible();
      expect(await tekstBinnenVak(recenteNaam), 'de volledige naam past in de recente aanmelding').toBe(true);

      // De tijdbalken staan standaard op vandaag: twaalf mensen, en person 3
      // heeft twee losse periodes (gesplitste dienst) die niet samengeplakt
      // mogen worden.
      await expect(aanwezigheid.getByText('12 personen', { exact: true })).toBeVisible();
      const gesplitst = aanwezigheid.getByLabel(/^Testgebruiker 4 actief van /);
      await expect(gesplitst).toHaveCount(2);

      // Ingeklapt: acht balken zichtbaar, de rest achter de knop. Zonder dit
      // werd "Vandaag" bij 12 tot 40 actieve mensen één lange lap waar je
      // doorheen moest scrollen om bij het auditspoor te komen (Jarno 18-09).
      const uitklapKnop = aanwezigheid.getByRole('button', { name: 'Toon alle 12' });
      await expect(uitklapKnop).toBeVisible();
      await expect(aanwezigheid.getByLabel(/ actief van /)).toHaveCount(9); // 8 rijen, person 3 heeft er twee
      await uitklapKnop.click();
      await expect(aanwezigheid.getByRole('button', { name: 'Toon minder' })).toBeVisible();
      await expect(aanwezigheid.getByLabel(/ actief van /)).toHaveCount(13); // alle 12, person 3 telt dubbel

      // Uuras: een fijne lijn per uur in elke balk, met labels om de 2 uur op
      // desktop en om de 6 uur op een telefoon. Person 3 was vandaag om 01:00
      // al actief, dus de as toont het volle etmaal (23 binnenlijnen). Elk
      // label staat binnen de as, ook "24" aan de rechterrand.
      const as = aanwezigheid.locator('[data-uuras]');
      const breed = profiel.width >= 1024;
      expect(await as.locator('span').allTextContents()).toEqual(breed
        ? ['00', '02', '04', '06', '08', '10', '12', '14', '16', '18', '20', '22', '24']
        : ['00', '06', '12', '18', '24']);
      const eersteBalk = aanwezigheid.locator('[data-uurlijn]').first().locator('..');
      await expect(eersteBalk.locator('[data-uurlijn]')).toHaveCount(23);
      await expect(eersteBalk.locator('[data-uurlijn="sterk"]')).toHaveCount(breed ? 11 : 3);
      const labelsBinnenAs = await as.evaluate((el) => {
        const vak = el.getBoundingClientRect();
        return [...el.querySelectorAll('span')].every((l) => {
          const r = l.getBoundingClientRect();
          return r.left >= vak.left - 8 && r.right <= vak.right + 1;
        });
      });
      expect(labelsBinnenAs, 'geen uurlabel steekt buiten de as').toBe(true);
      // Een label staat exact boven zijn lijn: "12" boven de lijn van 12 uur.
      const verschil = await aanwezigheid.evaluate((sectie) => {
        const label = [...sectie.querySelectorAll('[data-uuras] span')].find((l) => l.textContent === '12')!.getBoundingClientRect();
        const lijnen = [...sectie.querySelector('[data-uurlijn]')!.parentElement!.querySelectorAll('[data-uurlijn]')];
        const twaalf = lijnen[11].getBoundingClientRect(); // 01, 02, … : index 11 = 12 uur
        return Math.abs((label.left + label.width / 2) - (twaalf.left + twaalf.width / 2));
      });
      expect(verschil, 'label 12 staat boven de lijn van 12 uur').toBeLessThanOrEqual(1);

      // Exacte tijden staan uitgeschreven onder de balk (een title-tooltip
      // bestaat niet op een telefoon), en de plaats erachter.
      const rijPerson3 = aanwezigheid.getByText('Testgebruiker 4', { exact: true }).locator('xpath=ancestor::div[contains(@class,"grid")][1]');
      await expect(rijPerson3.getByText('01:00–01:50')).toBeVisible();
      await expect(rijPerson3.getByText('11:00–11:45')).toBeVisible();
      await expect(rijPerson3.getByText('Lille, Frankrijk')).toBeVisible();
      await expect(rijPerson3.getByText('Buiten België', { exact: true })).toBeVisible();
      await expect(aanwezigheid.getByText('Buiten België', { exact: true })).toHaveCount(2); // tegel + één rij

      // Het filter: alleen wie van buiten België kwam, en weer terug.
      const chip = aanwezigheid.getByRole('button', { name: 'Buiten België: 1' });
      await chip.click();
      await expect(aanwezigheid.getByText('1 van 12 personen', { exact: true })).toBeVisible();
      await expect(aanwezigheid.getByLabel(/ actief van /)).toHaveCount(2);
      await chip.click();
      await expect(aanwezigheid.getByText('12 personen', { exact: true })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);

      // Een dag in de strip kiezen stuurt de tijdbalken eronder. De dagstrip
      // blijft aanklikbaar, ook wanneer de grafiek mobiel compacter wordt.
      const gisteren = aanwezigheid.getByRole('button', { name: /^gisteren: \d+ actief$/ });
      await gisteren.click();
      await expect(aanwezigheid.getByRole('heading', { name: /^Gisteren/ })).toBeVisible();
      await expect(aanwezigheid.getByText('12 personen', { exact: true })).toHaveCount(0);
      // Gisteren was er niemand vóór 04:00: de as zoomt in op 04:00 tot 24:00,
      // zodat de blokken breder worden (19 binnenlijnen in plaats van 23).
      expect(await as.locator('span').allTextContents()).toEqual(breed
        ? ['04', '06', '08', '10', '12', '14', '16', '18', '20', '22', '24']
        : ['06', '12', '18', '24']);
      await expect(aanwezigheid.locator('[data-uurlijn]').first().locator('..').locator('[data-uurlijn]')).toHaveCount(19);

      // En terug naar vandaag.
      // Vandaag draagt in de strip ook de melding van de buitenlandse sessie.
      await aanwezigheid.getByRole('button', { name: 'vandaag: 12 actief, 1 buiten België', exact: true }).click();
      await expect(aanwezigheid.getByRole('heading', { name: /^Vandaag/ })).toBeVisible();
      await expect(aanwezigheid.getByText('12 personen', { exact: true })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    } finally {
      await context.close();
    }
  });
}
