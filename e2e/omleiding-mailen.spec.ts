import { test, expect, type Page } from '@playwright/test';
import { ADMIN, seed } from './helpers';

/**
 * Mailknop op een omleiding (mailtranche PR 4): vanuit het actiemenu van
 * Beheer omleidingen, verzendlijst plus vrij adres kiezen, voorbeeld met
 * aantal en bijlagen, bevestigen. API gemockt.
 */
const OMLEIDING = { id: 'd1', line: '58', location: 'Zottegem', title: 'Werken Markt Zottegem', description: 'Omleiding via de ring.', startDate: '2026-09-20', endDate: '2026-10-10', _rev: 'r1',
  bijlagen: [{ slot: 1, filename: 'Omleidingsplan lijn 58.pdf', sizeBytes: 182_000, url: 'https://x.test/1.pdf' }] };

async function opzet(page: Page, opties: { verstuur?: (body: any) => unknown; omleiding?: typeof OMLEIDING } = {}) {
  const calls: any[] = [];
  await page.clock.setFixedTime(new Date('2026-09-25T09:00:00Z'));
  await seed(page, {
    user: ADMIN, view: 'beheer-omleidingen',
    extra: (pad, request) => {
      const m = request.method();
      if (pad.endsWith('/api/diversions') && m === 'GET') return [opties.omleiding ?? OMLEIDING];
      if (pad.endsWith('/api/mails/verzendlijsten') && m === 'GET') return [{ id: 'l-1', naam: 'De Lijn', adressen: ['dispatching@delijn.be', 'planning@delijn.be'] }];
      if (pad.endsWith('/api/diversions/d1/mail') && m === 'POST') {
        const body = request.postDataJSON();
        calls.push(body);
        return body.droog
          ? { droog: true, aantal: 3, ontvangers: [{ adres: 'dispatching@delijn.be', naam: 'De Lijn' }, { adres: 'planning@delijn.be', naam: 'De Lijn' }, { adres: 'garage@vhb.be', naam: 'garage@vhb.be' }], onderwerp: 'Omleiding lijn 58: Werken Markt Zottegem (20/09/2026 t/m 10/10/2026)', html: '<!DOCTYPE html><html><body><h1>Werken Markt Zottegem</h1></body></html>', bijlagen: [{ filename: 'Omleidingsplan lijn 58.pdf', sizeBytes: 182_000 }] }
          : opties.verstuur?.(body) ?? { droog: false, aantal: 3, gelukt: 3, mislukt: 0, mocked: false, bijlagen: 1 };
      }
      return undefined;
    },
  });
  await page.goto('/beheer/omleidingen/d1');
  return { calls };
}

test('omleiding mailen: verzendlijst en vrij adres, voorbeeld, bevestigen', async ({ page, isMobile }) => {
  const { calls } = await opzet(page);
  const bewerk = page.getByRole(isMobile ? 'dialog' : 'region', { name: /Omleiding bewerken/ });
  await bewerk.getByRole('button', { name: 'Meer acties' }).click();
  await page.getByRole('menuitem', { name: 'Mailen…' }).click();
  const paneel = page.getByRole('dialog', { name: 'Omleiding mailen' });
  await expect(paneel).toBeVisible();
  await expect(paneel.getByRole('list', { name: 'Bijlagen' })).toContainText('Omleidingsplan lijn 58.pdf');
  // Zonder ontvangers: veldfout.
  await paneel.getByRole('button', { name: 'Voorbeeld en versturen' }).click();
  await expect(paneel.getByText('Kies minstens één verzendlijst of adres')).toBeVisible();
  expect(calls).toHaveLength(0);
  const vak = paneel.getByRole('checkbox', { name: 'Verzendlijst De Lijn' });
  await vak.locator('..').click();
  await expect(vak).toBeChecked();
  await paneel.getByLabel('Vrije adressen').fill('garage@vhb.be');
  await paneel.getByLabel('Begeleidend bericht (optioneel)').fill('Beste, hierbij de omleiding.');
  await paneel.getByRole('button', { name: 'Voorbeeld en versturen' }).click();
  await expect.poll(() => calls.length).toBe(1);
  expect(calls[0]).toMatchObject({ droog: true, bericht: 'Beste, hierbij de omleiding.', ontvangers: { lijsten: ['l-1'], adressen: ['garage@vhb.be'] } });
  const bevestiging = page.getByRole('dialog', { name: 'Voorbeeld van de omleidingsmail' });
  await expect(bevestiging.getByText('Naar 3 ontvangers')).toBeVisible();
  // Kop als h2 en de inhoud met binnenmarge (nr. 3): Modal draagt zelf geen padding.
  await expect(bevestiging.getByRole('heading', { level: 2, name: 'Naar 3 ontvangers' })).toBeVisible();
  const venster = (await bevestiging.boundingBox())!;
  const mail = (await bevestiging.locator('iframe').boundingBox())!;
  expect(mail.x - venster.x).toBeGreaterThanOrEqual(16);
  expect(venster.x + venster.width - (mail.x + mail.width)).toBeGreaterThanOrEqual(16);
  await expect(bevestiging.getByText(/1 PDF in bijlage/)).toBeVisible();
  await expect(bevestiging.frameLocator('iframe').getByRole('heading', { name: 'Werken Markt Zottegem' })).toBeVisible();
  await bevestiging.getByRole('button', { name: 'Versturen naar 3' }).click();
  await expect.poll(() => calls.length).toBe(2);
  expect(calls[1].droog).toBe(false);
  await expect(page.getByText('Omleiding gemaild naar 3 ontvangers.')).toBeVisible();
  await expect(bevestiging).toHaveCount(0);
  await expect(paneel).toHaveCount(0);
});

