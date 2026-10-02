import { test, expect, type Page } from '@playwright/test';
import { ADMIN, CHAUFFEUR, seed } from './helpers';
import { USERS } from '../scripts/audit-fixtures.mjs';
import { begrensMaandbord, eersteZichtbareDag } from '../shared/maandplanningTerugblik';

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

/**
 * Terugblik (Jarno 02-10): een chauffeur ziet de Maandplanning vanaf de
 * maandag van de lopende week, niet wat collega's vroeger reden; planner en
 * admin bladeren zoals voorheen. De mock antwoordt zoals de server: het
 * volledige bord voor staf, en voor de rest hetzelfde bord door de echte
 * knipregel (shared/maandplanningTerugblik.ts). De desktopgevallen zetten
 * zelf 1440 px, zoals de test hierboven.
 */
test.describe('terugblik voor wie geen staf is', () => {
  // Vrijdag 02/10/2026: de lopende week begon op maandag 28/09, in de vorige maand.
  const VRIJDAG = new Date('2026-10-02T09:00:00Z');
  // Woensdag 14/10/2026: de lopende week begon op maandag 12/10, midden in de maand.
  const WOENSDAG = new Date('2026-10-14T09:00:00Z');
  // De weekwissel: zondag 04/10 om 23:50 en maandag 05/10 om 00:10 in Brussel
  // (in UTC allebei nog zondag). Twintig minuten uit elkaar, binnen de
  // geldigheid van de testsessie.
  const ZONDAGAVOND = new Date('2026-10-04T21:50:00Z');
  const MAANDAGNACHT = new Date('2026-10-04T22:10:00Z');
  const PLANNER = { ...ADMIN, id: '2', name: 'Pieter Planner', role: 'planner', email: 'planner@vhb.be' };
  const RIJDERS = USERS.filter((u: any) => u.role === 'chauffeur').slice(0, 3);

  const dagenVan = (maand: string) => {
    const [jaar, m] = maand.split('-').map(Number);
    return Array.from({ length: new Date(jaar, m, 0).getDate() }, (_, i) => `${maand}-${String(i + 1).padStart(2, '0')}`);
  };
  /** Het bord van één maand zoals de server het voor staf geeft: elke chauffeur rijdt elke dag. */
  const volBord = (maand: string) => ({
    month: maand,
    dates: dagenVan(maand),
    drivers: RIJDERS.map((u: any) => ({ id: String(u.id), name: u.name, section: null })),
    cells: Object.fromEntries(RIJDERS.map((u: any, i: number) => [
      String(u.id),
      Object.fromEntries(dagenVan(maand).map((d) => [d, { code: `21${i + 1}${d.slice(8)}`, kind: 'service', label: '', segments: ['05:30 - 13:45'] }])),
    ])),
    geimporteerd: { eerste: '2026-01-01', laatste: '2026-12-31' },
  });

  /** Sessie, vaste klok en de maandplanning-mock; geeft de opgevraagde maanden
   *  terug, en `verzet` om de klok van browser én "server" samen te verzetten. */
  async function open(page: Page, user: Record<string, unknown>, start: Date, pad: string, breedte?: number) {
    const gevraagd: string[] = [];
    let nu = start;
    const verzet = async (naar: Date) => { nu = naar; await page.clock.setFixedTime(naar); };
    await page.clock.setFixedTime(nu);
    // De lengte van de historiek vóór de app iets doet: een replace laat ze staan, een push niet.
    await page.addInitScript(() => { (window as any).__startLengte = window.history.length; });
    await seed(page, {
      user,
      view: 'bezetting',
      extra: (p, req) => {
        if (!p.endsWith('/api/month-planning')) return undefined;
        const maand = new URL(req.url()).searchParams.get('month') ?? '';
        gevraagd.push(maand);
        const bord = volBord(maand);
        return user.role === 'planner' || user.role === 'admin' ? bord : begrensMaandbord(bord, eersteZichtbareDag(nu));
      },
    });
    if (breedte) await page.setViewportSize({ width: breedte, height: 900 });
    await page.goto(pad);
    await expect(page.getByRole('heading', { name: 'Maandplanning', level: 1 })).toBeVisible({ timeout: 15_000 });
    return { gevraagd, verzet };
  }
  /** Een collega wijzigt de planning: het bord herlaadt stil (na het salvo-venster). */
  const planningWijzigt = (page: Page) => page.evaluate(() => { window.dispatchEvent(new Event('vhb-planning-changed')); });
  const geenNieuweStap = (page: Page) => expect.poll(() => page.evaluate(() => window.history.length - (window as any).__startLengte)).toBe(0);
  const raster = (page: Page) => page.getByRole('table', { name: 'Maandplanning per chauffeur en dag' });
  /** De dagkoppen van het raster, zonder de kolom Chauffeur. */
  const dagkoppen = (page: Page) => raster(page).getByRole('columnheader').filter({ hasNotText: 'Chauffeur' });
  const strip = (page: Page) => page.getByRole('tablist', { name: 'Kies een dag' }).getByRole('tab');
  const gekozenDag = (page: Page) => page.getByRole('tablist', { name: 'Kies een dag' }).getByRole('tab', { selected: true });
  /** De tekst van een dag in de strip: weekdag en dagcijfer, bv. "ma" + "28". */
  const dag = (weekdag: string, cijfer: number) => new RegExp(`^${weekdag}\\s*${cijfer}$`, 'i');

  test('desktop: een chauffeur ziet de volledige lopende week en kan niet verder terug', async ({ page }) => {
    const { gevraagd } = await open(page, CHAUFFEUR, VRIJDAG, '/maandplanning', 1440);
    const terug = page.getByRole('button', { name: 'Vorige 2 weken' });
    await expect(terug).toBeDisabled({ timeout: 15_000 });
    await expect(terug).toHaveAttribute('title', 'Je ziet de planning vanaf deze week (28/09/2026)');

    // Het venster begint op maandag 28/09 en loopt twee volle weken.
    await expect(dagkoppen(page)).toHaveCount(14);
    await expect(dagkoppen(page).first()).toContainText('maandag 28 september');
    await expect(dagkoppen(page).last()).toContainText('zondag 11 oktober');
    // Ook de dagen van deze week die al voorbij zijn staan er: 14 cellen op de eigen rij.
    const eigenRij = raster(page).getByRole('row').filter({ has: page.getByRole('rowheader', { name: /Test Chauffeur/ }) });
    await expect(eigenRij.getByRole('button')).toHaveCount(14);

    // Vooruit en weer terug kan, maar nooit voorbij de grens.
    await page.getByRole('button', { name: 'Volgende 2 weken' }).click();
    await expect(dagkoppen(page).first()).toContainText('maandag 12 oktober');
    await expect(terug).toBeEnabled();
    await terug.click();
    await expect(dagkoppen(page).first()).toContainText('maandag 28 september');
    await expect(terug).toBeDisabled();
    // Vandaag brengt hem naar hetzelfde venster.
    await page.getByRole('button', { name: 'Vandaag' }).click();
    await expect(dagkoppen(page).first()).toContainText('maandag 28 september');
    await expect(terug).toBeDisabled();

    // Geen enkele vraag naar een maand van vóór de grens.
    expect(gevraagd.filter((m) => m < '2026-09')).toEqual([]);
  });

  test('telefoon: de week begon in de vorige maand, dus die toont alleen haar laatste dagen en daar stopt het', async ({ page }) => {
    await open(page, CHAUFFEUR, VRIJDAG, '/maandplanning');
    // Oktober staat er volledig: donderdag 01/10 is voorbij maar hoort bij de lopende week.
    await expect(page.getByText('Oktober 2026')).toBeVisible({ timeout: 15_000 });
    await expect(strip(page)).toHaveCount(31);
    await expect(strip(page).first()).toHaveText(dag('do', 1));
    await expect(gekozenDag(page)).toHaveText(dag('vr', 2));

    const vorige = page.getByRole('button', { name: 'Vorige maand' });
    await expect(vorige).toBeEnabled();
    await vorige.click();
    // September: alleen maandag 28, dinsdag 29 en woensdag 30.
    await expect(page.getByText('September 2026')).toBeVisible();
    await expect(strip(page)).toHaveCount(3);
    await expect(strip(page).first()).toHaveText(dag('ma', 28));
    await expect(strip(page).last()).toHaveText(dag('wo', 30));
    await expect(vorige).toBeDisabled();
    await expect(vorige).toHaveAttribute('title', 'Je ziet de planning vanaf deze week (28/09/2026)');
  });

  test('telefoon: de week begon midden in de maand, de strip biedt geen dag van vroeger en vorige maand staat uit', async ({ page }) => {
    const { gevraagd } = await open(page, CHAUFFEUR, WOENSDAG, '/maandplanning');
    await expect(page.getByText('Oktober 2026')).toBeVisible({ timeout: 15_000 });
    // 12 tot en met 31 oktober.
    await expect(strip(page)).toHaveCount(20);
    await expect(strip(page).first()).toHaveText(dag('ma', 12));
    await expect(gekozenDag(page)).toHaveText(dag('wo', 14));
    const vorige = page.getByRole('button', { name: 'Vorige maand' });
    await expect(vorige).toBeDisabled();
    await expect(vorige).toHaveAttribute('title', 'Je ziet de planning vanaf deze week (12/10/2026)');
    // De eerste dag van de strip is te openen: maandag van deze week, al voorbij.
    await strip(page).first().click();
    await expect(page.getByText('Maandag 12 oktober', { exact: true })).toBeVisible();
    await expect(page.getByText('3 diensten')).toBeVisible();
    // Vandaag springt terug naar vandaag, niet naar vroeger.
    await page.getByRole('button', { name: 'Vandaag' }).click();
    await expect(gekozenDag(page)).toHaveText(dag('wo', 14));
    await expect(strip(page)).toHaveCount(20);
    expect(gevraagd.filter((m) => m < '2026-10')).toEqual([]);
  });

  for (const [waar, breedte] of [['desktop', 1440], ['telefoon', undefined]] as const) {
    test(`${waar}: een oude link naar een vroegere maand of dag opent op nu, zonder extra stap in de historiek`, async ({ page }) => {
      for (const oud of ['/maandplanning/2026-05', '/maandplanning/2026-05/2026-05-12', '/maandplanning/2026-09/2026-09-15']) {
        const { gevraagd } = await open(page, CHAUFFEUR, VRIJDAG, oud, breedte);
        // De adresbalk staat weer op de schone URL van de huidige maand.
        await expect(page, oud).toHaveURL(/\/maandplanning$/, { timeout: 15_000 });
        await geenNieuweStap(page);
        if (breedte) {
          await expect(dagkoppen(page).first(), oud).toContainText('maandag 28 september');
          await expect(page.getByRole('button', { name: 'Vorige 2 weken' })).toBeDisabled();
        } else {
          await expect(page.getByText('Oktober 2026'), oud).toBeVisible();
          await expect(gekozenDag(page), oud).toHaveText(dag('vr', 2));
        }
        // Geen leeg bord en geen vraag naar de oude maand.
        await expect(page.getByText(/^Geen planning voor/)).toHaveCount(0);
        expect(gevraagd.filter((m) => m < '2026-09'), oud).toEqual([]);
        await page.unrouteAll({ behavior: 'ignoreErrors' });
      }
    });
  }

  test('desktop: staat het scherm open over de weekwissel, dan schuift het venster mee in plaats van een lege week te tonen', async ({ page }) => {
    // Zondag 04/10, 23:50 in Brussel: de week van 28/09 loopt nog.
    const { verzet } = await open(page, CHAUFFEUR, ZONDAGAVOND, '/maandplanning', 1440);
    const terug = page.getByRole('button', { name: 'Vorige 2 weken' });
    await expect(dagkoppen(page).first()).toContainText('maandag 28 september', { timeout: 15_000 });
    const eigenRij = raster(page).getByRole('row').filter({ has: page.getByRole('rowheader', { name: /Test Chauffeur/ }) });
    await expect(eigenRij.getByRole('button')).toHaveCount(14);

    // Maandag 05/10, 00:10: de vorige week is nu voorbij en de server geeft ze niet meer.
    await verzet(MAANDAGNACHT);
    await planningWijzigt(page);
    await expect(dagkoppen(page).first()).toContainText('maandag 5 oktober');
    await expect(dagkoppen(page).last()).toContainText('zondag 18 oktober');
    // Geen lege kolommen: de eigen rij heeft weer veertien cellen.
    await expect(eigenRij.getByRole('button')).toHaveCount(14);
    await expect(terug).toBeDisabled();
    await expect(terug).toHaveAttribute('title', 'Je ziet de planning vanaf deze week (05/10/2026)');
  });

  test('telefoon: wie de laatste dagen van de vorige maand bekeek, staat na de weekwissel op de huidige maand', async ({ page }) => {
    const { verzet } = await open(page, CHAUFFEUR, ZONDAGAVOND, '/maandplanning');
    await expect(page.getByText('Oktober 2026')).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: 'Vorige maand' }).click();
    await expect(page.getByText('September 2026')).toBeVisible();
    await expect(strip(page)).toHaveCount(3);

    await verzet(MAANDAGNACHT);
    await planningWijzigt(page);
    // September is helemaal voorbij: geen lege strip en geen leeg bord, maar oktober vanaf maandag 05/10.
    await expect(page.getByText('Oktober 2026')).toBeVisible();
    await expect(strip(page)).toHaveCount(27);
    await expect(strip(page).first()).toHaveText(dag('ma', 5));
    await expect(gekozenDag(page)).toHaveText(dag('ma', 5));
    await expect(page.getByText(/^Geen planning voor/)).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Vorige maand' })).toBeDisabled();
    await expect(page).toHaveURL(/\/maandplanning$/);
  });

  test('desktop: een planner bladert gewoon terug en een oude link blijft staan', async ({ page }) => {
    const { gevraagd } = await open(page, PLANNER, VRIJDAG, '/maandplanning', 1440);
    const terug = page.getByRole('button', { name: 'Vorige 2 weken' });
    await expect(dagkoppen(page).first()).toContainText('maandag 28 september', { timeout: 15_000 });
    await expect(terug).toBeEnabled();
    await expect(terug).toHaveAttribute('title', 'Vorige 2 weken');
    await terug.click();
    await expect(dagkoppen(page).first()).toContainText('maandag 14 september');
    // De voorbije weken staan er voor hem gewoon in.
    const rij = raster(page).getByRole('row').filter({ has: page.getByRole('rowheader', { name: /Test Chauffeur/ }) });
    await expect(rij.getByRole('button')).toHaveCount(14);
    await terug.click();
    await expect(dagkoppen(page).first()).toContainText('maandag 31 augustus');
    expect(gevraagd).toContain('2026-08');

    // Een link naar mei blijft mei.
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    const { gevraagd: mei } = await open(page, PLANNER, VRIJDAG, '/maandplanning/2026-05', 1440);
    await expect(dagkoppen(page).first()).toContainText('maandag 27 april', { timeout: 15_000 });
    await expect(page).toHaveURL(/\/maandplanning\/2026-05$/);
    expect(mei).toContain('2026-05');
  });

  test('telefoon: een planner gaat naar de vorige maanden en ziet daar alle dagen', async ({ page }) => {
    await open(page, PLANNER, VRIJDAG, '/maandplanning');
    await expect(page.getByText('Oktober 2026')).toBeVisible({ timeout: 15_000 });
    const vorige = page.getByRole('button', { name: 'Vorige maand' });
    await vorige.click();
    await expect(page.getByText('September 2026')).toBeVisible();
    await expect(strip(page)).toHaveCount(30);
    await expect(vorige).toBeEnabled();
    await vorige.click();
    await expect(page.getByText('Augustus 2026')).toBeVisible();
    await expect(strip(page)).toHaveCount(31);
  });
});
