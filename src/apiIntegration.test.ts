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

// Dynamisch geladen ná de env-set hieronder (statische imports worden
// gehoist en zouden rateLimit.ts met de default-limiet laden vóór
// RATE_LIMIT_MAX gezet is — dezelfde reden waarom de app dynamisch importeert).
let resetAllRateLimiters: () => void;
let invalidateUsersCache: () => void;

// Vóór de import van de app: voorkom dat index.ts zelf op poort 3000 gaat
// luisteren of Vite-middleware start.
process.env.VERCEL = '1';
process.env.NODE_ENV = 'production';
process.env.CRON_SECRET = 'test-cron-secret';
// Lagere limiet zodat de 429-test snel triggert; per test resetten we de
// telstand in beforeEach, dus geen overloop tussen testen.
process.env.RATE_LIMIT_MAX = '50';
process.env.RATE_LIMIT_ANON_MAX = '50';
// OCPI: token + publieke basis zodat de gehoste endpoints testbaar zijn.
process.env.OCPI_TOKEN_A = 'test-token-a';
process.env.OCPI_PUBLIC_BASE_URL = 'https://test.example';

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
  emailsSent: [] as Array<{ to: string[]; subject: string; context?: string }>,
  storedBackups: [] as Array<{ filename: string; size: number }>,
  pushSubscriptions: [] as any[],
  pushesSent: [] as Array<{ userIds: string[]; payload: any }>,
  documents: [] as any[],
  ritblaadje: null as any,
  devices: [] as any[],
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
  deletePushSubscriptionForUser: async (endpoint: string, userId: string) => {
    mem.pushSubscriptions = mem.pushSubscriptions.filter((s) => !(s.endpoint === endpoint && String(s.userId) === String(userId)));
  },
  sendPushToUsers: async (userIds: string[], payload: any) => {
    if (userIds.length > 0) mem.pushesSent.push({ userIds, payload });
  },
}));

