import { test, expect, type Page } from '@playwright/test';
import { ADMIN, seed } from './helpers';

/**
 * Mailknop op een omleiding (mailtranche PR 4): vanuit het actiemenu van
 * Beheer omleidingen, verzendlijst plus vrij adres kiezen, voorbeeld met
 * aantal en bijlagen, bevestigen. API gemockt.
 */
const OMLEIDING = { id: 'd1', line: '58', location: 'Zottegem', title: 'Werken Markt Zottegem', description: 'Omleiding via de ring.', startDate: '2026-09-20', endDate: '2026-10-10', _rev: 'r1',
  bijlagen: [{ slot: 1, filename: 'Omleidingsplan lijn 58.pdf', sizeBytes: 182_000, url: 'https://x.test/1.pdf' }] };

async function opzet(page: Page) {
  const calls: any[] = [];
  await page.clock.setFixedTime(new Date('2026-09-25T09:00:00Z'));
  await seed(page, {
    user: ADMIN, view: 'beheer-omleidingen',
    extra: (pad, request) => {
      const m = request.method();
      if (pad.endsWith('/api/diversions') && m === 'GET') return [OMLEIDING];
      if (pad.endsWith('/api/mails/verzendlijsten') && m === 'GET') return [{ id: 'l-1', naam: 'De Lijn', adressen: ['dispatching@delijn.be', 'planning@delijn.be'] }];
      if (pad.endsWith('/api/diversions/d1/mail') && m === 'POST') {
        const body = request.postDataJSON();
        calls.push(body);
        return body.droog
          ? { droog: true, aantal: 3, ontvangers: [{ adres: 'dispatching@delijn.be', naam: 'De Lijn' }, { adres: 'planning@delijn.be', naam: 'De Lijn' }, { adres: 'garage@vhb.be', naam: 'garage@vhb.be' }], onderwerp: 'Omleiding lijn 58: Werken Markt Zottegem (20/09/2026 t/m 10/10/2026)', html: '<!DOCTYPE html><html><body><h1>Werken Markt Zottegem</h1></body></html>', bijlagen: [{ filename: 'Omleidingsplan lijn 58.pdf', sizeBytes: 182_000 }] }
          : { droog: false, aantal: 3, gelukt: 3, mislukt: 0, mocked: false, bijlagen: 1 };
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
  await expect(bevestiging.getByText(/1 PDF in bijlage/)).toBeVisible();
  await expect(bevestiging.frameLocator('iframe').getByRole('heading', { name: 'Werken Markt Zottegem' })).toBeVisible();
  await bevestiging.getByRole('button', { name: 'Versturen naar 3' }).click();
  await expect.poll(() => calls.length).toBe(2);
  expect(calls[1].droog).toBe(false);
  await expect(page.getByText('Omleiding gemaild naar 3 ontvangers.')).toBeVisible();
  await expect(bevestiging).toHaveCount(0);
  await expect(paneel).toHaveCount(0);
});
