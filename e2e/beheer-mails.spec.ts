import { test, expect, type Locator, type Page } from '@playwright/test';
import { ADMIN, seed } from './helpers';

/**
 * Beheer › Mails (mailtranche PR 3): de lijst met automatische mails en hun
 * schakelaars, het voorbeeld, de verzendlijsten en het verzendlog, met de
 * API gemockt. Controleert vooral dat de schakelaar de juiste PUT stuurt en
 * dat een lijst met een fout adres niet doorgaat.
 */
const SOORTEN = [
  { soort: 'welkom', naam: 'Welkomstmail', wanneer: 'Bij een nieuw account', ontvangers: 'De nieuwe gebruiker', altijdAan: true, aan: true, laatst: null },
  { soort: 'ziekmelding', naam: 'Ziekmelding', wanneer: 'Als een planner iemand ziek meldt', ontvangers: 'Planners en admins', push: true, aan: true, laatst: { op: '2026-09-23T10:00:00Z', aantal: 2, gelukt: true } },
  { soort: 'dringende-update', naam: 'Dringende update', wanneer: 'Bij het publiceren van een dringende update', ontvangers: 'Alle actieve gebruikers', push: true, aan: false, laatst: null },
];

async function opzet(page: Page, opties: { verstuur?: (body: any) => unknown } = {}) {
  const calls: Array<{ pad: string; body: any }> = [];
  let instellingen = { uit: ['dringende-update'] };
  let lijsten: any[] = [{ id: 'l-1', naam: 'De Lijn', adressen: ['dispatching@delijn.be'] }];
  await page.clock.setFixedTime(new Date('2026-09-25T09:00:00Z'));
  await seed(page, {
    user: ADMIN, view: 'beheer-mails',
    extra: (pad, request) => {
      const m = request.method();
      if (pad.endsWith('/api/mails') && m === 'GET') {
        return { soorten: SOORTEN.map((s) => ({ ...s, aan: s.altijdAan ? true : !instellingen.uit.includes(s.soort) })), instellingen, verzendlijsten: lijsten, log: [
          { id: 'm-1', verzondenOp: '2026-09-23T10:00:00Z', soort: 'ziekmelding', aantal: 2, gelukt: true, door: 'Els Goossens' },
          { id: 'm-2', verzondenOp: '2026-09-22T06:00:00Z', soort: 'weekoverzicht', aantal: 1, gelukt: false, fout: 'SMTP niet geconfigureerd, mail alleen gelogd', door: 'Systeem' },
          { id: 'm-3', verzondenOp: '2026-09-21T10:00:00Z', soort: 'eigen-mail', aantal: 40, gelukt: false, fout: '2 van 40 mislukt', door: 'Annelies Admin' },
          { id: 'm-4', verzondenOp: '2026-09-20T10:00:00Z', soort: 'omleiding-mail', aantal: 12, gelukt: false, fout: 'onderbroken: de verzending is niet afgerond, mogelijk is een deel vertrokken', door: 'Pieter Planner' },
          { id: 'm-5', verzondenOp: '2026-09-19T10:00:00Z', soort: 'dringende-update', aantal: 31, gelukt: false, fout: 'uitgeschakeld in Beheer › Mails', door: 'Pieter Planner' },
        ] };
      }
      if (pad.endsWith('/api/mails/instellingen') && m === 'PUT') { const body = request.postDataJSON(); calls.push({ pad: 'instellingen', body }); instellingen = body; return body; }
      if (pad.endsWith('/api/mails/verzendlijsten') && m === 'PUT') { const body = request.postDataJSON(); calls.push({ pad: 'verzendlijsten', body }); lijsten = body; return body; }
      if (pad.includes('/api/mails/voorbeeld/')) return { onderwerp: 'Ziekmelding, Dirk Maes', html: '<!DOCTYPE html><html><body><h1>Voorbeeldmail</h1></body></html>' };
      if (pad.endsWith('/api/mails/eigen') && m === 'POST') {
        const body = request.postDataJSON();
        calls.push({ pad: 'eigen', body });
        return body.droog
          ? { droog: true, aantal: 3, ontvangers: [{ adres: 'a@vhb.be', naam: 'Alex Du Priez' }, { adres: 'b@vhb.be', naam: 'Bart Claeys' }, { adres: 'extern@voorbeeld.be', naam: 'extern@voorbeeld.be' }], onderwerp: body.onderwerp, html: '<!DOCTYPE html><html><body><h1>Eigen mail</h1></body></html>' }
          : opties.verstuur?.(body) ?? { droog: false, aantal: 3, gelukt: 3, mislukt: 0, mocked: false };
      }
      return undefined;
    },
  });
  await page.goto('/beheer/mails');
  await expect(page.getByRole('heading', { level: 1, name: 'Mails' })).toBeVisible({ timeout: 15_000 });
  return { calls };
}