vi.mock('../api/email.js', async (importOriginal) => ({
  ...(await importOriginal<any>()),
  sendLeaveDecisionEmail: vi.fn(async () => ({ ok: true, mocked: true })),
  sendEmail: vi.fn(async (opts: any) => {
    mem.emailsSent.push({ to: opts.to, subject: opts.subject, context: opts.context });
    return { ok: true, mocked: true };
  }),
  sendWelcomeEmail: vi.fn(async (ctx: any) => {
    mem.emailsSent.push({ to: [ctx.to], subject: 'Welkom op het VHB Portaal — stel je wachtwoord in', context: `welcome:${ctx.to}` });
    return { ok: true, mocked: true };
  }),
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
    saveUsersData: async (data: any[]) => {
      // Zelfde contract als de echte functie: nieuwe e-mailadressen = nieuw
      // Auth-account → welkomstmail-kandidaat.
      const beforeEmails = new Set(mem.users.map((u: any) => String(u.email || '').toLowerCase()).filter(Boolean));
      const createdAccounts = data
        .filter((u: any) => u.email && !beforeEmails.has(String(u.email).toLowerCase()))
        .map((u: any) => ({ email: u.email, name: u.name }));
      mem.users = data;
      return { createdAccounts };
    },
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
    getLoginActivity: async () => mem.activity.filter((a: any) => a.action === 'Aangemeld'),
    updateUserSessionMeta: async () => {},
    bumpActiveSessions: async () => {},
    getPlanningMatrixRows: async () => [],
    getCoverageExpectations: async () => ({}),
    listUserDocuments: async (userId?: string) =>
      userId ? mem.documents.filter((d: any) => String(d.userId) === String(userId)) : mem.documents,
    getUserDocument: async (id: string) => mem.documents.find((d: any) => String(d.id) === String(id)) ?? null,
    insertUserDocument: async (doc: any) => { const rec = { id: `doc-${mem.documents.length + 1}`, uploadedAt: '2026-07-01T00:00:00Z', ...doc }; mem.documents.push(rec); return rec; },
    deleteUserDocument: async (id: string) => { mem.documents = mem.documents.filter((d: any) => String(d.id) !== String(id)); },
    getRitblaadjeMeta: async () => mem.ritblaadje ?? null,
    // Toestel-whitelist: zelfde contract als de echte helpers, tegen mem.devices.
    getDevice: async (userId: string, deviceToken: string) => {
      // Speciale tokens simuleren DB-fouten voor de fail-open/closed-tests.
      if (deviceToken === 'dev-missingtable') throw { code: '42P01', message: 'relation "user_devices" does not exist' };
      if (deviceToken === 'dev-dberror') throw { code: '08006', message: 'connection failure' };
      return mem.devices.find((d: any) => String(d.userId) === String(userId) && d.deviceToken === deviceToken) ?? null;
    },
    userHasDevices: async (userId: string) =>
      mem.devices.some((d: any) => String(d.userId) === String(userId)),
    registerDevice: async (userId: string, deviceToken: string, name: string, autoApprove: boolean) => {
      const existing = mem.devices.find((d: any) => String(d.userId) === String(userId) && d.deviceToken === deviceToken);
      if (existing) {
        existing.lastSeenAt = '2026-07-18T12:00:00Z';
        return { device: existing, created: false };
      }
      const device = {
        userId: String(userId), deviceToken, name,
        status: autoApprove ? 'approved' : 'pending',
        createdAt: '2026-07-18T12:00:00Z', lastSeenAt: '2026-07-18T12:00:00Z',
        approvedAt: autoApprove ? '2026-07-18T12:00:00Z' : null, approvedBy: autoApprove ? 'auto' : null,
      };
      mem.devices.push(device);
      return { device, created: true };
    },
    listAllDevices: async () => mem.devices,
    setDeviceStatus: async (userId: string, deviceToken: string, status: string) => {
      const device = mem.devices.find((d: any) => String(d.userId) === String(userId) && d.deviceToken === deviceToken);
      if (device) device.status = status;
    },
    renameDevice: async (userId: string, deviceToken: string, name: string) => {
      const device = mem.devices.find((d: any) => String(d.userId) === String(userId) && d.deviceToken === deviceToken);
      if (device) device.name = name;
    },
    deleteDevice: async (userId: string, deviceToken: string) => {
      mem.devices = mem.devices.filter((d: any) => !(String(d.userId) === String(userId) && d.deviceToken === deviceToken));
    },
    deleteAllDocumentsForUser: async (userId: string) => {
      const n = mem.documents.filter((d: any) => String(d.userId) === String(userId)).length;
      mem.documents = mem.documents.filter((d: any) => String(d.userId) !== String(userId));
      return n;
    },
    logClientError: async (entry: any) => { mem.clientErrors.push(entry); },
    getClientErrors: async () => mem.clientErrors,
    getClientErrorsSince: async (sinceIso: string) =>
      mem.clientErrors.filter((e) => String(e.createdAt) >= sinceIso),
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
  resetAllRateLimiters = (await import('../api/rateLimit')).resetAllRateLimiters;
  invalidateUsersCache = (await import('../api/userCache')).invalidateUsersCache;
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
  // device: toestel-token voor de whitelist-gate. Default 'dev-ok' (in
  // beforeEach goedgekeurd voor beide chauffeurs) zodat bestaande tests
  // ongemoeid blijven; expliciet null = header weglaten.
  opts: { token?: string; body?: unknown; headers?: Record<string, string>; device?: string | null } = {},
) => {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
      ...(opts.device === null ? {} : { 'X-Device-Token': opts.device ?? 'dev-ok' }),
      ...(opts.headers ?? {}),
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, json, headers: res.headers };
};

beforeEach(() => {
  // Telstand van de rate-limiter en de auth-cache per test wissen: anders
  // bloedt verbruik over tussen tests (en kan een onschuldige test 429 of
  // stale users zien).
  resetAllRateLimiters();
  invalidateUsersCache();
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
    { id: 'sh-c', driverId: '3', date: '2026-07-08', code: '12' }, // vrije dienst van chauffeur 3 (geen open ruil)
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
  mem.emailsSent = [];
  mem.storedBackups = [];
  mem.pushSubscriptions = [];
  mem.pushesSent = [];
  mem.documents = [];
  mem.ritblaadje = null;
  // Beide chauffeurs hebben één goedgekeurd toestel ('dev-ok' — de default
  // van de api()-helper), zodat de whitelist-gate bestaande tests niet raakt.
  mem.devices = [
    { userId: '3', deviceToken: 'dev-ok', name: 'iPhone · app', status: 'approved', createdAt: '2026-07-01T00:00:00Z', lastSeenAt: '2026-07-01T00:00:00Z', approvedAt: '2026-07-01T00:00:00Z', approvedBy: 'auto' },
    { userId: '4', deviceToken: 'dev-ok', name: 'Android · app', status: 'approved', createdAt: '2026-07-01T00:00:00Z', lastSeenAt: '2026-07-01T00:00:00Z', approvedAt: '2026-07-01T00:00:00Z', approvedBy: 'auto' },
  ];
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

  it('een chauffeur kan zichzelf NIET ziek melden (403 — enkel planner/admin)', async () => {
    const res = await api('POST', '/api/leave/sick-report', { token: 'tok-a', body: { userId: '3', startDate: '2026-09-01' } });
    expect(res.status).toBe(403);
    expect(mem.leave.some((l: any) => l.type === 'ziekte')).toBe(false);
  });

  it('een planner registreert een ziekmelding: direct goedgekeurd ziekte-verlof + push/mail', async () => {
    const res = await api('POST', '/api/leave/sick-report', { token: 'tok-planner', body: { userId: '4', startDate: '2026-09-02', endDate: '2026-09-03' } });
    expect(res.status).toBe(200);
    expect(res.json.leave).toMatchObject({ userId: '4', type: 'ziekte', status: 'approved', startDate: '2026-09-02', endDate: '2026-09-03' });
    const stored = mem.leave.find((l: any) => l.type === 'ziekte');
    expect(stored?.status).toBe('approved');
    // De rest van de planning krijgt push + mail (behalve de melder = planner, id 2).
    const sickPush = mem.pushesSent.find((p) => p.payload.title === 'Ziekmelding');
    expect(sickPush?.userIds).toEqual(['1']);
    expect(mem.emailsSent.some((m) => (m.context ?? '').startsWith('sick:'))).toBe(true);
  });

  it('ziekmelding zonder chauffeur wordt geweigerd (400)', async () => {
    const res = await api('POST', '/api/leave/sick-report', { token: 'tok-planner', body: { startDate: '2026-09-02' } });
    expect(res.status).toBe(400);
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

  it('laat intrekken van eigen pending toe; een weggelaten eigen approved wordt genegeerd (blijft staan)', async () => {
    const zonderPending = mem.leave.filter((l) => l.userId === '3' && l.id !== 'l-a1');
    const ok = await api('POST', '/api/leave', { token: 'tok-a', body: zonderPending });
    expect(ok.status).toBe(200);
    expect(mem.leave.find((l) => l.id === 'l-a1')).toBeFalsy();

    // Eigen approved weglaten is géén intrekking (stale sessie): genegeerd,
    // niet verwijderd — en geen storende 403 op de rest van de save.
    const zonderApproved = mem.leave.filter((l) => l.userId === '3' && l.id !== 'l-a2');
    const res = await api('POST', '/api/leave', { token: 'tok-a', body: zonderApproved });
    expect(res.status).toBe(200);
    expect(mem.leave.find((l) => l.id === 'l-a2')).toBeTruthy();
  });

  it('negeert een inhoudelijke wijziging van een bestaande aanvraag door een chauffeur (blijft ongewijzigd, geen clobber)', async () => {
    const own = mem.leave.filter((l) => l.userId === '3').map((l) =>
      l.id === 'l-a1' ? { ...l, endDate: '2026-07-10' } : l,
    );
    const res = await api('POST', '/api/leave', { token: 'tok-a', body: own });
    expect(res.status).toBe(200);
    // Echo van een bestaand record wordt niet weggeschreven → origineel behouden.
    expect(mem.leave.find((l) => l.id === 'l-a1')?.endDate).toBe('2026-07-03');
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

  it('weigert een overgang uit een afgehandelde status — rejected → approved via POST (409)', async () => {
    mem.swaps = [{ id: 's-r', shiftId: 'sh-a', requesterId: '3', targetDriverId: '4', status: 'rejected', reason: '', createdAt: '2026-06-01T08:00:00Z', returnDate: '2026-07-02', returnCode: 'VRIJ' }];
    const res = await api('POST', '/api/swaps', { token: 'tok-admin', body: mem.swaps.map((s) => ({ ...s, status: 'approved' })) });
    expect(res.status).toBe(409);
    expect(mem.swaps.find((s) => s.id === 's-r')?.status).toBe('rejected');
  });

  it('weigert een overgang uit een afgehandelde status — rejected → approved via PATCH (409)', async () => {
    mem.swaps = [{ id: 's-r', shiftId: 'sh-a', requesterId: '3', targetDriverId: '4', status: 'rejected', reason: '', createdAt: '2026-06-01T08:00:00Z', returnDate: '2026-07-02', returnCode: 'VRIJ' }];
    const res = await api('PATCH', '/api/swaps/s-r', { token: 'tok-admin', body: { status: 'approved' } });
    expect(res.status).toBe(409);
    expect(mem.swaps.find((s) => s.id === 's-r')?.status).toBe('rejected');
  });
});

describe('urgente-update-mail: ontvangers server-side', () => {
  it('negeert client-opgegeven adressen en stuurt alleen naar interne gebruikers', async () => {
    mem.emailsSent = [];
    const res = await api('POST', '/api/send-urgent-update-email', {
      token: 'tok-planner',
      body: { update: { title: 'Test', content: 'x' }, recipients: [{ id: '999', email: 'attacker@evil.example' }] },
    });
    expect(res.status).toBe(200);
    const sent = mem.emailsSent.find((e) => e.context === 'urgent-update');
    expect(sent).toBeTruthy();
    expect(sent!.to).not.toContain('attacker@evil.example');
    expect((sent!.to as string[]).every((addr) => addr.endsWith('@vhb.be'))).toBe(true);
  });
});

describe('bulk-wipe-vangrail (PR #71)', () => {
  it('weigert een save die >50% van de diensten zou verwijderen (409)', async () => {
    const res = await api('POST', '/api/services', { token: 'tok-planner', body: mem.services.slice(0, 2) });
    expect(res.status).toBe(409);
    expect(mem.services).toHaveLength(6);
  });

  it('staat de x-bulk-replace alleen toe voor admin (planner krijgt 403)', async () => {
    const planner = await api('POST', '/api/services', {
      token: 'tok-planner',
      body: mem.services.slice(0, 2),
      headers: { 'x-bulk-replace': '1' },
    });
    expect(planner.status).toBe(403);
    expect(mem.services).toHaveLength(6); // niks gewijzigd

    const admin = await api('POST', '/api/services', {
      token: 'tok-admin',
      body: mem.services.slice(0, 2),
      headers: { 'x-bulk-replace': '1' },
    });
    expect(admin.status).toBe(200);
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

  it('stuurt een welkomstmail naar een nieuw account (en niet naar bestaande)', async () => {
    const res = await api('POST', '/api/users', {
      token: 'tok-admin',
      body: [...mem.users, { id: 'n1', name: 'Nieuwe Chauffeur', email: 'nieuw@vhb.be', role: 'chauffeur', isActive: true }],
    });
    expect(res.status).toBe(200);
    expect(res.json?.welcomed).toBe(1);
    const welcome = mem.emailsSent.filter((m) => (m.context ?? '').startsWith('welcome:'));
    expect(welcome).toHaveLength(1);
    expect(welcome[0].to).toEqual(['nieuw@vhb.be']);
  });

  it('weigert non-array payloads (400)', async () => {
    const res = await api('POST', '/api/updates', { token: 'tok-planner', body: { hack: true } });
    expect(res.status).toBe(400);
  });

  it('pusht een nieuwe update naar de actieve chauffeurs', async () => {
    const nieuw = { id: 'u-new', date: '2026-07-01', title: 'Zomeruniformen', category: 'algemeen', content: '...', isUrgent: false };
    const res = await api('POST', '/api/updates', { token: 'tok-planner', body: [nieuw, ...mem.updates] });
    expect(res.status).toBe(200);
    const push = mem.pushesSent.find((p) => p.payload.title === 'Nieuwe update');
    expect(push).toBeTruthy();
    expect(push!.userIds.sort()).toEqual(['3', '4']); // de twee chauffeurs
    expect(push!.payload.body).toBe('Zomeruniformen');
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

  it('vervangt een opgegeven userId door de échte gebruiker bij een geldig token', async () => {
    const res = await api('POST', '/api/client-errors', { token: 'tok-a', body: { message: 'boem', userId: '1' } });
    expect(res.status).toBe(204);
    expect(mem.clientErrors[0].userId).toBe('3');
  });

  it('markeert een userId zonder geldige sessie als onbevestigd', async () => {
    const res = await api('POST', '/api/client-errors', { body: { message: 'boem', userId: '1' } });
    expect(res.status).toBe(204);
    expect(mem.clientErrors[0].userId).toBe('onbevestigd:1');
  });

  it('beperkt foutrapportage per IP: 429 zodra de eigen limiet vol is', async () => {
    let last = 0;
    for (let i = 0; i < 12; i++) {
      last = (await api('POST', '/api/client-errors', { body: { message: `f${i}` } })).status;
    }
    expect(last).toBe(429);
    expect(mem.clientErrors.length).toBeLessThanOrEqual(10);
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
      id: 's-nieuw', shiftId: 'sh-c', requesterId: '3', targetDriverId: '4', status: 'pending',
      reason: '', createdAt: '2026-06-12T08:00:00Z', returnDate: '2026-07-09', returnCode: 'VRIJ',
    };
    const res = await api('POST', '/api/swaps', { token: 'tok-a', body: [...own, nieuw] });
    expect(res.status).toBe(200);
    const ruilPush = mem.pushesSent.find((p) => p.payload.title === 'Nieuwe dienstruil-aanvraag');
    expect(ruilPush).toBeTruthy();
    expect(ruilPush!.userIds).toEqual(['4']);
  });

  it('pusht de beslissers (planner/admin) wanneer een collega de ruil accepteert', async () => {
    const res = await api('PATCH', '/api/swaps/s-1', { token: 'tok-b', body: { status: 'accepted' } });
    expect(res.status).toBe(200);
    const validatiePush = mem.pushesSent.find((p) => p.payload.title === 'Dienstruil wacht op validatie');
    expect(validatiePush).toBeTruthy();
    expect(validatiePush!.userIds.sort()).toEqual(['1', '2']);
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
    // v2: + authUsers en ocpiRegistration als referentie-exports (DR).
    expect(res.json.version).toBe(2);
    expect(Array.isArray(res.json.authUsers)).toBe(true);
    expect(typeof res.json.exportedAt).toBe('string');
    const c = res.json.collections;
    expect(c.users).toHaveLength(4);
    expect(c.leave).toHaveLength(3);
    expect(c.swaps).toHaveLength(2);
    expect(c.services).toHaveLength(6);
    expect(c.updates).toHaveLength(6);
    expect(c.planning).toHaveLength(3);
    expect(Array.isArray(c.diversions)).toBe(true);
    expect(Array.isArray(c.planningCodes)).toBe(true);
    expect(Array.isArray(c.activityLog)).toBe(true);
  });

  it('back-up bevat documenten- en ritblad-metadata als referentie-export', async () => {
    mem.documents = [{ id: 'd1', userId: '3', filename: 'attest.pdf', storagePath: '3/x', uploadedAt: '2026-07-01T00:00:00Z' }];
    mem.ritblaadje = { id: 'current', filename: 'ritblad.pdf', storage_path: 'r/y' };
    const res = await api('GET', '/api/backup', { token: 'tok-admin' });
    expect(res.status).toBe(200);
    expect(res.json.userDocuments).toHaveLength(1);
    expect(res.json.userDocuments[0].filename).toBe('attest.pdf');
    expect(res.json.ritblaadje?.filename).toBe('ritblad.pdf');
  });
});

describe('wees-documenten opruimen', () => {
  it('verwijdert de documenten van een gebruiker die uit gebruikersbeheer wordt geschrapt', async () => {
    mem.documents = [
      { id: 'd1', userId: '3', filename: 'a.pdf', storagePath: '3/a', uploadedAt: '2026-07-01T00:00:00Z' },
      { id: 'd2', userId: '4', filename: 'b.pdf', storagePath: '4/b', uploadedAt: '2026-07-01T00:00:00Z' },
    ];
    // Chauffeur 3 (a@vhb.be) uit de lijst halen — de rest blijft (geen bulk-wipe).
    const zonderDrie = mem.users.filter((u: any) => u.id !== '3');
    const res = await api('POST', '/api/users', { token: 'tok-admin', body: zonderDrie });
    expect(res.status).toBe(200);
    expect(mem.documents.map((d: any) => d.id)).toEqual(['d2']);
  });
});

describe('foutmelding-digest (cron)', () => {
  const recent = () => new Date().toISOString();

  it('weigert zonder of met fout secret (401)', async () => {
    expect((await api('GET', '/api/cron/error-digest')).status).toBe(401);
    expect((await api('GET', '/api/cron/error-digest', { headers: { Authorization: 'Bearer fout' } })).status).toBe(401);
  });

  it('mailt een samenvatting naar admins als er recente fouten zijn', async () => {
    mem.clientErrors = [
      { id: 1, createdAt: recent(), message: 'Kon planning niet laden', source: 'error-toast', url: '/' },
      { id: 2, createdAt: recent(), message: 'Kon planning niet laden', source: 'error-toast', url: '/' },
      { id: 3, createdAt: recent(), message: 'TypeError: x is undefined', source: 'window.onerror', url: '/rooster' },
    ];
    const res = await api('GET', '/api/cron/error-digest', { headers: { Authorization: 'Bearer test-cron-secret' } });
    expect(res.status).toBe(200);
    expect(res.json.alerted).toBe(true);
    expect(res.json.count).toBe(3);
    expect(mem.emailsSent).toHaveLength(1);
    // Default-ontvanger = admin-account (admin@vhb.be).
    expect(mem.emailsSent[0].to).toContain('admin@vhb.be');
    expect(mem.emailsSent[0].subject).toContain('3 fouten');
    expect(mem.emailsSent[0].context).toBe('error-digest');
  });

  it('stuurt niets als er geen recente fouten zijn', async () => {
    mem.clientErrors = [];
    const res = await api('GET', '/api/cron/error-digest', { headers: { Authorization: 'Bearer test-cron-secret' } });
    expect(res.status).toBe(200);
    expect(res.json.alerted).toBe(false);
    expect(mem.emailsSent).toHaveLength(0);
  });

  it('negeert fouten ouder dan het interval', async () => {
    mem.clientErrors = [
      { id: 1, createdAt: '2020-01-01T00:00:00.000Z', message: 'oud', source: 'error-toast' },
    ];
    const res = await api('GET', '/api/cron/error-digest', { headers: { Authorization: 'Bearer test-cron-secret' } });
    expect(res.json.alerted).toBe(false);
    expect(mem.emailsSent).toHaveLength(0);
  });

  it('respecteert ALERT_EMAIL als die gezet is', async () => {
    process.env.ALERT_EMAIL = 'ops@vhb.be, baas@vhb.be';
    mem.clientErrors = [{ id: 1, createdAt: recent(), message: 'boem', source: 'window.onerror' }];
    try {
      const res = await api('GET', '/api/cron/error-digest', { headers: { Authorization: 'Bearer test-cron-secret' } });
      expect(res.status).toBe(200);
      expect(mem.emailsSent[0].to).toEqual(['ops@vhb.be', 'baas@vhb.be']);
    } finally {
      delete process.env.ALERT_EMAIL;
    }
  });
});

describe('optimistic concurrency (revisie-tokens, anti-overschrijf)', () => {
  const REV = 'x-collection-revision';

  it('GET /api/services geeft een revisie-header', async () => {
    const res = await api('GET', '/api/services', { token: 'tok-planner' });
    expect(res.status).toBe(200);
    expect(res.headers.get(REV)).toBeTruthy();
  });

  it('dezelfde data geeft een stabiele revisie (geen vals conflict)', async () => {
    const a = await api('GET', '/api/services', { token: 'tok-planner' });
    const b = await api('GET', '/api/services', { token: 'tok-admin' });
    expect(a.headers.get(REV)).toBe(b.headers.get(REV));
  });

  it('POST met de juiste base-revisie slaagt en geeft een nieuwe revisie terug', async () => {
    const get = await api('GET', '/api/services', { token: 'tok-planner' });
    const rev = get.headers.get(REV)!;
    const edited = mem.services.map((s, i) => (i === 0 ? { ...s, startTime: '05:30' } : s));
    const res = await api('POST', '/api/services', { token: 'tok-planner', body: edited, headers: { [REV]: rev } });
    expect(res.status).toBe(200);
    const newRev = res.headers.get(REV);
    expect(newRev).toBeTruthy();
    expect(newRev).not.toBe(rev); // inhoud veranderde → andere revisie
    expect(mem.services[0].startTime).toBe('05:30');
  });

  it('POST met een verouderde base-revisie geeft 409 en slaat niets op', async () => {
    const edited = mem.services.map((s, i) => (i === 0 ? { ...s, startTime: '05:30' } : s));
    const res = await api('POST', '/api/services', { token: 'tok-planner', body: edited, headers: { [REV]: 'verouderd-token' } });
    expect(res.status).toBe(409);
    expect(res.json.conflict).toBe('revision');
    expect(mem.services[0].startTime).toBe('06:00');
  });

  it('POST zonder revisie-header blijft toegestaan (oudere client / backward compatible)', async () => {
    const edited = mem.services.map((s, i) => (i === 0 ? { ...s, startTime: '05:30' } : s));
    const res = await api('POST', '/api/services', { token: 'tok-planner', body: edited });
    expect(res.status).toBe(200);
  });

  it('twee-beheerders-race: de tweede save overschrijft de eerste niet (409)', async () => {
    const a = await api('GET', '/api/services', { token: 'tok-admin' });
    const revA = a.headers.get(REV)!;
    // Beheerder B laadt vers en slaat op.
    const b = await api('GET', '/api/services', { token: 'tok-planner' });
    const editedB = mem.services.map((s, i) => (i === 0 ? { ...s, serviceNumber: 'B' } : s));
    const bSave = await api('POST', '/api/services', { token: 'tok-planner', body: editedB, headers: { [REV]: b.headers.get(REV)! } });
    expect(bSave.status).toBe(200);
    // Beheerder A slaat op met de inmiddels verouderde revisie → geweigerd.
    const editedA = mem.services.map((s, i) => (i === 0 ? { ...s, serviceNumber: 'A' } : s));
    const aSave = await api('POST', '/api/services', { token: 'tok-admin', body: editedA, headers: { [REV]: revA } });
    expect(aSave.status).toBe(409);
    expect(mem.services[0].serviceNumber).toBe('B'); // B's wijziging blijft staan
  });

  it('bulk-replace-import omzeilt de revisie-check', async () => {
    const res = await api('POST', '/api/services', {
      token: 'tok-admin',
      body: mem.services.slice(0, 2),
      headers: { [REV]: 'maakt-niet-uit', 'x-bulk-replace': '1' },
    });
    expect(res.status).toBe(200);
  });

  it('handhaaft de revisie ook op updates en planningscodes', async () => {
    const upd = await api('POST', '/api/updates', { token: 'tok-planner', body: mem.updates, headers: { [REV]: 'oud' } });
    expect(upd.status).toBe(409);
    mem.planningCodes = [{ code: 'V', description: 'Verlof', category: 'absence' }];
    const pc = await api('POST', '/api/planning-codes', { token: 'tok-planner', body: [], headers: { [REV]: 'oud' } });
    expect(pc.status).toBe(409);
  });
});

describe('rate limiting', () => {
  it('blokkeert met 429 zodra een token de limiet (50/venster) overschrijdt', async () => {
    // RATE_LIMIT_MAX=50 in deze testomgeving; beforeEach heeft gereset.
    const statuses: number[] = [];
    for (let i = 0; i < 55; i++) {
      const res = await api('GET', '/api/leave', { token: 'tok-a' });
      statuses.push(res.status);
    }
    const allowed = statuses.filter((s) => s !== 429).length;
    const blocked = statuses.filter((s) => s === 429).length;
    expect(allowed).toBe(50);
    expect(blocked).toBe(5);
  });

  it('houdt de limiet per token bij — een andere gebruiker wordt niet geraakt', async () => {
    for (let i = 0; i < 55; i++) await api('GET', '/api/leave', { token: 'tok-a' });
    // tok-b heeft een eigen budget en mag gewoon door.
    const res = await api('GET', '/api/leave', { token: 'tok-b' });
    expect(res.status).toBe(200);
  });
});

describe('concurrency & IDOR (middel-fixes)', () => {
  it('weigert een tweede open ruil voor dezelfde dienst (409)', async () => {
    // sh-a heeft al een open ruil (s-1). Chauffeur 3 biedt sh-a nogmaals aan.
    const own = mem.swaps.filter((s) => s.requesterId === '3' || s.targetDriverId === '3');
    const dubbel = {
      id: 's-dup', shiftId: 'sh-a', requesterId: '3', targetDriverId: '4', status: 'pending',
      reason: '', createdAt: '2026-06-12T08:00:00Z', returnDate: '2026-07-09', returnCode: 'VRIJ',
    };
    const res = await api('POST', '/api/swaps', { token: 'tok-a', body: [...own, dubbel] });
    expect(res.status).toBe(409);
    expect(mem.swaps.find((s) => s.id === 's-dup')).toBeFalsy();
  });

  it('weigert een tweede goedkeuring voor dezelfde dienst (409, via PATCH)', async () => {
    mem.swaps = [
      { id: 'x1', shiftId: 'sh-z', requesterId: '3', targetDriverId: '4', status: 'accepted', reason: '', createdAt: '2026-06-01T08:00:00Z', returnDate: '2026-07-02', returnCode: 'VRIJ' },
      { id: 'x2', shiftId: 'sh-z', requesterId: '3', targetDriverId: '2', status: 'accepted', reason: '', createdAt: '2026-06-01T09:00:00Z', returnDate: '2026-07-03', returnCode: '12' },
    ];
    const eerste = await api('PATCH', '/api/swaps/x1', { token: 'tok-admin', body: { status: 'approved', ifStatus: 'accepted' } });
    expect(eerste.status).toBe(200);
    const tweede = await api('PATCH', '/api/swaps/x2', { token: 'tok-admin', body: { status: 'approved', ifStatus: 'accepted' } });
    expect(tweede.status).toBe(409);
    expect(mem.swaps.find((s) => s.id === 'x2')?.status).toBe('accepted');
  });

  it('push-unsubscribe verwijdert niet het abonnement van een ándere gebruiker (geen IDOR)', async () => {
    await api('POST', '/api/push/subscribe', { token: 'tok-a', body: { endpoint: 'https://push.example/owned-by-3', keys: { p256dh: 'pk', auth: 'au' } } });
    // Gebruiker 4 probeert het endpoint van gebruiker 3 af te melden → geen effect.
    const idor = await api('POST', '/api/push/unsubscribe', { token: 'tok-b', body: { endpoint: 'https://push.example/owned-by-3' } });
    expect(idor.status).toBe(200);
    expect(mem.pushSubscriptions.some((s) => s.endpoint === 'https://push.example/owned-by-3')).toBe(true);
    // De eigenaar zelf kan het wél afmelden.
    await api('POST', '/api/push/unsubscribe', { token: 'tok-a', body: { endpoint: 'https://push.example/owned-by-3' } });
    expect(mem.pushSubscriptions.some((s) => s.endpoint === 'https://push.example/owned-by-3')).toBe(false);
  });
});

describe('aanmeldingen (login-activiteit)', () => {
  it('logt een aanmelding bij sessie-start', async () => {
    const res = await api('POST', '/api/auth/session', { token: 'tok-a', body: { action: 'start' } });
    expect(res.status).toBe(200);
    const login = mem.activity.find((a) => a.action === 'Aangemeld');
    expect(login).toBeTruthy();
    expect(login.domain).toBe('auth');
  });

  it('GET /api/activity/logins: admin krijgt logins, planner 403', async () => {
    await api('POST', '/api/auth/session', { token: 'tok-a', body: { action: 'start' } });
    const planner = await api('GET', '/api/activity/logins', { token: 'tok-planner' });
    expect(planner.status).toBe(403);
    const admin = await api('GET', '/api/activity/logins', { token: 'tok-admin' });
    expect(admin.status).toBe(200);
    expect(admin.json.days).toBe(30);
    expect(Array.isArray(admin.json.logins)).toBe(true);
    expect(admin.json.logins.length).toBeGreaterThanOrEqual(1);
  });
});

describe('OCPI 2.2.1 — gehoste endpoints + handshake-auth', () => {
  const tok = (s: string) => 'Token ' + Buffer.from(s, 'utf8').toString('base64');

  it('versions vereist een geldig OCPI-token (anders 401)', async () => {
    expect((await api('GET', '/api/ocpi/versions')).status).toBe(401);
    expect((await api('GET', '/api/ocpi/versions', { headers: { Authorization: tok('fout') } })).status).toBe(401);
  });

  it('versions geeft het OCPI-envelope met 2.2.1 bij geldig Token A', async () => {
    const res = await api('GET', '/api/ocpi/versions', { headers: { Authorization: tok('test-token-a') } });
    expect(res.status).toBe(200);
    expect(res.json.status_code).toBe(1000);
    expect(res.json.data[0].version).toBe('2.2.1');
    expect(res.json.data[0].url).toContain('/api/ocpi/2.2.1');
  });

  it('version-details vermeldt de credentials-module', async () => {
    const res = await api('GET', '/api/ocpi/2.2.1', { headers: { Authorization: tok('test-token-a') } });
    expect(res.status).toBe(200);
    expect(res.json.data.endpoints.some((e: any) => e.identifier === 'credentials')).toBe(true);
  });

  it('register en status zijn admin-only', async () => {
    expect((await api('POST', '/api/ocpi/register', { token: 'tok-a' })).status).toBe(403);
    expect((await api('GET', '/api/ocpi/status', { token: 'tok-planner' })).status).toBe(403);
    const admin = await api('GET', '/api/ocpi/status', { token: 'tok-admin' });
    expect(admin.status).toBe(200);
    expect(admin.json).toHaveProperty('registered');
  });
});

describe('OCPI-client — paginatie (parseNextLink)', () => {
  it('haalt de next-URL uit de Link-header', async () => {
    const { parseNextLink } = await import('../api/ocpi');
    expect(parseNextLink('<https://kempower.io/api/ocpi/2.2.1/locations?offset=100&limit=100>; rel="next"'))
      .toBe('https://kempower.io/api/ocpi/2.2.1/locations?offset=100&limit=100');
  });
  it('geeft null als er geen next is', async () => {
    const { parseNextLink } = await import('../api/ocpi');
    expect(parseNextLink('<https://x/y?offset=0>; rel="prev"')).toBeNull();
    expect(parseNextLink(null)).toBeNull();
    expect(parseNextLink('')).toBeNull();
  });
  it('kiest de next-link uit meerdere', async () => {
    const { parseNextLink } = await import('../api/ocpi');
    expect(parseNextLink('<https://a>; rel="prev", <https://b>; rel="next"')).toBe('https://b');
  });
});

describe('OCPI-sync — autorisatie', () => {
  it('POST /api/ocpi/sync is admin-only', async () => {
    expect((await api('POST', '/api/ocpi/sync', { token: 'tok-a' })).status).toBe(403);
    expect((await api('POST', '/api/ocpi/sync', { token: 'tok-planner' })).status).toBe(403);
    const admin = await api('POST', '/api/ocpi/sync', { token: 'tok-admin' });
    expect(admin.status).toBe(200);
    expect(admin.json).toHaveProperty('errors');
  });
  it('cron-sync vereist het CRON_SECRET', async () => {
    expect((await api('GET', '/api/cron/ocpi-sync')).status).toBe(401);
    const ok = await api('GET', '/api/cron/ocpi-sync?parts=locations', { headers: { Authorization: 'Bearer test-cron-secret' } });
    expect(ok.status).toBe(200);
    expect(ok.json).toHaveProperty('errors');
  });
});

describe('OCPI-dashboard — autorisatie', () => {
  it('GET /api/ocpi/dashboard is admin-only', async () => {
    expect((await api('GET', '/api/ocpi/dashboard', { token: 'tok-planner' })).status).toBe(403);
    expect((await api('GET', '/api/ocpi/dashboard', { token: 'tok-a' })).status).toBe(403);
  });
});

describe('rostering-export (solver-brug)', () => {
  it('weigert zonder auth (401) en voor chauffeurs (403)', async () => {
    expect((await api('GET', '/api/rostering-export')).status).toBe(401);
    expect((await api('GET', '/api/rostering-export', { token: 'tok-a' })).status).toBe(403);
  });

  it('geeft de planner solver-input: actieve chauffeurs, diensten, goedgekeurd verlof en shifts in het venster', async () => {
    const res = await api('GET', '/api/rostering-export?from=2026-07-01&to=2026-12-31', { token: 'tok-planner' });
    expect(res.status).toBe(200);
    expect(res.json.range).toEqual({ from: '2026-07-01', to: '2026-12-31' });
    // Alleen chauffeurs (3 en 4), niet admin/planner.
    expect(res.json.drivers.map((d: any) => d.id).sort()).toEqual(['3', '4']);
    expect(res.json.services).toHaveLength(6);
    // Alleen goedgekeurd verlof binnen het venster (l-a2), geen pending.
    expect(res.json.approvedLeave).toHaveLength(1);
    expect(res.json.approvedLeave[0]).toMatchObject({ userId: '3', startDate: '2026-08-10' });
    expect(res.json.shifts).toHaveLength(3);
  });

  it('is ook bereikbaar met het cron-secret (headless solver)', async () => {
    const res = await api('GET', '/api/rostering-export?from=2026-07-01&to=2026-07-31', { headers: { Authorization: 'Bearer test-cron-secret' } });
    expect(res.status).toBe(200);
    expect(res.json.shifts).toHaveLength(3);
  });
});

describe('documenten per gebruiker', () => {
  it('een chauffeur ziet alleen zijn eigen documenten, ook met een vreemde userId in de query', async () => {
    mem.documents = [
      { id: 'd1', userId: '3', filename: 'attest.pdf', storagePath: '3/x', uploadedAt: '2026-07-01T00:00:00Z' },
      { id: 'd2', userId: '4', filename: 'loonbrief.pdf', storagePath: '4/y', uploadedAt: '2026-07-01T00:00:00Z' },
    ];
    const res = await api('GET', '/api/documents?userId=4', { token: 'tok-a' }); // tok-a = user 3
    expect(res.status).toBe(200);
    expect(res.json.map((d: any) => d.id)).toEqual(['d1']);
  });

  it('alleen een admin kan de documenten van een andere gebruiker opvragen — een planner krijgt de eigen lijst', async () => {
    mem.documents = [
      { id: 'd2', userId: '4', filename: 'loonbrief.pdf', storagePath: '4/y', uploadedAt: '2026-07-01T00:00:00Z' },
      { id: 'd-p', userId: '2', filename: 'eigen.pdf', storagePath: '2/z', uploadedAt: '2026-07-01T00:00:00Z' },
    ];
    // Admin (user 1) mag een andere gebruiker uitlezen.
    const adminRes = await api('GET', '/api/documents?userId=4', { token: 'tok-admin' });
    expect(adminRes.status).toBe(200);
    expect(adminRes.json.map((d: any) => d.id)).toEqual(['d2']);
    // Planner (user 2) is géén staff meer voor documenten: ?userId=4 wordt
    // genegeerd, hij krijgt enkel zijn eigen documenten (gevoelige PII).
    const plannerRes = await api('GET', '/api/documents?userId=4', { token: 'tok-planner' });
    expect(plannerRes.status).toBe(200);
    expect(plannerRes.json.map((d: any) => d.id)).toEqual(['d-p']);
  });

  it('uploaden/broadcasten is niet meer toegankelijk voor een planner (403, admin-only)', async () => {
    expect((await api('POST', '/api/documents', { token: 'tok-planner', body: { userId: '3', filename: 'x.pdf', dataUrl: 'data:application/pdf;base64,QQ==' } })).status).toBe(403);
    expect((await api('POST', '/api/documents/broadcast', { token: 'tok-planner', body: { filename: 'r.pdf', dataUrl: 'data:application/pdf;base64,QQ==' } })).status).toBe(403);
  });

  it('uploaden en verwijderen zijn niet toegankelijk voor chauffeurs (403)', async () => {
    expect((await api('POST', '/api/documents', { token: 'tok-a', body: { userId: '3', filename: 'x.pdf', dataUrl: 'data:application/pdf;base64,QQ==' } })).status).toBe(403);
    expect((await api('DELETE', '/api/documents/d1', { token: 'tok-a' })).status).toBe(403);
  });

  it('document rondsturen naar alle chauffeurs is niet toegankelijk voor chauffeurs (403)', async () => {
    const res = await api('POST', '/api/documents/broadcast', { token: 'tok-a', body: { filename: 'reglement.pdf', dataUrl: 'data:application/pdf;base64,QQ==' } });
    expect(res.status).toBe(403);
  });
});

describe('toestel-whitelist', () => {
  it('blokkeert een chauffeur zonder toestel-header (403 device_unknown)', async () => {
    const res = await api('GET', '/api/updates', { token: 'tok-a', device: null });
    expect(res.status).toBe(403);
    expect(res.json?.code).toBe('device_unknown');
  });

  it('blokkeert een chauffeur met een onbekend toestel-token (403 device_unknown)', async () => {
    const res = await api('GET', '/api/updates', { token: 'tok-a', device: 'dev-vreemd' });
    expect(res.status).toBe(403);
    expect(res.json?.code).toBe('device_unknown');
  });

  it('blokkeert een pending en een geblokkeerd toestel met de juiste code', async () => {
    mem.devices.push(
      { userId: '3', deviceToken: 'dev-pending', name: 'x', status: 'pending', createdAt: '', lastSeenAt: '', approvedAt: null, approvedBy: null },
      { userId: '3', deviceToken: 'dev-revoked', name: 'x', status: 'revoked', createdAt: '', lastSeenAt: '', approvedAt: null, approvedBy: null },
    );
    const pending = await api('GET', '/api/updates', { token: 'tok-a', device: 'dev-pending' });
    expect(pending.status).toBe(403);
    expect(pending.json?.code).toBe('device_pending');
    const revoked = await api('GET', '/api/updates', { token: 'tok-a', device: 'dev-revoked' });
    expect(revoked.status).toBe(403);
    expect(revoked.json?.code).toBe('device_revoked');
  });

  it('raakt planner en admin niet — ook zonder toestel-header', async () => {
    expect((await api('GET', '/api/updates', { token: 'tok-admin', device: null })).status).toBe(200);
    expect((await api('GET', '/api/updates', { token: 'tok-planner', device: null })).status).toBe(200);
  });

  it('eerste toestel van een chauffeur wordt automatisch goedgekeurd, het tweede wacht (+ push naar admin)', async () => {
    mem.devices = []; // schone lei: chauffeur zonder toestellen
    const eerste = await api('POST', '/api/devices/register', { token: 'tok-a', device: 'dev-1', body: { name: 'iPhone · app' } });
    expect(eerste.status).toBe(200);
    expect(eerste.json?.status).toBe('approved');

    const tweede = await api('POST', '/api/devices/register', { token: 'tok-a', device: 'dev-2', body: { name: 'Tweede toestel' } });
    expect(tweede.status).toBe(200);
    expect(tweede.json?.status).toBe('pending');
    // Admin (id '1') krijgt een push over het wachtende toestel.
    expect(mem.pushesSent.some((p) => p.userIds.includes('1') && /goedkeuring/i.test(p.payload?.title ?? ''))).toBe(true);
  });

  it('de register-route blijft bereikbaar vanaf een pending toestel (exempt in de gate)', async () => {
    mem.devices = [
      { userId: '3', deviceToken: 'dev-p', name: 'x', status: 'pending', createdAt: '', lastSeenAt: '', approvedAt: null, approvedBy: null },
    ];
    const res = await api('POST', '/api/devices/register', { token: 'tok-a', device: 'dev-p', body: { name: 'x' } });
    expect(res.status).toBe(200);
    expect(res.json?.status).toBe('pending'); // her-registratie promoveert NIET
  });

  it('na goedkeuring door de admin werkt het toestel', async () => {
    mem.devices.push({ userId: '3', deviceToken: 'dev-nieuw', name: 'x', status: 'pending', createdAt: '', lastSeenAt: '', approvedAt: null, approvedBy: null });
    expect((await api('GET', '/api/updates', { token: 'tok-a', device: 'dev-nieuw' })).status).toBe(403);
    const approve = await api('POST', '/api/devices/approve', { token: 'tok-admin', body: { userId: '3', deviceToken: 'dev-nieuw' } });
    expect(approve.status).toBe(200);
    expect((await api('GET', '/api/updates', { token: 'tok-a', device: 'dev-nieuw' })).status).toBe(200);
  });

  it('toestellenlijst en beheer-acties zijn admin-only', async () => {
    expect((await api('GET', '/api/devices', { token: 'tok-planner' })).status).toBe(403);
    expect((await api('GET', '/api/devices', { token: 'tok-a' })).status).toBe(403);
    expect((await api('GET', '/api/devices', { token: 'tok-admin' })).status).toBe(200);
  });

  it('een overlang toestel-token wordt behandeld als onbekend toestel (403, geen 500/fail-open)', async () => {
    const res = await api('GET', '/api/updates', { token: 'tok-a', device: 'x'.repeat(500) });
    expect(res.status).toBe(403);
    expect(res.json?.code).toBe('device_unknown');
  });

  it('fail-CLOSED bij een echte DB-fout in de gate (503)', async () => {
    const res = await api('GET', '/api/updates', { token: 'tok-a', device: 'dev-dberror' });
    expect(res.status).toBe(503);
    expect(res.json?.code).toBe('device_check_failed');
  });

  it('fail-OPEN alleen wanneer de user_devices-tabel ontbreekt (migratie niet gedraaid)', async () => {
    const res = await api('GET', '/api/updates', { token: 'tok-a', device: 'dev-missingtable' });
    expect(res.status).toBe(200);
  });

  it('het laatste toestel van een gebruiker kan niet geschrapt worden (heropent auto-approve)', async () => {
    mem.devices = [
      { userId: '3', deviceToken: 'dev-enige', name: 'x', status: 'approved', createdAt: '', lastSeenAt: '', approvedAt: '', approvedBy: 'auto' },
    ];
    const res = await api('POST', '/api/devices/delete', { token: 'tok-admin', body: { userId: '3', deviceToken: 'dev-enige' } });
    expect(res.status).toBe(400);
    expect(res.json?.code).toBe('last_device');
    // Met een tweede toestel erbij mag schrappen wél.
    mem.devices.push({ userId: '3', deviceToken: 'dev-tweede', name: 'y', status: 'pending', createdAt: '', lastSeenAt: '', approvedAt: null, approvedBy: null });
    expect((await api('POST', '/api/devices/delete', { token: 'tok-admin', body: { userId: '3', deviceToken: 'dev-tweede' } })).status).toBe(200);
  });

  it('een toestelnaam met regeleinden wordt gesaniteerd (anti-injectie in de admin-push)', async () => {
    mem.devices = [];
    await api('POST', '/api/devices/register', { token: 'tok-a', device: 'dev-naam', body: { name: 'iPhone\n\nGoedkeuren aub!!!' } });
    const stored = mem.devices.find((d: any) => d.deviceToken === 'dev-naam');
    expect(stored?.name).toBe('iPhone Goedkeuren aub!!!');
    expect(stored?.name).not.toContain('\n');
  });

  it('de admin kan het toestel waarop die nu werkt niet blokkeren of schrappen (lockout-guard)', async () => {
    mem.devices.push({ userId: '1', deviceToken: 'dev-admin', name: 'Mac', status: 'approved', createdAt: '', lastSeenAt: '', approvedAt: '', approvedBy: 'auto' });
    const revoke = await api('POST', '/api/devices/revoke', { token: 'tok-admin', device: 'dev-admin', body: { userId: '1', deviceToken: 'dev-admin' } });
    expect(revoke.status).toBe(400);
    const del = await api('POST', '/api/devices/delete', { token: 'tok-admin', device: 'dev-admin', body: { userId: '1', deviceToken: 'dev-admin' } });
    expect(del.status).toBe(400);
    // Een ánder toestel blokkeren mag wel.
    mem.devices.push({ userId: '3', deviceToken: 'dev-x', name: 'x', status: 'approved', createdAt: '', lastSeenAt: '', approvedAt: '', approvedBy: 'auto' });
    expect((await api('POST', '/api/devices/revoke', { token: 'tok-admin', device: 'dev-admin', body: { userId: '3', deviceToken: 'dev-x' } })).status).toBe(200);
  });
});