test('omleiding mailen: een bijlage die niet meeging wordt gemeld (nr. 11)', async ({ page, isMobile }) => {
  await opzet(page, { verstuur: () => ({ droog: false, aantal: 3, gelukt: 3, mislukt: 0, nietGeprobeerd: 0, onzeker: 0, mocked: false, resterend: [], onzekerAdressen: [], bijlagen: 0, ontbrekendeBijlagen: ['Omleidingsplan lijn 58.pdf'] }) });
  const bewerk = page.getByRole(isMobile ? 'dialog' : 'region', { name: /Omleiding bewerken/ });
  await bewerk.getByRole('button', { name: 'Meer acties' }).click();
  await page.getByRole('menuitem', { name: 'Mailen…' }).click();
  const paneel = page.getByRole('dialog', { name: 'Omleiding mailen' });
  await paneel.getByLabel('Vrije adressen').fill('garage@vhb.be');
  await paneel.getByRole('button', { name: 'Voorbeeld en versturen' }).click();
  const bevestiging = page.getByRole('dialog', { name: 'Voorbeeld van de omleidingsmail' });
  await bevestiging.getByRole('button', { name: 'Versturen naar 3' }).click();
  await expect(page.getByText('Omleiding gemaild naar 3 ontvangers. Niet meegegaan, bestand niet gevonden: Omleidingsplan lijn 58.pdf.')).toBeVisible();
  await expect(paneel).toHaveCount(0);
});

test('omleiding mailen: deels vertrokken verstuurt daarna alleen de rest (nr. 5 en 34)', async ({ page, isMobile }) => {
  const { calls } = await opzet(page, {
    verstuur: (body) => (body.alleen
      ? { droog: false, aantal: 2, gelukt: 2, mislukt: 0, nietGeprobeerd: 0, onzeker: 0, mocked: false, resterend: [], onzekerAdressen: [], bijlagen: 1, ontbrekendeBijlagen: [] }
      : { droog: false, aantal: 3, gelukt: 1, mislukt: 0, nietGeprobeerd: 2, onzeker: 0, mocked: false, resterend: ['planning@delijn.be', 'garage@vhb.be'], onzekerAdressen: [], bijlagen: 1, ontbrekendeBijlagen: [] }),
  });
  const bewerk = page.getByRole(isMobile ? 'dialog' : 'region', { name: /Omleiding bewerken/ });
  await bewerk.getByRole('button', { name: 'Meer acties' }).click();
  await page.getByRole('menuitem', { name: 'Mailen…' }).click();
  const paneel = page.getByRole('dialog', { name: 'Omleiding mailen' });
  await paneel.getByLabel('Vrije adressen').fill('garage@vhb.be');
  await paneel.getByRole('button', { name: 'Voorbeeld en versturen' }).click();
  const bevestiging = page.getByRole('dialog', { name: 'Voorbeeld van de omleidingsmail' });
  await bevestiging.getByRole('button', { name: 'Versturen naar 3' }).click();
  await expect(bevestiging.getByRole('alert')).toContainText('Verstuurd naar 1 van 3');
  await expect(bevestiging.getByRole('alert')).toContainText('2 adressen hebben de mail niet gekregen: planning@delijn.be, garage@vhb.be.');
  await bevestiging.getByRole('button', { name: 'Alleen de resterende 2 versturen' }).click();
  await expect.poll(() => calls.filter((c) => !c.droog).length).toBe(2);
  expect(calls.filter((c) => !c.droog)[1].alleen).toEqual(['planning@delijn.be', 'garage@vhb.be']);
  await expect(page.getByText('Omleiding gemaild naar 2 ontvangers.')).toBeVisible();
  await expect(bevestiging).toHaveCount(0);
  await expect(paneel).toHaveCount(0);
});

