// @vitest-environment node
/**
 * De rapportenroute los van de rest van de API: pariteit tussen register en
 * laders, en de periodevalidatie (hooguit 366 dagen). Verlofsaldo heeft geen
 * periodefilter, dus hier krijgt het register één testrapport mét periode
 * erbij; de volledige keten (auth, rollen, echte cijfers) zit in
 * src/apiIntegration.test.ts.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';
import type { RapportDefinitie, RapportFilters } from '../shared/rapporten/types';

const TESTRAPPORT: RapportDefinitie = {
  id: 'test-periode',
  domein: 'ziekte',
  titel: 'Testrapport',
  omschrijving: 'Alleen voor de test.',
  filters: [{ soort: 'periode' }, { soort: 'chauffeur' }],
  kolommen: [{ id: 'naam', titel: 'Naam', type: 'tekst' }, { id: 'dagen', titel: 'Dagen', type: 'getal', totaal: true }],
  sortering: { kolom: 'naam', richting: 'asc' },
  print: 'staand',
  bronNaam: 'testgegevens',
};

vi.mock('../api/middleware.js', () => ({
  authenticate: (_req: unknown, _res: unknown, next: () => void) => next(),
  requireRole: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock('../api/deviceGate.js', () => ({ isMissingTableError: () => false }));
vi.mock('../api/storage.js', () => ({
  getAppSetting: async () => null,
  getLeaveData: async () => [],
  getUsersData: async () => [],
}));
vi.mock('../shared/rapporten/register.js', async (origineel) => {
  const echt = await origineel<typeof import('../shared/rapporten/register')>();
  return { ...echt, rapportVan: (id: string) => (id === 'test-periode' ? TESTRAPPORT : echt.rapportVan(id)) };
});

let server: Server;
let basis = '';
const gezien: RapportFilters[] = [];

beforeAll(async () => {
  const { mountRapportRoutes, RAPPORT_LADERS } = await import('../api/_lib/rapportRoutes');
  RAPPORT_LADERS['test-periode'] = async (filters) => {
    gezien.push(filters);
    return { rijen: [{ id: '1', naam: 'Bert', dagen: 2 }, { id: '2', naam: 'Anna', dagen: 3 }], bereik: { van: '2026-01-05', tot: '2026-09-01' } };
  };
  const app = express();
  mountRapportRoutes(app);
  await new Promise<void>((klaar) => { server = app.listen(0, '127.0.0.1', () => klaar()); });
  basis = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((klaar) => server.close(() => klaar()));
});

const haal = async (pad: string) => {
  const res = await fetch(`${basis}${pad}`);
  return { status: res.status, json: await res.json() };
};

describe('register en laders', () => {
  it('elk rapport in het register heeft een lader, en elke lader een rapport', async () => {
    const { RAPPORTEN } = await vi.importActual<typeof import('../shared/rapporten/register')>('../shared/rapporten/register');
    const { RAPPORT_LADERS } = await import('../api/_lib/rapportRoutes');
    const laders = Object.keys(RAPPORT_LADERS).filter((id) => id !== 'test-periode').sort();
    expect(laders).toEqual(RAPPORTEN.map((r) => r.id).sort());
  });
});

describe('periodevalidatie op de route', () => {
  it('een periode van meer dan 366 dagen is 400, met de fout bij het veld', async () => {
    const res = await haal('/api/rapporten/test-periode?van=2026-01-01&tot=2027-01-02');
    expect(res.status).toBe(400);
    expect(res.json).toMatchObject({ error: 'Ongeldige invoer', veldfouten: { tot: 'Kies een periode van hoogstens 366 dagen' } });
  });

  it('ontbrekende, onmogelijke of omgekeerde datums zijn 400 en bereiken de lader niet', async () => {
    gezien.length = 0;
    expect((await haal('/api/rapporten/test-periode')).status).toBe(400);
    expect((await haal('/api/rapporten/test-periode?van=2026-02-30&tot=2026-03-01')).status).toBe(400);
    expect((await haal('/api/rapporten/test-periode?van=2026-09-02&tot=2026-09-01')).json.veldfouten).toEqual({ tot: 'De einddatum ligt voor de begindatum' });
    expect(gezien).toEqual([]);
  });

  it('precies 366 dagen mag; de lader krijgt genormaliseerde filters en de route telt de totalen', async () => {
    gezien.length = 0;
    const res = await haal('/api/rapporten/test-periode?van=2028-01-01&tot=2028-12-31&chauffeur=43&rommel=1');
    expect(res.status).toBe(200);
    expect(gezien).toEqual([{ van: '2028-01-01', tot: '2028-12-31', chauffeur: '43', keuzes: {} }]);
    expect(res.json.totalen).toEqual({ dagen: 5 });
    expect(res.json.bereik).toEqual({ van: '2026-01-05', tot: '2026-09-01' });
    expect(res.json.rijen).toHaveLength(2);
  });

  it('een lader die faalt geeft 500 met een nette tekst, geen lege lijst', async () => {
    const { RAPPORT_LADERS } = await import('../api/_lib/rapportRoutes');
    const vorige = RAPPORT_LADERS['test-periode'];
    RAPPORT_LADERS['test-periode'] = async () => { throw new Error('db weg'); };
    const stil = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const res = await haal('/api/rapporten/test-periode?van=2026-09-01&tot=2026-09-30');
    stil.mockRestore();
    RAPPORT_LADERS['test-periode'] = vorige;
    expect(res.status).toBe(500);
    expect(res.json).toEqual({ error: 'Het rapport kon niet geladen worden.' });
  });
});
