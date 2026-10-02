// @vitest-environment node
/**
 * Een chauffeur annuleert zijn melding in het gele boek terwijl de technieker
 * ze afhandelt (scan 01-10, punt 11). De route controleerde "eigen melding en
 * nog open" op een eerdere lezing en schreef daarna onvoorwaardelijk: de
 * annulering overschreef zo een afhandeling die er net tussen kwam.
 *
 * Hier draaien de échte route en de échte opslag (api/_lib/techniekStorage.ts)
 * tegen een kleine PostgREST-nabootsing van `vehicle_defects`: de voorwaarde
 * van de update wordt dus echt als filter uitgevoerd. Het tweede verzoek landt
 * via `staat.voorUpdate` in het venster tussen de lezing en de schrijfactie
 * van het eerste, en gaat zelf ook door de echte route.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';

const staat = vi.hoisted(() => ({
  users: [
    { id: '10', name: 'Chris Chauffeur', role: 'chauffeur', isActive: true },
    { id: '11', name: 'Carla Collega', role: 'chauffeur', isActive: true },
    { id: '12', name: 'Tom Technieker', role: 'technieker', isActive: true },
  ],
  defecten: [] as Array<Record<string, any>>,
  /** Loopt één keer, vlak vóór de eerstvolgende update wordt uitgevoerd. */
  voorUpdate: null as null | (() => Promise<void> | void),
  /** De filters van elke uitgevoerde update, in volgorde. */
  updates: [] as Array<Array<[string, unknown]>>,
  log: [] as Array<{ actie: string; door: string }>,
  pushes: [] as Array<{ ontvangers: string[]; titel: string }>,
}));