/** Het verzendlog: een tabel waar ze past, op de telefoon een lijst (nr. 6). */
const verzendlog = (page: Page, isMobile: boolean) => page.getByRole(isMobile ? 'list' : 'table', { name: 'Verzendlog' });

/** De inhoud staat links en rechts minstens 16 px van de rand van het venster.
 *  De body van een modal is p-6 = 1,5 rem: 24 px op de telefoon, ±19 px op
 *  desktop (kleinere wortelmaat). Modal zelf draagt geen padding. */
async function heeftBinnenmarge(dialoog: Locator, inhoud: Locator) {
  const d = (await dialoog.boundingBox())!;
  const i = (await inhoud.boundingBox())!;
  expect(i.x - d.x, 'marge links').toBeGreaterThanOrEqual(16);
  expect(d.x + d.width - (i.x + i.width), 'marge rechts').toBeGreaterThanOrEqual(16);
}

test('mails: elke modal heeft een kop (h2) en een binnenmarge (nr. 3)', async ({ page }) => {
  await opzet(page);
  // Voorbeeld van een mail.
  await page.getByRole('list', { name: 'Automatische mails' }).getByRole('listitem').filter({ hasText: 'Ziekmelding' }).getByRole('button', { name: 'Voorbeeld' }).click();
  const voorbeeld = page.getByRole('dialog', { name: 'Voorbeeld: Ziekmelding' });
  await expect(voorbeeld.getByRole('heading', { level: 2, name: 'Ziekmelding' })).toBeVisible();
  await heeftBinnenmarge(voorbeeld, voorbeeld.locator('iframe'));
  await heeftBinnenmarge(voorbeeld, voorbeeld.getByRole('heading', { level: 2 }));
  await voorbeeld.getByRole('button', { name: 'Sluiten' }).click();
  await expect(voorbeeld).toHaveCount(0);
  // Verzendlijst.
  await page.getByRole('button', { name: 'Nieuwe lijst' }).click();
  const lijst = page.getByRole('dialog', { name: 'Nieuwe verzendlijst' });
  await expect(lijst.getByRole('heading', { level: 2, name: 'Nieuwe verzendlijst' })).toBeVisible();
  await heeftBinnenmarge(lijst, lijst.getByLabel('Naam'));
  await heeftBinnenmarge(lijst, lijst.getByLabel('Adressen'));
  await lijst.getByRole('button', { name: 'Annuleren' }).click();
  await expect(lijst).toHaveCount(0);
  // Bevestiging van een eigen mail.
  await page.getByRole('button', { name: 'Mail versturen' }).click();
  const paneel = page.getByRole('dialog', { name: 'Mail versturen' });
  await paneel.getByLabel('Onderwerp').fill('Nieuwe uniformen');
  await paneel.getByLabel('Bericht').fill('Vanaf 1 juli.');
  await paneel.getByLabel('Vrije adressen').fill('extern@voorbeeld.be');
  await paneel.getByRole('button', { name: 'Voorbeeld en versturen' }).click();
  const bevestiging = page.getByRole('dialog', { name: 'Voorbeeld van je mail' });
  await expect(bevestiging.getByRole('heading', { level: 2, name: 'Naar 3 ontvangers' })).toBeVisible();
  await heeftBinnenmarge(bevestiging, bevestiging.locator('iframe'));
  await heeftBinnenmarge(bevestiging, bevestiging.getByRole('heading', { level: 2 }));
});

