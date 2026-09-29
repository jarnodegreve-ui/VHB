import { test, expect, type Page } from '@playwright/test';
import { ADMIN, seed } from './helpers';

/**
 * "Ongedaan maken" na het verwijderen van een omleiding, in de echte
 * gebouwde app. Het herstel (src/lib/herstel.ts) zit niet in de startbundel
 * en laadt pas bij de klik: hier controleren we dat die chunk echt bestaat,
 * echt pas dan opgevraagd wordt, en wat er gebeurt als hij niet te laden is.
 * API gemockt.
 */
const OMLEIDING = { id: 'd1', line: '58', location: 'Zottegem', title: 'Werken Markt Zottegem', description: 'Omleiding via de ring.', startDate: '2026-09-20', endDate: '2026-10-10', _rev: 'r1',
  bijlagen: [
    { slot: 1, filename: 'Omleidingsplan lijn 58.pdf', sizeBytes: 182_000, url: 'https://x.test/1.pdf' },
    { slot: 2, filename: 'Haltekaart.pdf', sizeBytes: 90_000, url: 'https://x.test/2.pdf' },
  ] };

const HERSTEL_CHUNK = /\/assets\/herstel-[^/]+\.js$/;

async function opzet(page: Page, terug: (body: any) => unknown) {
  const calls: Array<{ methode: string; pad: string; herstel: string | null; body: any }> = [];
  const chunks: string[] = [];
  let lijst: unknown[] = [OMLEIDING];
  page.on('request', (r) => { if (HERSTEL_CHUNK.test(new URL(r.url()).pathname)) chunks.push(r.url()); });
  await page.clock.setFixedTime(new Date('2026-09-25T09:00:00Z'));
  await seed(page, {
    user: ADMIN, view: 'beheer-omleidingen',
    extra: (pad, request) => {
      const m = request.method();
      if (pad.endsWith('/api/diversions') && m === 'GET') return lijst;
      if (pad.endsWith('/api/diversions/d1') && m === 'DELETE') {
        calls.push({ methode: m, pad: '/api/diversions/d1', herstel: null, body: null });
        lijst = [];
        return { success: true };
      }
      if (pad.endsWith('/api/diversions/one') && m === 'POST') {
        const body = request.postDataJSON();
        calls.push({ methode: m, pad: '/api/diversions/one', herstel: request.headers()['x-herstel'] ?? null, body });
        const record = terug(body);
        lijst = [record];
        return { success: true, diversion: record };
      }
      return undefined;
    },
  });
  await page.goto('/beheer/omleidingen/d1');
  return { calls, chunks };
}

async function verwijder(page: Page, isMobile: boolean) {
  const bewerk = page.getByRole(isMobile ? 'dialog' : 'region', { name: /Omleiding bewerken/ });
  await bewerk.getByRole('button', { name: 'Meer acties' }).click();
  await page.getByRole('menuitem', { name: 'Verwijderen' }).click();
  await expect(page.getByText('Omleiding ‘Werken Markt Zottegem’ verwijderd.')).toBeVisible();
}

test('ongedaan maken: de herstelmodule laadt pas bij de klik en de omleiding komt terug met haar PDF’s', async ({ page, isMobile }) => {
  const { calls, chunks } = await opzet(page, (body) => ({ ...body, _rev: 'r2' }));
  await verwijder(page, isMobile);
  expect(calls.map((c) => `${c.methode} ${c.pad}`)).toEqual(['DELETE /api/diversions/d1']);
  // De toast staat er, de module is nog niet opgevraagd.
  expect(chunks).toEqual([]);

  await page.getByRole('button', { name: 'Ongedaan maken' }).click();
  await expect(page.getByText('Omleiding hersteld.', { exact: true })).toBeVisible();
  expect(chunks).toHaveLength(1);
  expect(calls).toHaveLength(2);
  expect(calls[1]).toMatchObject({ methode: 'POST', pad: '/api/diversions/one', herstel: '1' });
  expect(calls[1].body.id).toBe('d1');
  expect(calls[1].body.bijlagen.map((b: { slot: number }) => b.slot)).toEqual([1, 2]);
});

test('ongedaan maken: kwam er een PDF niet mee terug, dan zegt de melding dat', async ({ page, isMobile }) => {
  await opzet(page, (body) => ({ ...body, bijlagen: [body.bijlagen[0]], _rev: 'r2' }));
  await verwijder(page, isMobile);
  await page.getByRole('button', { name: 'Ongedaan maken' }).click();
  await expect(page.getByText('Omleiding hersteld, maar 1 van de 2 PDF’s kwam niet mee terug. Voeg hem opnieuw toe.')).toBeVisible();
});

test('ongedaan maken: is de herstelmodule niet te laden, dan een nette melding en geen half herstel', async ({ page, isMobile }) => {
  const { calls } = await opzet(page, (body) => ({ ...body, _rev: 'r2' }));
  await page.route(HERSTEL_CHUNK, (route) => route.abort('failed'));
  await verwijder(page, isMobile);
  await page.getByRole('button', { name: 'Ongedaan maken' }).click();
  await expect(page.getByText(/^Ongedaan maken is mislukt\. /)).toBeVisible();
  await expect(page.getByText(/hersteld/)).toHaveCount(0);
  // Er is niets gepost: het record blijft verwijderd.
  expect(calls.map((c) => `${c.methode} ${c.pad}`)).toEqual(['DELETE /api/diversions/d1']);
});
