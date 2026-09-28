// @vitest-environment node
/**
 * De techniek-API met "Ook technieker" (28-09), door de échte routes en de
 * échte `requireRole`: alleen het aanmelden, de opslag en de push zijn
 * vervangen. Een chauffeur met de schakelaar mag wat een technieker mag
 * (werkprestaties van zichzelf, het hele gele boek, de volledige
 * voertuigenlijst) en krijgt de meldingen van de garage; een chauffeur zonder
 * de schakelaar blijft waar hij was.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';

const staat = vi.hoisted(() => ({
  users: [
    { id: '10', name: 'Chris Chauffeur', role: 'chauffeur', isActive: true },
    { id: '11', name: 'Tessa Tweeledig', role: 'chauffeur', ookTechnieker: true, isActive: true },
    { id: '12', name: 'Tom Technieker', role: 'technieker', isActive: true },
    { id: '13', name: 'Paula Planner', role: 'planner', isActive: true },
  ],
  prestatieFilters: [] as Array<Record<string, unknown>>,
  nieuwePrestaties: [] as Array<Record<string, unknown>>,
  defectFilters: [] as Array<Record<string, unknown>>,
  pushes: [] as Array<{ ontvangers: string[]; titel: string }>,
}));

const VOERTUIGEN = [
  { id: 'v1', busnr: '013 023', kortNr: 23, nummerplaat: '1-VPZ-070', type: 'lijnbus', categorie: 'bus', status: 'actief' },
  { id: 'v2', busnr: 'Privé 1', kortNr: null, nummerplaat: '1-ABC-123', type: 'privevoertuig', categorie: 'privewagen', status: 'actief' },
];

vi.mock('../api/middleware.js', async (origineel) => {
  const echt = await origineel<typeof import('../api/middleware')>();
  return {
    ...echt,
    // Alleen wie aangemeld is wisselt (header x-test-id); de rolcontrole is de echte.
    authenticate: (req: express.Request & { appUser?: unknown }, _res: express.Response, next: express.NextFunction) => {
      const id = req.header('x-test-id');
      if (id) req.appUser = staat.users.find((u) => u.id === id);
      next();
    },
  };
});
vi.mock('../api/storage.js', async (origineel) => ({
  ...(await origineel<typeof import('../api/storage')>()),
  getUsersData: async () => staat.users,
  logActivity: async () => undefined,
}));
vi.mock('../api/push.js', () => ({
  sendPushToUsers: async (ontvangers: string[], payload: { title: string }) => {
    staat.pushes.push({ ontvangers: [...ontvangers].sort(), titel: payload.title });
  },
}));
vi.mock('../api/_lib/techniekStorage.js', async (origineel) => ({
  ...(await origineel<typeof import('../api/_lib/techniekStorage')>()),
  getVehicles: async () => VOERTUIGEN,
  getVehicle: async (id: string) => VOERTUIGEN.find((v) => v.id === id) ?? null,
  getVehicleExpiries: async () => [],
  countOpenDefecten: async () => 3,
  getDefecten: async (filter: Record<string, unknown>) => { staat.defectFilters.push(filter); return []; },
  createDefect: async (body: Record<string, unknown>) => ({ id: 'd1', status: 'open', gemeldOp: '2026-09-28', ...body }),
  getWerkprestaties: async (filter: Record<string, unknown>) => { staat.prestatieFilters.push(filter); return []; },
  createWerkprestatie: async (body: Record<string, unknown>) => {
    staat.nieuwePrestaties.push(body);
    return { id: 'w1', createdAt: '2026-09-28T08:00:00Z', ...body };
  },
}));

let server: Server;
let basis = '';

beforeAll(async () => {
  const { mountTechniekRoutes } = await import('../api/_lib/techniekRoutes');
  const app = express();
  app.use(express.json());
  mountTechniekRoutes(app);
  await new Promise<void>((klaar) => { server = app.listen(0, '127.0.0.1', () => klaar()); });
  basis = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((klaar) => server.close(() => klaar()));
});

beforeEach(() => {
  staat.prestatieFilters.length = 0;
  staat.nieuwePrestaties.length = 0;
  staat.defectFilters.length = 0;
  staat.pushes.length = 0;
});

const vraag = async (methode: string, pad: string, id: string, body?: unknown) => {
  const res = await fetch(`${basis}${pad}`, {
    method: methode,
    headers: { 'x-test-id': id, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: await res.json() };
};

const CHAUFFEUR = '10';
const OOK_TECHNIEKER = '11';
const TECHNIEKER = '12';

describe('techniek-API: chauffeur zonder schakelaar', () => {
  it('geen werkprestaties, geen open-telling en geen vervaldata (403)', async () => {
    expect((await vraag('GET', '/api/werkprestaties', CHAUFFEUR)).status).toBe(403);
    expect((await vraag('GET', '/api/defecten/aantal-open', CHAUFFEUR)).status).toBe(403);
    expect((await vraag('GET', '/api/vehicle-expiries', CHAUFFEUR)).status).toBe(403);
    expect(staat.prestatieFilters).toEqual([]);
  });

  it('het gele boek alleen met zijn eigen meldingen, en de korte voertuigenlijst', async () => {
    expect((await vraag('GET', '/api/defecten', CHAUFFEUR)).status).toBe(200);
    expect(staat.defectFilters[0]?.gemeldDoor).toBe(CHAUFFEUR);
    const voertuigen = await vraag('GET', '/api/vehicles', CHAUFFEUR);
    expect(voertuigen.json.map((v: { id: string }) => v.id)).toEqual(['v1']);
    expect(voertuigen.json[0]).not.toHaveProperty('nummerplaat');
  });
});

describe('techniek-API: chauffeur met "Ook technieker"', () => {
  it('ziet zijn werkprestaties, alleen de eigen, ook als hij om die van een ander vraagt', async () => {
    const res = await vraag('GET', `/api/werkprestaties?mecanicienId=${TECHNIEKER}`, OOK_TECHNIEKER);
    expect(res.status).toBe(200);
    expect(staat.prestatieFilters[0]?.mecanicienId).toBe(OOK_TECHNIEKER);
  });

  it('registreert een werkprestatie altijd op zijn eigen naam', async () => {
    const res = await vraag('POST', '/api/werkprestaties', OOK_TECHNIEKER, {
      datum: '2026-09-28', vehicleId: 'v1', werkcode: 'H', omschrijving: 'Olie ververst', werkuren: 1.5, mecanicienId: TECHNIEKER,
    });
    expect(res.status).toBe(201);
    expect(staat.nieuwePrestaties[0]?.mecanicienId).toBe(OOK_TECHNIEKER);
    expect(res.json.mecanicienNaam).toBe('Tessa Tweeledig');
  });

  it('ziet het volledige gele boek, de open-telling en de volledige voertuigenlijst', async () => {
    expect((await vraag('GET', '/api/defecten', OOK_TECHNIEKER)).status).toBe(200);
    expect(staat.defectFilters[0]?.gemeldDoor).toBeUndefined();
    expect((await vraag('GET', '/api/defecten/aantal-open', OOK_TECHNIEKER)).json).toEqual({ open: 3 });
    const voertuigen = await vraag('GET', '/api/vehicles', OOK_TECHNIEKER);
    expect(voertuigen.json.map((v: { id: string }) => v.id)).toEqual(['v1', 'v2']);
    expect(voertuigen.json[0].nummerplaat).toBe('1-VPZ-070');
  });

  it('mag een defect op een privéwagen melden; een gewone chauffeur niet', async () => {
    const melding = { vehicleId: 'v2', werktype: 'T', omschrijving: 'Remlicht stuk' };
    expect((await vraag('POST', '/api/defecten', OOK_TECHNIEKER, melding)).status).toBe(201);
    expect((await vraag('POST', '/api/defecten', CHAUFFEUR, melding)).status).toBe(400);
  });

  it('krijgt de pushmelding bij een nieuwe melding in het gele boek, net als de technieker', async () => {
    const res = await vraag('POST', '/api/defecten', CHAUFFEUR, { vehicleId: 'v1', werktype: 'T', omschrijving: 'Deur klemt' });
    expect(res.status).toBe(201);
    // Wel de technieker en de chauffeur met de schakelaar; niet de melder,
    // en de planner alleen bij "voor De Lijn".
    expect(staat.pushes).toEqual([{ ontvangers: [OOK_TECHNIEKER, TECHNIEKER], titel: 'Bus 23: nieuwe melding in het gele boek' }]);
  });
});