test('mails: lijst, schakelaar en voorbeeld', async ({ page }) => {
  const { calls } = await opzet(page);
  const lijst = page.getByRole('list', { name: 'Automatische mails' });
  await expect(lijst.getByRole('listitem')).toHaveCount(3);
  await expect(lijst.getByText('Altijd aan')).toBeVisible();
  await expect(lijst.getByText(/Laatst verstuurd .* naar 2 ontvangers/)).toBeVisible();
  await expect(lijst.getByText('Uit', { exact: true })).toBeVisible();
  // Ziekmelding uitzetten → PUT met de uit-lijst.
  const ziek = lijst.getByRole('switch', { name: 'Ziekmelding versturen' });
  await expect(ziek).toBeChecked();
  await ziek.click();
  await expect.poll(() => calls.length).toBe(1);
  expect(calls[0]).toEqual({ pad: 'instellingen', body: { uit: ['dringende-update', 'ziekmelding'] } });
  await expect(ziek).not.toBeChecked();
  await expect(page.getByText('Ziekmelding staat uit; er gaat geen mail meer uit.')).toBeVisible();
  // Voorbeeld opent in een dialoog met de mail in een iframe.
  await lijst.getByRole('listitem').filter({ hasText: 'Ziekmelding' }).getByRole('button', { name: 'Voorbeeld' }).click();
  const dialoog = page.getByRole('dialog', { name: 'Voorbeeld: Ziekmelding' });
  await expect(dialoog).toBeVisible();
  await expect(dialoog.getByText('Onderwerp: Ziekmelding, Dirk Maes')).toBeVisible();
  await expect(dialoog.frameLocator('iframe').getByRole('heading', { name: 'Voorbeeldmail' })).toBeVisible();
  await dialoog.getByRole('button', { name: 'Sluiten' }).click();
  await expect(dialoog).toHaveCount(0);
});

test('mails: verzendlijst toevoegen met adrescontrole, en verwijderen', async ({ page, isMobile }) => {
  const { calls } = await opzet(page);
  const kaart = page.getByRole('list', { name: 'Verzendlijsten' });
  await expect(kaart.getByText('De Lijn')).toBeVisible();
  await page.getByRole('button', { name: 'Nieuwe lijst' }).click();
  const dialoog = page.getByRole('dialog', { name: 'Nieuwe verzendlijst' });
  await dialoog.getByLabel('Naam').fill('Garage');
  await dialoog.getByLabel('Adressen').fill('garage@vhb.be\ngeen adres');
  await dialoog.getByRole('button', { name: 'Toevoegen' }).click();
  await expect(dialoog.getByText('Geen geldig adres: geen adres')).toBeVisible();
  expect(calls).toHaveLength(0);
  await dialoog.getByLabel('Adressen').fill('Garage@VHB.be, techniek@vhb.be');
  await expect(dialoog.getByText('2 geldige adressen')).toBeVisible();
  await dialoog.getByRole('button', { name: 'Toevoegen' }).click();
  await expect.poll(() => calls.length).toBe(1);
  expect(calls[0].pad).toBe('verzendlijsten');
  expect(calls[0].body).toHaveLength(2);
  expect(calls[0].body[1]).toMatchObject({ naam: 'Garage', adressen: ['garage@vhb.be', 'techniek@vhb.be'] });
  await expect(dialoog).toHaveCount(0);
  await expect(kaart.getByText('Garage', { exact: true })).toBeVisible();
  // Verwijderen vraagt bevestiging.
  await kaart.getByRole('button', { name: 'Lijst De Lijn verwijderen' }).click();
  await page.getByRole('button', { name: 'Verwijderen', exact: true }).click();
  await expect.poll(() => calls.length).toBe(2);
  expect(calls[1].body.map((l: any) => l.naam)).toEqual(['Garage']);
  // Verzendlog toont status en wie (op de telefoon een lijst, nr. 6).
  const log = verzendlog(page, isMobile);
  await expect(log.getByText('Verstuurd')).toBeVisible();
  await expect(log.getByText('Alleen gelogd')).toBeVisible();
  await expect(log.getByText('Els Goossens')).toBeVisible();
});

