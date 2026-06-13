// @vitest-environment node
/**
 * Integratietests voor de Express-API — het vangnet voor precies de klasse
 * bugs die de reviews vonden (autorisatie-diffs, PII-scoping, bulk-wipes).
 * Supabase wordt gemockt op twee lagen:
 *  - db.js: auth.getUser → vaste token→gebruiker-mapping
 *  - storage.js: data-functies → in-memory store (mem); de pure diff/
 *    summarize-helpers blijven de échte implementatie.
 * De handlers zelf (api/index.ts) draaien dus integraal.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { AddressInfo } from 'node:net';

// Vóór de import van de app: voorkom dat index.ts zelf op poort 3000 gaat
// luisteren of Vite-middleware start.
process.env.VERCEL = '1';
process.env.NODE_ENV = 'production';
process.env.CRON_SECRET = 'test-cron-secret';

const mem = vi.hoisted(() => ({
  users: [] as any[],
  leave: [] as any[],
  swaps: [] as any[],
  services: [] as any[],
  updates: [] as any[],
  diversions: [] as any[],
  planning: [] as any[],
  planningCodes: [] as any[],
  activity: [] as any[],
  clientErrors: [] as any[],
  storedBackups: [] as Array<{ filename: string; size: number }>,
  pushSubscriptions: [] as any[],
  pushesSent: [] as Array<{ userIds: string[]; payload: any }>,
}));

vi.mock('../api/db.js', () => {
  const tokenToEmail: Record<string, string> = {
    'tok-admin': 'admin@vhb.be',
    'tok-planner': 'planner@vhb.be',
    'tok-a': 'a@vhb.be',
    'tok-b': 'b@vhb.be',
  };
  return {
    supabase: {
      auth: {
        getUser: async (token: string) => {
          const email = tokenToEmail[token];
          return email
            ? { data: { user: { id: `auth-${token}`, email } }, error: null }
            : { data: { user: null }, error: { message: 'Ongeldige sessie' } };
        },
      },
    },
    supabaseAdmin: null,
    db: {},
  };
});

vi.mock('../api/push.js', async (importOriginal) => ({
  ...(await importOriginal<any>()),
  getVapidPublicKey: () => 'test-public-key',
  savePushSubscription: async (record: any) => { mem.pushSubscriptions.push(record); },
  deletePushSubscription: async (endpoint: string) => {
    mem.pushSubscriptions = mem.pushSubscriptions.filter((s) => s.endpoint !== endpoint);
  },
  sendPushToUsers: async (userIds: string[], payload: any) => {
    if (userIds.length > 0) mem.pushesSent.push({ userIds, payload });
  },
}));

vi.mock('../api/email.js', async (importOriginal) => ({
  ...(await importOriginal<any>()),
  sendLeaveDecisionEmail: vi.fn(async () => ({ sent: false, reason: 'test' })),
  sendEmail: vi.fn(async () => ({ sent: false, reason: 'test' })),
}));

vi.mock('../api/storage.js', async (importOriginal) => {
  const orig = await importOriginal<any>();
  const replaceById = (current: any[], incoming: any[], idsToDelete: string[] = []) => {
    const byId = new Map(current.map((r: any) => [String(r.id), r]));
    for (const r of incoming) byId.set(String(r.id), r);
    for (const id of idsToDelete) byId.delete(String(id));
    return [...byId.values()];
  };
  return {
    ...orig,
    getUsersData: async () => mem.users,
    saveUsersData: async (data: any[]) => { mem.users = data; },
    getLeaveData: async () => mem.leave,
    saveLeaveData: async (data: any[], idsToDelete: string[] = []) => {
      mem.leave = replaceById(mem.leave, data, idsToDelete);
    },
    getSwapsData: async () => mem.swaps,
    saveSwapsData: async (data: any[], idsToDelete: string[] = []) => {
      mem.swaps = replaceById(mem.swaps, data, idsToDelete);
    },
    getShiftById: async (id: string) =>
      mem.planning.find((s: any) => String(s.id) === String(id)) ?? null,
    getPlanningData: async () => mem.planning,
    getServicesData: async () => mem.services,
    saveServicesData: async (data: any[]) => { mem.services = data; },
    getUpdatesData: async () => mem.updates,
    saveUpdatesData: async (data: any[]) => { mem.updates = data; },
    getDiversionsData: async () => mem.diversions,
    saveDiversionsData: async (data: any[]) => { mem.diversions = data; },
    getPlanningCodesData: async () => mem.planningCodes,
    savePlanningCodesData: async (data: any[]) => { mem.planningCodes = data; },
    logActivity: async (_req: any, domain: string, action: string, message: string) => {
      mem.activity.push({ domain, action, message });
    },
    getActivityLog: async () => mem.activity,
    updateUserSessionMeta: async () => {},
    getPlanningMatrixRows: async () => [],
    getCoverageExpectations: async () => ({}),
    logClientError: async (entry: any) => { mem.clientErrors.push(entry); },
    getClientErrors: async () => mem.clientErrors,
    storeBackup: async (filename: string, body: string) => {
      mem.storedBackups.push({ filename, size: body.length });
      return { removedOld: 0 };
    },
    restoreFromBackup: async (collections: any) => {
      const summary: Record<string, number> = {};
      for (const key of ['users', 'planning', 'services', 'diversions', 'updates', 'leave', 'swaps', 'planningCodes']) {
        if (Array.isArray(collections[key])) {
          (mem as any)[key] = collections[key];
          summary[key] = collections[key].length;
        }
      }
      return summary;
    },
  };
});

let baseUrl = '';
let server: ReturnType<typeof import('express')['application']['listen']> | any;

beforeAll(async () => {
  const app = (await import('../api/index')).default;
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => resolve());
  });
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server?.close(() => resolve()));
});

const api = async (
  method: string,
  path: string,
  opts: { token?: string; body?: unknown; headers?: Record<string, string> } = {},
) => {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
      ...(opts.headers ?? {}),
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
};

beforeEach(() => {
  mem.users = [
    { id: '1', name: 'Annelies Admin', email: 'admin@vhb.be', role: 'admin', isActive: true },
    { id: '2', name: 'Pieter Planner', email: 'planner@vhb.be', role: 'planner', isActive: true },
    { id: '3', name: 'Chauffeur A', email: 'a@vhb.be', role: 'chauffeur', isActive: true },
    { id: '4', name: 'Chauffeur B', email: 'b@vhb.be', role: 'chauffeur', isActive: true },
  ];
  mem.leave = [
    { id: 'l-a1', userId: '3', startDate: '2026-07-01', endDate: '2026-07-03', type: 'betaald_verlof', status: 'pending', comment: 'rust', createdAt: '2026-06-01T08:00:00Z' },
    { id: 'l-a2', userId: '3', startDate: '2026-08-10', endDate: '2026-08-12', type: 'betaald_verlof', status: 'approved', comment: '', createdAt: '2026-05-01T08:00:00Z', decidedAt: '2026-05-02T08:00:00Z' },
    { id: 'l-b1', userId: '4', startDate: '2026-07-05', endDate: '2026-07-06', type: 'klein_verlet', status: 'pending', comment: 'privé', createdAt: '2026-06-02T08:00:00Z' },
  ];
  mem.swaps = [
    { id: 's-1', shiftId: 'sh-a', requesterId: '3', targetDriverId: '4', status: 'pending', reason: '', createdAt: '2026-06-01T08:00:00Z', returnDate: '2026-07-02', returnCode: 'VRIJ' },
    { id: 's-2', shiftId: 'sh-b', requesterId: '4', targetDriverId: '2', status: 'pending', reason: '', createdAt: '2026-06-01T09:00:00Z', returnDate: '2026-07-03', returnCode: '12' },
  ];
  mem.planning = [
    { id: 'sh-a', driverId: '3', date: '2026-07-01', code: '12' },
    { id: 'sh-b', driverId: '4', date: '2026-07-02', code: '14' },
  ];
  mem.services = [
    { id: 'd1', serviceNumber: '10', startTime: '06:00', endTime: '14:00' },
    { id: 'd2', serviceNumber: '11', startTime: '07:00', endTime: '15:00' },
    { id: 'd3', serviceNumber: '12', startTime: '08:00', endTime: '16:00' },
    { id: 'd4', serviceNumber: '13', startTime: '09:00', endTime: '17:00' },
    { id: 'd5', serviceNumber: '14', startTime: '10:00', endTime: '18:00' },
    { id: 'd6', serviceNumber: '15', startTime: '11:00', endTime: '19:00' },
  ];
  mem.updates = Array.from({ length: 6 }, (_, i) => ({
    id: `u${i + 1}`, date: '2026-06-01', title: `Update ${i + 1}`, category: 'algemeen', content: '...',
  }));
  mem.diversions = [];
  mem.planningCodes = [];
  mem.activity = [];
  mem.clientErrors = [];
  mem.storedBackups = [];
  mem.pushSubscriptions = [];
  mem.pushesSent = [];
});

describe('authenticatie & rollen', () => {
  it('weigert requests zonder token (401)', async () => {
    const res = await api('GET', '/api/leave');
    expect(res.status).toBe(401);
  });

  it('weigert een ongeldig token (401)', async () => {
    const res = await api('GET', '/api/leave', { token: 'tok-nep' });
    expect(res.status).toBe(401);
  });

  it('laat een chauffeur het dienstoverzicht lezen maar niet schrijven', async () => {
    const read = await api('GET', '/api/services', { token: 'tok-a' });
    expect(read.status).toBe(200);
    const write = await api('POST', '/api/services', { token: 'tok-a', body: mem.services });
    expect(write.status).toBe(403);
  });

  it('weigert een chauffeur op POST /api/planning (403)', async () => {
    const res = await api('POST', '/api/planning', { token: 'tok-a', body: mem.planning });
    expect(res.status).toBe(403);
  });
});

describe('PII-scoping voor chauffeurs', () => {
  it('GET /api/leave geeft een chauffeur alleen eigen verlof', async () => {
    const res = await api('GET', '/api/leave', { token: 'tok-a' });
    expect(res.status).toBe(200);
    expect(res.json.map((l: any) => l.id).sort()).toEqual(['l-a1', 'l-a2']);
  });

  it('GET /api/leave geeft planner alles', async () => {
    const res = await api('GET', '/api/leave', { token: 'tok-planner' });
    expect(res.json).toHaveLength(3);
  });

  it('GET /api/swaps geeft een chauffeur alleen ruilen waar die bij betrokken is', async () => {
    const res = await api('GET', '/api/swaps', { token: 'tok-a' });
    expect(res.json.map((s: any) => s.id)).toEqual(['s-1']);
  });
});

describe('verlof: scoped diff-autorisatie (regressie hotfix #66)', () => {
  it('accepteert een gescopede payload zonder verlof van collega\'s te verwijderen', async () => {
    // Chauffeur A stuurt exact wat de gescopede GET teruggaf — vroeger gaf
    // dit 403 ("intrekking van andermans verlof") of erger: verwijdering.
    const own = mem.leave.filter((l) => l.userId === '3');
    const res = await api('POST', '/api/leave', { token: 'tok-a', body: own });
    expect(res.status).toBe(200);
    expect(mem.leave.find((l) => l.id === 'l-b1')).toBeTruthy();
  });

  it('laat een chauffeur een eigen pending-aanvraag toevoegen', async () => {
    const own = mem.leave.filter((l) => l.userId === '3');
    const nieuw = { id: 'l-a3', userId: '3', startDate: '2026-09-01', endDate: '2026-09-02', type: 'betaald_verlof', status: 'pending', comment: '', createdAt: '2026-06-12T08:00:00Z' };
    const res = await api('POST', '/api/leave', { token: 'tok-a', body: [...own, nieuw] });
    expect(res.status).toBe(200);
    expect(mem.leave.find((l) => l.id === 'l-a3')).toBeTruthy();
  });

  it('weigert verlof aanvragen voor een ander (403)', async () => {
    const own = mem.leave.filter((l) => l.userId === '3');
    const voorAnder = { id: 'l-x', userId: '4', startDate: '2026-09-01', endDate: '2026-09-01', type: 'betaald_verlof', status: 'pending', createdAt: '2026-06-12T08:00:00Z' };
    const res = await api('POST', '/api/leave', { token: 'tok-a', body: [...own, voorAnder] });
    expect(res.status).toBe(403);
    expect(mem.leave.find((l) => l.id === 'l-x')).toBeFalsy();
  });

  it('weigert een nieuwe aanvraag die niet als pending start (403)', async () => {
    const own = mem.leave.filter((l) => l.userId === '3');
    const zelfGoedgekeurd = { id: 'l-x', userId: '3', startDate: '2026-09-01', endDate: '2026-09-01', type: 'betaald_verlof', status: 'approved', createdAt: '2026-06-12T08:00:00Z' };
    const res = await api('POST', '/api/leave', { token: 'tok-a', body: [...own, zelfGoedgekeurd] });
    expect(res.status).toBe(403);
  });

  it('laat intrekken van eigen pending toe, maar niet van eigen approved', async () => {
    const zonderPending = mem.leave.filter((l) => l.userId === '3' && l.id !== 'l-a1');
    const ok = await api('POST', '/api/leave', { token: 'tok-a', body: zonderPending });
    expect(ok.status).toBe(200);
    expect(mem.leave.find((l) => l.id === 'l-a1')).toBeFalsy();

    const zonderApproved = mem.leave.filter((l) => l.userId === '3' && l.id !== 'l-a2');
    const fail = await api('POST', '/api/leave', { token: 'tok-a', body: zonderApproved });
    expect(fail.status).toBe(403);
    expect(mem.leave.find((l) => l.id === 'l-a2')).toBeTruthy();
  });

  it('weigert dat een chauffeur een bestaande aanvraag inhoudelijk wijzigt (403)', async () => {
    const own = mem.leave.filter((l) => l.userId === '3').map((l) =>
      l.id === 'l-a1' ? { ...l, endDate: '2026-07-10' } : l,
    );
    const res = await api('POST', '/api/leave', { token: 'tok-a', body: own });
    expect(res.status).toBe(403);
  });

  it('laat de planner een aanvraag goedkeuren en verwijderingen doorvoeren', async () => {
    const payload = mem.leave
      .filter((l) => l.id !== 'l-b1') // bewuste verwijdering door planner
      .map((l) => (l.id === 'l-a1' ? { ...l, status: 'approved', decidedAt: '2026-06-12T09:00:00Z' } : l));
    const res = await api('POST', '/api/leave', { token: 'tok-planner', body: payload });
    expect(res.status).toBe(200);
    expect(mem.leave.find((l) => l.id === 'l-a1')?.status).toBe('approved');
    expect(mem.leave.find((l) => l.id === 'l-b1')).toBeFalsy();
  });
});

describe('dienstruil: autorisatieregels', () => {
  it('weigert force-approve (pending → approved) door een planner, staat het toe voor admin', async () => {
    const approve = (rows: any[]) => rows.map((s) => (s.id === 's-1' ? { ...s, status: 'approved', decidedAt: '2026-06-12T09:00:00Z' } : s));
    const planner = await api('POST', '/api/swaps', { token: 'tok-planner', body: approve(mem.swaps) });
    expect(planner.status).toBe(403);

    const admin = await api('POST', '/api/swaps', { token: 'tok-admin', body: approve(mem.swaps) });
    expect(admin.status).toBe(200);
    expect(mem.swaps.find((s) => s.id === 's-1')?.status).toBe('approved');
  });

  it('dicht het bypass-gat: nieuw record met status approved wordt geweigerd (403)', async () => {
    const bypass = [...mem.swaps, { ...mem.swaps[0], id: 's-nieuw', status: 'approved' }];
    const res = await api('POST', '/api/swaps', { token: 'tok-planner', body: bypass });
    expect(res.status).toBe(403);
  });

  it('weigert een ruil met andermans dienst als aanbod (403)', async () => {
    const own = mem.swaps.filter((s) => s.requesterId === '3' || s.targetDriverId === '3');
    const metAndermansShift = [...own, {
      id: 's-x', shiftId: 'sh-b', requesterId: '3', targetDriverId: '4', status: 'pending',
      reason: '', createdAt: '2026-06-12T08:00:00Z', returnDate: '2026-07-05', returnCode: 'VRIJ',
    }];
    const res = await api('POST', '/api/swaps', { token: 'tok-a', body: metAndermansShift });
    expect(res.status).toBe(403);
  });

  it('laat de aangezochte collega accepteren maar niets anders wijzigen', async () => {
    const scoped = mem.swaps.filter((s) => s.requesterId === '4' || s.targetDriverId === '4');
    const accepteer = scoped.map((s) => (s.id === 's-1' ? { ...s, status: 'accepted' } : s));
    const ok = await api('POST', '/api/swaps', { token: 'tok-b', body: accepteer });
    expect(ok.status).toBe(200);
    expect(mem.swaps.find((s) => s.id === 's-1')?.status).toBe('accepted');
  });

  it('weigert accepteren mét gewijzigde ruilvoorwaarden (403)', async () => {
    const scoped = mem.swaps.filter((s) => s.requesterId === '4' || s.targetDriverId === '4');
    const sjoemel = scoped.map((s) => (s.id === 's-1' ? { ...s, status: 'accepted', returnCode: '99' } : s));
    const res = await api('POST', '/api/swaps', { token: 'tok-b', body: sjoemel });
    expect(res.status).toBe(403);
  });
});

describe('bulk-wipe-vangrail (PR #71)', () => {
  it('weigert een save die >50% van de diensten zou verwijderen (409)', async () => {
    const res = await api('POST', '/api/services', { token: 'tok-planner', body: mem.services.slice(0, 2) });
    expect(res.status).toBe(409);
    expect(mem.services).toHaveLength(6);
  });

  it('staat dezelfde save toe mét expliciete x-bulk-replace header', async () => {
    const res = await api('POST', '/api/services', {
      token: 'tok-planner',
      body: mem.services.slice(0, 2),
      headers: { 'x-bulk-replace': '1' },
    });
    expect(res.status).toBe(200);
    expect(mem.services).toHaveLength(2);
  });

  it('weigert het leegmaken van de updates-collectie (409)', async () => {
    const res = await api('POST', '/api/updates', { token: 'tok-planner', body: [] });
    expect(res.status).toBe(409);
    expect(mem.updates).toHaveLength(6);
  });

  it('laat kleine collecties (<5 records) wel volledig vervangen', async () => {
    mem.updates = mem.updates.slice(0, 3);
    const res = await api('POST', '/api/updates', { token: 'tok-planner', body: [] });
    expect(res.status).toBe(200);
    expect(mem.updates).toHaveLength(0);
  });

  it('weigert een gebruikers-save die >50% van de accounts schrapt (409)', async () => {
    mem.users = [
      ...mem.users,
      { id: '5', name: 'C', email: 'c@vhb.be', role: 'chauffeur', isActive: true },
    ];
    const res = await api('POST', '/api/users', { token: 'tok-admin', body: mem.users.slice(0, 1) });
    expect(res.status).toBe(409);
    expect(mem.users).toHaveLength(5);
  });

  it('weigert non-array payloads (400)', async () => {
    const res = await api('POST', '/api/updates', { token: 'tok-planner', body: { hack: true } });
    expect(res.status).toBe(400);
  });
});

describe('client-foutmonitoring', () => {
  it('accepteert een foutmelding zonder authenticatie (204) en kapt lange velden af', async () => {
    const res = await api('POST', '/api/client-errors', {
      body: { message: 'x'.repeat(5000), source: 'error-toast', url: '/dashboard' },
    });
    expect(res.status).toBe(204);
    expect(mem.clientErrors).toHaveLength(1);
    expect(mem.clientErrors[0].message).toHaveLength(1000);
  });

  it('weigert een melding zonder message (400)', async () => {
    const res = await api('POST', '/api/client-errors', { body: { source: 'window.onerror' } });
    expect(res.status).toBe(400);
    expect(mem.clientErrors).toHaveLength(0);
  });

  it('toont de foutenlijst alleen aan admins', async () => {
    mem.clientErrors = [{ id: 1, createdAt: '2026-06-12T10:00:00Z', message: 'boem' }];
    const planner = await api('GET', '/api/client-errors', { token: 'tok-planner' });
    expect(planner.status).toBe(403);
    const admin = await api('GET', '/api/client-errors', { token: 'tok-admin' });
    expect(admin.status).toBe(200);
    expect(admin.json).toHaveLength(1);
  });
});

describe('delta-endpoints (PATCH per record, anti-race)', () => {
  it('laat de planner een verlofaanvraag goedkeuren via PATCH', async () => {
    const res = await api('PATCH', '/api/leave/l-a1', { token: 'tok-planner', body: { status: 'approved', ifStatus: 'pending' } });
    expect(res.status).toBe(200);
    expect(res.json.leave.status).toBe('approved');
    expect(res.json.leave.decidedAt).toBeTruthy();
    expect(mem.leave.find((l) => l.id === 'l-a1')?.status).toBe('approved');
    // De aanvrager kreeg e-mail-equivalent push.
    expect(mem.pushesSent.find((p) => p.payload.title === 'Verlof goedgekeurd')?.userIds).toEqual(['3']);
  });

  it('detecteert een race: tweede beslisser krijgt 409 en de eerste beslissing blijft staan', async () => {
    const eerste = await api('PATCH', '/api/leave/l-a1', { token: 'tok-planner', body: { status: 'approved', ifStatus: 'pending' } });
    expect(eerste.status).toBe(200);
    const tweede = await api('PATCH', '/api/leave/l-a1', { token: 'tok-admin', body: { status: 'rejected', ifStatus: 'pending' } });
    expect(tweede.status).toBe(409);
    expect(tweede.json.currentStatus).toBe('approved');
    expect(mem.leave.find((l) => l.id === 'l-a1')?.status).toBe('approved');
  });

  it('geeft 404 voor een intussen ingetrokken aanvraag en 403 voor chauffeurs', async () => {
    const weg = await api('PATCH', '/api/leave/bestaat-niet', { token: 'tok-planner', body: { status: 'approved' } });
    expect(weg.status).toBe(404);
    const chauffeur = await api('PATCH', '/api/leave/l-a1', { token: 'tok-a', body: { status: 'approved' } });
    expect(chauffeur.status).toBe(403);
  });

  it('laat de aangezochte collega accepteren via PATCH (zonder decidedAt) en de planner daarna goedkeuren', async () => {
    const accept = await api('PATCH', '/api/swaps/s-1', { token: 'tok-b', body: { status: 'accepted', ifStatus: 'pending' } });
    expect(accept.status).toBe(200);
    expect(accept.json.swap.status).toBe('accepted');
    expect(accept.json.swap.decidedAt).toBeFalsy();

    const approve = await api('PATCH', '/api/swaps/s-1', { token: 'tok-planner', body: { status: 'approved', ifStatus: 'accepted' } });
    expect(approve.status).toBe(200);
    expect(approve.json.swap.decidedAt).toBeTruthy();
    expect(mem.swaps.find((s) => s.id === 's-1')?.status).toBe('approved');
  });

  it('handhaaft de force-approve-regel ook op het delta-pad', async () => {
    const planner = await api('PATCH', '/api/swaps/s-1', { token: 'tok-planner', body: { status: 'approved', ifStatus: 'pending' } });
    expect(planner.status).toBe(403);
    const admin = await api('PATCH', '/api/swaps/s-1', { token: 'tok-admin', body: { status: 'approved', ifStatus: 'pending' } });
    expect(admin.status).toBe(200);
  });

  it('weigert een chauffeur die niet de aangezochte collega is (403)', async () => {
    // Chauffeur A is requester van s-1, niet target — accepteren mag niet.
    const res = await api('PATCH', '/api/swaps/s-1', { token: 'tok-a', body: { status: 'accepted' } });
    expect(res.status).toBe(403);
  });
});

describe('push-notificaties', () => {
  it('geeft de public key aan ingelogde gebruikers', async () => {
    const res = await api('GET', '/api/push/public-key', { token: 'tok-a' });
    expect(res.status).toBe(200);
    expect(res.json.publicKey).toBe('test-public-key');
    const anon = await api('GET', '/api/push/public-key');
    expect(anon.status).toBe(401);
  });

  it('registreert en verwijdert een abonnement', async () => {
    const sub = { endpoint: 'https://push.example/abc', keys: { p256dh: 'pk', auth: 'au' } };
    const res = await api('POST', '/api/push/subscribe', { token: 'tok-a', body: sub });
    expect(res.status).toBe(200);
    expect(mem.pushSubscriptions).toEqual([{ userId: '3', endpoint: 'https://push.example/abc', p256dh: 'pk', auth: 'au' }]);

    const ongeldid = await api('POST', '/api/push/subscribe', { token: 'tok-a', body: { endpoint: '' } });
    expect(ongeldid.status).toBe(400);

    const del = await api('POST', '/api/push/unsubscribe', { token: 'tok-a', body: { endpoint: 'https://push.example/abc' } });
    expect(del.status).toBe(200);
    expect(mem.pushSubscriptions).toHaveLength(0);
  });

  it('stuurt een push naar de chauffeur bij een verlofbeslissing', async () => {
    const payload = mem.leave.map((l) => (l.id === 'l-a1' ? { ...l, status: 'approved', decidedAt: '2026-06-12T09:00:00Z' } : l));
    const res = await api('POST', '/api/leave', { token: 'tok-planner', body: payload });
    expect(res.status).toBe(200);
    const verlofPush = mem.pushesSent.find((p) => p.payload.title === 'Verlof goedgekeurd');
    expect(verlofPush).toBeTruthy();
    expect(verlofPush!.userIds).toEqual(['3']);
  });

  it('stuurt een push naar de aangezochte collega bij een nieuwe ruil', async () => {
    const own = mem.swaps.filter((s) => s.requesterId === '3' || s.targetDriverId === '3');
    const nieuw = {
      id: 's-nieuw', shiftId: 'sh-a', requesterId: '3', targetDriverId: '4', status: 'pending',
      reason: '', createdAt: '2026-06-12T08:00:00Z', returnDate: '2026-07-09', returnCode: 'VRIJ',
    };
    const res = await api('POST', '/api/swaps', { token: 'tok-a', body: [...own, nieuw] });
    expect(res.status).toBe(200);
    const ruilPush = mem.pushesSent.find((p) => p.payload.title === 'Nieuwe dienstruil-aanvraag');
    expect(ruilPush).toBeTruthy();
    expect(ruilPush!.userIds).toEqual(['4']);
  });
});

describe('restore vanuit back-up', () => {
  const backup = (collections: any) => ({ exportedAt: '2026-06-13T02:00:00Z', version: 1, collections });

  it('is alleen toegankelijk voor admins (403 voor planner)', async () => {
    const res = await api('POST', '/api/restore', { token: 'tok-planner', body: backup({ users: mem.users }) });
    expect(res.status).toBe(403);
  });

  it('weigert een payload zonder collections (400)', async () => {
    const res = await api('POST', '/api/restore', { token: 'tok-admin', body: { exportedAt: 'x', version: 1 } });
    expect(res.status).toBe(400);
  });

  it('weigert een back-up zonder admin-account (400)', async () => {
    const zonderAdmin = [{ id: '9', name: 'X', email: 'x@vhb.be', role: 'chauffeur', isActive: true }];
    const res = await api('POST', '/api/restore', { token: 'tok-admin', body: backup({ users: zonderAdmin }) });
    expect(res.status).toBe(400);
    expect(res.json.error).toMatch(/admin/i);
  });

  it('zet de collecties terug en geeft een samenvatting', async () => {
    const nieuweServices = mem.services.slice(0, 2);
    const res = await api('POST', '/api/restore', {
      token: 'tok-admin',
      body: backup({ users: mem.users, services: nieuweServices, leave: [] }),
    });
    expect(res.status).toBe(200);
    expect(res.json.success).toBe(true);
    expect(res.json.summary.services).toBe(2);
    expect(res.json.summary.leave).toBe(0);
    expect(mem.services).toHaveLength(2);
    expect(mem.leave).toHaveLength(0);
    // De restore-actie staat in de audit-log.
    expect(mem.activity.find((a) => a.action === 'Back-up hersteld')).toBeTruthy();
  });
});

describe('back-up export', () => {
  it('is alleen toegankelijk voor admins (403 voor planner/chauffeur)', async () => {
    const planner = await api('GET', '/api/backup', { token: 'tok-planner' });
    expect(planner.status).toBe(403);
    const chauffeur = await api('GET', '/api/backup', { token: 'tok-a' });
    expect(chauffeur.status).toBe(403);
  });

  it('cron-route weigert zonder of met fout secret (401), draait met juist secret', async () => {
    const zonder = await api('GET', '/api/cron/backup');
    expect(zonder.status).toBe(401);
    const fout = await api('GET', '/api/cron/backup', { headers: { Authorization: 'Bearer verkeerd' } });
    expect(fout.status).toBe(401);

    const goed = await api('GET', '/api/cron/backup', { headers: { Authorization: 'Bearer test-cron-secret' } });
    expect(goed.status).toBe(200);
    expect(goed.json.success).toBe(true);
    expect(mem.storedBackups).toHaveLength(1);
    expect(mem.storedBackups[0].filename).toMatch(/^vhb-backup-\d{4}-\d{2}-\d{2}\.json$/);
    expect(mem.storedBackups[0].size).toBeGreaterThan(100);
  });

  it('levert alle collecties in één JSON met export-metadata', async () => {
    const res = await api('GET', '/api/backup', { token: 'tok-admin' });
    expect(res.status).toBe(200);
    expect(res.json.version).toBe(1);
    expect(typeof res.json.exportedAt).toBe('string');
    const c = res.json.collections;
    expect(c.users).toHaveLength(4);
    expect(c.leave).toHaveLength(3);
    expect(c.swaps).toHaveLength(2);
    expect(c.services).toHaveLength(6);
    expect(c.updates).toHaveLength(6);
    expect(c.planning).toHaveLength(2);
    expect(Array.isArray(c.diversions)).toBe(true);
    expect(Array.isArray(c.planningCodes)).toBe(true);
    expect(Array.isArray(c.activityLog)).toBe(true);
  });
});
