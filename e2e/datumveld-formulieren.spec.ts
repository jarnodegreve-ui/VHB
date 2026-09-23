import { test, expect, type Page } from '@playwright/test';
import { ADMIN, seed } from './helpers';
import { DIVERSIONS } from '../scripts/audit-fixtures.mjs';

/**
 * Datumtranche PR 2: het typbare datumveld in echte formulieren, desktop en
 * iPhone. Een ongeldige datum houdt de save tegen (geen stille oude waarde),
 * een geldige gaat als ISO naar de server, Enter dient in.
 */

const dag = (plus: number) => {
  const d = new Date();
  d.setDate(d.getDate() + plus);
  return d.toLocaleDateString('sv-SE');
};
const dmj = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

type Schrijf = { methode: string; pad: string; body: any };
async function metSchrijfacties(page: Page, extra: (p: string) => unknown = () => undefined) {
  const schrijf: Schrijf[] = [];
  await seed(page, {
    user: ADMIN,
    extra: (p, req) => {
      if (req.method() !== 'GET') {
        let body: any = null;
        try { body = JSON.parse(req.postData() ?? 'null'); } catch { body = null; }
        schrijf.push({ methode: req.method(), pad: p, body });
        return body ?? {};
      }
      return extra(p);
    },
  });
  return schrijf;
}

/** Omleidingen met een revisie, zoals GET /api/diversions ze levert (per-record-API eist `_rev`). */
const metRevisie = (p: string) => (p.endsWith('/api/diversions') ? DIVERSIONS.map((d) => ({ ...d, _rev: 'r1' })) : undefined);

test('omleiding: onbestaande einddatum houdt Opslaan tegen, een geldige gaat als ISO mee', async ({ page }) => {
  const schrijf = await metSchrijfacties(page, metRevisie);
  await page.goto(`/beheer/omleidingen/${DIVERSIONS[0].id}`);
  const eind = page.getByLabel('Einddatum', { exact: true });
  await expect(eind).toBeVisible();

  await eind.fill('31/02/2027');
  await page.getByRole('button', { name: 'Opslaan', exact: true }).click();
  await expect(page.getByText('Die dag bestaat niet.')).toBeVisible();
  expect(schrijf.filter((s) => s.pad.includes('/api/diversions'))).toEqual([]);

  const nieuw = dag(40);
  await eind.fill(dmj(nieuw));
  await page.getByRole('button', { name: 'Opslaan', exact: true }).click();
  await expect.poll(() => schrijf.filter((s) => s.pad.includes('/api/diversions')).length).toBe(1);
  const put = schrijf.find((s) => s.pad.includes('/api/diversions'))!;
  expect(put.methode).toBe('PUT');
  expect(put.body.endDate).toBe(nieuw);
});

test('omleiding: einddatum vóór de start = de bestaande regel, nu ook bij typen', async ({ page }) => {
  const schrijf = await metSchrijfacties(page, metRevisie);
  await page.goto(`/beheer/omleidingen/${DIVERSIONS[0].id}`);
  const eind = page.getByLabel('Einddatum', { exact: true });
  await eind.fill(dmj(dag(-30)));
  await eind.press('Enter');
  await expect(page.getByText(`Vroegst ${dmj(DIVERSIONS[0].startDate)}.`)).toBeVisible();
  expect(schrijf.filter((s) => s.pad.includes('/api/diversions'))).toEqual([]);
  // Enter met een geldige datum dient in.
  await eind.fill(dmj(dag(20)));
  await eind.press('Enter');
  await expect.poll(() => schrijf.filter((s) => s.pad.includes('/api/diversions')).length).toBe(1);
  expect(schrijf.find((s) => s.pad.includes('/api/diversions'))!.body.endDate).toBe(dag(20));
});

test('vervaldata: getypte datum bewaart als ISO, een onbestaande dag bewaart niets', async ({ page }) => {
  const schrijf = await metSchrijfacties(page, (p) => (p.endsWith('/api/user-expiries') ? [] : undefined));
  await page.goto('/beheer/vervaldata/42');
  const modal = page.getByRole('dialog');
  const code95 = modal.getByLabel(/Code 95 geldig tot/i);
  await expect(code95).toBeVisible();

  await code95.fill('29/02/2027');
  await modal.getByRole('button', { name: 'Opslaan', exact: true }).click();
  await expect(modal.getByText('Die dag bestaat niet.')).toBeVisible();
  expect(schrijf.filter((s) => s.pad.endsWith('/api/user-expiries'))).toEqual([]);

  await code95.fill('29/02/2028');
  await modal.getByRole('button', { name: 'Opslaan', exact: true }).click();
  await expect.poll(() => schrijf.filter((s) => s.pad.endsWith('/api/user-expiries')).length).toBe(1);
  expect(schrijf.find((s) => s.pad.endsWith('/api/user-expiries'))!.body).toMatchObject({ userId: '42', validUntil: '2028-02-29' });
});
