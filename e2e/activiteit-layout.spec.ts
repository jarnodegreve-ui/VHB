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
  { naam: 'mobiel 375', width: 375, height: 812 },
  { naam: 'mobiel 402', width: 402, height: 874 },
  { naam: 'desktop', width: 1440, height: 1000 },
] as const;

for (const profiel of PROFIELEN) {
  test(`activiteit · ${profiel.naam}: volledige tegeltekst, namen en tijdbalken`, async ({ browser, baseURL }) => {
    // Eén lange doorloop (tegels, as, uitklappen, filter, dagwissel). Lokaal
    // ±4 s, maar WebKit op de CI-runner haalde de standaard 30 s niet meer:
    // sinds 20-09 viel het desktopprofiel daar bij elke run om op de
    // time-out, ook bij de herpoging, en kleurde main rood. Driedubbele
    // limiet; een echte hang valt zo nog altijd om.
    test.slow();
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

      // Dicht (standaard, Jarno 20-09): per persoon alleen naam, balk en
      // totale tijd. Geen periodes en geen plaats in beeld, en de rij is een
      // knop van minstens 44 px hoog.
      const knopPerson3 = aanwezigheid.getByRole('button', { name: /^Testgebruiker 4, 1 u 35 actief in 2 periodes, aanmelding van buiten België$/ });
      const paneelPerson3 = aanwezigheid.getByRole('list', { name: 'Periodes van Testgebruiker 4' });
      // Een dichtgeklapt paneel blijft in de DOM staan (Uitklap houdt de
      // inhoud vast voor de sluitbeweging), dus "dicht" is: uit de
      // toegankelijkheidsboom, inert, en nul pixels hoog.
      const paneelDicht = async () => {
        await expect(paneelPerson3).toHaveCount(0);
        const houder = page.locator('[id="tijdbalk-periodes-gebruiker-3"]');
        await expect(houder).toHaveAttribute('aria-hidden', 'true');
        await expect.poll(() => houder.evaluate((el) => Math.round(el.getBoundingClientRect().height))).toBe(0);
      };
      await expect(knopPerson3).toHaveAttribute('aria-expanded', 'false');
      await expect(aanwezigheid.getByText('01:00–01:50')).toBeHidden();
      await expect(aanwezigheid.getByText('Lille, Frankrijk')).toBeHidden();
      await expect(aanwezigheid.getByText(/^\d{2}:\d{2}–\d{2}:\d{2}$/).filter({ visible: true })).toHaveCount(0);
      await expect(aanwezigheid.getByText('Gent, BE').filter({ visible: true })).toHaveCount(0);
      const rijHoogtes = await aanwezigheid.locator('button[aria-controls^="tijdbalk-periodes-"]').evaluateAll((knoppen) => knoppen.map((k) => k.getBoundingClientRect().height));
      expect(rijHoogtes).toHaveLength(12);
      expect(Math.min(...rijHoogtes), 'elke rij is een aanraakdoel van minstens 44 px').toBeGreaterThanOrEqual(44);

      // Het veiligheidssignaal blijft in de dichte rij staan: één amber stip,
      // bij de persoon met de sessie uit Frankrijk en bij niemand anders.
      await expect(aanwezigheid.locator('[data-buitenland]')).toHaveCount(1);
      await expect(knopPerson3.locator('[data-buitenland]')).toBeVisible();

      // Open met het toetsenbord: de rij is een echte knop, dus Enter en de
      // spatiebalk werken. Eén regel per periode met tijd, duur en plaats.
      await knopPerson3.focus();
      await page.keyboard.press('Enter');
      await expect(knopPerson3).toHaveAttribute('aria-expanded', 'true');
      await expect(paneelPerson3.getByRole('listitem')).toHaveCount(2);
      await expect(paneelPerson3.getByText('01:00–01:50')).toBeVisible();
      await expect(paneelPerson3.getByText('50 min')).toBeVisible();
      await expect(paneelPerson3.getByText('Lille, Frankrijk')).toBeVisible();
      await expect(paneelPerson3.getByText('11:00–11:45')).toBeVisible();
      await expect(paneelPerson3.getByText('Gent, BE')).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
      const paneelBinnenKaart = await paneelPerson3.evaluate((ul) => {
        const kaart = ul.closest('section')!.getBoundingClientRect();
        return [...ul.querySelectorAll('li > span')].every((cel) => {
          const r = cel.getBoundingClientRect();
          return r.width === 0 || (r.left >= kaart.left - 1 && r.right <= kaart.right + 1);
        });
      });
      expect(paneelBinnenKaart, 'tijd, duur en plaats blijven binnen de kaart').toBe(true);

      // Meerdere tegelijk open: een tweede rij openen laat de eerste staan,
      // zodat er niets boven je vinger dichtklapt en de lijst niet verspringt.
      // Person 5 heeft een sessie van vóór de migratie, zonder plaats.
      const knopPerson5 = aanwezigheid.getByRole('button', { name: /^Testgebruiker 6, / });
      await knopPerson5.click();
      await expect(knopPerson5).toHaveAttribute('aria-expanded', 'true');
      await expect(knopPerson3).toHaveAttribute('aria-expanded', 'true');
      await expect(aanwezigheid.getByRole('list', { name: 'Periodes van Testgebruiker 6' }).getByText('Plaats onbekend')).toBeVisible();
      // En weer dicht met de spatiebalk.
      await knopPerson3.focus();
      await page.keyboard.press('Space');
      await expect(knopPerson3).toHaveAttribute('aria-expanded', 'false');
      await paneelDicht();
      await knopPerson5.click();

      // Het filter: alleen wie van buiten België kwam, en die rij staat dan
      // meteen open (wie filtert wil zien wanneer en van waar). Dichtklappen
      // kan nog steeds, en het filter uitzetten brengt alles terug naar dicht.
      const chip = aanwezigheid.getByRole('button', { name: 'Buiten België: 1' });
      await chip.click();
      await expect(aanwezigheid.getByText('1 van 12 personen', { exact: true })).toBeVisible();
      await expect(aanwezigheid.getByLabel(/ actief van /)).toHaveCount(2);
      await expect(knopPerson3).toHaveAttribute('aria-expanded', 'true');
      await expect(paneelPerson3.getByText('Lille, Frankrijk')).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
      await knopPerson3.click();
      await expect(knopPerson3).toHaveAttribute('aria-expanded', 'false');
      await chip.click();
      await expect(aanwezigheid.getByText('12 personen', { exact: true })).toBeVisible();
      await expect(knopPerson3).toHaveAttribute('aria-expanded', 'false');
      await paneelDicht();
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
