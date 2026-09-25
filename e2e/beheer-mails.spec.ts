import { test, expect, type Page } from '@playwright/test';
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

async function opzet(page: Page) {
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
          : { droog: false, aantal: 3, gelukt: 3, mislukt: 0, mocked: false };
      }
      return undefined;
    },
  });
  await page.goto('/beheer/mails');
  await expect(page.getByRole('heading', { level: 1, name: 'Mails' })).toBeVisible({ timeout: 15_000 });
  return { calls };
}

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

test('mails: verzendlijst toevoegen met adrescontrole, en verwijderen', async ({ page }) => {
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
  // Verzendlog toont status en wie.
  const log = page.getByRole('table', { name: 'Verzendlog' });
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