test('omleiding mailen: focus naar het eerste foute veld, Enter dient in, sluiten met invoer vraagt bevestiging (nr. 21)', async ({ page, isMobile }) => {
  const { calls } = await opzet(page);
  const bewerk = page.getByRole(isMobile ? 'dialog' : 'region', { name: /Omleiding bewerken/ });
  const open = async () => {
    await bewerk.getByRole('button', { name: 'Meer acties' }).click();
    await page.getByRole('menuitem', { name: 'Mailen…' }).click();
  };
  await open();
  const paneel = page.getByRole('dialog', { name: 'Omleiding mailen' });
  await expect(paneel.getByRole('checkbox', { name: 'Verzendlijst De Lijn' })).toBeAttached();
  // Net geopend en niets ingevuld: sluiten vraagt niets.
  await page.keyboard.press('Escape');
  await expect(paneel).toHaveCount(0);
  await open();
  await expect(paneel.getByRole('checkbox', { name: 'Verzendlijst De Lijn' })).toBeAttached();
  // Zonder ontvangers: de focus gaat naar het eerste vakje van de ontvangers.
  await paneel.getByRole('button', { name: 'Voorbeeld en versturen' }).click();
  await expect(paneel.getByText('Kies minstens één verzendlijst of adres')).toBeVisible();
  await expect(paneel.getByRole('checkbox', { name: 'Verzendlijst De Lijn' })).toBeFocused();
  // Een fout adres (met een lijst gekozen): de focus gaat naar dat veld.
  const vak = paneel.getByRole('checkbox', { name: 'Verzendlijst De Lijn' });
  await vak.locator('..').click();
  await expect(vak).toBeChecked();
  await expect(paneel.getByText('Kies minstens één verzendlijst of adres')).toHaveCount(0);
  await paneel.getByLabel('Vrije adressen').fill('geen adres');
  await paneel.getByRole('button', { name: 'Voorbeeld en versturen' }).click();
  await expect(paneel.getByText('Geen geldig adres: geen adres')).toBeVisible();
  await expect(paneel.getByLabel('Vrije adressen')).toBeFocused();
  expect(calls).toHaveLength(0);
  // Sluiten met invoer vraagt bevestiging; verder bewerken houdt de invoer.
  await page.keyboard.press('Escape');
  const vraag = page.getByRole('dialog', { name: 'Wijzigingen niet bewaren?' });
  await expect(vraag).toBeVisible();
  await vraag.getByRole('button', { name: 'Verder bewerken' }).click();
  await expect(paneel.getByLabel('Vrije adressen')).toHaveValue('geen adres');
  await paneel.getByLabel('Vrije adressen').fill('garage@vhb.be');
  await paneel.getByRole('button', { name: 'Voorbeeld en versturen' }).click();
  await expect(page.getByRole('dialog', { name: 'Voorbeeld van de omleidingsmail' })).toBeVisible();
  expect(calls).toHaveLength(1);
});

test('omleiding mailen: een lange bestandsnaam kapt af binnen het paneel op 320 px', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'Het smalle paneel is de telefoon.');
  await page.setViewportSize({ width: 320, height: 640 });
  const naam = 'Omleidingsplan lijn 58 en 82 Zottegem centrum fase 2 def.pdf';
  expect(naam).toHaveLength(60);
  await opzet(page, { omleiding: { ...OMLEIDING, bijlagen: [{ slot: 1, filename: naam, sizeBytes: 182_000, url: 'https://x.test/1.pdf' }] } });
  const bewerk = page.getByRole('dialog', { name: /Omleiding bewerken/ });
  await bewerk.getByRole('button', { name: 'Meer acties' }).click();
  await page.getByRole('menuitem', { name: 'Mailen…' }).click();
  const paneel = page.getByRole('dialog', { name: 'Omleiding mailen' });
  const bijlage = paneel.getByRole('list', { name: 'Bijlagen' }).getByRole('listitem').first();
  await expect(bijlage).toBeVisible();
  // Paneel en pil in hetzelfde frame meten: het paneel schuift nog binnen.
  const maten = await bijlage.locator('> span').evaluate((pil) => {
    const p = pil.closest('[role="dialog"]')!.getBoundingClientRect();
    const b = pil.getBoundingClientRect();
    const naamEl = pil.querySelector('span.truncate') as HTMLElement;
    return { links: b.left - p.left, rechts: p.right - b.right, paneel: p.width, afgekapt: naamEl.scrollWidth > naamEl.clientWidth };
  });
  expect(maten.paneel).toBeLessThanOrEqual(320);
  expect(maten.links, 'de pil begint binnen het paneel').toBeGreaterThanOrEqual(8);
  expect(maten.rechts, 'de pil eindigt binnen het paneel').toBeGreaterThanOrEqual(8);
  expect(maten.afgekapt, 'de naam is afgekapt, niet afgebroken of uitgelopen').toBe(true);
  // Niets schuift horizontaal en de volledige naam blijft opvraagbaar.
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await expect(bijlage.locator('> span')).toHaveAttribute('title', naam);
  await expect(bijlage).toContainText('178');
});