vi.mock('../api/db.js', () => {
  const from = (tabel: string) => {
    if (tabel !== 'vehicle_defects') throw new Error(`nep-db: onbekende tabel ${tabel}`);
    const q: any = {
      _patch: null as null | Record<string, unknown>,
      _filters: [] as Array<[string, unknown]>,
      select() { return q; },
      update(patch: Record<string, unknown>) { q._patch = patch; return q; },
      eq(kolom: string, waarde: unknown) { q._filters.push([kolom, waarde]); return q; },
      async maybeSingle() {
        if (q._patch) {
          const haak = staat.voorUpdate;
          if (haak) { staat.voorUpdate = null; await haak(); }
          staat.updates.push([...q._filters]);
        }
        // De filters gelden op het moment van uitvoeren, zoals in de database.
        const raak = staat.defecten.filter((r) => q._filters.every(([k, w]: [string, unknown]) => String(r[k]) === String(w)));
        if (raak.length > 1) return { data: null, error: { code: 'PGRST116', message: 'meer dan één rij' } };
        if (q._patch && raak[0]) Object.assign(raak[0], q._patch);
        return { data: raak[0] ? { ...raak[0] } : null, error: null };
      },
    };
    return q;
  };
  return { db: { from }, supabase: null, supabaseAdmin: null };
});
vi.mock('../api/middleware.js', async (origineel) => {
  const echt = await origineel<typeof import('../api/middleware')>();
  return {
    ...echt,
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
  logActivity: async (req: { appUser?: { id?: string } }, _domein: string, actie: string) => {
    staat.log.push({ actie, door: String(req.appUser?.id ?? '') });
  },
}));
vi.mock('../api/push.js', () => ({
  sendPushToUsers: async (ontvangers: string[], payload: { title: string }) => {
    staat.pushes.push({ ontvangers: [...ontvangers].sort(), titel: payload.title });
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

const CHAUFFEUR = '10';
const COLLEGA = '11';
const TECHNIEKER = '12';

beforeEach(() => {
  staat.defecten = [{
    id: 'd1', vehicle_id: 'v1', gemeld_op: '2026-09-28T08:00:00Z', gemeld_door: CHAUFFEUR, werktype: 'T',
    omschrijving: 'Deur klemt', status: 'open', uitgevoerd_op: null, uitgevoerd_door: null, uitgevoerd_werk: null,
    vehicles: { busnr: '013 023', kort_nr: 23 },
  }];
  staat.voorUpdate = null;
  staat.updates = [];
  staat.log = [];
  staat.pushes = [];
});

const wijzig = async (wie: string, body: unknown, id = 'd1') => {
  const res = await fetch(`${basis}/api/defecten/${id}`, {
    method: 'PATCH',
    headers: { 'x-test-id': wie, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json() };
};
const melding = () => staat.defecten[0];
const AFHANDELING = { status: 'uitgevoerd', uitgevoerdOp: '2026-09-29', uitgevoerdWerk: 'Deurrail gesmeerd' };

describe('eigen open melding annuleren', () => {
  it('lukt, met de voorwaarde in de schrijfactie zelf: nog open en van deze chauffeur', async () => {
    const res = await wijzig(CHAUFFEUR, { status: 'geannuleerd' });
    expect(res.status).toBe(200);
    expect(res.json.status).toBe('geannuleerd');
    expect(melding().status).toBe('geannuleerd');
    expect(staat.updates).toEqual([[['id', 'd1'], ['status', 'open'], ['gemeld_door', CHAUFFEUR]]]);
    expect(staat.log).toEqual([{ actie: 'Melding geannuleerd', door: CHAUFFEUR }]);
  });

  it('andermans melding of een melding die niet meer open is: 403, zoals voorheen, zonder schrijfactie', async () => {
    expect((await wijzig(COLLEGA, { status: 'geannuleerd' })).status).toBe(403);
    melding().status = 'uitgevoerd';
    expect((await wijzig(CHAUFFEUR, { status: 'geannuleerd' })).status).toBe(403);
    expect(staat.updates).toEqual([]);
  });
});

describe('de chauffeur annuleert terwijl de technieker afhandelt', () => {
  it('de afhandeling landt eerst: de annulering krijgt 409 en overschrijft niets', async () => {
    let tweede: { status: number } | undefined;
    staat.voorUpdate = async () => { tweede = await wijzig(TECHNIEKER, AFHANDELING); };
    const res = await wijzig(CHAUFFEUR, { status: 'geannuleerd' });
    expect(tweede?.status).toBe(200);
    expect(res.status).toBe(409);
    expect(res.json.currentStatus).toBe('uitgevoerd');
    expect(res.json.error).toBe('Deze melding is intussen al behandeld, annuleren kan niet meer. Vernieuw de lijst.');
    // De afhandeling van de technieker staat er nog, volledig.
    expect(melding()).toMatchObject({ status: 'uitgevoerd', uitgevoerd_door: TECHNIEKER, uitgevoerd_op: '2026-09-29', uitgevoerd_werk: 'Deurrail gesmeerd' });
    // Alleen de afhandeling is gelogd en gemeld; van de annulering geen spoor.
    expect(staat.log).toEqual([{ actie: 'Melding uitgevoerd', door: TECHNIEKER }]);
    expect(staat.pushes).toEqual([{ ontvangers: [CHAUFFEUR], titel: 'Bus 23: je melding is afgehandeld' }]);
  });

  it('de melding verdween intussen: 404', async () => {
    staat.voorUpdate = () => { staat.defecten = []; };
    const res = await wijzig(CHAUFFEUR, { status: 'geannuleerd' });
    expect(res.status).toBe(404);
    expect(staat.log).toEqual([]);
  });

  it('wat de technieker doet is ongewijzigd: zijn schrijfactie draagt geen voorwaarde', async () => {
    const res = await wijzig(TECHNIEKER, AFHANDELING);
    expect(res.status).toBe(200);
    expect(staat.updates).toEqual([[['id', 'd1']]]);
    // Ook terug openzetten en opnieuw afhandelen blijft kunnen.
    expect((await wijzig(TECHNIEKER, { status: 'open' })).status).toBe(200);
    expect(melding()).toMatchObject({ status: 'open', uitgevoerd_door: null, uitgevoerd_op: null });
  });
});
