// @vitest-environment node
/**
 * De rapporten van ruilen en planning door de échte route: de echte
 * `requireRole`, de echte zod-filters uit de definitie en de echte laders, met
 * alleen de opslag vervangen door vaste gegevens. Bewaakt de rolafscherming
 * (alleen planner en admin), de filtervalidatie (400, en de bron wordt dan
 * niet gelezen), hele maanden, en een eerlijk `bereik`.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';

const gelezen = { swaps: 0, planning: 0, matrix: 0, dekking: [] as string[][] };

vi.mock('../api/middleware.js', async (origineel) => {
  const echt = await origineel<typeof import('../api/middleware')>();
  return {
    ...echt,
    authenticate: (req: express.Request & { appUser?: unknown }, _res: express.Response, next: express.NextFunction) => {
      const rol = req.header('x-test-rol');
      if (rol) req.appUser = { id: '1', name: 'Test', role: rol };
      next();
    },
  };
});
vi.mock('../api/storage.js', async (origineel) => ({
  ...(await origineel<typeof import('../api/storage')>()),
  getSwapsData: async () => {
    gelezen.swaps += 1;
    return [
      { id: 's1', requesterId: '10', targetDriverId: '11', status: 'approved', createdAt: '2026-09-10T08:00:00.000Z', swapType: 'overname', shiftDate: '2026-09-20', shiftLine: '2703' },
    ];
  },
  getSwapVerloopRegels: async () => ({
    s1: [
      { createdAt: '2026-09-10T08:00:00.000Z', action: 'Dienstruil aangevraagd', actorRole: 'chauffeur', actorName: 'Bert Buschauffeur', details: '' },
      { createdAt: '2026-09-10T22:30:00.000Z', action: 'Dienstruil goedgekeurd', actorRole: 'planner', actorName: 'Petra Planner', details: '(pending → approved)' },
    ],
  }),
  getPlanningData: async () => {
    gelezen.planning += 1;
    return [
      { id: 'p1', date: '2026-09-21', startTime: '06:53', endTime: '08:23', line: '2109', busNumber: '', loopnr: '4601', driverId: '10' },
      { id: 'p2', date: '2026-09-21', startTime: '13:10', endTime: '19:15', line: '2109', busNumber: '', loopnr: '4602', driverId: '10' },
    ];
  },
  getPlanningMatrixRows: async () => {
    gelezen.matrix += 1;
    return [{ source_date: '2026-09-21', assignments: { 'Bert Buschauffeur': '2109', 'Dirk Nacht': 'vrij' } }];
  },
  getPlanningMatrixGrenzen: async () => ({ eerste: '2026-07-01', laatste: '2099-12-31' }),
  getServicesData: async () => [{ serviceNumber: '2109', startTime: '06:53', endTime: '08:23', startTime2: '13:10', endTime2: '19:15' }],
  getPlanningCodesData: async () => [{ code: 'vrij', category: 'absence', description: 'Vrij', isDayOff: true }],
  getLeaveData: async () => [],
}));
vi.mock('../api/coverageRoutes.js', () => ({
  berekenDekkingsGaten: async (van: string, tot: string) => {
    gelezen.dekking.push([van, tot]);
    return [{ date: van, dayType: 'schooldag', expected: 2, covered: 1, missing: ['2115'] }];
  },
}));
vi.mock('../api/_lib/rapporten/personeelBron.js', () => ({
  getRapportMedewerkers: async () => [
    { id: '10', name: 'Bert Buschauffeur', role: 'chauffeur', section: 'Reguliere', startDate: '2019-01-23', isActive: true },
    { id: '11', name: 'Dirk Nacht', role: 'chauffeur', section: 'Nacht', isActive: true },
    { id: '1', name: 'Annelies Admin', role: 'admin', isActive: true },
  ],
}));
vi.mock('../api/_lib/techniekStorage.js', () => ({
  getVehicles: async () => [{ id: 'v1', busnr: '013 023', kortNr: 23, status: 'actief' }],
  getVehicleExpiries: async () => [],
  getDefecten: async () => [],
  getWerkprestaties: async () => [],
}));

let server: Server;
let basis = '';

beforeAll(async () => {
  const { mountRapportRoutes } = await import('../api/_lib/rapportRoutes');
  const app = express();
  mountRapportRoutes(app);
  await new Promise<void>((klaar) => { server = app.listen(0, '127.0.0.1', () => klaar()); });
  basis = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((klaar) => server.close(() => klaar()));
});

const haal = async (pad: string, rol?: string) => {
  const res = await fetch(`${basis}${pad}`, { headers: rol ? { 'x-test-rol': rol } : {} });
  return { status: res.status, json: await res.json() };
};

const SEPTEMBER = '?van=2026-09-01&tot=2026-09-30';
const ALLE = ['uitgevoerde-wissels', 'ruilen-per-chauffeur', 'ruilaanvragen', 'overzicht-per-chauffeur', 'diensten-per-dag', 'openstaande-diensten'];
const leeg = () => { gelezen.swaps = 0; gelezen.planning = 0; gelezen.matrix = 0; gelezen.dekking = []; };

describe('rolafscherming: alleen planner en admin', () => {
  it('zonder sessie 401, chauffeur en technieker 403, en de bron wordt niet gelezen', async () => {
    leeg();
    for (const id of ALLE) {
      expect((await haal(`/api/rapporten/${id}${SEPTEMBER}`)).status, id).toBe(401);
      expect((await haal(`/api/rapporten/${id}${SEPTEMBER}`, 'chauffeur')).status, id).toBe(403);
      expect((await haal(`/api/rapporten/${id}${SEPTEMBER}`, 'technieker')).status, id).toBe(403);
    }
    expect(gelezen).toEqual({ swaps: 0, planning: 0, matrix: 0, dekking: [] });
  });

  it('planner en admin krijgen elk rapport', async () => {
    for (const id of ALLE) {
      expect((await haal(`/api/rapporten/${id}${SEPTEMBER}`, 'planner')).status, id).toBe(200);
      expect((await haal(`/api/rapporten/${id}${SEPTEMBER}`, 'admin')).status, id).toBe(200);
    }
  });
});

describe('filtervalidatie', () => {
  it('elk rapport eist zijn periode, hooguit 366 dagen, en een onbekende keuze is 400 bij het veld', async () => {
    leeg();
    for (const id of ALLE) expect((await haal(`/api/rapporten/${id}`, 'planner')).status, id).toBe(400);
    expect((await haal('/api/rapporten/uitgevoerde-wissels?van=2025-01-01&tot=2026-09-30', 'planner')).json.veldfouten).toEqual({ tot: 'Kies een periode van hoogstens 366 dagen' });
    expect((await haal(`/api/rapporten/ruilaanvragen${SEPTEMBER}&status=kwijt`, 'planner')).json).toMatchObject({ error: 'Ongeldige invoer', veldfouten: { status: 'Ongeldige keuze' } });
    expect((await haal(`/api/rapporten/ruilaanvragen${SEPTEMBER}&soort=cadeau`, 'admin')).status).toBe(400);
    expect(gelezen).toEqual({ swaps: 0, planning: 0, matrix: 0, dekking: [] });
  });

  it('Overzicht per chauffeur telt per hele maand: een halve maand is 400, twaalf maanden mogen, dertien niet', async () => {
    expect((await haal('/api/rapporten/overzicht-per-chauffeur?van=2026-09-15&tot=2026-09-30', 'planner')).json.veldfouten).toEqual({ van: 'Dit rapport telt per hele maand: begin op de eerste dag van een maand' });
    expect((await haal('/api/rapporten/overzicht-per-chauffeur?van=2026-09-01&tot=2026-09-29', 'planner')).json.veldfouten).toEqual({ tot: 'Dit rapport telt per hele maand: eindig op de laatste dag van een maand' });
    expect((await haal('/api/rapporten/overzicht-per-chauffeur?van=2026-01-01&tot=2026-12-31', 'planner')).status).toBe(200);
    expect((await haal('/api/rapporten/overzicht-per-chauffeur?van=2026-01-01&tot=2027-01-31', 'planner')).json.veldfouten).toEqual({ tot: 'Kies hoogstens twaalf maanden' });
  });
});

describe('antwoord', () => {
  it('uitgevoerde wissels: de Brusselse dag van de logregel (22:30 UTC = 00:30 de volgende dag), met status en bereik', async () => {
    const res = await haal(`/api/rapporten/uitgevoerde-wissels${SEPTEMBER}`, 'planner');
    expect(res.json.rijen).toEqual([expect.objectContaining({ uitgevoerdOp: '2026-09-11', van: 'Bert Buschauffeur', naar: 'Dirk Nacht', dienst: '2703', soort: 'Overname', door: 'Petra Planner', status: 'Goedgekeurd' })]);
    expect(res.json.bereik).toEqual({ van: '2026-09-11', tot: '2026-09-11' });
    // Een periode vóór de eerste doorvoer: geen rijen, en het bereik zegt vanaf wanneer.
    const voor = await haal('/api/rapporten/uitgevoerde-wissels?van=2026-01-01&tot=2026-06-30', 'planner');
    expect(voor.json.rijen).toEqual([]);
    expect(voor.json.bereik.van).toBe('2026-09-11');
  });

  it('ruilen per chauffeur: de totalen van de lader (ruilen, niet de som van de rijen)', async () => {
    const res = await haal(`/api/rapporten/ruilen-per-chauffeur${SEPTEMBER}`, 'admin');
    expect(res.json.rijen.map((r: { naam: string; goedgekeurd: number }) => [r.naam, r.goedgekeurd])).toEqual([['Bert Buschauffeur', 1], ['Dirk Nacht', 1]]);
    expect(res.json.totalen).toMatchObject({ aangevraagd: 1, ontvangen: 1, goedgekeurd: 1 });
  });

  it('ruilaanvragen: rechtstreeks goedgekeurd = antwoord niet afgewacht, met de peildatum van de server', async () => {
    const res = await haal(`/api/rapporten/ruilaanvragen${SEPTEMBER}`, 'planner');
    expect(res.json.rijen[0]).toMatchObject({ aanvrager: 'Bert Buschauffeur', antwoord: 'Niet afgewacht', beslistOp: '2026-09-11', door: 'Petra Planner', doorlooptijd: 1 });
    expect(res.json.peildatum).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('overzicht per chauffeur: de gesplitste dienst is één dag met dienst, met de som van beide delen', async () => {
    const res = await haal(`/api/rapporten/overzicht-per-chauffeur${SEPTEMBER}`, 'planner');
    expect(res.json.rijen.map((r: { naam: string; diensten: number; minuten: number; vrij: number }) => [r.naam, r.diensten, r.minuten, r.vrij])).toEqual([['Bert Buschauffeur', 1, 455, 0], ['Dirk Nacht', 0, 0, 1]]);
    expect(res.json.totalen).toMatchObject({ diensten: 1, minuten: 455, dagen: 2 });
  });

  it('diensten per dag: twee delen, zonder bus; een voertuig in de URL doet niets meer en het rapport per voertuig bestaat niet', async () => {
    const diensten = await haal('/api/rapporten/diensten-per-dag?van=2026-09-21&tot=2026-09-27', 'planner');
    expect(diensten.json.rijen.map((r: { dienst: string; deel: number; duur: number }) => [r.dienst, r.deel, r.duur])).toEqual([['2109', 1, 90], ['2109', 2, 365]]);
    for (const rij of diensten.json.rijen) expect(Object.keys(rij)).not.toContain('bus');
    const metVoertuig = await haal('/api/rapporten/diensten-per-dag?van=2026-09-21&tot=2026-09-27&voertuig=v1', 'planner');
    expect(metVoertuig.json.rijen).toEqual(diensten.json.rijen);
    expect((await haal('/api/rapporten/inzet-per-voertuig?van=2026-09-21&tot=2026-09-27', 'planner')).status).toBe(404);
  });

  it('openstaande diensten: de dekking wordt pas vanaf vandaag gerekend, en helemaal niet voor een voorbije periode', async () => {
    leeg();
    const voorbij = await haal('/api/rapporten/openstaande-diensten?van=2026-01-01&tot=2026-01-31', 'planner');
    expect(voorbij.json.rijen).toEqual([]);
    expect(gelezen.dekking).toEqual([]);
    // Een periode die tien dagen geleden begon en over twintig dagen eindigt.
    const dag = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
    const komend = await haal(`/api/rapporten/openstaande-diensten?van=${dag(-10)}&tot=${dag(20)}`, 'planner');
    // `van` is opgeschoven naar vandaag (de peildatum van de server).
    expect(gelezen.dekking).toEqual([[komend.json.peildatum, dag(20)]]);
    expect(komend.json.rijen[0]).toMatchObject({ datum: komend.json.peildatum, dienst: '2115', reden: 'Niet toegewezen', status: 'Open' });
    expect(komend.json.bereik).toEqual({ van: komend.json.peildatum, tot: '2099-12-31' });
  });
});