test('mails: zelf een mail sturen, met voorbeeld en bevestiging', async ({ page, isMobile }) => {
  const { calls } = await opzet(page);
  await page.getByRole('button', { name: 'Mail versturen' }).click();
  const paneel = page.getByRole('dialog', { name: 'Mail versturen' });
  await expect(paneel).toBeVisible();
  // Zonder ontvangers: veldfout, geen call.
  await paneel.getByLabel('Onderwerp').fill('Nieuwe uniformen');
  await paneel.getByLabel('Bericht').fill('Vanaf 1 juli.\n\nKom passen in het depot.');
  await paneel.getByRole('button', { name: 'Voorbeeld en versturen' }).click();
  await expect(paneel.getByText('Kies minstens één ontvanger')).toBeVisible();
  expect(calls.filter((c) => c.pad === 'eigen')).toHaveLength(0);
  // Groep + verzendlijst + één gebruiker + vrij adres.
  // De Checkbox-primitief verbergt de input (sr-only) in een label: klik het
  // label, zoals een vinger dat doet, en controleer de staat van de input.
  const vink = async (vak: ReturnType<typeof paneel.getByRole>) => { await vak.locator('..').click(); await expect(vak).toBeChecked(); };
  await vink(paneel.getByRole('checkbox', { name: 'Alle chauffeurs' }));
  await vink(paneel.getByRole('checkbox', { name: 'Verzendlijst De Lijn' }));
  await paneel.getByRole('searchbox', { name: 'Zoek een gebruiker' }).fill('Alex');
  await vink(paneel.getByRole('list', { name: 'Gebruikers' }).getByRole('checkbox').first());
  await paneel.getByLabel('Vrije adressen').fill('extern@voorbeeld.be');
  await paneel.getByRole('button', { name: 'Voorbeeld en versturen' }).click();
  await expect.poll(() => calls.filter((c) => c.pad === 'eigen').length).toBe(1);
  const droog = calls.find((c) => c.pad === 'eigen')!.body;
  expect(droog.droog).toBe(true);
  expect(droog.ontvangers).toMatchObject({ groepen: ['chauffeurs'], lijsten: ['l-1'], adressen: ['extern@voorbeeld.be'] });
  expect(droog.ontvangers.gebruikers).toHaveLength(1);
  const bevestiging = page.getByRole('dialog', { name: 'Voorbeeld van je mail' });
  await expect(bevestiging.getByText('Naar 3 ontvangers')).toBeVisible();
  await expect(bevestiging.getByText(/Alex Du Priez, Bart Claeys/)).toBeVisible();
  await expect(bevestiging.frameLocator('iframe').getByRole('heading', { name: 'Eigen mail' })).toBeVisible();
  await bevestiging.getByRole('button', { name: 'Versturen naar 3' }).click();
  await expect.poll(() => calls.filter((c) => c.pad === 'eigen').length).toBe(2);
  expect(calls.filter((c) => c.pad === 'eigen')[1].body.droog).toBe(false);
  await expect(page.getByText('Mail verstuurd naar 3 ontvangers.')).toBeVisible();
  await expect(bevestiging).toHaveCount(0);
  await expect(paneel).toHaveCount(0);
  if (isMobile) await expect(page.getByRole('dialog')).toHaveCount(0);
});

/** Vult het formulier en opent de bevestiging. */
async function naarBevestiging(page: Page) {
  await page.getByRole('button', { name: 'Mail versturen' }).click();
  const paneel = page.getByRole('dialog', { name: 'Mail versturen' });
  await paneel.getByLabel('Onderwerp').fill('Nieuwe uniformen');
  await paneel.getByLabel('Bericht').fill('Vanaf 1 juli.');
  await paneel.getByLabel('Vrije adressen').fill('extern@voorbeeld.be');
  await paneel.getByRole('button', { name: 'Voorbeeld en versturen' }).click();
  const bevestiging = page.getByRole('dialog', { name: 'Voorbeeld van je mail' });
  await expect(bevestiging.getByRole('button', { name: 'Versturen naar 3' })).toBeVisible();
  return { paneel, bevestiging };
}

test('mails: deels vertrokken zegt hoeveel, en verstuurt daarna alleen de rest (nr. 5)', async ({ page }) => {
  const { calls } = await opzet(page, {
    verstuur: (body) => (body.alleen
      ? { droog: false, aantal: 1, gelukt: 1, mislukt: 0, nietGeprobeerd: 0, onzeker: 0, mocked: false, resterend: [], onzekerAdressen: [] }
      : { droog: false, aantal: 3, gelukt: 2, mislukt: 1, nietGeprobeerd: 0, onzeker: 0, mocked: false, resterend: ['b@vhb.be'], onzekerAdressen: [] }),
  });
  const { paneel, bevestiging } = await naarBevestiging(page);
  await bevestiging.getByRole('button', { name: 'Versturen naar 3' }).click();
  const melding = bevestiging.getByRole('alert');
  await expect(melding).toContainText('Verstuurd naar 2 van 3');
  await expect(melding).toContainText('1 adres heeft de mail niet gekregen: b@vhb.be.');
  // Geen knop die alles opnieuw verstuurt.
  await expect(bevestiging.getByRole('button', { name: 'Versturen naar 3' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Opnieuw proberen' })).toHaveCount(0);
  await bevestiging.getByRole('button', { name: 'Alleen de resterende 1 versturen' }).click();
  await expect.poll(() => calls.filter((c) => c.pad === 'eigen' && !c.body.droog).length).toBe(2);
  const echte = calls.filter((c) => c.pad === 'eigen' && !c.body.droog);
  expect(echte[0].body.alleen).toBeUndefined();
  expect(echte[1].body.alleen).toEqual(['b@vhb.be']);
  // Dezelfde mail en dezelfde keuze, alleen het filter erbij.
  expect(echte[1].body).toMatchObject({ onderwerp: 'Nieuwe uniformen', ontvangers: { adressen: ['extern@voorbeeld.be'] } });
  await expect(page.getByText('Mail verstuurd naar 1 ontvanger.')).toBeVisible();
  await expect(bevestiging).toHaveCount(0);
  await expect(paneel).toHaveCount(0);
});

test('mails: geen antwoord van de server biedt geen knop om alles opnieuw te versturen (nr. 5)', async ({ page }) => {
  const { calls } = await opzet(page);
  // Alleen de echte verzending valt weg (time-out van de functie); het voorbeeld werkt.
  await page.route('**/api/mails/eigen', (r) => (r.request().postDataJSON()?.droog ? r.fallback() : r.fulfill({ status: 504, contentType: 'text/plain', body: 'FUNCTION_INVOCATION_TIMEOUT' })));
  const { paneel, bevestiging } = await naarBevestiging(page);
  await bevestiging.getByRole('button', { name: 'Versturen naar 3' }).click();
  const melding = bevestiging.getByRole('alert');
  await expect(melding).toContainText('Geen antwoord van de server');
  await expect(melding).toContainText('Mogelijk is een deel van de mails toch vertrokken.');
  await expect(melding).toContainText('verzendlog');
  await expect(page.getByRole('button', { name: 'Opnieuw proberen' })).toHaveCount(0);
  await expect(bevestiging.getByRole('button', { name: /Versturen/ })).toHaveCount(0);
  await bevestiging.getByRole('button', { name: 'Sluiten' }).click();
  await expect(bevestiging).toHaveCount(0);
  // Het formulier staat er nog, met de invoer: de admin beslist na het log.
  await expect(paneel.getByLabel('Onderwerp')).toHaveValue('Nieuwe uniformen');
  expect(calls.filter((c) => c.pad === 'eigen' && !c.body.droog)).toHaveLength(0);
});

test('mails: formulieren brengen de focus naar het eerste foute veld, Enter dient in, en sluiten vraagt bevestiging (nr. 21)', async ({ page }) => {
  const { calls } = await opzet(page);
  // Verzendlijst: leeg indienen → focus op Naam; naam ingevuld → focus op Adressen.
  await page.getByRole('button', { name: 'Nieuwe lijst' }).click();
  const lijst = page.getByRole('dialog', { name: 'Nieuwe verzendlijst' });
  await lijst.getByRole('button', { name: 'Toevoegen' }).click();
  await expect(lijst.getByText('Geef de lijst een naam')).toBeVisible();
  await expect(lijst.getByLabel('Naam')).toBeFocused();
  await lijst.getByLabel('Naam').fill('Garage');
  await lijst.getByLabel('Naam').press('Enter');
  await expect(lijst.getByText('Vul minstens één adres in')).toBeVisible();
  await expect(lijst.getByLabel('Adressen')).toBeFocused();
  // Sluiten met invoer vraagt eerst bevestiging.
  await page.keyboard.press('Escape');
  const vraag = page.getByRole('dialog', { name: 'Wijzigingen niet bewaren?' });
  await expect(vraag).toBeVisible();
  await vraag.getByRole('button', { name: 'Niet bewaren' }).click();
  await expect(lijst).toHaveCount(0);
  expect(calls).toHaveLength(0);
  // Zonder invoer sluit het venster meteen.
  await page.getByRole('button', { name: 'Nieuwe lijst' }).click();
  await expect(lijst.getByLabel('Naam')).toHaveValue('');
  await page.keyboard.press('Escape');
  await expect(lijst).toHaveCount(0);
  await expect(vraag).toHaveCount(0);

  // Eigen mail: leeg indienen → focus op Onderwerp.
  await page.getByRole('button', { name: 'Mail versturen' }).click();
  const paneel = page.getByRole('dialog', { name: 'Mail versturen' });
  await paneel.getByRole('button', { name: 'Voorbeeld en versturen' }).click();
  await expect(paneel.getByText('Vul een onderwerp in')).toBeVisible();
  await expect(paneel.getByLabel('Onderwerp')).toBeFocused();
  // Alleen de ontvangers ontbreken → focus op het eerste vakje van de ontvangers.
  await paneel.getByLabel('Onderwerp').fill('Nieuwe uniformen');
  await paneel.getByLabel('Bericht').fill('Vanaf 1 juli.');
  await paneel.getByLabel('Onderwerp').press('Enter');
  await expect(paneel.getByText('Kies minstens één ontvanger')).toBeVisible();
  await expect(paneel.getByRole('checkbox', { name: 'Alle chauffeurs' })).toBeFocused();
  expect(calls.filter((c) => c.pad === 'eigen')).toHaveLength(0);
  // Enter in een veld dient in zodra alles klopt.
  await paneel.getByLabel('Vrije adressen').fill('extern@voorbeeld.be');
  await expect(paneel.getByText('Kies minstens één ontvanger')).toHaveCount(0);
  await paneel.getByLabel('Onderwerp').press('Enter');
  const bevestiging = page.getByRole('dialog', { name: 'Voorbeeld van je mail' });
  await expect(bevestiging).toBeVisible();
  expect(calls.filter((c) => c.pad === 'eigen')).toHaveLength(1);
  await bevestiging.getByRole('button', { name: 'Terug' }).click();
  await expect(bevestiging).toHaveCount(0);
  // Sluiten met invoer vraagt bevestiging; "Niet bewaren" gooit de invoer weg.
  await paneel.getByRole('button', { name: 'Annuleren' }).click();
  await expect(vraag).toBeVisible();
  await vraag.getByRole('button', { name: 'Niet bewaren' }).click();
  await expect(paneel).toHaveCount(0);
  await page.getByRole('button', { name: 'Mail versturen' }).click();
  await expect(paneel.getByLabel('Onderwerp')).toHaveValue('');
  await expect(paneel.getByLabel('Vrije adressen')).toHaveValue('');
});

test('mails: in het verzendlog is een fout rood en heeft een onderbroken verzending een eigen toon (nr. 25)', async ({ page, isMobile }) => {
  await opzet(page);
  const log = verzendlog(page, isMobile);
  const pil = (tekst: string) => log.getByText(tekst, { exact: true });
  // Mislukt: rode pil, met de reden ernaast.
  await expect(pil('Mislukt')).toHaveClass(/text-red-700/);
  await expect(pil('Mislukt')).toHaveClass(/bg-red-50/);
  await expect(log.getByText('2 van 40 mislukt')).toBeVisible();
  // Onderbroken: volle amber pil, met uitleg; nooit dezelfde als Mislukt.
  await expect(pil('Onderbroken')).toHaveClass(/text-amber-700/);
  await expect(pil('Onderbroken')).toHaveClass(/bg-amber-50/);
  await expect(log.getByText('Niet afgerond; onbekend hoeveel er vertrokken zijn.')).toBeVisible();
  // De technische reden van een onderbroken verzending staat niet in beeld.
  await expect(log.getByText(/mogelijk is een deel vertrokken/)).toHaveCount(0);
  // De naam van de mail komt uit de soorten die de server meestuurt, of uit
  // de vaste namen van de twee mails die een mens zelf verstuurt.
  for (const naam of ['Ziekmelding', 'Dringende update', 'Eigen mail', 'Omleiding gemaild']) {
    await expect(log.getByText(naam, { exact: true })).toBeVisible();
  }
  // Rusttoestanden blijven stil: een neutrale pil, geen rood en geen amber vlak.
  for (const stil of ['Uitgeschakeld', 'Alleen gelogd', 'Verstuurd']) {
    await expect(pil(stil)).not.toHaveClass(/text-red-700|bg-red-50|bg-amber-50/);
  }
});

// --- Nr. 6: het verzendlog was op de telefoon afgeknipt ---

/** Wat er van de mislukte verzending (m-3) te lezen moet zijn. */
const M3 = { mail: 'Eigen mail', moment: /21 september/, aantal: '40', status: 'Mislukt', reden: '2 van 40 mislukt', door: /Annelies Admin/ };

/** Geen horizontale overloop van de pagina, en het element valt volledig
 *  binnen het kader van het verzendlog (niets afgeknipt). */
async function paginaSchuiftNiet(page: Page, waar: string) {
  const m = await page.evaluate(() => {
    const root = document.querySelector<HTMLElement>('[data-scroll-root]');
    return { doc: document.documentElement.scrollWidth, vp: window.innerWidth, root: root ? root.scrollWidth - root.clientWidth : 0 };
  });
  expect(m.doc, `${waar}: documentbreedte`).toBeLessThanOrEqual(m.vp);
  expect(m.root, `${waar}: de pagina schuift horizontaal`).toBeLessThanOrEqual(1);
}
async function binnenKader(el: Locator, waar: string) {
  await expect(el, waar).toBeVisible();
  const m = await el.evaluate((n) => {
    const r = n.getBoundingClientRect();
    const k = n.closest('.surface-table')!.getBoundingClientRect();
    return { links: r.left - k.left, rechts: k.right - r.right, afgekapt: n.scrollWidth > n.clientWidth + 1 && getComputedStyle(n).overflow !== 'visible' };
  });
  expect(m.links, `${waar}: begint binnen het kader`).toBeGreaterThanOrEqual(0);
  expect(m.rechts, `${waar}: eindigt binnen het kader`).toBeGreaterThanOrEqual(0);
  expect(m.afgekapt, `${waar}: niet afgekapt`).toBe(false);
}

for (const breedte of [320, 375]) {
  test(`mails: verzendlog op ${breedte} px toont elke waarde van een verzending, zonder schuiven of afknippen (nr. 6)`, async ({ page, isMobile }) => {
    test.skip(!isMobile, 'telefoonbreedte');
    await page.setViewportSize({ width: breedte, height: 740 });
    await opzet(page);
    const lijst = page.getByRole('list', { name: 'Verzendlog' });
    await expect(lijst.getByRole('listitem')).toHaveCount(5);
    await expect(page.getByRole('table', { name: 'Verzendlog' })).toHaveCount(0);
    const rij = lijst.getByRole('listitem').filter({ hasText: M3.mail });
    await rij.scrollIntoViewIfNeeded();
    await binnenKader(rij.getByText(M3.mail, { exact: true }), 'mail');
    await binnenKader(rij.getByText(M3.moment), 'moment');
    await binnenKader(rij.getByText(`${M3.aantal} ontvangers`), 'aantal ontvangers');
    await binnenKader(rij.getByText(M3.status, { exact: true }), 'status');
    await binnenKader(rij.getByText(M3.reden, { exact: true }), 'reden van de fout');
    await binnenKader(rij.getByText(M3.door), 'door wie');
    // De tonen van nr. 25 gelden ook in de lijst.
    await expect(rij.getByText(M3.status, { exact: true })).toHaveClass(/text-red-700/);
    // Ook de onderbroken verzending, met haar uitleg, en een rij zonder reden.
    const onderbroken = lijst.getByRole('listitem').filter({ hasText: 'Omleiding gemaild' });
    await binnenKader(onderbroken.getByText('Onderbroken', { exact: true }), 'onderbroken');
    await binnenKader(onderbroken.getByText('Niet afgerond; onbekend hoeveel er vertrokken zijn.'), 'uitleg');
    await binnenKader(lijst.getByRole('listitem').filter({ hasText: 'Ziekmelding' }).getByText(/Els Goossens/), 'door wie, eerste rij');
    await paginaSchuiftNiet(page, `${breedte} px`);
  });
}

for (const breedte of [768, 1024]) {
  test(`mails: verzendlog op ${breedte} px is een tabel die in haar kader past (nr. 6)`, async ({ page, isMobile }) => {
    test.skip(isMobile, 'desktopbreedtes, in het desktopproject');
    await page.setViewportSize({ width: breedte, height: 900 });
    await opzet(page);
    const tabel = page.getByRole('table', { name: 'Verzendlog' });
    await expect(tabel).toBeVisible();
    await expect(page.getByRole('list', { name: 'Verzendlog' })).toHaveCount(0);
    for (const kop of ['Moment', 'Mail', 'Ontvangers', 'Status', 'Door']) await binnenKader(tabel.getByRole('columnheader', { name: kop, exact: true }), `kolomkop ${kop}`);
    // De tabel zelf valt binnen haar kader en schuift niet.
    const m = await tabel.evaluate((t) => {
      const r = t.getBoundingClientRect();
      const k = t.closest('.surface-table')!.getBoundingClientRect();
      const strook = t.parentElement!.parentElement!;
      return { over: Math.round(r.right - k.right), schuift: strook.scrollWidth - strook.clientWidth };
    });
    expect(m.over, 'tabel breder dan haar kader').toBeLessThanOrEqual(1);
    expect(m.schuift, 'de tabel schuift in haar kader').toBeLessThanOrEqual(1);
    const rij = tabel.getByRole('row').filter({ hasText: M3.mail });
    await binnenKader(rij.getByRole('cell', { name: M3.moment }), 'moment');
    await binnenKader(rij.getByRole('cell', { name: M3.aantal, exact: true }), 'aantal ontvangers');
    await binnenKader(rij.getByText(M3.status, { exact: true }), 'status');
    await binnenKader(rij.getByText(M3.reden, { exact: true }), 'reden van de fout');
    await binnenKader(rij.getByRole('cell', { name: M3.door }), 'door wie');
    await paginaSchuiftNiet(page, `${breedte} px`);
    // Geen doos in doos: het tabelkader is zelf de kaart.
    expect(await tabel.evaluate((t) => t.closest('.surface-table')!.parentElement!.closest('.surface-card, .surface-table') === null)).toBe(true);
  });
}
