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
  // Ruwe planning-matrix (chauffeur × datum met codes) — bron voor de
  // 'vrij/bv/tk/ta'-check bij een ruil zonder tegenprestatie.
  planningMatrix: [] as any[],
  planningCodes: [] as any[],
  coverageExpectations: {} as Record<string, unknown>,
  activity: [] as any[],
  // Retourwaarde van getLatestAuthEventAt — stuurt de per-dag-dedup van het
  // 'Actief'-event bij action:'resume'.
  lastAuthEventAt: null as string | null,
  clientErrors: [] as any[],
  emailsSent: [] as Array<{ to: string[]; subject: string; context?: string; text?: string }>,
  storedBackups: [] as Array<{ filename: string; size: number }>,
  pushSubscriptions: [] as any[],
  pushesSent: [] as Array<{ userIds: string[]; payload: any }>,
  documents: [] as any[],
  ritblaadje: null as any,
  devices: [] as any[],
  planningNotes: [] as any[],
  userExpiries: [] as any[],
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
          // Simulatie-tokens voor de 401-vs-503-scheiding in de middleware.
          if (token === 'tok-storing') return { data: { user: null }, error: { message: 'fetch failed', status: 0 } };
          if (token === 'tok-auth-500') return { data: { user: null }, error: { message: 'internal', status: 500 } };
          const email = tokenToEmail[token];
          return email
            ? { data: { user: { id: `auth-${token}`, email } }, error: null }
            : { data: { user: null }, error: { message: 'Ongeldige sessie', status: 401 } };
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
  getUsersMetPush: async () => [...new Set(mem.pushSubscriptions.map((s: any) => String(s.userId)))],
}));

vi.mock('../api/email.js', async (importOriginal) => ({
  ...(await importOriginal<any>()),
  sendLeaveDecisionEmail: vi.fn(async () => ({ ok: true, mocked: true })),
  sendEmail: vi.fn(async (opts: any) => {
    mem.emailsSent.push({ to: opts.to, subject: opts.subject, context: opts.context, text: opts.text });
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
    getPlanningNotes: async (o: any) => mem.planningNotes.filter((n: any) => (!o.driverId || n.driverId === o.driverId) && n.date >= o.fromIso && n.date <= o.toIso),
    upsertPlanningNote: async (driverId: string, date: string, note: string) => { mem.planningNotes = mem.planningNotes.filter((n: any) => !(n.driverId === driverId && n.date === date)); mem.planningNotes.push({ driverId, date, note }); },
    getUserExpiries: async () => mem.userExpiries,
    saveUserExpiry: async (rec: any) => {
      mem.userExpiries = mem.userExpiries.filter((e: any) => !(e.userId === rec.userId && e.soort === rec.soort));
      mem.userExpiries.push({ ...rec, updatedAt: null });
    },
    deleteUserExpiry: async (userId: string, soort: string) => {
      mem.userExpiries = mem.userExpiries.filter((e: any) => !(e.userId === userId && e.soort === soort));
    },
    deletePlanningNote: async (driverId: string, date: string) => { mem.planningNotes = mem.planningNotes.filter((n: any) => !(n.driverId === driverId && n.date === date)); },
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
    markSwapTargetSeen: async (id: string, seenAtIso: string) => {
      const sw = mem.swaps.find((s: any) => String(s.id) === String(id));
      if (sw) sw.targetSeenAt = seenAtIso;
    },
    getShiftById: async (id: string) =>
      mem.planning.find((s: any) => String(s.id) === String(id)) ?? null,
    getShiftsOnDate: async (date: string) =>
      mem.planning.filter((s: any) => String(s.date) === String(date)),
    // Planning-doorvoer: zelfde semantiek als de echte DB-functies, maar op
    // mem.planning — zodat de integratietests het effect van approve/cancel
    // op de planning kunnen asserten.
    applySwapToPlanning: async (swap: any) => {
      if (!swap.shiftDate || !swap.shiftLine || !swap.targetDriverId) return null;
      const move = (date: string, line: string, from: string, to: string) => {
        let n = 0;
        for (const row of mem.planning) {
          if (row.date === date && String(row.line) === String(line) && String(row.driverId) === String(from)) { row.driverId = String(to); n++; }
        }
        return n;
      };
      const offeredMoved = move(swap.shiftDate, swap.shiftLine, swap.requesterId, swap.targetDriverId);
      const hasReturn = swap.swapType !== 'overname' && swap.returnDate && swap.returnCode && String(swap.returnCode).toLowerCase() !== 'vrij';
      const returnMoved = hasReturn ? move(swap.returnDate, swap.returnCode, swap.targetDriverId, swap.requesterId) : null;
      return { offeredMoved, returnMoved };
    },
    revertSwapFromPlanning: async (swap: any) => {
      if (!swap.shiftDate || !swap.shiftLine || !swap.targetDriverId) return null;
      const move = (date: string, line: string, from: string, to: string) => {
        let n = 0;
        for (const row of mem.planning) {
          if (row.date === date && String(row.line) === String(line) && String(row.driverId) === String(from)) { row.driverId = String(to); n++; }
        }
        return n;
      };
      const offeredMoved = move(swap.shiftDate, swap.shiftLine, swap.targetDriverId, swap.requesterId);
      const hasReturn = swap.swapType !== 'overname' && swap.returnDate && swap.returnCode && String(swap.returnCode).toLowerCase() !== 'vrij';
      const returnMoved = hasReturn ? move(swap.returnDate, swap.returnCode, swap.requesterId, swap.targetDriverId) : null;
      return { offeredMoved, returnMoved };
    },
    getPlanningData: async (f?: { driverId?: string; monthIso?: string }) =>
      mem.planning.filter((s: any) =>
        (!f?.driverId || String(s.driverId) === String(f.driverId)) &&
        (!f?.monthIso || String(s.date ?? '').startsWith(`${f.monthIso}-`))),
    getServicesData: async () => mem.services,
    saveServicesData: async (data: any[]) => { mem.services = data; },
    getUpdatesData: async () => mem.updates,
    saveUpdatesData: async (data: any[]) => { mem.updates = data; },
    getDiversionsData: async () => mem.diversions,
    saveDiversionsData: async (data: any[]) => { mem.diversions = data; },
    getPlanningCodesData: async () => mem.planningCodes,
    savePlanningCodesData: async (data: any[]) => { mem.planningCodes = data; },
    logActivity: async (_req: any, domain: string, action: string, message: string, entity?: { type?: string; id?: string }) => {
      mem.activity.push({ domain, action, message, entityType: entity?.type, entityId: entity?.id });
    },
    getActivityLog: async (opts?: { sinceIso?: string | null; max?: number }) => {
    // Mock respecteert de opts — anders kan de #249-regressie ("UI beloofde
    // 30 dagen, server gaf 100") ongemerkt terugkomen terwijl alles groen blijft.
    let rows = mem.activity;
    if (opts?.sinceIso) rows = rows.filter((a) => a.createdAt >= opts.sinceIso!);
    if (opts?.max !== undefined) rows = rows.slice(0, opts.max);
    return rows;
  },
    getLoginActivity: async () => mem.activity.filter((a: any) => a.action === 'Aangemeld' || a.action === 'Actief'),
    getLatestAuthEventAt: async () => mem.lastAuthEventAt,
    updateUserSessionMeta: async () => {},
    bumpActiveSessions: async () => {},
    getPlanningMatrixRows: async () => mem.planningMatrix,
    // Mini-versie van de matrix-heropbouw op mem: dienstcode matcht op
    // services, al de rest telt als afwezigheid. De route-logica (guards,
    // ruil-replay, save) draait onveranderd — alleen de generatie is mem.
    buildPlanningFromMatrix: async (inputRows?: any[]) => {
      const rows = inputRows ?? mem.planningMatrix;
      const byName: Record<string, string> = { 'chauffeur a': '3', 'chauffeur b': '4' };
      const shifts: any[] = [];
      for (const row of rows) {
        for (const [name, code] of Object.entries(row.assignments ?? {})) {
          const driverId = byName[String(name).toLowerCase()];
          const svc = mem.services.find((sv: any) => String(sv.serviceNumber) === String(code));
          if (!driverId || !svc) continue;
          shifts.push({
            id: `${row.source_date}-${driverId}-${svc.serviceNumber}-1`,
            date: row.source_date, startTime: svc.startTime, endTime: svc.endTime,
            line: String(svc.serviceNumber), busNumber: '', loopnr: '', driverId,
          });
        }
      }
      return {
        shifts,
        summary: {
          importedDays: rows.length, generatedShifts: shifts.length, matchedServices: shifts.length,
          skippedAbsences: 0, unknownCodes: [], unmatchedDrivers: [], servicesWithoutSegments: [], perDriver: [],
        },
      };
    },
    replacePlanningData: async (shifts: any[]) => { mem.planning = shifts; },
    replacePlanningAndMatrix: async (rows: any[], shifts: any[]) => { mem.planningMatrix = rows; mem.planning = shifts; },
    savePlanningMatrixHistoryEntry: async () => {},
    saveMatrixRowAssignments: async (rowId: string, assignments: Record<string, string>) => {
      mem.planningMatrix = mem.planningMatrix.map((r: any) => (String(r.id) === String(rowId) ? { ...r, assignments } : r));
    },
    insertPlanningRows: async (rows: any[]) => { mem.planning = [...mem.planning, ...rows]; },
    getServiceSegments: (service: any) => {
      const segs = [];
      if (service.startTime && service.endTime) segs.push({ startTime: service.startTime, endTime: service.endTime, segment: 1, loopnr: String(service.loopnr ?? '') });
      return segs;
    },
    getCoverageExpectations: async () => mem.coverageExpectations ?? {},
    saveCoverageExpectations: async (map: any) => { mem.coverageExpectations = map; },
    listUserDocuments: async (userId?: string) =>
      userId ? mem.documents.filter((d: any) => String(d.userId) === String(userId)) : mem.documents,
    getUserDocument: async (id: string) => mem.documents.find((d: any) => String(d.id) === String(id)) ?? null,
    insertUserDocument: async (doc: any) => { const rec = { id: `doc-${mem.documents.length + 1}`, uploadedAt: '2026-07-01T00:00:00Z', ...doc }; mem.documents.push(rec); return rec; },
    deleteUserDocument: async (id: string) => { mem.documents = mem.documents.filter((d: any) => String(d.id) !== String(id)); },
    markUserDocumentOpened: async (id: string, userId: string) => {
      const doc = mem.documents.find((d: any) => String(d.id) === String(id) && String(d.userId) === String(userId));
      if (doc && !doc.openedAt) doc.openedAt = '2026-07-30T12:00:00Z';
    },
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
    { id: 'sh-a', driverId: '3', date: '2026-07-01', line: '12' },
    { id: 'sh-b', driverId: '4', date: '2026-07-02', line: '14' },
    { id: 'sh-c', driverId: '3', date: '2026-07-08', line: '12' }, // vrije dienst van chauffeur 3 (geen open ruil)
  ];
  // 2026-07-08: chauffeur 3 rijdt dienst 12, chauffeur 4 staat op bv → een
  // overname (ruil zonder tegenprestatie) naar chauffeur 4 mag die dag.
  mem.planningMatrix = [
    { id: 'm-1', source_date: '2026-07-08', day_type: 'week', assignments: { 'Chauffeur A': '12', 'Chauffeur B': 'bv' }, raw_row: '' },
    { id: 'm-2', source_date: '2026-07-01', day_type: 'week', assignments: { 'Chauffeur A': '12', 'Chauffeur B': '14' }, raw_row: '' },
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
  mem.coverageExpectations = {};
  mem.activity = [];
  mem.lastAuthEventAt = null;
  mem.clientErrors = [];
  mem.emailsSent = [];
  mem.storedBackups = [];
  mem.pushSubscriptions = [];
  mem.pushesSent = [];
  mem.documents = [];
  mem.ritblaadje = null;
  // Beide chauffeurs hebben één goedgekeurd toestel ('dev-ok' — de default
  // van de api()-helper), zodat de whitelist-gate bestaande tests niet raakt.
  mem.planningNotes = [];
  mem.userExpiries = [];
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
    // Diensten in de ziekteperiode: één gesplitste dienst op 02/09 (twee
    // planning-rijen, zelfde nummer) en een gewone op 03/09 — de mail hoort
    // ze per dag gededupliceerd op te sommen.
    mem.planning.push(
      { id: 'zk-1', driverId: '4', date: '2026-09-02', line: '4407' },
      { id: 'zk-2', driverId: '4', date: '2026-09-02', line: '4407' },
      { id: 'zk-3', driverId: '4', date: '2026-09-03', line: '4408' },
      { id: 'zk-4', driverId: '3', date: '2026-09-02', line: '4409' }, // collega — hoort er níét in
    );
    const res = await api('POST', '/api/leave/sick-report', { token: 'tok-planner', body: { userId: '4', startDate: '2026-09-02', endDate: '2026-09-03' } });
    expect(res.status).toBe(200);
    expect(res.json.leave).toMatchObject({ userId: '4', type: 'ziekte', status: 'approved', startDate: '2026-09-02', endDate: '2026-09-03' });
    const stored = mem.leave.find((l: any) => l.type === 'ziekte');
    expect(stored?.status).toBe('approved');
    // Push naar de rest van de planning (behalve de melder = planner, id 2)…
    const sickPush = mem.pushesSent.find((p) => p.payload.title === 'Ziekmelding');
    expect(sickPush?.userIds).toEqual(['1']);
    // …maar de mail gaat naar álle planner/admin-adressen, de melder incluis
    // (verzoek Jarno 04-08) — en PER PERSOON een eigen mail, rechtstreeks in
    // de To-regel. De eerdere BCC-batch werd door Microsoft 365 stilletjes
    // weggefilterd terwijl de directe testmail wél aankwam (04-08).
    const sickMails = mem.emailsSent.filter((m) => (m.context ?? '').startsWith('sick:'));
    expect(sickMails.map((m) => m.to).sort()).toEqual([['admin@vhb.be'], ['planner@vhb.be']]);
    // De opengevallen diensten staan in de mail: per dag het nummer, de
    // gesplitste dienst één keer, de dienst van de collega niet.
    const body = sickMails[0]?.text ?? '';
    expect(body).toContain('Openstaande dienst(en):');
    expect(body).toMatch(/wo 2 sep.* — 4407/);
    expect(body).toMatch(/do 3 sep.* — 4408/);
    expect(body).not.toContain('4407 / 4407');
    expect(body).not.toContain('4409');
  });

  it('ziekmelding zonder diensten in de periode zegt dat expliciet in de mail', async () => {
    const res = await api('POST', '/api/leave/sick-report', { token: 'tok-planner', body: { userId: '4', startDate: '2026-10-05' } });
    expect(res.status).toBe(200);
    const mail = mem.emailsSent.find((m) => (m.context ?? '').startsWith('sick:'));
    expect(mail?.text).toContain('Geen ingeplande diensten in deze periode.');
  });

  it('ziekmelding zonder chauffeur wordt geweigerd (400)', async () => {
    const res = await api('POST', '/api/leave/sick-report', { token: 'tok-planner', body: { startDate: '2026-09-02' } });
    expect(res.status).toBe(400);
  });

  it('ziekmelding over drie maanden somt ook de middelste maand op in de mail', async () => {
    mem.planning.push(
      { id: 'mnd-1', driverId: '4', date: '2026-09-25', line: '4401' },
      { id: 'mnd-2', driverId: '4', date: '2026-10-10', line: '4402' }, // middelste maand
      { id: 'mnd-3', driverId: '4', date: '2026-11-03', line: '4403' },
    );
    const res = await api('POST', '/api/leave/sick-report', { token: 'tok-planner', body: { userId: '4', startDate: '2026-09-20', endDate: '2026-11-05' } });
    expect(res.status).toBe(200);
    const body = mem.emailsSent.find((m) => (m.context ?? '').startsWith('sick:'))?.text ?? '';
    expect(body).toContain('4401');
    expect(body).toContain('4402');
    expect(body).toContain('4403');
  });

  it('ziekmelding weigert onbestaande kalenderdatums en absurde periodes', async () => {
    const kapot = await api('POST', '/api/leave/sick-report', { token: 'tok-planner', body: { userId: '4', startDate: '2026-02-31' } });
    expect(kapot.status).toBe(400);
    const eeuwig = await api('POST', '/api/leave/sick-report', { token: 'tok-planner', body: { userId: '4', startDate: '2026-09-01', endDate: '9999-12-31' } });
    expect(eeuwig.status).toBe(400);
    expect(mem.leave.some((l: any) => l.type === 'ziekte')).toBe(false);
  });

  it('ziekmelding weigert een tweede melding over een overlappende periode (409)', async () => {
    const eerste = await api('POST', '/api/leave/sick-report', { token: 'tok-planner', body: { userId: '4', startDate: '2026-09-02', endDate: '2026-09-05' } });
    expect(eerste.status).toBe(200);
    const tweede = await api('POST', '/api/leave/sick-report', { token: 'tok-planner', body: { userId: '4', startDate: '2026-09-04', endDate: '2026-09-08' } });
    expect(tweede.status).toBe(409);
    expect(mem.leave.filter((l: any) => l.type === 'ziekte').length).toBe(1);
  });

  it('ziekmelding kan alleen voor een actieve chauffeur (niet voor een admin)', async () => {
    const res = await api('POST', '/api/leave/sick-report', { token: 'tok-planner', body: { userId: '1', startDate: '2026-09-02' } });
    expect(res.status).toBe(400);
    expect(mem.leave.some((l: any) => l.type === 'ziekte')).toBe(false);
  });

  it('ziekmelding herschrijft niet de hele verloftabel (raakt bestaande rijen niet aan)', async () => {
    // Simuleer de race: een collega-beslissing die ná onze snapshot zou
    // vallen. Omdat sick-report alleen zijn eigen record schrijft, blijft
    // elke andere rij exact zoals hij was.
    const voor = JSON.stringify(mem.leave);
    const res = await api('POST', '/api/leave/sick-report', { token: 'tok-planner', body: { userId: '4', startDate: '2026-09-02' } });
    expect(res.status).toBe(200);
    const na = mem.leave.filter((l: any) => l.type !== 'ziekte');
    expect(JSON.stringify(na)).toBe(voor);
  });

  it('een dienst doorgeven aan een ziek gemelde collega wordt geweigerd (409)', async () => {
    // Chauffeur B ('4') staat in de matrix op bv voor 2026-07-08 (overname
    // normaal toegestaan), maar is intussen via de verlofmodule ziek gemeld.
    mem.leave.push({ id: 'l-zkr', userId: '4', startDate: '2026-07-08', endDate: '2026-07-08', type: 'ziekte', status: 'approved', comment: '', createdAt: '2026-07-07T06:00:00Z', decidedAt: '2026-07-07T06:00:00Z' });
    const eigen = mem.swaps.filter((sw: any) => sw.requesterId === '3' || sw.targetDriverId === '3');
    const nieuw = { id: 's-ziek', shiftId: 'sh-c', requesterId: '3', targetDriverId: '4', status: 'pending', reason: '', createdAt: '2026-07-01T08:00:00Z', swapType: 'overname' };
    const res = await api('POST', '/api/swaps', { token: 'tok-a', body: [...eigen, nieuw] });
    expect(res.status).toBe(409);
    expect(String(res.json.error)).toContain('ziek');
    expect(mem.swaps.find((sw: any) => sw.id === 's-ziek')).toBeUndefined();
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
    // ifStatus is sinds de verbeterronde verplicht; de state-machine-check
    // (afgehandeld = eindstation) vuurt daarná alsnog.
    const res = await api('PATCH', '/api/swaps/s-r', { token: 'tok-admin', body: { status: 'approved', ifStatus: 'rejected' } });
    expect(res.status).toBe(409);
    expect(mem.swaps.find((s) => s.id === 's-r')?.status).toBe('rejected');
  });
});

describe('dienstruil zonder tegenprestatie (overname)', () => {
  // Chauffeur 3 biedt sh-c aan (2026-07-08); chauffeur 4 staat die dag op 'bv'.
  const overname = (extra: Record<string, unknown> = {}) => ({
    id: 's-over', shiftId: 'sh-c', requesterId: '3', targetDriverId: '4', status: 'pending',
    reason: '', createdAt: '2026-06-12T08:00:00Z', swapType: 'overname', ...extra,
  });
  const eigenPayload = (nieuw: unknown) => [
    ...mem.swaps.filter((s) => s.requesterId === '3' || s.targetDriverId === '3'),
    nieuw,
  ];

  it('staat een overname toe als de collega die dag op bv staat', async () => {
    const res = await api('POST', '/api/swaps', { token: 'tok-a', body: eigenPayload(overname()) });
    expect(res.status).toBe(200);
    const opgeslagen = mem.swaps.find((s) => s.id === 's-over');
    expect(opgeslagen?.swapType).toBe('overname');
    // Geen tegenprestatie: return-velden blijven leeg.
    expect(opgeslagen?.returnDate ?? null).toBeNull();
    expect(opgeslagen?.returnCode ?? null).toBeNull();
  });

  it('weigert een overname als de collega die dag een dienst rijdt (409)', async () => {
    // sh-a valt op 2026-07-01; chauffeur 4 staat dan in de matrix op dienst 14.
    mem.swaps = [];
    const res = await api('POST', '/api/swaps', { token: 'tok-a', body: [overname({ shiftId: 'sh-a' })] });
    expect(res.status).toBe(409);
    expect(mem.swaps).toHaveLength(0);
  });

  it('weigert een overname als de collega ziek is (409)', async () => {
    mem.planningMatrix = [
      { id: 'm-1', source_date: '2026-07-08', day_type: 'week', assignments: { 'Chauffeur A': '12', 'Chauffeur B': 'ziek' }, raw_row: '' },
    ];
    const res = await api('POST', '/api/swaps', { token: 'tok-a', body: eigenPayload(overname()) });
    expect(res.status).toBe(409);
    expect(mem.swaps.find((s) => s.id === 's-over')).toBeUndefined();
  });

  it('weigert een overname als er voor die dag niets in de planning-matrix staat (409)', async () => {
    mem.planningMatrix = [];
    const res = await api('POST', '/api/swaps', { token: 'tok-a', body: eigenPayload(overname()) });
    expect(res.status).toBe(409);
  });

  it('weigert een overname als de collega tóch een dienst in de planning heeft (409)', async () => {
    // Matrix zegt 'bv', maar er staat een handmatig toegevoegde dienst.
    mem.planning = [...mem.planning, { id: 'sh-extra', driverId: '4', date: '2026-07-08', code: '15' }];
    const res = await api('POST', '/api/swaps', { token: 'tok-a', body: eigenPayload(overname()) });
    expect(res.status).toBe(409);
  });

  it('geldt ook voor een planner — niet enkel voor chauffeurs (409)', async () => {
    mem.planningMatrix = [];
    mem.swaps = [];
    const res = await api('POST', '/api/swaps', { token: 'tok-planner', body: [overname()] });
    expect(res.status).toBe(409);
  });

  it('vraagt bij een gewone ruil nog steeds een tegenprestatie (400)', async () => {
    const res = await api('POST', '/api/swaps', {
      token: 'tok-a',
      body: eigenPayload(overname({ id: 's-zonder', swapType: 'ruil' })),
    });
    expect(res.status).toBe(400);
  });

  it('behoudt het type als de collega accepteert, ook zonder swapType in de payload', async () => {
    mem.swaps = [{
      id: 's-over', shiftId: 'sh-c', requesterId: '3', targetDriverId: '4', status: 'pending',
      reason: '', createdAt: '2026-06-12T08:00:00Z', swapType: 'overname',
    }];
    const { swapType: _weg, ...zonderType } = mem.swaps[0] as any;
    const res = await api('POST', '/api/swaps', { token: 'tok-b', body: [{ ...zonderType, status: 'accepted' }] });
    expect(res.status).toBe(200);
    expect(mem.swaps.find((s) => s.id === 's-over')?.status).toBe('accepted');
    expect(mem.swaps.find((s) => s.id === 's-over')?.swapType).toBe('overname');
  });

  it('geeft via /api/availability?takeover=1 wie er die dag mag overnemen', async () => {
    const res = await api('GET', '/api/availability?from=2026-07-08&to=2026-07-08&takeover=1', { token: 'tok-a' });
    expect(res.status).toBe(200);
    expect(res.json.days[0].takeover).toEqual({ '4': 'bv' });
  });

  it('laat de takeover-lijst weg zonder de expliciete vlag', async () => {
    const res = await api('GET', '/api/availability?from=2026-07-08&to=2026-07-08', { token: 'tok-a' });
    expect(res.status).toBe(200);
    expect(res.json.days[0].takeover).toBeUndefined();
  });
});

describe('planning-doorvoer van goedgekeurde ruilen', () => {
  // s-1 (bestaand record) mét dienst-info, alsof de backfill-migratie liep:
  // sh-a = dienst 12 op 2026-07-01 van chauffeur 3, tegenprestatie = vrij.
  const seedShiftInfo = () => {
    mem.swaps = mem.swaps.map((s) => (s.id === 's-1' ? { ...s, shiftDate: '2026-07-01', shiftLine: '12' } : s));
  };

  it('verhuist de dienst naar de collega bij goedkeuring (vrije-dag-tegenprestatie)', async () => {
    seedShiftInfo();
    const accept = await api('PATCH', '/api/swaps/s-1', { token: 'tok-b', body: { status: 'accepted', ifStatus: 'pending' } });
    expect(accept.status).toBe(200);
    const approve = await api('PATCH', '/api/swaps/s-1', { token: 'tok-planner', body: { status: 'approved', ifStatus: 'accepted' } });
    expect(approve.status).toBe(200);
    // sh-a hoort nu bij chauffeur 4; er is geen terugdienst (returnCode VRIJ).
    expect(mem.planning.find((p: any) => p.id === 'sh-a')?.driverId).toBe('4');
    expect(mem.planning.find((p: any) => p.id === 'sh-b')?.driverId).toBe('4');
  });

  it('verhuist bij een 1-op-1 ruil ook de terugdienst naar de aanvrager', async () => {
    // Chauffeur 3 geeft sh-c (dienst 12, 08/07) aan 4 en neemt diens dienst 14 (02/07).
    mem.swaps = [];
    const nieuw = {
      id: 's-ruil', shiftId: 'sh-c', requesterId: '3', targetDriverId: '4', status: 'pending',
      reason: '', createdAt: '2026-06-20T08:00:00Z', returnDate: '2026-07-02', returnCode: '14',
    };
    const post = await api('POST', '/api/swaps', { token: 'tok-a', body: [nieuw] });
    expect(post.status).toBe(200);
    // Server vulde de dienst-info zelf in (niet client-trusted).
    const opgeslagen = mem.swaps.find((s: any) => s.id === 's-ruil');
    expect(opgeslagen?.shiftDate).toBe('2026-07-08');
    expect(opgeslagen?.shiftLine).toBe('12');

    await api('PATCH', '/api/swaps/s-ruil', { token: 'tok-b', body: { status: 'accepted', ifStatus: 'pending' } });
    const approve = await api('PATCH', '/api/swaps/s-ruil', { token: 'tok-planner', body: { status: 'approved', ifStatus: 'accepted' } });
    expect(approve.status).toBe(200);
    expect(mem.planning.find((p: any) => p.id === 'sh-c')?.driverId).toBe('4');
    expect(mem.planning.find((p: any) => p.id === 'sh-b')?.driverId).toBe('3');
  });

  it('draait de wissel terug wanneer een goedgekeurde ruil geannuleerd wordt', async () => {
    seedShiftInfo();
    await api('PATCH', '/api/swaps/s-1', { token: 'tok-b', body: { status: 'accepted', ifStatus: 'pending' } });
    await api('PATCH', '/api/swaps/s-1', { token: 'tok-planner', body: { status: 'approved', ifStatus: 'accepted' } });
    expect(mem.planning.find((p: any) => p.id === 'sh-a')?.driverId).toBe('4');

    const cancel = await api('PATCH', '/api/swaps/s-1', { token: 'tok-planner', body: { status: 'cancelled', ifStatus: 'approved' } });
    expect(cancel.status).toBe(200);
    expect(mem.planning.find((p: any) => p.id === 'sh-a')?.driverId).toBe('3');
  });

  it('laat een aanvraag zonder dienst-info gewoon goedkeuren (legacy) zonder planning-wijziging', async () => {
    // s-1 zonder shiftDate/shiftLine — van vóór de migratie én de rij is herbouwd.
    await api('PATCH', '/api/swaps/s-1', { token: 'tok-b', body: { status: 'accepted', ifStatus: 'pending' } });
    const approve = await api('PATCH', '/api/swaps/s-1', { token: 'tok-planner', body: { status: 'approved', ifStatus: 'accepted' } });
    expect(approve.status).toBe(200);
    expect(mem.planning.find((p: any) => p.id === 'sh-a')?.driverId).toBe('3');
    // De activity-log waarschuwt dat handmatig bijwerken nodig is.
    expect(mem.activity.some((a: any) => String(a.message).includes('NIET automatisch bijgewerkt'))).toBe(true);
  });

  it('past goedgekeurde ruilen opnieuw toe bij planning-heropbouw (sync-from-matrix)', async () => {
    // Matrix voor 08/07: chauffeur 3 rijdt 12, chauffeur 4 vrij — maar er is
    // een goedgekeurde overname van die dienst naar chauffeur 4.
    mem.planningMatrix = [
      { id: 'm-r', source_date: '2026-07-08', day_type: 'week', assignments: { 'Chauffeur A': '12', 'Chauffeur B': 'vrij' }, raw_row: '' },
    ];
    mem.planningCodes = [
      { code: 'vrij', category: 'absence', description: 'Geen dienst', countsAsShift: false, isPaidAbsence: false, isDayOff: true },
    ];
    mem.swaps = [{
      id: 's-app', shiftId: 'sh-c', requesterId: '3', targetDriverId: '4', status: 'approved',
      reason: '', createdAt: '2026-06-20T08:00:00Z', decidedAt: '2026-06-21T08:00:00Z',
      swapType: 'overname', shiftDate: '2026-07-08', shiftLine: '12',
    }];
    const res = await api('POST', '/api/planning/sync-from-matrix', { token: 'tok-planner' });
    expect(res.status).toBe(200);
    const rebuilt = mem.planning.filter((p: any) => p.date === '2026-07-08' && String(p.line) === '12');
    expect(rebuilt.length).toBeGreaterThan(0);
    for (const row of rebuilt) expect(row.driverId).toBe('4');
  });

  it('heropbouw pusht alléén naar chauffeurs van wie het rooster wijzigde', async () => {
    // Uitgangssituatie: chauffeur 3 heeft dienst 12 op 08/07 (sh-c uit de
    // fixture, 08:00-16:00 volgens dienst d3). De matrix bevestigt exact
    // diezelfde toestand voor 3, maar geeft chauffeur 4 een nieuwe dienst 11.
    mem.planning = [
      { id: 'sh-c', driverId: '3', date: '2026-07-08', line: '12', startTime: '08:00', endTime: '16:00' },
    ];
    mem.planningMatrix = [
      { id: 'm-p', source_date: '2026-07-08', day_type: 'week', assignments: { 'Chauffeur A': '12', 'Chauffeur B': '11' }, raw_row: '' },
    ];
    mem.swaps = [];
    const res = await api('POST', '/api/planning/sync-from-matrix', { token: 'tok-planner' });
    expect(res.status).toBe(200);
    const push = mem.pushesSent.find((pz) => pz.payload.title === 'Rooster bijgewerkt');
    // Chauffeur 4 kreeg een nieuwe dienst → push; chauffeur 3 bleef gelijk → stil.
    expect(push?.userIds).toEqual(['4']);
    expect(res.json.notifiedDrivers).toBe(1);
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

  it('weigert een leave-PATCH zonder ifStatus (400) — spiegel van de swaps-guard', async () => {
    const res = await api('PATCH', '/api/leave/l-a1', { token: 'tok-planner', body: { status: 'approved' } });
    expect(res.status).toBe(400);
    expect(mem.leave.find((l) => l.id === 'l-a1')?.status).toBe('pending');
  });

  it('weigert een overgang uit een afgehandelde leave-status — rejected → approved (409)', async () => {
    mem.leave = [{ id: 'l-r', userId: '3', startDate: '2026-08-10', endDate: '2026-08-12', type: 'betaald_verlof', status: 'rejected', createdAt: '2026-07-01T08:00:00Z', decidedAt: '2026-07-02T08:00:00Z' }];
    const res = await api('PATCH', '/api/leave/l-r', { token: 'tok-admin', body: { status: 'approved', ifStatus: 'rejected' } });
    expect(res.status).toBe(409);
    expect(mem.leave.find((l) => l.id === 'l-r')?.status).toBe('rejected');
  });

  it('geeft 404 voor een intussen ingetrokken aanvraag en 403 voor chauffeurs', async () => {
    const weg = await api('PATCH', '/api/leave/bestaat-niet', { token: 'tok-planner', body: { status: 'approved', ifStatus: 'pending' } });
    expect(weg.status).toBe(404);
    const chauffeur = await api('PATCH', '/api/leave/l-a1', { token: 'tok-a', body: { status: 'approved', ifStatus: 'pending' } });
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

  it('weigert een PATCH zonder ifStatus (400) — anders geldt stil last-write-wins', async () => {
    const res = await api('PATCH', '/api/swaps/s-1', { token: 'tok-planner', body: { status: 'approved' } });
    expect(res.status).toBe(400);
  });

  it('weigert een chauffeur die niet de aangezochte collega is (403)', async () => {
    // Chauffeur A is requester van s-1, niet target — accepteren mag niet.
    const res = await api('PATCH', '/api/swaps/s-1', { token: 'tok-a', body: { status: 'accepted', ifStatus: 'pending' } });
    expect(res.status).toBe(403);
  });

  it('laat geen enkele stafrol "accepted" schrijven — instemming is niet te vervalsen', async () => {
    // De force-approve-regel blokkeerde alleen pending → approved in één stap.
    // Via pending → accepted → approved was instemming alsnog te faken, mét
    // een push "<collega> accepteerde de ruil" naar de aanvrager als bewijs.
    const planner = await api('PATCH', '/api/swaps/s-1', { token: 'tok-planner', body: { status: 'accepted', ifStatus: 'pending' } });
    expect(planner.status).toBe(403);

    // Ook een admin niet: die heeft de directe pending → approved-weg al.
    const admin = await api('PATCH', '/api/swaps/s-1', { token: 'tok-admin', body: { status: 'accepted', ifStatus: 'pending' } });
    expect(admin.status).toBe(403);

    // De ruil staat dus nog steeds op pending — stap 2 kan niet volgen.
    expect(mem.swaps.find((s) => s.id === 's-1')?.status).toBe('pending');
  });

  it('blokkeert de twee-staps-vervalsing ook op het array-pad (POST)', async () => {
    const scoped = mem.swaps.map((s) => (s.id === 's-1' ? { ...s, status: 'accepted' } : s));
    const res = await api('POST', '/api/swaps', { token: 'tok-planner', body: scoped });
    expect(res.status).toBe(403);
    expect(mem.swaps.find((s) => s.id === 's-1')?.status).toBe('pending');
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
    const res = await api('PATCH', '/api/swaps/s-1', { token: 'tok-b', body: { status: 'accepted', ifStatus: 'pending' } });
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
    // Integriteitscheck: seed heeft een admin + alle collecties → ok.
    expect(goed.json.integrity.ok).toBe(true);
  });

  it('integriteitscheck flagt een back-up zonder admin en mailt een alert', async () => {
    const prevAlert = process.env.ALERT_EMAIL;
    process.env.ALERT_EMAIL = 'alerts@vhb.be';
    try {
      mem.users = mem.users.filter((u) => u.role !== 'admin'); // geen admin meer
      mem.emailsSent = [];
      const res = await api('GET', '/api/cron/backup', { headers: { Authorization: 'Bearer test-cron-secret' } });
      expect(res.status).toBe(200); // back-up wordt wél opgeslagen
      expect(res.json.integrity.ok).toBe(false);
      expect(res.json.integrity.issues.some((i: string) => /admin/i.test(i))).toBe(true);
      expect(mem.emailsSent.some((e) => e.context === 'backup-integrity')).toBe(true);
    } finally {
      if (prevAlert === undefined) delete process.env.ALERT_EMAIL;
      else process.env.ALERT_EMAIL = prevAlert;
    }
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

describe('document-leesbevestiging', () => {
  it('zet openedAt bij de eerste keer openen van een eigen document', async () => {
    mem.documents = [{ id: 'd1', userId: '3', filename: 'loonbrief.pdf', storagePath: '3/l', uploadedAt: '2026-07-01T00:00:00Z', openedAt: null }];
    const res = await api('POST', '/api/documents/d1/opened', { token: 'tok-a' });
    expect(res.status).toBe(204);
    expect(mem.documents[0].openedAt).toBe('2026-07-30T12:00:00Z');
  });

  it('laat andermans document onaangeroerd (user_id-match in de update)', async () => {
    mem.documents = [{ id: 'd1', userId: '3', filename: 'loonbrief.pdf', storagePath: '3/l', uploadedAt: '2026-07-01T00:00:00Z', openedAt: null }];
    const res = await api('POST', '/api/documents/d1/opened', { token: 'tok-b' });
    expect(res.status).toBe(204);
    expect(mem.documents[0].openedAt).toBeNull();
  });

  it('geeft openedAt terug in de documentenlijst', async () => {
    mem.documents = [{ id: 'd1', userId: '3', filename: 'loonbrief.pdf', storagePath: '3/l', uploadedAt: '2026-07-01T00:00:00Z', openedAt: '2026-07-30T12:00:00Z' }];
    const res = await api('GET', '/api/documents', { token: 'tok-a' });
    expect(res.status).toBe(200);
    expect(res.json[0].openedAt).toBe('2026-07-30T12:00:00Z');
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
    expect(mem.emailsSent[0].subject).toContain('3 meldingen');
    expect(mem.emailsSent[0].context).toBe('error-digest');
  });

  it('stuurt ook een overzicht als er niets gebeurd is', async () => {
    // Bewuste keuze (02-08): élke dag een mail, ook bij nul. Een bericht dat
    // alleen bij problemen komt, laat je je afvragen of het niet gewoon niet
    // verstuurd is.
    mem.clientErrors = [];
    const res = await api('GET', '/api/cron/error-digest', { headers: { Authorization: 'Bearer test-cron-secret' } });
    expect(res.status).toBe(200);
    expect(res.json.alerted).toBe(true);
    expect(mem.emailsSent).toHaveLength(1);
    expect(mem.emailsSent[0].subject).toContain('geen meldingen');
  });

  it('houdt de toon neutraal en noemt het aantal toestellen', async () => {
    // Waarschuwingsteken weg (verzoek Jarno): 16 meldingen van één toestel las
    // als een storing terwijl het deploy-ruis was. Het aantal toestellen is
    // het signaal dat er wél toe doet.
    mem.clientErrors = [
      { id: 1, createdAt: recent(), message: 'Kon planning niet laden', source: 'error-toast', userId: '3' },
      { id: 2, createdAt: recent(), message: 'Kon updates niet laden', source: 'error-toast', userId: 'onbevestigd:3' },
    ];
    const res = await api('GET', '/api/cron/error-digest', { headers: { Authorization: 'Bearer test-cron-secret' } });
    expect(res.status).toBe(200);
    expect(mem.emailsSent[0].subject).not.toContain('⚠');
    expect(mem.emailsSent[0].subject).toContain('dagoverzicht');
    // 'onbevestigd:3' en '3' zijn hetzelfde toestel.
    expect(mem.emailsSent[0].subject).toContain('1 toestel');
  });

  it('meldt hoeveel er als ruis genegeerd is', async () => {
    mem.clientErrors = [
      { id: 1, createdAt: recent(), message: 'Kon planning niet laden', source: 'error-toast', userId: '3' },
      { id: 2, createdAt: recent(), message: 'Je sessie is verlopen. Log opnieuw in.', source: 'error-toast', userId: '4' },
      { id: 3, createdAt: recent(), message: 'Failed to fetch dynamically imported module: /assets/x.js', source: 'unhandledrejection', userId: '4' },
    ];
    const res = await api('GET', '/api/cron/error-digest', { headers: { Authorization: 'Bearer test-cron-secret' } });
    expect(res.json.count).toBe(1);
    expect(mem.emailsSent[0].text).toContain('2 meldingen niet meegeteld');
  });

  it('negeert fouten ouder dan het interval', async () => {
    mem.clientErrors = [
      { id: 1, createdAt: '2020-01-01T00:00:00.000Z', message: 'oud', source: 'error-toast' },
    ];
    const res = await api('GET', '/api/cron/error-digest', { headers: { Authorization: 'Bearer test-cron-secret' } });
    // Er komt wél een dagoverzicht (dat komt elke dag), maar de oude fout
    // telt niet mee.
    expect(res.json.count).toBe(0);
    expect(mem.emailsSent[0].subject).toContain('geen meldingen');
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

  it("sessie-start logt géén tweede 'Aangemeld' binnen 10 minuten (spam-dedup)", async () => {
    mem.lastAuthEventAt = new Date(Date.now() - 2 * 60 * 1000).toISOString();
    const res = await api('POST', '/api/auth/session', { token: 'tok-a', body: { action: 'start' } });
    expect(res.status).toBe(200);
    expect(mem.activity.find((a) => a.action === 'Aangemeld')).toBeUndefined();
    // Ouder dan 10 minuten → wél opnieuw loggen.
    mem.lastAuthEventAt = new Date(Date.now() - 15 * 60 * 1000).toISOString();
    await api('POST', '/api/auth/session', { token: 'tok-a', body: { action: 'start' } });
    expect(mem.activity.find((a) => a.action === 'Aangemeld')).toBeTruthy();
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

  it("resume zonder auth-event vandaag logt een 'Actief'-event", async () => {
    const res = await api('POST', '/api/auth/session', { token: 'tok-a', body: { action: 'resume' } });
    expect(res.status).toBe(200);
    const actief = mem.activity.find((a) => a.action === 'Actief');
    expect(actief).toBeTruthy();
    expect(actief.domain).toBe('auth');
  });

  it('resume met al een auth-event van vandaag logt niets (dedup)', async () => {
    mem.lastAuthEventAt = new Date().toISOString();
    const res = await api('POST', '/api/auth/session', { token: 'tok-a', body: { action: 'resume' } });
    expect(res.status).toBe(200);
    expect(mem.activity.find((a) => a.action === 'Actief')).toBeUndefined();
  });

  it("resume met laatste auth-event van gisteren logt wél een 'Actief'-event", async () => {
    mem.lastAuthEventAt = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const res = await api('POST', '/api/auth/session', { token: 'tok-a', body: { action: 'resume' } });
    expect(res.status).toBe(200);
    expect(mem.activity.find((a) => a.action === 'Actief')).toBeTruthy();
  });

  it("'Actief'-events tellen mee in /api/activity/logins", async () => {
    await api('POST', '/api/auth/session', { token: 'tok-a', body: { action: 'resume' } });
    const admin = await api('GET', '/api/activity/logins', { token: 'tok-admin' });
    expect(admin.status).toBe(200);
    expect(admin.json.logins.some((l: any) => l.action === 'Actief')).toBe(true);
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

describe('activiteitenlog: venster-parameter (#249)', () => {
  it('?window=30d geeft ook regels ouder dan 7 dagen; default 7d niet', async () => {
    const now = Date.now();
    mem.activity = [
      { id: 'act-oud', createdAt: new Date(now - 20 * 864e5).toISOString(), actorName: 'A', actorRole: 'admin', category: 'planning', action: 'Import', details: '' },
      { id: 'act-nieuw', createdAt: new Date(now - 3600e3).toISOString(), actorName: 'A', actorRole: 'admin', category: 'planning', action: 'Import', details: '' },
    ];
    const kort = await api('GET', '/api/activity', { token: 'tok-admin' });
    expect(kort.json.map((a: any) => a.id)).toEqual(['act-nieuw']);
    const lang = await api('GET', '/api/activity?window=30d', { token: 'tok-admin' });
    expect(lang.json.map((a: any) => a.id).sort()).toEqual(['act-nieuw', 'act-oud']);
  });
});

describe('dienstruil intrekken via PATCH (#250)', () => {
  it('de aanvrager mag een eigen open ruil intrekken (ook vanuit accepted)', async () => {
    mem.swaps = [{ id: 's-w', shiftId: 'sh-a', requesterId: '3', targetDriverId: '4', status: 'accepted', reason: '', createdAt: '2026-07-01T08:00:00Z', returnDate: '2026-08-02', returnCode: 'VRIJ' }];
    const res = await api('PATCH', '/api/swaps/s-w', { token: 'tok-a', body: { status: 'cancelled', ifStatus: 'accepted' } });
    expect(res.status).toBe(200);
    expect(mem.swaps.find((s) => s.id === 's-w')?.status).toBe('cancelled');
  });

  it('een ándere chauffeur (ook de aangezochte) mag níet intrekken (403)', async () => {
    mem.swaps = [{ id: 's-w2', shiftId: 'sh-a', requesterId: '3', targetDriverId: '4', status: 'pending', reason: '', createdAt: '2026-07-01T08:00:00Z', returnDate: '2026-08-02', returnCode: 'VRIJ' }];
    const res = await api('PATCH', '/api/swaps/s-w2', { token: 'tok-b', body: { status: 'cancelled', ifStatus: 'pending' } });
    expect(res.status).toBe(403);
    expect(mem.swaps.find((s) => s.id === 's-w2')?.status).toBe('pending');
  });
});

describe('auth-storing ≠ uitloggen (middleware 401 vs 503)', () => {
  it('een onbereikbare auth-dienst geeft 503, geen 401 — de client logt anders alle toestellen tegelijk uit', async () => {
    const res = await api('GET', '/api/planning', { token: 'tok-storing' });
    expect(res.status).toBe(503);
    expect(res.json?.code).toBe('auth_unavailable');
  });

  it('een 5xx uit de auth-dienst geeft eveneens 503', async () => {
    const res = await api('GET', '/api/planning', { token: 'tok-auth-500' });
    expect(res.status).toBe(503);
  });

  it('een écht ongeldig token blijft 401', async () => {
    const res = await api('GET', '/api/planning', { token: 'tok-bestaat-niet' });
    expect(res.status).toBe(401);
  });
});

describe('dienstnotities (planning_notes)', () => {
  it('planner plaatst een notitie; de chauffeur ziet alleen zijn eigen', async () => {
    const put = await api('PUT', '/api/planning-notes', { token: 'tok-planner', body: { driverId: '3', date: '2026-08-05', note: 'Neem bus 412' } });
    expect(put.status).toBe(200);
    await api('PUT', '/api/planning-notes', { token: 'tok-planner', body: { driverId: '4', date: '2026-08-05', note: 'Ander bericht' } });
    const eigen = await api('GET', '/api/planning-notes?from=2026-08-01&to=2026-08-31', { token: 'tok-a' });
    expect(eigen.status).toBe(200);
    expect(eigen.json).toEqual([{ driverId: '3', date: '2026-08-05', note: 'Neem bus 412' }]);
    const alles = await api('GET', '/api/planning-notes?from=2026-08-01&to=2026-08-31', { token: 'tok-planner' });
    expect(alles.json).toHaveLength(2);
  });

  it('chauffeurs mogen niet schrijven (403) en een lege notitie verwijdert', async () => {
    const put = await api('PUT', '/api/planning-notes', { token: 'tok-a', body: { driverId: '3', date: '2026-08-05', note: 'x' } });
    expect(put.status).toBe(403);
    await api('PUT', '/api/planning-notes', { token: 'tok-planner', body: { driverId: '3', date: '2026-08-06', note: 'weg straks' } });
    const del = await api('PUT', '/api/planning-notes', { token: 'tok-planner', body: { driverId: '3', date: '2026-08-06', note: '  ' } });
    expect(del.status).toBe(200);
    expect(mem.planningNotes).toHaveLength(0);
  });

  it('valideert de datum-shape (400)', async () => {
    const res = await api('PUT', '/api/planning-notes', { token: 'tok-planner', body: { driverId: '3', date: '05/08/2026', note: 'x' } });
    expect(res.status).toBe(400);
  });
});

describe('dienstruil — dóórgeef-ketting en stale goedkeuring', () => {
  it('laat een via een ruil verkregen dienst opnieuw ruilen (geen 409 op een afgehandelde ruil)', async () => {
    // s-1 is goedgekeurd én doorgevoerd: sh-a staat nu op naam van chauffeur 4.
    // Vóór de fix blokkeerde die afgehandelde ruil elk nieuw verzoek voor
    // dezelfde shiftId, waardoor de nieuwe eigenaar vastzat.
    mem.swaps = [
      { id: 's-1', shiftId: 'sh-a', requesterId: '3', targetDriverId: '4', status: 'approved', reason: '', createdAt: '2026-06-01T08:00:00Z', decidedAt: '2026-06-02T08:00:00Z', returnDate: '2026-07-02', returnCode: 'VRIJ' },
    ];
    mem.planning = mem.planning.map((r: any) => (r.id === 'sh-a' ? { ...r, driverId: '4' } : r));
    const nieuw = {
      id: 's-door', shiftId: 'sh-a', requesterId: '4', targetDriverId: '3', status: 'pending',
      reason: '', createdAt: '2026-06-13T08:00:00Z', returnDate: '2026-07-08', returnCode: '12',
    };
    // Chauffeur-payload = eigen betrokken ruilen + de nieuwe (weglaten leest
    // de server als een intrekking).
    const own = mem.swaps.filter((s: any) => s.requesterId === '4' || s.targetDriverId === '4');
    const res = await api('POST', '/api/swaps', { token: 'tok-b', body: [...own, nieuw] });
    expect(res.status).toBe(200);
    expect(mem.swaps.find((s: any) => s.id === 's-door')).toBeTruthy();
  });

  it('weigert een goedkeuring als de dienst niet meer van de aanvrager is (409)', async () => {
    mem.swaps = [
      { id: 'x-stale', shiftId: 'sh-a', requesterId: '3', targetDriverId: '4', status: 'accepted', reason: '', createdAt: '2026-06-01T08:00:00Z', returnDate: '2026-07-02', returnCode: 'VRIJ' },
    ];
    mem.planning = mem.planning.map((r: any) => (r.id === 'sh-a' ? { ...r, driverId: '4' } : r));
    const res = await api('PATCH', '/api/swaps/x-stale', { token: 'tok-admin', body: { status: 'approved', ifStatus: 'accepted' } });
    expect(res.status).toBe(409);
    expect(mem.swaps.find((s: any) => s.id === 'x-stale')?.status).toBe('accepted');
  });
});

describe('maandplanning — afwezigheidscodes zijn voor iedereen zichtbaar', () => {
  // BEWUSTE KEUZE (Jarno, 01-08-2026): het maandrooster toont dezelfde codes
  // als de fysieke planning in het chauffeurslokaal, ziekte incluis. Er is kort
  // een maskering voor chauffeurs geweest (#290) die er op verzoek weer uit is.
  // Deze test legt de keuze vast, zodat een volgende opruimronde hem niet
  // ongemerkt terugdraait — en zodat je het bewust doet als je hem wél wil.
  beforeEach(() => {
    mem.planningCodes = [
      { id: 'pc-ziek', code: 'ziek', description: 'Ziek', category: 'absence' },
      { id: 'pc-bv', code: 'bv', description: 'Betaald Verlof', category: 'leave' },
    ];
    mem.planningMatrix = [
      { id: 'm-z', source_date: '2026-07-15', day_type: 'week', assignments: { 'Chauffeur A': 'ziek', 'Chauffeur B': 'ziek' }, raw_row: '' },
      { id: 'm-v', source_date: '2026-07-16', day_type: 'week', assignments: { 'Chauffeur B': 'bv' }, raw_row: '' },
    ];
  });

  it('een chauffeur ziet de code van een collega ongewijzigd', async () => {
    const res = await api('GET', '/api/month-planning?month=2026-07', { token: 'tok-a' });
    expect(res.status).toBe(200);
    expect(res.json.cells['3']['2026-07-15']).toMatchObject({ code: 'ziek', kind: 'absence', label: 'Ziek' });
    expect(res.json.cells['4']['2026-07-15']).toMatchObject({ code: 'ziek', kind: 'absence', label: 'Ziek' });
    expect(res.json.cells['4']['2026-07-16']).toMatchObject({ code: 'bv', kind: 'leave' });
  });

  it('planner en admin zien hetzelfde', async () => {
    for (const token of ['tok-planner', 'tok-admin']) {
      const res = await api('GET', '/api/month-planning?month=2026-07', { token });
      expect(res.json.cells['3']['2026-07-15']).toMatchObject({ code: 'ziek', label: 'Ziek' });
      expect(res.json.cells['4']['2026-07-15']).toMatchObject({ code: 'ziek', label: 'Ziek' });
    }
  });
});

describe('ziekte werkt door in maandplanning en dekking', () => {
  // De Excel-import is een momentopname: wie dáárna ziek gemeld wordt, stond
  // in het maandrooster nog op zijn dienst en zijn dienst telde in de dekking
  // als ingevuld — terwijl de ziekmeldings-mail het omgekeerde beloofde.
  beforeEach(() => {
    mem.planningCodes = [
      { id: 'pc-ziek', code: 'ziek', description: 'Ziek', category: 'absence' },
      { id: 'pc-bv', code: 'bv', description: 'Betaald Verlof', category: 'leave' },
    ];
    mem.planningMatrix = [
      { id: 'm-1', source_date: '2026-07-15', day_type: 'week', assignments: { 'Chauffeur A': '12', 'Chauffeur B': '11' }, raw_row: '' },
      { id: 'm-2', source_date: '2026-07-16', day_type: 'week', assignments: { 'Chauffeur A': '12' }, raw_row: '' },
    ];
    mem.leave = [
      { id: 'l-ziek', userId: '3', startDate: '2026-07-15', endDate: '2026-07-15', type: 'ziekte', status: 'approved', comment: '', createdAt: '2026-07-15T06:00:00Z', decidedAt: '2026-07-15T06:00:00Z' },
    ];
  });

  it('een ziekmelding overschrijft de dienst in het maandrooster, alleen op de ziektedagen', async () => {
    const res = await api('GET', '/api/month-planning?month=2026-07', { token: 'tok-planner' });
    expect(res.status).toBe(200);
    // 15/07: ziek — de matrix-code 12 is overschreven met de ziekte-code.
    expect(res.json.cells['3']['2026-07-15']).toMatchObject({ code: 'ziek', kind: 'absence', label: 'Ziek' });
    // 16/07 (buiten de ziekteperiode): de dienst staat er nog gewoon.
    expect(res.json.cells['3']['2026-07-16']).toMatchObject({ kind: 'service' });
    // De collega is onaangeroerd.
    expect(res.json.cells['4']['2026-07-15']).toMatchObject({ kind: 'service' });
  });

  it('de overdekte dienst blijft meegestuurd, zodat een admin hem kan overzetten', async () => {
    // Ziek melden haalt de dienst niet uit de planning: de zieke chauffeur
    // stáát er nog op. Zonder hiddenService was juist het hoofdscenario
    // (ziekte) onbereikbaar in de maandplanning — de cel toont "ziek" en de
    // wissel-actie hangt aan een dienst.
    const res = await api('GET', '/api/month-planning?month=2026-07', { token: 'tok-planner' });
    expect(res.json.cells['3']['2026-07-15']).toMatchObject({ code: 'ziek', hiddenService: '12' });
    // Een afwezigheidsdag zónder dienst eronder krijgt het veld niet.
    mem.leave.push({ id: 'l-bv2', userId: '4', startDate: '2026-07-16', endDate: '2026-07-16', type: 'betaald_verlof', status: 'approved', comment: '', createdAt: '2026-07-10T06:00:00Z', decidedAt: '2026-07-11T06:00:00Z' });
    const res2 = await api('GET', '/api/month-planning?month=2026-07', { token: 'tok-planner' });
    expect(res2.json.cells['4']['2026-07-16'].hiddenService).toBeUndefined();
  });

  it('markeert gewisselde cellen met de swap-herkomst', async () => {
    // Een doorgevoerde wissel verplaatst de cel; de maandplanning moet erbij
    // zeggen dat die afwijkt van de Excel (merkteken + terugdraai-knop).
    mem.leave = [];
    mem.swaps = [{
      id: 's-merk', shiftId: 'sh-a', requesterId: '3', targetDriverId: '4', status: 'approved',
      reason: 'Handmatige wissel door Admin E2E — Ziekte', createdAt: '2026-07-14T08:00:00Z',
      decidedAt: '2026-07-14T09:00:00Z', shiftDate: '2026-07-15', shiftLine: '12', swapType: 'overname',
    }];
    const res = await api('GET', '/api/month-planning?month=2026-07', { token: 'tok-planner' });
    expect(res.status).toBe(200);
    // De dienst staat nu bij chauffeur 4, mét herkomst.
    expect(res.json.cells['4']['2026-07-15']).toMatchObject({
      code: '12', swapId: 's-merk', swapManual: true, swapFrom: 'Chauffeur A',
    });
    // Een gewone ruil (geen handmatige wissel) is wél gemerkt maar niet 'manual'.
    mem.swaps = [{ ...mem.swaps[0], id: 's-ruil', reason: 'Ik heb een afspraak' }];
    const res2 = await api('GET', '/api/month-planning?month=2026-07', { token: 'tok-planner' });
    expect(res2.json.cells['4']['2026-07-15']).toMatchObject({ swapId: 's-ruil', swapManual: false });
  });

  it('ook een naderhand goedgekeurd verlof overschrijft de cel', async () => {
    mem.leave.push({ id: 'l-bv', userId: '4', startDate: '2026-07-15', endDate: '2026-07-16', type: 'betaald_verlof', status: 'approved', comment: '', createdAt: '2026-07-10T06:00:00Z', decidedAt: '2026-07-11T06:00:00Z' });
    const res = await api('GET', '/api/month-planning?month=2026-07', { token: 'tok-planner' });
    expect(res.json.cells['4']['2026-07-15']).toMatchObject({ code: 'bv', kind: 'leave' });
  });

  it('pending of afgewezen leave verandert niets aan het rooster', async () => {
    mem.leave = [
      { id: 'l-p', userId: '3', startDate: '2026-07-15', endDate: '2026-07-15', type: 'ziekte', status: 'pending', comment: '', createdAt: '2026-07-15T06:00:00Z' },
      { id: 'l-r', userId: '4', startDate: '2026-07-15', endDate: '2026-07-15', type: 'betaald_verlof', status: 'rejected', comment: '', createdAt: '2026-07-15T06:00:00Z', decidedAt: '2026-07-15T07:00:00Z' },
    ];
    const res = await api('GET', '/api/month-planning?month=2026-07', { token: 'tok-planner' });
    expect(res.json.cells['3']['2026-07-15']).toMatchObject({ kind: 'service' });
    expect(res.json.cells['4']['2026-07-15']).toMatchObject({ kind: 'service' });
  });

  it('de dienst van een zieke chauffeur telt als gat in de dekking (vandaag/toekomst)', async () => {
    // Toekomstige datums: de dekking past afwezigheid bewust alleen toe op
    // vandaag en later — een gereden dag is geen gat meer (zie test hieronder).
    mem.planningMatrix = [
      { id: 'm-t1', source_date: '2030-07-15', day_type: 'week', assignments: { 'Chauffeur A': '12', 'Chauffeur B': '11' }, raw_row: '' },
      { id: 'm-t2', source_date: '2030-07-16', day_type: 'week', assignments: { 'Chauffeur A': '12' }, raw_row: '' },
    ];
    mem.leave = [
      { id: 'l-t', userId: '3', startDate: '2030-07-15', endDate: '2030-07-15', type: 'ziekte', status: 'approved', comment: '', createdAt: '2030-07-15T06:00:00Z', decidedAt: '2030-07-15T06:00:00Z' },
    ];
    mem.coverageExpectations = { week: ['12', '11'] };
    const res = await api('GET', '/api/coverage-gaps?from=2030-07-15&to=2030-07-16', { token: 'tok-planner' });
    expect(res.status).toBe(200);
    // 15/07: Chauffeur A (dienst 12) is ziek → 12 valt open; 11 blijft gedekt.
    const dag15 = res.json.days.find((d: any) => d.date === '2030-07-15');
    expect(dag15.missing).toEqual(['12']);
    expect(dag15.covered).toBe(1);
    // De tegel weet wie er uitviel en waarom.
    expect(dag15.uitval).toEqual({ '12': { name: 'Chauffeur A', reason: 'ziek' } });
    // 16/07: niemand ziek → geen gat voor 12 (11 staat die dag niet in de matrix).
    const dag16 = res.json.days.find((d: any) => d.date === '2030-07-16');
    expect(dag16.missing).toEqual(['11']);
    // 11 was nooit toegewezen → géén uitval-info (kale chip in de UI).
    expect(dag16.uitval).toBeUndefined();
  });

  it('weekdag-periode: vanaf de ingangsdatum geldt een ander regime (dienstregelingswissel)', async () => {
    // Basis-toewijzing = 'zomer' (dienst 41); vanaf 01-09 geldt 'school'
    // (dienst 21). Matrixrijen zonder eigen dagtype vallen terug op de
    // toewijzing — en die moet per datum de juiste periode pakken.
    mem.planningMatrix = [
      { id: 'm-p1', source_date: '2030-08-26', day_type: '', assignments: {}, raw_row: '' },
      { id: 'm-p2', source_date: '2030-09-02', day_type: '', assignments: {}, raw_row: '' },
    ];
    mem.leave = [];
    mem.coverageExpectations = {
      zomer: ['41'],
      school: ['21'],
      __weekdagen__: ['zomer', 'zomer', 'zomer', 'zomer', 'zomer', 'zomer', 'zomer'],
      '__weekdagen_2030-09-01__': ['school', 'school', 'school', 'school', 'school', 'school', 'school'],
    };
    const res = await api('GET', '/api/coverage-gaps?from=2030-08-26&to=2030-09-02', { token: 'tok-planner' });
    expect(res.status).toBe(200);
    const aug = res.json.days.find((d: any) => d.date === '2030-08-26');
    const sep = res.json.days.find((d: any) => d.date === '2030-09-02');
    expect([aug.dayType, aug.missing]).toEqual(['zomer', ['41']]);
    expect([sep.dayType, sep.missing]).toEqual(['school', ['21']]);
  });

  it('weekdag-periodes overleven een GET/PUT-rondje van de instellingen', async () => {
    mem.coverageExpectations = {};
    const put = await api('PUT', '/api/coverage-expectations', {
      token: 'tok-planner',
      body: {
        dayTypes: [{ name: 'zomer', services: ['41'] }, { name: 'school', services: ['21'] }],
        weekdays: ['zomer', 'zomer', 'zomer', 'zomer', 'zomer', 'zomer', 'zomer'],
        weekdayPeriods: [
          { vanaf: '2030-09-01', weekdays: ['school', 'school', 'school', 'school', 'school', 'school', 'school'] },
          // Ongeldige ingangsdatum → genegeerd, mag de rest niet blokkeren.
          { vanaf: 'kapot', weekdays: ['school'] },
        ],
        overrides: [],
      },
    });
    expect(put.status).toBe(200);
    const get = await api('GET', '/api/coverage-expectations', { token: 'tok-planner' });
    expect(get.status).toBe(200);
    expect(get.json.weekdayPeriods).toEqual([
      { vanaf: '2030-09-01', weekdays: ['school', 'school', 'school', 'school', 'school', 'school', 'school'] },
    ]);
    // De periode-sleutel is reserved en lekt niet als dag-type de lijst in.
    expect(get.json.dayTypes.map((d: any) => d.name)).toEqual(['school', 'zomer']);
  });

  it('een herverdeelde dienst verdwijnt uit de dekking (melding Jarno 14-08)', async () => {
    // De matrix blijft de zieke chauffeur tonen — dat is een momentopname van
    // de Excel. Is de dienst intussen overgenomen, dan is hij gewoon gedekt;
    // zonder deze overlay bleef hij als gat staan mét de naam van de zieke,
    // ook nadat de admin hem had overgezet.
    mem.planningMatrix = [
      { id: 'm-w1', source_date: '2030-07-15', day_type: 'week', assignments: { 'Chauffeur A': '12', 'Chauffeur B': '11' }, raw_row: '' },
    ];
    mem.leave = [
      { id: 'l-w', userId: '3', startDate: '2030-07-15', endDate: '2030-07-15', type: 'ziekte', status: 'approved', comment: '', createdAt: '2030-07-15T06:00:00Z', decidedAt: '2030-07-15T06:00:00Z' },
    ];
    mem.coverageExpectations = { week: ['12', '11'] };

    // Vóór de wissel: dienst 12 is een gat.
    const voor = await api('GET', '/api/coverage-gaps?from=2030-07-15&to=2030-07-15', { token: 'tok-planner' });
    expect(voor.json.days[0].missing).toEqual(['12']);

    // Admin zet dienst 12 over naar chauffeur 4 (niet afwezig).
    mem.swaps = [{
      id: 's-dekking', shiftId: 'sh-x', requesterId: '3', targetDriverId: '4', status: 'approved',
      reason: 'Handmatige wissel door Admin E2E — Ziekte', createdAt: '2030-07-14T08:00:00Z',
      decidedAt: '2030-07-14T09:00:00Z', shiftDate: '2030-07-15', shiftLine: '12', swapType: 'overname',
    }];
    const na = await api('GET', '/api/coverage-gaps?from=2030-07-15&to=2030-07-15', { token: 'tok-planner' });
    expect(na.json.days[0].missing).toEqual([]);
    expect(na.json.days[0].covered).toBe(2);
    expect(na.json.days[0].uitval).toBeUndefined();
  });

  it('een dienst die is overgezet naar iemand die zélf afwezig is, blijft een gat', async () => {
    mem.planningMatrix = [
      { id: 'm-w2', source_date: '2030-07-15', day_type: 'week', assignments: { 'Chauffeur A': '12' }, raw_row: '' },
    ];
    // Beide chauffeurs afwezig: de oorspronkelijke én de overnemer.
    mem.leave = [
      { id: 'l-w1', userId: '3', startDate: '2030-07-15', endDate: '2030-07-15', type: 'ziekte', status: 'approved', comment: '', createdAt: '2030-07-15T06:00:00Z', decidedAt: '2030-07-15T06:00:00Z' },
      { id: 'l-w2', userId: '4', startDate: '2030-07-15', endDate: '2030-07-15', type: 'betaald_verlof', status: 'approved', comment: '', createdAt: '2030-07-10T06:00:00Z', decidedAt: '2030-07-11T06:00:00Z' },
    ];
    mem.coverageExpectations = { week: ['12'] };
    mem.swaps = [{
      id: 's-dekking2', shiftId: 'sh-x', requesterId: '3', targetDriverId: '4', status: 'approved',
      reason: '', createdAt: '2030-07-14T08:00:00Z', decidedAt: '2030-07-14T09:00:00Z',
      shiftDate: '2030-07-15', shiftLine: '12', swapType: 'overname',
    }];
    const res = await api('GET', '/api/coverage-gaps?from=2030-07-15&to=2030-07-15', { token: 'tok-planner' });
    expect(res.json.days[0].missing).toEqual(['12']);
    // …en de tegel noemt de nieuwe eigenaar, niet de oorspronkelijke zieke.
    expect(res.json.days[0].uitval['12']).toMatchObject({ name: 'Chauffeur B', reason: 'verlof' });
  });

  it('een gereden (historische) dag wordt niet met terugwerkende kracht een gat', async () => {
    // Een achteraf ingevoerd ziektebriefje voor 15 juli (verleden): die dag ís
    // gereden — door een invaller die nooit in de matrix is bijgewerkt. De
    // dekking blijft hem als gedekt tonen; alleen vandaag/toekomst filtert.
    mem.coverageExpectations = { week: ['12', '11'] };
    const res = await api('GET', '/api/coverage-gaps?from=2026-07-15&to=2026-07-15', { token: 'tok-planner' });
    const dag = res.json.days[0];
    expect(dag.missing).toEqual([]);
    expect(dag.covered).toBe(2);
    expect(dag.uitval).toBeUndefined();
  });

  it('de dekking matcht de zieke ook op omgekeerde naamvolgorde', async () => {
    // De matrix schrijft "A Chauffeur" (achternaam eerst) — zelfde
    // volgorde-onafhankelijke resolutie als /api/month-planning.
    mem.planningMatrix = [
      { id: 'm-3', source_date: '2030-07-15', day_type: 'week', assignments: { 'A Chauffeur': '12' }, raw_row: '' },
    ];
    mem.leave = [
      { id: 'l-t', userId: '3', startDate: '2030-07-15', endDate: '2030-07-15', type: 'ziekte', status: 'approved', comment: '', createdAt: '2030-07-15T06:00:00Z', decidedAt: '2030-07-15T06:00:00Z' },
    ];
    mem.coverageExpectations = { week: ['12'] };
    const res = await api('GET', '/api/coverage-gaps?from=2030-07-15&to=2030-07-15', { token: 'tok-planner' });
    expect(res.json.days[0].missing).toEqual(['12']);
  });

  it('ziekte wint van overlappend verlof in het maandrooster', async () => {
    mem.leave = [
      { id: 'l-bv', userId: '3', startDate: '2026-07-14', endDate: '2026-07-16', type: 'betaald_verlof', status: 'approved', comment: '', createdAt: '2026-07-01T06:00:00Z', decidedAt: '2026-07-02T06:00:00Z' },
      { id: 'l-zk', userId: '3', startDate: '2026-07-15', endDate: '2026-07-15', type: 'ziekte', status: 'approved', comment: '', createdAt: '2026-07-15T06:00:00Z', decidedAt: '2026-07-15T06:00:00Z' },
    ];
    const res = await api('GET', '/api/month-planning?month=2026-07', { token: 'tok-planner' });
    // Op de ziektedag wint ziek; de dag ervoor/erna blijft verlof.
    expect(res.json.cells['3']['2026-07-15']).toMatchObject({ code: 'ziek' });
    expect(res.json.cells['3']['2026-07-16']).toMatchObject({ code: 'bv' });
  });

  it('een leave-record met kapotte datums overschrijft niets', async () => {
    mem.leave = [
      { id: 'l-kapot', userId: '3', startDate: '', endDate: '2026-07-31', type: 'ziekte', status: 'approved', comment: '', createdAt: '2026-07-01T06:00:00Z' },
    ];
    const res = await api('GET', '/api/month-planning?month=2026-07', { token: 'tok-planner' });
    // Lege startdatum vergeleek vroeger als "altijd waar" en zette de hele
    // maand op ziek; nu wordt zo'n record genegeerd.
    expect(res.json.cells['3']['2026-07-15']).toMatchObject({ kind: 'service' });
  });
});

describe('maandplanning — goedgekeurde dienstruilen zichtbaar (bevinding Jarno 06-08)', () => {
  // Een goedgekeurde ruil verhuist de dienst in de planning-tabel, maar het
  // maandrooster leest de matrix — zonder overlay bleef de oude eigenaar
  // daar op zijn dienst staan.
  beforeEach(() => {
    mem.planningMatrix = [
      { id: 'm-r1', source_date: '2026-07-15', day_type: 'week', assignments: { 'Chauffeur A': '12' }, raw_row: '' },
      { id: 'm-r2', source_date: '2026-07-16', day_type: 'week', assignments: { 'Chauffeur B': '11' }, raw_row: '' },
    ];
    mem.swaps = [];
    mem.leave = [];
  });

  it('een goedgekeurde overname verhuist de dienst-cel naar de collega', async () => {
    mem.swaps = [
      { id: 'r-1', shiftId: 'sh-x', requesterId: '3', targetDriverId: '4', status: 'approved', swapType: 'overname', reason: '', createdAt: '2026-07-10T08:00:00Z', decidedAt: '2026-07-11T08:00:00Z', shiftDate: '2026-07-15', shiftLine: '12' },
    ];
    const res = await api('GET', '/api/month-planning?month=2026-07', { token: 'tok-planner' });
    expect(res.status).toBe(200);
    expect(res.json.cells['4']['2026-07-15']).toMatchObject({ code: '12', kind: 'service' });
    expect(res.json.cells['3']?.['2026-07-15']).toBeUndefined();
  });

  it('een 1-op-1 ruil wisselt óók de terugruil-dag', async () => {
    mem.swaps = [
      { id: 'r-2', shiftId: 'sh-x', requesterId: '3', targetDriverId: '4', status: 'approved', swapType: 'ruil', reason: '', createdAt: '2026-07-10T08:00:00Z', decidedAt: '2026-07-11T08:00:00Z', shiftDate: '2026-07-15', shiftLine: '12', returnDate: '2026-07-16', returnCode: '11' },
    ];
    const res = await api('GET', '/api/month-planning?month=2026-07', { token: 'tok-planner' });
    expect(res.json.cells['4']['2026-07-15']).toMatchObject({ code: '12', kind: 'service' });
    expect(res.json.cells['3']['2026-07-16']).toMatchObject({ code: '11', kind: 'service' });
    expect(res.json.cells['4']?.['2026-07-16']).toBeUndefined();
  });

  it('geen dubbele doorvoer als de Excel de ruil al verwerkt heeft', async () => {
    // De planner importeerde een nieuwe Excel mét de ruil erin: de cel staat
    // al bij de collega. De overlay mag hem dan niet terug-wisselen.
    mem.planningMatrix = [
      { id: 'm-r3', source_date: '2026-07-15', day_type: 'week', assignments: { 'Chauffeur B': '12' }, raw_row: '' },
    ];
    mem.swaps = [
      { id: 'r-3', shiftId: 'sh-x', requesterId: '3', targetDriverId: '4', status: 'approved', swapType: 'overname', reason: '', createdAt: '2026-07-10T08:00:00Z', decidedAt: '2026-07-11T08:00:00Z', shiftDate: '2026-07-15', shiftLine: '12' },
    ];
    const res = await api('GET', '/api/month-planning?month=2026-07', { token: 'tok-planner' });
    expect(res.json.cells['4']['2026-07-15']).toMatchObject({ code: '12', kind: 'service' });
    expect(res.json.cells['3']?.['2026-07-15']).toBeUndefined();
  });

  it('een latere ziekmelding wint van de geruilde dienst', async () => {
    mem.planningCodes = [{ id: 'pc-ziek', code: 'ziek', description: 'Ziek', category: 'absence' }];
    mem.swaps = [
      { id: 'r-4', shiftId: 'sh-x', requesterId: '3', targetDriverId: '4', status: 'approved', swapType: 'overname', reason: '', createdAt: '2026-07-10T08:00:00Z', decidedAt: '2026-07-11T08:00:00Z', shiftDate: '2026-07-15', shiftLine: '12' },
    ];
    mem.leave = [
      { id: 'l-r', userId: '4', startDate: '2026-07-15', endDate: '2026-07-15', type: 'ziekte', status: 'approved', comment: '', createdAt: '2026-07-14T06:00:00Z', decidedAt: '2026-07-14T06:00:00Z' },
    ];
    const res = await api('GET', '/api/month-planning?month=2026-07', { token: 'tok-planner' });
    expect(res.json.cells['4']['2026-07-15']).toMatchObject({ code: 'ziek', kind: 'absence' });
  });
});

describe('dienstruil — afwezigheids-check in beide richtingen', () => {
  it('weigert een nieuwe ruil als de AANVRAGER ziek is op de terugruil-dag (409)', async () => {
    // Chauffeur 4 biedt sh-b aan en zou op 08/07 dienst 12 van chauffeur 3
    // terugrijden — maar is die dag zelf ziek gemeld. De oude check keek
    // alleen naar de collega op de dienstdag.
    mem.swaps = [];
    mem.leave = [
      { id: 'l-req', userId: '4', startDate: '2026-07-08', endDate: '2026-07-08', type: 'ziekte', status: 'approved', comment: '', createdAt: '2026-07-07T06:00:00Z', decidedAt: '2026-07-07T06:00:00Z' },
    ];
    const nieuw = {
      id: 's-richting', shiftId: 'sh-b', requesterId: '4', targetDriverId: '3', status: 'pending',
      reason: '', createdAt: '2026-06-13T08:00:00Z', returnDate: '2026-07-08', returnCode: '12',
    };
    const res = await api('POST', '/api/swaps', { token: 'tok-b', body: [nieuw] });
    expect(res.status).toBe(409);
    expect(mem.swaps.find((s: any) => s.id === 's-richting')).toBeUndefined();
  });

  it('weigert goedkeuren als de collega ná het accepteren ziek gemeld is (409)', async () => {
    mem.swaps = [
      { id: 's-zk', shiftId: 'sh-a', requesterId: '3', targetDriverId: '4', status: 'accepted', reason: '', createdAt: '2026-06-01T08:00:00Z', shiftDate: '2026-07-01', shiftLine: '12', returnDate: '2026-07-02', returnCode: 'VRIJ' },
    ];
    mem.leave = [
      { id: 'l-na', userId: '4', startDate: '2026-07-01', endDate: '2026-07-01', type: 'ziekte', status: 'approved', comment: '', createdAt: '2026-06-20T06:00:00Z', decidedAt: '2026-06-20T06:00:00Z' },
    ];
    const res = await api('PATCH', '/api/swaps/s-zk', { token: 'tok-admin', body: { status: 'approved', ifStatus: 'accepted' } });
    expect(res.status).toBe(409);
    expect(mem.swaps.find((s: any) => s.id === 's-zk')?.status).toBe('accepted');
    // De planning is niet halverwege gewisseld.
    expect(mem.planning.find((r: any) => r.id === 'sh-a')?.driverId).toBe('3');
  });
});

describe('dienstruil — terugdraaien, bevriezen en tegenprestatie-validatie', () => {
  it('approved → rejected draait de planning terug (niet alleen cancelled)', async () => {
    // sh-a is via s-x doorgevoerd naar chauffeur 4; de planner wijst hem daarna
    // alsnog af. Vóór de fix bleef de dienst bij 4 staan en zette de replay hem
    // bij de volgende import stilletjes terug.
    mem.swaps = [
      { id: 's-x', shiftId: 'sh-a', requesterId: '3', targetDriverId: '4', status: 'approved', reason: '', createdAt: '2026-06-01T08:00:00Z', decidedAt: '2026-06-02T08:00:00Z', shiftDate: '2026-07-01', shiftLine: '12', returnDate: '2026-07-02', returnCode: 'VRIJ' },
    ];
    mem.planning = mem.planning.map((r: any) => (r.id === 'sh-a' ? { ...r, driverId: '4' } : r));
    const res = await api('PATCH', '/api/swaps/s-x', { token: 'tok-admin', body: { status: 'rejected', ifStatus: 'approved' } });
    expect(res.status).toBe(200);
    expect(mem.planning.find((r: any) => r.id === 'sh-a')?.driverId).toBe('3');
  });

  it('completed laat de wissel juist staan', async () => {
    mem.swaps = [
      { id: 's-y', shiftId: 'sh-a', requesterId: '3', targetDriverId: '4', status: 'approved', reason: '', createdAt: '2026-06-01T08:00:00Z', decidedAt: '2026-06-02T08:00:00Z', shiftDate: '2026-07-01', shiftLine: '12', returnDate: '2026-07-02', returnCode: 'VRIJ' },
    ];
    mem.planning = mem.planning.map((r: any) => (r.id === 'sh-a' ? { ...r, driverId: '4' } : r));
    const res = await api('PATCH', '/api/swaps/s-y', { token: 'tok-admin', body: { status: 'completed', ifStatus: 'approved' } });
    expect(res.status).toBe(200);
    expect(mem.planning.find((r: any) => r.id === 'sh-a')?.driverId).toBe('4');
  });

  it('een planner kan de voorwaarden van een geaccepteerde ruil niet herschrijven', async () => {
    mem.swaps = [
      { id: 's-acc', shiftId: 'sh-a', requesterId: '3', targetDriverId: '4', status: 'accepted', reason: '', createdAt: '2026-06-01T08:00:00Z', returnDate: '2026-07-02', returnCode: '14' },
    ];
    // Planner probeert in één keer de tegenprestatie én de collega te wijzigen
    // en de ruil goed te keuren.
    const res = await api('POST', '/api/swaps', {
      token: 'tok-planner',
      body: [{ ...mem.swaps[0], targetDriverId: '2', returnDate: '2026-07-08', returnCode: '12', status: 'approved' }],
    });
    expect(res.status).toBe(200);
    const saved = mem.swaps.find((s: any) => s.id === 's-acc');
    expect(saved?.status).toBe('approved');
    // Alleen de status is meegegaan; de voorwaarden zijn bevroren.
    expect(saved?.targetDriverId).toBe('4');
    expect(saved?.returnDate).toBe('2026-07-02');
    expect(saved?.returnCode).toBe('14');
  });

  it('weigert een tegenprestatie die niet in de planning van de collega staat', async () => {
    const own = mem.swaps.filter((s: any) => s.requesterId === '3' || s.targetDriverId === '3');
    const verzonnen = {
      id: 's-fake', shiftId: 'sh-c', requesterId: '3', targetDriverId: '4', status: 'pending',
      reason: '', createdAt: '2026-06-14T08:00:00Z', returnDate: '2026-07-02', returnCode: '99',
    };
    const res = await api('POST', '/api/swaps', { token: 'tok-a', body: [...own, verzonnen] });
    expect(res.status).toBe(400);
    expect(mem.swaps.find((s: any) => s.id === 's-fake')).toBeFalsy();
  });

  it('weigert een samengestelde dienstcode als tegenprestatie met uitleg', async () => {
    const own = mem.swaps.filter((s: any) => s.requesterId === '3' || s.targetDriverId === '3');
    const samengesteld = {
      id: 's-multi', shiftId: 'sh-c', requesterId: '3', targetDriverId: '4', status: 'pending',
      reason: '', createdAt: '2026-06-14T09:00:00Z', returnDate: '2026-07-02', returnCode: '14/12',
    };
    const res = await api('POST', '/api/swaps', { token: 'tok-a', body: [...own, samengesteld] });
    expect(res.status).toBe(400);
    expect(String(res.json?.error)).toContain('meerdere diensten');
  });

  it('laat een geldige tegenprestatie gewoon door', async () => {
    const own = mem.swaps.filter((s: any) => s.requesterId === '3' || s.targetDriverId === '3');
    // sh-b: chauffeur 4 rijdt dienst 14 op 2026-07-02.
    const geldig = {
      id: 's-ok', shiftId: 'sh-c', requesterId: '3', targetDriverId: '4', status: 'pending',
      reason: '', createdAt: '2026-06-14T10:00:00Z', returnDate: '2026-07-02', returnCode: '14',
    };
    const res = await api('POST', '/api/swaps', { token: 'tok-a', body: [...own, geldig] });
    expect(res.status).toBe(200);
    expect(mem.swaps.find((s: any) => s.id === 's-ok')).toBeTruthy();
  });
});

describe('handmatige dienstwissel — gates uit de controle-ronde', () => {
  const wissel = (body: Record<string, unknown>, token = 'tok-admin') =>
    api('POST', '/api/admin/shift-swap', { token, body: { reason: 'Ziekte', ...body } });

  it('weigert de wissel als de dienst de TEGENPRESTATIE van een open ruil is', async () => {
    // s-2: chauffeur 4 biedt sh-b aan en vraagt dienst 12 op 03/07 terug.
    // Zet die terugruil-dienst in de planning op naam van chauffeur 3.
    mem.planning.push({ id: 'sh-terug', driverId: '3', date: '2026-07-03', line: '12' });
    const res = await wissel({ date: '2026-07-03', line: '12', fromDriverId: '3', toDriverId: '2' });
    expect(res.status).toBe(409);
    expect(String(res.json?.error)).toContain('ruilaanvraag');
    // Niets verplaatst.
    expect(mem.planning.find((r: any) => r.id === 'sh-terug')?.driverId).toBe('3');
  });

  it('matcht de dienstcode genormaliseerd (rauwe matrixcode vs. canoniek nummer)', async () => {
    mem.planning.push({ id: 'sh-r12', driverId: '3', date: '2026-07-20', line: 'r12' });
    // De maandplanning-cel stuurt de rúwe schrijfwijze mee.
    const res = await wissel({ date: '2026-07-20', line: 'R12', fromDriverId: '3', toDriverId: '4' });
    expect(res.status).toBe(200);
    expect(mem.planning.find((r: any) => r.id === 'sh-r12')?.driverId).toBe('4');
    // De swap bewaart de canonieke schrijfwijze, zodat de replay hem terugvindt.
    expect(mem.swaps.find((s: any) => s.shiftDate === '2026-07-20')?.shiftLine).toBe('r12');
  });
});

describe('planning-import — ziekte blokkeert niet, gepland verlof wel', () => {
  // Melding Jarno 15-08: een upload werd geblokkeerd door een "verlofconflict"
  // dat in werkelijkheid een ziekteperiode was. Ziekte is onvoorzien (de Excel
  // wordt vooraf gemaakt) en heeft een eigen herverdeel-flow — alleen gepland
  // verlof (betaald/klein verlet) hoort de import tegen te houden.
  const buildXlsxBase64 = async () => {
    const XLSX = await import('xlsx');
    const serial = (iso: string) => Math.round((Date.parse(`${iso}T00:00:00Z`) - Date.parse('1899-12-30T00:00:00Z')) / 86400000);
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([
      ['datum', 'dagtype', 'Chauffeur A', 'Chauffeur B', 'aantal'],
      [serial('2030-08-03'), 'W', '12', '14', 2],
    ]);
    XLSX.utils.book_append_sheet(wb, ws, 'praktijk');
    return (XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer).toString('base64');
  };

  it('preview scheidt ziekte (informatief) van verlof (blokkerend)', async () => {
    mem.leave = [
      { id: 'l-z', userId: '3', startDate: '2030-08-01', endDate: '2030-08-10', type: 'ziekte', status: 'approved', comment: '', createdAt: '2030-07-30T06:00:00Z', decidedAt: '2030-07-30T06:00:00Z' },
    ];
    const res = await api('POST', '/api/planning-matrix/preview', { token: 'tok-planner', body: { xlsxBase64: await buildXlsxBase64() } });
    expect(res.status).toBe(200);
    // Chauffeur A is ziek op 03/08 en staat op dienst 12 → informatief…
    expect(res.json.ziekteDiensten).toHaveLength(1);
    expect(res.json.ziekteDiensten[0]).toMatchObject({ driverName: 'Chauffeur A', serviceNumber: '12' });
    // …maar géén blokkerend verlofconflict.
    expect(res.json.verlofConflicts).toHaveLength(0);
  });

  it('import gaat dóór bij ziekte, en blokkeert nog steeds op betaald verlof', async () => {
    mem.leave = [
      { id: 'l-z', userId: '3', startDate: '2030-08-01', endDate: '2030-08-10', type: 'ziekte', status: 'approved', comment: '', createdAt: '2030-07-30T06:00:00Z', decidedAt: '2030-07-30T06:00:00Z' },
    ];
    const base64 = await buildXlsxBase64();
    const ok = await api('POST', '/api/planning-matrix/import', { token: 'tok-planner', body: { xlsxBase64: base64 } });
    expect(ok.status).toBe(200);
    expect(ok.json.success).toBe(true);
    expect(ok.json.ziekteDiensten).toHaveLength(1);

    // Zelfde Excel, maar nu met goedgekeurd betaald verlof: wél blokkeren.
    mem.leave = [
      { id: 'l-bv', userId: '3', startDate: '2030-08-01', endDate: '2030-08-10', type: 'betaald_verlof', status: 'approved', comment: '', createdAt: '2030-07-01T06:00:00Z', decidedAt: '2030-07-02T06:00:00Z' },
    ];
    const geblokkeerd = await api('POST', '/api/planning-matrix/import', { token: 'tok-planner', body: { xlsxBase64: base64 } });
    expect(geblokkeerd.status).toBe(400);
    expect(geblokkeerd.json.blocked).toBe(true);
    expect(geblokkeerd.json.verlofConflicts).toHaveLength(1);
  });
});

describe('planning-import — periode-selectie', () => {
  // De planner maakt de Excel maanden vooruit, maar alleen het vaststaande
  // deel mag het portaal in: een meegegeven periode filtert de rijen vóór
  // opbouw én vervanging, alsof de rest niet in het bestand stond.
  const buildTweeMaandenXlsx = async () => {
    const XLSX = await import('xlsx');
    const serial = (iso: string) => Math.round((Date.parse(`${iso}T00:00:00Z`) - Date.parse('1899-12-30T00:00:00Z')) / 86400000);
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([
      ['datum', 'dagtype', 'Chauffeur A', 'Chauffeur B', 'aantal'],
      [serial('2030-09-01'), 'W', '12', '', 1],
      [serial('2030-10-01'), 'W', '', '14', 1],
    ]);
    XLSX.utils.book_append_sheet(wb, ws, 'praktijk');
    return (XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer).toString('base64');
  };

  it('preview met periode filtert tot de gekozen dagen en meldt het volledige bestandsbereik', async () => {
    mem.leave = [];
    const res = await api('POST', '/api/planning-matrix/preview', {
      token: 'tok-planner',
      body: { xlsxBase64: await buildTweeMaandenXlsx(), periode: { van: '2030-09-01', tot: '2030-09-30' } },
    });
    expect(res.status).toBe(200);
    expect(res.json.importedDays).toBe(1);
    expect(res.json.startDate).toBe('2030-09-01');
    expect(res.json.endDate).toBe('2030-09-01');
    expect(res.json.fileStartDate).toBe('2030-09-01');
    expect(res.json.fileEndDate).toBe('2030-10-01');
  });

  it('import met periode schrijft alleen de geselecteerde dagen weg', async () => {
    mem.leave = [];
    mem.swaps = [];
    const res = await api('POST', '/api/planning-matrix/import', {
      token: 'tok-planner',
      body: { xlsxBase64: await buildTweeMaandenXlsx(), periode: { van: '2030-09-01', tot: '2030-09-30' } },
    });
    expect(res.status).toBe(200);
    expect(res.json.success).toBe(true);
    expect(res.json.importedDays).toBe(1);
    // De oktober-rij uit het bestand is genegeerd: matrix én planning bevatten
    // alleen september.
    expect(mem.planningMatrix.map((r: any) => r.source_date)).toEqual(['2030-09-01']);
    expect(mem.planning.every((r: any) => r.date === '2030-09-01')).toBe(true);
  });

  it('weigert een periode zonder dagen, met het bestandsbereik in de melding', async () => {
    const res = await api('POST', '/api/planning-matrix/preview', {
      token: 'tok-planner',
      body: { xlsxBase64: await buildTweeMaandenXlsx(), periode: { van: '2030-11-01', tot: '2030-11-30' } },
    });
    expect(res.status).toBe(400);
    expect(String(res.json.error)).toContain('Geen dagen binnen de gekozen periode');
    expect(String(res.json.error)).toContain('2030-09-01');
    expect(String(res.json.error)).toContain('2030-10-01');
  });

  it('weigert een periode met begindatum na einddatum', async () => {
    const res = await api('POST', '/api/planning-matrix/import', {
      token: 'tok-planner',
      body: { xlsxBase64: await buildTweeMaandenXlsx(), periode: { van: '2030-10-01', tot: '2030-09-01' } },
    });
    expect(res.status).toBe(400);
    expect(String(res.json.error)).toContain('begindatum ligt na de einddatum');
  });
});

describe('dienstruil — dubbele inplanning bij goedkeuren', () => {
  it('weigert goedkeuring als de collega intussen zelf een dienst heeft die dag', async () => {
    // s-1: chauffeur 3 biedt sh-a (01/07, dienst 12) aan chauffeur 4, tegen een
    // vrije dag. Chauffeur 4 krijgt intussen zelf een dienst op 01/07.
    mem.swaps = mem.swaps.map((s: any) => (s.id === 's-1' ? { ...s, shiftDate: '2026-07-01', shiftLine: '12' } : s));
    mem.planning.push({ id: 'sh-nieuw', driverId: '4', date: '2026-07-01', line: '15' });
    const accept = await api('PATCH', '/api/swaps/s-1', { token: 'tok-b', body: { status: 'accepted', ifStatus: 'pending' } });
    expect(accept.status).toBe(200);
    const approve = await api('PATCH', '/api/swaps/s-1', { token: 'tok-admin', body: { status: 'approved', ifStatus: 'accepted' } });
    expect(approve.status).toBe(409);
    expect(String(approve.json?.error)).toContain('dubbele inplanning');
    // De dienst is niet verhuisd.
    expect(mem.planning.find((r: any) => r.id === 'sh-a')?.driverId).toBe('3');
  });

  it('laat een 1-op-1 ruil op dezelfde dag gewoon door (terugruil telt niet mee)', async () => {
    // Chauffeur 3 (dienst 12) en chauffeur 4 (dienst 14) ruilen op 01/07.
    mem.planning = [
      { id: 'sh-a', driverId: '3', date: '2026-07-01', line: '12' },
      { id: 'sh-x', driverId: '4', date: '2026-07-01', line: '14' },
    ];
    mem.swaps = [
      { id: 's-zelfde-dag', shiftId: 'sh-a', requesterId: '3', targetDriverId: '4', status: 'accepted', reason: '', createdAt: '2026-06-01T08:00:00Z', shiftDate: '2026-07-01', shiftLine: '12', returnDate: '2026-07-01', returnCode: '14' },
    ];
    const res = await api('PATCH', '/api/swaps/s-zelfde-dag', { token: 'tok-admin', body: { status: 'approved', ifStatus: 'accepted' } });
    expect(res.status).toBe(200);
    expect(mem.planning.find((r: any) => r.id === 'sh-a')?.driverId).toBe('4');
    expect(mem.planning.find((r: any) => r.id === 'sh-x')?.driverId).toBe('3');
  });
});

describe('onbemande dienst toewijzen (Dekking)', () => {
  // Een gat = een verwachte dienst die op níémand staat; de dienstwissel kan
  // daar niets mee. Toewijzen schrijft in de matrix (bron van elke heropbouw)
  // én zet de blokken direct in de planning.
  beforeEach(() => {
    mem.planningMatrix = [
      { id: 'm-gat', source_date: '2030-09-02', day_type: 'week', assignments: { 'Chauffeur A': '12' }, raw_row: '' },
    ];
    mem.planning = [{ id: 'sh-a2', driverId: '3', date: '2030-09-02', line: '12' }];
    mem.leave = [];
    mem.swaps = [];
  });

  it('wijst een onbemande dienst toe: matrix + planning bijgewerkt', async () => {
    // Dienst 14 wordt die dag verwacht maar staat op niemand; chauffeur 4 is vrij.
    const res = await api('POST', '/api/planning/assign-service', {
      token: 'tok-planner',
      body: { date: '2030-09-02', serviceNumber: '14', driverId: '4' },
    });
    expect(res.status).toBe(200);
    expect(res.json.success).toBe(true);
    // Planning-rij met de tijden uit het dienstoverzicht.
    const rij = mem.planning.find((r: any) => r.line === '14' && r.date === '2030-09-02');
    expect(rij).toMatchObject({ driverId: '4', startTime: '10:00', endTime: '18:00' });
    // Matrix-rij draagt de toewijzing, zodat een heropbouw hem regenereert.
    expect(mem.planningMatrix[0].assignments['Chauffeur B']).toBe('14');
    // Bestaande toewijzing van chauffeur A blijft staan.
    expect(mem.planningMatrix[0].assignments['Chauffeur A']).toBe('12');
  });

  it('weigert toewijzen aan iemand die al rijdt, en aan een bemande dienst', async () => {
    const alRijdt = await api('POST', '/api/planning/assign-service', {
      token: 'tok-planner',
      body: { date: '2030-09-02', serviceNumber: '14', driverId: '3' },
    });
    expect(alRijdt.status).toBe(409);
    expect(String(alRijdt.json?.error)).toContain('al dienst');

    const alBemand = await api('POST', '/api/planning/assign-service', {
      token: 'tok-planner',
      body: { date: '2030-09-02', serviceNumber: '12', driverId: '4' },
    });
    expect(alBemand.status).toBe(409);
    expect(String(alBemand.json?.error)).toContain('al ingevuld');
  });

  it('weigert een afwezige chauffeur en een chauffeur-rol-check via 403 voor chauffeurs', async () => {
    mem.leave = [{ id: 'l-a', userId: '4', startDate: '2030-09-02', endDate: '2030-09-02', type: 'ziekte', status: 'approved', comment: '', createdAt: '2030-09-01T06:00:00Z', decidedAt: '2030-09-01T06:00:00Z' }];
    const ziek = await api('POST', '/api/planning/assign-service', {
      token: 'tok-planner',
      body: { date: '2030-09-02', serviceNumber: '14', driverId: '4' },
    });
    expect(ziek.status).toBe(409);

    const chauffeur = await api('POST', '/api/planning/assign-service', {
      token: 'tok-a',
      body: { date: '2030-09-02', serviceNumber: '14', driverId: '4' },
    });
    expect(chauffeur.status).toBe(403);
  });
});

describe('dienstruil — concurrency-vangnet bij goedkeuren', () => {
  it('weigert goedkeuring als de doorvoer nul rijen verplaatst (planning intussen gewijzigd)', async () => {
    // Geaccepteerde ruil, maar de dienst is intussen (bv. door een admin-
    // wissel) al naar iemand anders verplaatst: apply raakt 0 rijen.
    mem.planning = [{ id: 'sh-a', driverId: '9', date: '2026-07-01', line: '12' }];
    mem.swaps = [{
      id: 's-race', shiftId: 'sh-weg', requesterId: '3', targetDriverId: '4', status: 'accepted',
      reason: '', createdAt: '2026-06-01T08:00:00Z', shiftDate: '2026-07-01', shiftLine: '12', swapType: 'overname',
    }];
    const res = await api('PATCH', '/api/swaps/s-race', { token: 'tok-admin', body: { status: 'approved', ifStatus: 'accepted' } });
    expect(res.status).toBe(409);
    expect(String(res.json?.error)).toContain('intussen gewijzigd');
    // Niet half goedgekeurd: status bleef accepted.
    expect(mem.swaps.find((s: any) => s.id === 's-race')?.status).toBe('accepted');
  });
});

describe('dienstruil — verwijderen laat een auditspoor na', () => {
  it('logt een verwijderde ruil in het activiteitenlog', async () => {
    const voor = mem.activity.length;
    // Planner schrijft de volledige lijst terug zónder s-1 (= verwijdering).
    const res = await api('POST', '/api/swaps', { token: 'tok-planner', body: mem.swaps.filter((s: any) => s.id !== 's-1') });
    expect(res.status).toBe(200);
    expect(mem.swaps.find((s: any) => s.id === 's-1')).toBeFalsy();
    const nieuw = mem.activity.slice(voor);
    expect(nieuw.some((a: any) => String(a.action) === 'Dienstruil verwijderd' && String(a.entityId) === 's-1')).toBe(true);
  });
});

describe('push-abonnees (wie kan meldingen ontvangen)', () => {
  it('planner ziet de ids, chauffeur krijgt 403', async () => {
    await api('POST', '/api/push/subscribe', {
      token: 'tok-a',
      body: { endpoint: 'https://push.test/abc', keys: { p256dh: 'p', auth: 'a' } },
    });
    const alsPlanner = await api('GET', '/api/push/subscribers', { token: 'tok-planner' });
    expect(alsPlanner.status).toBe(200);
    expect(alsPlanner.json).toEqual({ userIds: ['3'] });
    // Geen chauffeur-inzage: wie meldingen aan heeft is beheerinformatie.
    const alsChauffeur = await api('GET', '/api/push/subscribers', { token: 'tok-a' });
    expect(alsChauffeur.status).toBe(403);
  });
});

describe('vervaldata (Code 95 / medische schifting)', () => {
  it('planner zet een vervaldatum; chauffeur ziet alleen zijn eigen datums', async () => {
    const zet = await api('PUT', '/api/user-expiries', { token: 'tok-planner', body: { userId: '3', soort: 'code95', validUntil: '2027-03-01' } });
    expect(zet.status).toBe(200);
    await api('PUT', '/api/user-expiries', { token: 'tok-planner', body: { userId: '4', soort: 'medische_schifting', validUntil: '2028-01-15' } });
    // Chauffeur 3 (tok-a) ziet alleen zichzelf.
    const eigen = await api('GET', '/api/user-expiries', { token: 'tok-a' });
    expect(eigen.status).toBe(200);
    expect(eigen.json).toEqual([{ userId: '3', soort: 'code95', validUntil: '2027-03-01' }]);
    // Planner ziet alles.
    const alle = await api('GET', '/api/user-expiries', { token: 'tok-planner' });
    expect(alle.json).toHaveLength(2);
  });

  it('chauffeur mag niet schrijven (403); lege datum verwijdert; rommel wordt geweigerd', async () => {
    const verboden = await api('PUT', '/api/user-expiries', { token: 'tok-a', body: { userId: '3', soort: 'code95', validUntil: '2027-03-01' } });
    expect(verboden.status).toBe(403);
    await api('PUT', '/api/user-expiries', { token: 'tok-admin', body: { userId: '3', soort: 'code95', validUntil: '2027-03-01' } });
    const weg = await api('PUT', '/api/user-expiries', { token: 'tok-admin', body: { userId: '3', soort: 'code95', validUntil: null } });
    expect(weg.status).toBe(200);
    expect(mem.userExpiries).toHaveLength(0);
    const fouteSoort = await api('PUT', '/api/user-expiries', { token: 'tok-admin', body: { userId: '3', soort: 'tachograaf', validUntil: '2027-01-01' } });
    expect(fouteSoort.status).toBe(400);
    const fouteDatum = await api('PUT', '/api/user-expiries', { token: 'tok-admin', body: { userId: '3', soort: 'code95', validUntil: '01/03/2027' } });
    expect(fouteDatum.status).toBe(400);
    const onbekendeUser = await api('PUT', '/api/user-expiries', { token: 'tok-admin', body: { userId: 'geest', soort: 'code95', validUntil: '2027-01-01' } });
    expect(onbekendeUser.status).toBe(404);
  });

  it('rijbewijs wordt niet meer bewaakt: PUT weigert, oude rijen komen niet in de GET', async () => {
    const oud = await api('PUT', '/api/user-expiries', { token: 'tok-admin', body: { userId: '3', soort: 'rijbewijs', validUntil: '2029-05-01' } });
    expect(oud.status).toBe(400);
    // Rij die vóór de wijziging is opgeslagen: blijft in de DB staan, maar
    // mag nergens meer opduiken.
    mem.userExpiries.push({ userId: '3', soort: 'rijbewijs', validUntil: '2029-05-01', updatedAt: null, updatedBy: null });
    await api('PUT', '/api/user-expiries', { token: 'tok-admin', body: { userId: '3', soort: 'code95', validUntil: '2027-03-01' } });
    const alle = await api('GET', '/api/user-expiries', { token: 'tok-planner' });
    expect(alle.json).toEqual([{ userId: '3', soort: 'code95', validUntil: '2027-03-01' }]);
  });
});

describe('gezien-bevestiging op een doorgevoerde wissel', () => {
  beforeEach(() => {
    mem.swaps = [
      { id: 's-app', shiftId: 'sh-a', requesterId: '3', targetDriverId: '4', status: 'approved', reason: '', createdAt: '2026-07-01T08:00:00Z', decidedAt: '2026-07-02T08:00:00Z', shiftDate: '2026-07-15', shiftLine: '12' },
      { id: 's-pend', shiftId: 'sh-b', requesterId: '3', targetDriverId: '4', status: 'pending', reason: '', createdAt: '2026-07-01T09:00:00Z' },
    ];
  });

  it('alleen de ontvangende chauffeur mag bevestigen (403 voor anderen)', async () => {
    // Aanvrager (chauffeur 3) is niet de ontvanger.
    const res = await api('POST', '/api/swaps/s-app/gezien', { token: 'tok-a' });
    expect(res.status).toBe(403);
    expect(mem.swaps.find((s: any) => s.id === 's-app')?.targetSeenAt).toBeUndefined();
  });

  it('weigert een nog niet doorgevoerde wissel (409)', async () => {
    const res = await api('POST', '/api/swaps/s-pend/gezien', { token: 'tok-b' });
    expect(res.status).toBe(409);
  });

  it('zet target_seen_at, logt de activiteit en is idempotent', async () => {
    const res = await api('POST', '/api/swaps/s-app/gezien', { token: 'tok-b' });
    expect(res.status).toBe(200);
    const eerste = mem.swaps.find((s: any) => s.id === 's-app')?.targetSeenAt;
    expect(typeof eerste).toBe('string');
    expect(mem.activity.some((a: any) => a.action === 'Dienstwissel bevestigd')).toBe(true);
    // Tweede keer bevestigen overschrijft de timestamp niet.
    const opnieuw = await api('POST', '/api/swaps/s-app/gezien', { token: 'tok-b' });
    expect(opnieuw.status).toBe(200);
    expect(mem.swaps.find((s: any) => s.id === 's-app')?.targetSeenAt).toBe(eerste);
  });

  it('de array-route wist een bestaande bevestiging niet', async () => {
    await api('POST', '/api/swaps/s-app/gezien', { token: 'tok-b' });
    const eerste = mem.swaps.find((s: any) => s.id === 's-app')?.targetSeenAt;
    // Chauffeur 4 stuurt zijn eigen lijst terug zónder targetSeenAt (en zelfs
    // met een vervalste waarde op de pending) — de server negeert dat veld.
    const eigen = mem.swaps
      .filter((s: any) => s.requesterId === '4' || s.targetDriverId === '4')
      .map((s: any) => ({ ...s, targetSeenAt: s.id === 's-pend' ? '2020-01-01T00:00:00Z' : undefined }));
    const res = await api('POST', '/api/swaps', { token: 'tok-b', body: eigen });
    expect(res.status).toBe(200);
    expect(mem.swaps.find((s: any) => s.id === 's-app')?.targetSeenAt).toBe(eerste);
    expect(mem.swaps.find((s: any) => s.id === 's-pend')?.targetSeenAt ?? undefined).toBeUndefined();
  });

  it('GET /api/swaps geeft targetSeenAt terug', async () => {
    await api('POST', '/api/swaps/s-app/gezien', { token: 'tok-b' });
    const res = await api('GET', '/api/swaps', { token: 'tok-planner' });
    expect(res.json.find((s: any) => s.id === 's-app')?.targetSeenAt).toBeTruthy();
  });
});

describe('Excel-terugexport van de maandplanning', () => {
  beforeEach(() => {
    mem.planningMatrix = [
      { id: 'm-1', source_date: '2026-07-15', day_type: 'week', assignments: { 'Chauffeur A': '12', 'Chauffeur B': '11' }, raw_row: '' },
    ];
  });

  it('weigert een chauffeur (403)', async () => {
    const res = await api('GET', '/api/month-planning?month=2026-07&format=xlsx', { token: 'tok-a' });
    expect(res.status).toBe(403);
  });

  it('levert een geldig xlsx-bestand met de actuele cel-waarheid', async () => {
    // Wissel doorgevoerd ná de Excel-import: de export moet de áctuele stand
    // bevatten (dienst 12 bij chauffeur B), niet de originele upload.
    mem.swaps = [{
      id: 's-x', shiftId: 'sh-a', requesterId: '3', targetDriverId: '4', status: 'approved',
      reason: '', createdAt: '2026-07-01T08:00:00Z', decidedAt: '2026-07-02T08:00:00Z',
      shiftDate: '2026-07-15', shiftLine: '12', swapType: 'overname',
    }];
    const raw = await fetch(`${baseUrl}/api/month-planning?month=2026-07&format=xlsx`, {
      headers: { Authorization: 'Bearer tok-planner', 'X-Device-Token': 'dev-ok' },
    });
    expect(raw.status).toBe(200);
    expect(raw.headers.get('content-type')).toContain('spreadsheetml');
    expect(raw.headers.get('content-disposition')).toContain('planning-2026-07.xlsx');
    const XLSX = await import('xlsx');
    const wb = XLSX.read(Buffer.from(await raw.arrayBuffer()), { type: 'buffer' });
    const ws = wb.Sheets['praktijk'];
    expect(ws).toBeTruthy();
    const rows = XLSX.utils.sheet_to_json<any>(ws, { header: 1, raw: true });
    const header = (rows[0] as any[]).map((h: any) => String(h).toLowerCase());
    expect(header).toContain('chauffeur a');
    expect(header).toContain('chauffeur b');
    // Kolom A is een Excel-serial (zelfde formaat als de praktijk-tab-upload).
    const serial = Math.round((Date.parse('2026-07-15T00:00:00Z') - Date.parse('1899-12-30T00:00:00Z')) / 86400000);
    const dag = rows.find((r: any[]) => Number(r[0]) === serial) as any[];
    expect(dag).toBeTruthy();
    const colB = header.indexOf('chauffeur b');
    const colA = header.indexOf('chauffeur a');
    expect(String(dag[colB])).toBe('12');
    // Chauffeur A gaf de dienst weg (overname) → geen dienstcode meer.
    expect(String(dag[colA] ?? '')).not.toBe('12');
  });
});

describe('beveiliging (controleronde 16-08)', () => {
  it('A — /api/planning is per chauffeur gescoped, ook met een vreemde ?driverId', async () => {
    const eigen = await api('GET', '/api/planning', { token: 'tok-a' });
    expect(eigen.status).toBe(200);
    expect(eigen.json.every((s: any) => String(s.driverId) === '3')).toBe(true);
    expect(eigen.json.some((s: any) => String(s.driverId) === '4')).toBe(false);
    // Bypass-poging: kale fetch met andermans id → nog steeds alleen eigen rijen.
    const vreemd = await api('GET', '/api/planning?driverId=4', { token: 'tok-a' });
    expect(vreemd.json.every((s: any) => String(s.driverId) === '3')).toBe(true);
  });

  it('A — planner/admin mag wél gericht een andere chauffeur opvragen', async () => {
    const res = await api('GET', '/api/planning?driverId=4', { token: 'tok-planner' });
    expect(res.status).toBe(200);
    expect(res.json.every((s: any) => String(s.driverId) === '4')).toBe(true);
  });

  it('E — push-subscribe weigert een intern/loopback-endpoint (SSRF)', async () => {
    for (const endpoint of [
      'http://169.254.169.254/latest/meta-data',
      'https://localhost/x',
      'http://push.example/x',        // geen https
      'https://127.0.0.1/x',
      'https://[::1]/x',
    ]) {
      const res = await api('POST', '/api/push/subscribe', { token: 'tok-a', body: { endpoint, keys: { p256dh: 'pk', auth: 'au' } } });
      expect(res.status, endpoint).toBe(400);
    }
    expect(mem.pushSubscriptions).toHaveLength(0);
    // Een echt (publiek https) endpoint gaat wél door.
    const ok = await api('POST', '/api/push/subscribe', { token: 'tok-a', body: { endpoint: 'https://fcm.googleapis.com/abc', keys: { p256dh: 'pk', auth: 'au' } } });
    expect(ok.status).toBe(200);
  });

  it('C — nieuw toestel boven de bovengrens wordt geweigerd, een bekend token nog wel', async () => {
    mem.devices = Array.from({ length: 15 }, (_, i) => ({
      userId: '3', deviceToken: `d${i}`, name: `t${i}`, status: 'approved',
      createdAt: '2026-07-01T00:00:00Z', lastSeenAt: '', approvedAt: '2026-07-01T00:00:00Z', approvedBy: 'auto',
    }));
    const nieuw = await api('POST', '/api/devices/register', { token: 'tok-a', device: 'd-nieuw', body: { name: 'nog een' } });
    expect(nieuw.status).toBe(429);
    expect(mem.devices).toHaveLength(15); // geen rij bijgemaakt
    // Een reeds bekend token (last_seen-update) mag ondanks de cap.
    const bekend = await api('POST', '/api/devices/register', { token: 'tok-a', device: 'd0', body: { name: 't0' } });
    expect(bekend.status).toBe(200);
  });

  it('D — decidedAt is server-gezaghebbend bij een afwijzing via de array-route', async () => {
    const eigen = mem.swaps
      .filter((s: any) => s.requesterId === '4' || s.targetDriverId === '4')
      .map((s: any) => (s.id === 's-1' ? { ...s, status: 'rejected', decidedAt: '2000-01-01T00:00:00Z' } : s));
    const res = await api('POST', '/api/swaps', { token: 'tok-b', body: eigen });
    expect(res.status).toBe(200);
    const saved = mem.swaps.find((s: any) => s.id === 's-1');
    expect(saved.status).toBe('rejected');
    expect(saved.decidedAt).not.toBe('2000-01-01T00:00:00Z');
    expect(Date.parse(saved.decidedAt)).toBeGreaterThan(Date.parse('2026-01-01'));
  });

  it('D — decidedAt is server-gezaghebbend bij goedkeuring via de array-route', async () => {
    // Force-approve pending→approved via de array-route mag alleen admin.
    const all = mem.swaps.map((s: any) => (s.id === 's-1' ? { ...s, status: 'approved', decidedAt: '2000-01-01T00:00:00Z' } : s));
    const res = await api('POST', '/api/swaps', { token: 'tok-admin', body: all });
    expect(res.status).toBe(200);
    const saved = mem.swaps.find((s: any) => s.id === 's-1');
    expect(saved.status).toBe('approved');
    expect(saved.decidedAt).not.toBe('2000-01-01T00:00:00Z');
    expect(Date.parse(saved.decidedAt)).toBeGreaterThan(Date.parse('2026-01-01'));
  });

  it('G — het bedrijfsbrede noodbericht is rate-limited', async () => {
    let last: any;
    for (let i = 0; i < 8; i++) {
      last = await api('POST', '/api/send-urgent-update-email', { token: 'tok-admin', body: { update: { title: 't', content: 'c' } } });
    }
    expect(last.status).toBe(429); // max 6/uur → de latere calls worden geweigerd
  });
});

describe('advies openstaande diensten (/api/coverage-advisor)', () => {
  // Vaste toekomst-dag: het advies rekent alleen met de meegegeven dag en
  // het venster eromheen (±6 dagen + de hele week én kalendermaand voor de
  // belastingtelling) — geen "vandaag" in de logica.
  const DAG = '2026-09-16';

  it('is planner/admin-terrein (chauffeur krijgt 403)', async () => {
    const res = await api('GET', `/api/coverage-advisor?date=${DAG}&code=10`, { token: 'tok-a' });
    expect(res.status).toBe(403);
  });

  it('weigert een kapotte datum of ontbrekende code', async () => {
    const geenCode = await api('GET', `/api/coverage-advisor?date=${DAG}`, { token: 'tok-planner' });
    expect(geenCode.status).toBe(400);
    const kapot = await api('GET', '/api/coverage-advisor?date=16-09-2026&code=10', { token: 'tok-planner' });
    expect(kapot.status).toBe(400);
  });

  it('beoordeelt rust: wie gisteren laat eindigde past niet vóór een vroege dienst', async () => {
    // Dienst 10 = 06:00–14:00. Chauffeur A werkte gisteren tot 23:30 → 6u30
    // rust; Chauffeur B was vrij → passend. B hoort vóór A te staan.
    mem.planning = [
      { id: 'p-1', driverId: '3', date: '2026-09-15', startTime: '15:00', endTime: '23:30', line: '12' },
    ];
    const res = await api('GET', `/api/coverage-advisor?date=${DAG}&code=10`, { token: 'tok-planner' });
    expect(res.status).toBe(200);
    expect(res.json.tijdenOnbekend).toBe(false);
    expect(res.json.segmenten).toEqual([{ startTime: '06:00', endTime: '14:00' }]);
    expect(res.json.kandidaten.map((k: any) => [k.name, k.past])).toEqual([
      ['Chauffeur B', true],
      ['Chauffeur A', false],
    ]);
    const a = res.json.kandidaten.find((k: any) => k.name === 'Chauffeur A');
    expect(a.rustVoor).toBe(6 * 60 + 30);
    expect(a.redenen).toEqual(['maar 6u30 rust na de dienst van de dag ervoor']);
  });

  it('bewaakt de 6-dagenregel over de bestaande planning heen', async () => {
    // Chauffeur A werkte 10 t/m 15 september (6 dagen): de 16e zou dag 7 zijn.
    mem.planning = ['10', '11', '12', '13', '14', '15'].map((d) => (
      { id: `p-${d}`, driverId: '3', date: `2026-09-${d}`, startTime: '08:00', endTime: '14:00', line: '12' }
    ));
    const res = await api('GET', `/api/coverage-advisor?date=${DAG}&code=10`, { token: 'tok-planner' });
    const a = res.json.kandidaten.find((k: any) => k.name === 'Chauffeur A');
    expect(a.past).toBe(false);
    expect(a.dagenNaElkaar).toBe(7);
    expect(a.redenen).toEqual(['zou 7 dagen na elkaar werken']);
  });

  it('wie die dag al rijdt of verlof heeft, is geen kandidaat', async () => {
    mem.planning = [
      { id: 'p-b', driverId: '4', date: DAG, startTime: '08:00', endTime: '16:00', line: '12' },
    ];
    mem.leave = [
      { id: 'l-adv', userId: '3', startDate: DAG, endDate: DAG, type: 'betaald_verlof', status: 'approved', comment: '', createdAt: '2026-09-01T08:00:00Z', decidedAt: '2026-09-02T08:00:00Z' },
    ];
    const res = await api('GET', `/api/coverage-advisor?date=${DAG}&code=10`, { token: 'tok-planner' });
    expect(res.json.kandidaten).toEqual([]);
  });

  it('sorteert op belasting: wie deze week het minst werkte staat bovenaan', async () => {
    // Chauffeur A werkte al op maandag 14/09 (zelfde week als het gat, niet
    // aansluitend); Chauffeur B werkte die week nog niet → B eerst.
    mem.planning = [
      { id: 'p-wk', driverId: '3', date: '2026-09-14', startTime: '08:00', endTime: '14:00', line: '12' },
    ];
    const res = await api('GET', `/api/coverage-advisor?date=${DAG}&code=10`, { token: 'tok-planner' });
    expect(res.json.kandidaten.map((k: any) => [k.name, k.dagenDezeWeek])).toEqual([
      ['Chauffeur B', 0],
      ['Chauffeur A', 1],
    ]);
  });

  it('een schoolvervoerchauffeur valt buiten het voorstel, mét reden', async () => {
    mem.planning = [];
    mem.users = mem.users.map((u: any) => (u.id === '4' ? { ...u, section: 'Schoolvervoer' } : u));
    const res = await api('GET', `/api/coverage-advisor?date=${DAG}&code=10`, { token: 'tok-planner' });
    expect(res.json.kandidaten.map((k: any) => [k.name, k.past])).toEqual([
      ['Chauffeur A', true],
      ['Chauffeur B', false],
    ]);
    const b = res.json.kandidaten.find((k: any) => k.name === 'Chauffeur B');
    expect(b.redenen).toEqual(['schoolvervoerchauffeur — springt niet in op een lijndienst']);
  });

  it('bij gelijke weekbelasting beslist de reeks, daarna het maandtotaal', async () => {
    // Beiden één werkdag deze week: A op di 15/09 (sluit aan op het gat →
    // reeks van 2), B op ma 14/09 (los → reeks van 1). B staat bovenaan.
    mem.planning = [
      { id: 'p-a15', driverId: '3', date: '2026-09-15', startTime: '08:00', endTime: '14:00', line: '12' },
      { id: 'p-b14', driverId: '4', date: '2026-09-14', startTime: '08:00', endTime: '14:00', line: '12' },
    ];
    const res = await api('GET', `/api/coverage-advisor?date=${DAG}&code=10`, { token: 'tok-planner' });
    expect(res.json.kandidaten.map((k: any) => [k.name, k.dagenDezeWeek, k.dagenNaElkaar])).toEqual([
      ['Chauffeur B', 1, 1],
      ['Chauffeur A', 1, 2],
    ]);

    // Zelfde week (0 gewerkte dagen) en zelfde reeks: het maandtotaal beslist.
    // A werkte 3 septemberdagen buiten de week van het gat — dat kan de
    // advisor alleen zien doordat het datavenster de hele maand dekt.
    mem.planning = ['01', '03', '05'].map((d) => (
      { id: `p-m${d}`, driverId: '3', date: `2026-09-${d}`, startTime: '08:00', endTime: '14:00', line: '12' }
    ));
    const res2 = await api('GET', `/api/coverage-advisor?date=${DAG}&code=10`, { token: 'tok-planner' });
    expect(res2.json.kandidaten.map((k: any) => [k.name, k.dagenDezeMaand])).toEqual([
      ['Chauffeur B', 0],
      ['Chauffeur A', 3],
    ]);
  });

  it('onbekende dienst: kandidaten mét 6-dagenregel, maar rustcheck gemarkeerd als onmogelijk', async () => {
    mem.planning = [];
    const res = await api('GET', `/api/coverage-advisor?date=${DAG}&code=999`, { token: 'tok-planner' });
    expect(res.status).toBe(200);
    expect(res.json.tijdenOnbekend).toBe(true);
    expect(res.json.segmenten).toEqual([]);
    const a = res.json.kandidaten.find((k: any) => k.name === 'Chauffeur A');
    expect(a.rustVoor).toBeNull();
    expect(a.past).toBe(true);
  });
});

describe('advisor: ketting-voorstellen en collega-samenvatting', () => {
  const DAG = '2026-09-16';

  it('stelt een ruil in één stap voor als niemand direct past', async () => {
    // Dienst 10 begint 06:00. Chauffeur B is vrij maar werkte gisteren tot
    // 23:30 → maar 6u30 rust vóór 06:00, wél 8u30 vóór 08:00. Chauffeur A
    // rijdt dienst 12 (08:00–16:00) en kan zelf het gat rijden.
    mem.planning = [
      { id: 'p-ka', driverId: '3', date: DAG, startTime: '08:00', endTime: '16:00', line: '12' },
      { id: 'p-kb', driverId: '4', date: '2026-09-15', startTime: '15:00', endTime: '23:30', line: '14' },
    ];
    const res = await api('GET', `/api/coverage-advisor?date=${DAG}&code=10`, { token: 'tok-planner' });
    expect(res.status).toBe(200);
    expect(res.json.kandidaten.some((k: any) => k.past)).toBe(false);
    expect(res.json.kettingen).toEqual([{
      vanId: '3', vanNaam: 'Chauffeur A', viaCode: '12', viaTijden: '08:00–16:00',
      naarId: '4', naarNaam: 'Chauffeur B',
    }]);
    expect(res.json.samenvatting).toContain('Wél mogelijk via een ruil');
    expect(res.json.samenvatting).toContain('Chauffeur B');
  });

  it('geen kettingen zolang er een passende kandidaat is; samenvatting noemt hem', async () => {
    mem.planning = [];
    const res = await api('GET', `/api/coverage-advisor?date=${DAG}&code=10`, { token: 'tok-planner' });
    expect(res.json.kettingen).toEqual([]);
    expect(res.json.samenvatting).toContain('Ik zou Chauffeur A vragen');
  });
});

describe('digest: proactieve sectie openstaande diensten', () => {
  it('mailt de gaten van de komende 7 dagen mét advies en pusht de planning', async () => {
    // Morgen (lokale klok — valt hoe dan ook binnen het Brusselse 7-dagenvenster):
    // dienst 12 is bemand in de matrix, dienst 11 wordt verwacht maar staat open.
    const d = new Date();
    d.setDate(d.getDate() + 1);
    const morgen = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    mem.planningMatrix = [
      { id: 'm-dig', source_date: morgen, day_type: 'week', assignments: { 'Chauffeur A': '12' }, raw_row: '' },
    ];
    mem.coverageExpectations = { week: ['12', '11'] };
    mem.planning = [];

    const res = await api('GET', '/api/cron/error-digest', { headers: { Authorization: 'Bearer test-cron-secret' } });
    expect(res.status).toBe(200);
    const mail = mem.emailsSent.find((m) => m.context === 'error-digest');
    expect(mail?.text).toContain('Openstaande diensten (komende 7 dagen)');
    expect(mail?.text).toContain('dienst 11');
    // De samenvatting reist mee de mail in ("Ik zou … vragen").
    expect(mail?.text).toContain('Ik zou');
    // En de planners/admins krijgen één push met het aantal.
    const push = mem.pushesSent.find((p) => String(p.payload.title).includes('openstaande dienst'));
    expect(push).toBeTruthy();
    expect(push!.userIds.sort()).toEqual(['1', '2']);
  });

  it('geen gaten → geen sectie en geen push', async () => {
    mem.planningMatrix = [];
    mem.coverageExpectations = {};
    const res = await api('GET', '/api/cron/error-digest', { headers: { Authorization: 'Bearer test-cron-secret' } });
    expect(res.status).toBe(200);
    const mail = mem.emailsSent.find((m) => m.context === 'error-digest');
    expect(mail?.text ?? '').not.toContain('Openstaande diensten');
    expect(mem.pushesSent.some((p) => String(p.payload.title).includes('openstaande dienst'))).toBe(false);
  });
});

describe('planner-assistent (/api/planner-chat)', () => {
  it('is planner/admin-terrein (chauffeur krijgt 403)', async () => {
    const res = await api('POST', '/api/planner-chat', { token: 'tok-a', body: { messages: [{ role: 'user', content: 'test' }] } });
    expect(res.status).toBe(403);
  });

  it('meldt netjes dat de assistent nog niet geactiveerd is zonder API-sleutel', async () => {
    const bewaard = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      const res = await api('POST', '/api/planner-chat', { token: 'tok-planner', body: { messages: [{ role: 'user', content: 'test' }] } });
      expect(res.status).toBe(503);
      expect(res.json.code).toBe('assistent_uitgeschakeld');
    } finally {
      if (bewaard !== undefined) process.env.ANTHROPIC_API_KEY = bewaard;
    }
  });

  it('weigert een lege of kapotte gespreksgeschiedenis (vóór er een model aan te pas komt)', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test-nep';
    try {
      const leeg = await api('POST', '/api/planner-chat', { token: 'tok-planner', body: { messages: [] } });
      expect(leeg.status).toBe(400);
      // Laatste beurt moet van de gebruiker zijn.
      const verkeerd = await api('POST', '/api/planner-chat', { token: 'tok-planner', body: { messages: [{ role: 'assistant', content: 'hoi' }] } });
      expect(verkeerd.status).toBe(400);
    } finally {
      delete process.env.ANTHROPIC_API_KEY;
    }
  });
});

describe('verbeterronde 20-08 — import-signalen & planning-aanwezigheid', () => {
  const bouwXlsx = async (aoa: unknown[][]) => {
    const XLSX = await import('xlsx');
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), 'praktijk');
    return (XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer).toString('base64');
  };
  const serial = (iso: string) => Math.round((Date.parse(`${iso}T00:00:00Z`) - Date.parse('1899-12-30T00:00:00Z')) / 86400000);

  it('preview waarschuwt voor kolommen ná "aantal" en vergelijkt chauffeurs met de planning vlak vóór de periode', async () => {
    // Bestaande matrix (juli 2030, binnen het 60-dagen-venster) heeft
    // Chauffeur A + B; dit bestand (2030-08) heeft alleen A + een nieuwe C,
    // plus een kolom áchter aantal — precies het patroon waarmee Luc Cherlet
    // op 20-08 geruisloos verdween.
    mem.planningMatrix = [
      { id: 'm-jul', source_date: '2030-07-08', day_type: 'week', assignments: { 'Chauffeur A': '12', 'Chauffeur B': '14' }, raw_row: '' },
    ];
    const base64 = await bouwXlsx([
      ['datum', 'dagtype', 'Chauffeur A', 'Chauffeur C', 'aantal', 'Vergeten Chauffeur'],
      [serial('2030-08-03'), 'W', '12', '14', 2, '15'],
    ]);
    const res = await api('POST', '/api/planning-matrix/preview', { token: 'tok-planner', body: { xlsxBase64: base64 } });
    expect(res.status).toBe(200);
    expect(res.json.parserWaarschuwingen).toHaveLength(1);
    expect(res.json.parserWaarschuwingen[0]).toContain('Vergeten Chauffeur');
    expect(res.json.chauffeursVerdwenen).toEqual([{ naam: 'Chauffeur B', laatste: '2030-07-08' }]);
    expect(res.json.chauffeursNieuw).toEqual(['Chauffeur C']);
  });

  it('chauffeurs-vergelijking: oude planning buiten het venster telt niet mee; dekt het bestand alles, dan vergelijkt hij met de oude versie van de periode zelf', async () => {
    const base64 = await bouwXlsx([
      ['datum', 'dagtype', 'Chauffeur A', 'aantal'],
      [serial('2030-08-03'), 'W', '12', 1],
    ]);
    // Alleen jaren-oude rijen (ver buiten het 60-dagen-venster): geen ruis
    // over allang vertrokken collega's.
    mem.planningMatrix = [
      { id: 'm-oud', source_date: '2026-07-01', day_type: 'week', assignments: { 'Chauffeur A': '12', 'Chauffeur B': '14' }, raw_row: '' },
    ];
    const stil = await api('POST', '/api/planning-matrix/preview', { token: 'tok-planner', body: { xlsxBase64: base64 } });
    expect(stil.json.chauffeursVerdwenen).toEqual([]);
    expect(stil.json.chauffeursNieuw).toEqual([]);

    // Zelfde bestand, maar nu bestaat er een oude versie van exact deze
    // periode mét Chauffeur B: de fallback vergelijkt daarmee.
    mem.planningMatrix = [
      { id: 'm-zelfde', source_date: '2030-08-03', day_type: 'week', assignments: { 'Chauffeur A': '12', 'Chauffeur B': '14' }, raw_row: '' },
    ];
    const fallback = await api('POST', '/api/planning-matrix/preview', { token: 'tok-planner', body: { xlsxBase64: base64 } });
    expect(fallback.json.chauffeursVerdwenen).toEqual([{ naam: 'Chauffeur B', laatste: '2030-08-03' }]);
  });

  it('preview meldt Excel-"ziek" zonder geregistreerde ziekteperiode, en zwijgt mét', async () => {
    const base64 = await bouwXlsx([
      ['datum', 'dagtype', 'Chauffeur A', 'Chauffeur B', 'aantal'],
      [serial('2030-08-03'), 'W', 'ziek', '14', 1],
    ]);
    const zonder = await api('POST', '/api/planning-matrix/preview', { token: 'tok-planner', body: { xlsxBase64: base64 } });
    expect(zonder.status).toBe(200);
    expect(zonder.json.ziekTeRegistreren).toEqual([{ userId: '3', naam: 'Chauffeur A', van: '2030-08-03', tot: '2030-08-03', dagen: 1, actief: true, ambigu: false }]);

    mem.leave = [
      { id: 'l-z', userId: '3', startDate: '2030-08-01', endDate: '2030-08-10', type: 'ziekte', status: 'approved', comment: '', createdAt: '2030-07-30T06:00:00Z', decidedAt: '2030-07-30T06:00:00Z' },
    ];
    const met = await api('POST', '/api/planning-matrix/preview', { token: 'tok-planner', body: { xlsxBase64: base64 } });
    expect(met.json.ziekTeRegistreren).toEqual([]);
  });

  it('GET /api/coverage-expectation-check vindt structurele afwijkingen (en is staf-only)', async () => {
    mem.planningMatrix = [
      { id: 'm-a', source_date: '2030-09-01', day_type: 'school', assignments: { 'Chauffeur A': '2101', 'Chauffeur B': '2515' }, raw_row: '' },
      { id: 'm-b', source_date: '2030-09-02', day_type: 'school', assignments: { 'Chauffeur A': '2101', 'Chauffeur B': '2515' }, raw_row: '' },
    ];
    mem.coverageExpectations = { school: ['2101', '2114'] };
    const res = await api('GET', '/api/coverage-expectation-check?from=2030-09-01&to=2030-09-30', { token: 'tok-planner' });
    expect(res.status).toBe(200);
    expect(res.json.afwijkingen).toEqual([
      { dayType: 'school', dagen: 2, nooitGereden: ['2114'], nietVerwacht: [{ code: '2515', dagen: 2 }] },
    ]);
    const verboden = await api('GET', '/api/coverage-expectation-check?from=2030-09-01&to=2030-09-30', { token: 'tok-a' });
    expect(verboden.status).toBe(403);
  });

  it('GET /api/ziekte-zonder-registratie kijkt alleen vooruit', async () => {
    mem.planningMatrix = [
      { id: 'm-verleden', source_date: '2020-01-01', day_type: '', assignments: { 'Chauffeur A': 'ziek' }, raw_row: '' },
      { id: 'm-toekomst', source_date: '2030-09-01', day_type: '', assignments: { 'Chauffeur A': 'ziek' }, raw_row: '' },
    ];
    const res = await api('GET', '/api/ziekte-zonder-registratie', { token: 'tok-planner' });
    expect(res.status).toBe(200);
    expect(res.json.reeksen).toEqual([{ userId: '3', naam: 'Chauffeur A', van: '2030-09-01', tot: '2030-09-01', dagen: 1, actief: true, ambigu: false }]);
  });

  it('GET /api/planning-presence geeft per gematchte chauffeur de laatste datum in de matrix', async () => {
    const res = await api('GET', '/api/planning-presence', { token: 'tok-planner' });
    expect(res.status).toBe(200);
    expect(res.json.van).toBe('2026-07-01');
    expect(res.json.tot).toBe('2026-07-08');
    const perUser = Object.fromEntries(res.json.perUser.map((p: { userId: string; laatste: string }) => [p.userId, p.laatste]));
    // Ook een afwezigheidscel (bv) telt als "komt voor in de planning".
    expect(perUser['3']).toBe('2026-07-08');
    expect(perUser['4']).toBe('2026-07-08');
  });
});

describe('telegram-webhook — secret, koppeling en commando\'s', () => {
  const verzonden: Array<{ chatId: string; tekst: string; knoppen?: Array<Array<{ tekst: string; data: string }>> }> = [];
  const webhook = (body: unknown, secretHeader?: string) =>
    api('POST', '/api/telegram/webhook', {
      body,
      headers: secretHeader === undefined ? {} : { 'X-Telegram-Bot-Api-Secret-Token': secretHeader },
    });

  beforeEach(async () => {
    const { zetTelegramVerzenderVoorTests } = await import('../api/telegram');
    verzonden.length = 0;
    zetTelegramVerzenderVoorTests(async (v: any) => { verzonden.push(v); return true; });
    process.env.TELEGRAM_WEBHOOK_SECRET = 'test-secret';
    process.env.TELEGRAM_CHAT_ID = '777';
    delete process.env.TELEGRAM_BOT_TOKEN; // answerCallbackQuery wordt dan een no-op
  });

  afterAll(async () => {
    const { zetTelegramVerzenderVoorTests } = await import('../api/telegram');
    zetTelegramVerzenderVoorTests(null);
    delete process.env.TELEGRAM_WEBHOOK_SECRET;
    delete process.env.TELEGRAM_CHAT_ID;
  });

  it('weigert zonder (juiste) secret-header, en is dicht zonder geconfigureerd secret', async () => {
    expect((await webhook({ message: {} }, 'fout-secret')).status).toBe(401);
    expect((await webhook({ message: {} })).status).toBe(401);
    delete process.env.TELEGRAM_WEBHOOK_SECRET;
    expect((await webhook({ message: {} }, 'wat-dan-ook')).status).toBe(401);
  });

  it('toont bij /start de chat-id zolang er geen chat gekoppeld is, en negeert andere afzenders stil', async () => {
    delete process.env.TELEGRAM_CHAT_ID;
    const res = await webhook({ message: { chat: { id: 12345 }, text: '/start' } }, 'test-secret');
    expect(res.status).toBe(200);
    expect(verzonden).toHaveLength(1);
    expect(verzonden[0].chatId).toBe('12345');
    expect(verzonden[0].tekst).toContain('12345');
    expect(verzonden[0].tekst).toContain('TELEGRAM_CHAT_ID');

    // Mét gekoppelde chat: een vreemde afzender krijgt niets — ook geen /start.
    process.env.TELEGRAM_CHAT_ID = '777';
    verzonden.length = 0;
    await webhook({ message: { chat: { id: 999 }, text: '/start' } }, 'test-secret');
    await webhook({ message: { chat: { id: 999 }, text: '/gaten' } }, 'test-secret');
    expect(verzonden).toHaveLength(0);
  });

  it('/gaten antwoordt met de openstaande diensten en kandidaten-knoppen', async () => {
    const vandaag = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Brussels' });
    mem.planningMatrix = [
      { id: 'm-nu', source_date: vandaag, day_type: 'week', assignments: { 'Chauffeur A': '12', 'Chauffeur B': 'vrij' }, raw_row: '' },
    ];
    mem.coverageExpectations = { week: ['12', '11'] };
    const res = await webhook({ message: { chat: { id: 777 }, text: '/gaten' } }, 'test-secret');
    expect(res.status).toBe(200);
    expect(verzonden).toHaveLength(1);
    expect(verzonden[0].chatId).toBe('777');
    expect(verzonden[0].tekst).toContain('1 openstaande dienst');
    expect(verzonden[0].tekst).toContain('11');
    expect(verzonden[0].knoppen?.flat().map((k) => k.data)).toEqual([`adv|${vandaag}|11`]);
  });

  it('kandidaten-knop stuurt het invaladvies voor dat gat', async () => {
    const vandaag = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Brussels' });
    mem.planningMatrix = [
      { id: 'm-nu', source_date: vandaag, day_type: 'week', assignments: { 'Chauffeur A': '12', 'Chauffeur B': 'vrij' }, raw_row: '' },
    ];
    mem.coverageExpectations = { week: ['12', '11'] };
    const res = await webhook({
      callback_query: { id: 'cb1', data: `adv|${vandaag}|11`, message: { chat: { id: 777 } } },
    }, 'test-secret');
    expect(res.status).toBe(200);
    expect(verzonden).toHaveLength(1);
    expect(verzonden[0].tekst).toContain('Dienst 11');
    // Chauffeur B staat op "vrij" en hoort in het advies voor te komen.
    expect(verzonden[0].tekst).toContain('Chauffeur B');
  });

  it('/dienst toont de tijden uit het Dienstoverzicht, of legt een planningscode uit', async () => {
    mem.planningCodes = [{ code: 'bv', category: 'leave', description: 'Betaald verlof', countsAsShift: false, isPaidAbsence: true, isDayOff: false }];
    await webhook({ message: { chat: { id: 777 }, text: '/dienst 12' } }, 'test-secret');
    expect(verzonden[0].tekst).toContain('Dienst 12');
    expect(verzonden[0].tekst).toContain('08:00');
    verzonden.length = 0;
    await webhook({ message: { chat: { id: 777 }, text: '/dienst bv' } }, 'test-secret');
    expect(verzonden[0].tekst).toContain('planningscode');
    verzonden.length = 0;
    await webhook({ message: { chat: { id: 777 }, text: '/dienst 9999' } }, 'test-secret');
    expect(verzonden[0].tekst).toContain('niet in het Dienstoverzicht');
  });

  it('/wie toont wie de dienst rijdt in de komende week (ruil-correcte planning)', async () => {
    const vandaag = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Brussels' });
    mem.planning = [
      { id: 'p-1', driverId: '3', date: vandaag, line: '12', startTime: '08:00', endTime: '16:00' },
      { id: 'p-2', driverId: '4', date: '2020-01-01', line: '12', startTime: '08:00', endTime: '16:00' },
    ];
    await webhook({ message: { chat: { id: 777 }, text: '/wie 12' } }, 'test-secret');
    expect(verzonden[0].tekst).toContain('Chauffeur A');
    // De oude rij van Chauffeur B valt buiten het venster.
    expect(verzonden[0].tekst).not.toContain('Chauffeur B');
  });

  it('/rooster vraagt om verduidelijking bij meerdere matches en toont anders de week', async () => {
    const vandaag = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Brussels' });
    mem.planning = [
      { id: 'p-1', driverId: '3', date: vandaag, line: '12', startTime: '08:00', endTime: '16:00' },
    ];
    mem.planningMatrix = [
      { id: 'm-morgen', source_date: new Date(Date.parse(`${vandaag}T00:00:00Z`) + 86400000).toISOString().slice(0, 10), day_type: '', assignments: { 'Chauffeur A': 'vrij' }, raw_row: '' },
    ];
    await webhook({ message: { chat: { id: 777 }, text: '/rooster chauffeur' } }, 'test-secret');
    expect(verzonden[0].tekst).toContain('Meerdere chauffeurs');
    verzonden.length = 0;
    await webhook({ message: { chat: { id: 777 }, text: '/rooster chauffeur a' } }, 'test-secret');
    expect(verzonden[0].tekst).toContain('Chauffeur A');
    expect(verzonden[0].tekst).toContain('12 (08:00\u201316:00)');
    expect(verzonden[0].tekst).toContain('vrij');
  });

  it('/ziekmeld toont de interpretatie met bevestigknop, en de knop registreert echt', async () => {
    const vandaag = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Brussels' });
    const morgen = new Date(Date.parse(`${vandaag}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
    mem.leave = [];
    await webhook({ message: { chat: { id: 777 }, text: '/ziekmeld chauffeur a t/m morgen' } }, 'test-secret');
    expect(verzonden[0].tekst).toContain('Ziek melden');
    expect(verzonden[0].tekst).toContain('Chauffeur A');
    const knop = verzonden[0].knoppen?.flat().find((k) => k.data.startsWith('zm|'));
    expect(knop?.data).toBe(`zm|3|${vandaag}|${morgen}`);

    verzonden.length = 0;
    await webhook({ callback_query: { id: 'cb-zm', data: knop!.data, message: { chat: { id: 777 } } } }, 'test-secret');
    expect(verzonden[0].tekst).toContain('Ziek gemeld');
    const record = mem.leave.find((l: any) => l.type === 'ziekte' && String(l.userId) === '3');
    expect(record).toMatchObject({ status: 'approved', startDate: vandaag, endDate: morgen });
    // Meerdere matches → verduidelijking, geen knop.
    verzonden.length = 0;
    mem.leave = [];
    await webhook({ message: { chat: { id: 777 }, text: '/ziekmeld chauffeur' } }, 'test-secret');
    expect(verzonden[0].tekst).toContain('Meerdere chauffeurs');
  });

  it('verlof-goedkeurknop: bevestiging eerst, daarna echte beslissing via de kern', async () => {
    mem.leave = [
      { id: 'lv-1', userId: '3', startDate: '2030-10-01', endDate: '2030-10-03', type: 'betaald_verlof', status: 'pending', comment: '', createdAt: '2030-09-01T08:00:00Z' },
    ];
    await webhook({ callback_query: { id: 'cb1', data: 'lv|lv-1|approved', message: { chat: { id: 777 } } } }, 'test-secret');
    expect(verzonden[0].tekst).toContain('goedkeuren');
    const bevestig = verzonden[0].knoppen?.flat().find((k) => k.data === 'lv2|lv-1|approved');
    expect(bevestig).toBeTruthy();

    verzonden.length = 0;
    await webhook({ callback_query: { id: 'cb2', data: 'lv2|lv-1|approved', message: { chat: { id: 777 } } } }, 'test-secret');
    expect(verzonden[0].tekst).toContain('Verlof goedgekeurd');
    expect(mem.leave.find((l: any) => l.id === 'lv-1')?.status).toBe('approved');
    // Nogmaals beslissen ketst af op de concurrency-guard (ifStatus pending).
    verzonden.length = 0;
    await webhook({ callback_query: { id: 'cb3', data: 'lv2|lv-1|approved', message: { chat: { id: 777 } } } }, 'test-secret');
    expect(verzonden[0].tekst).toContain('intussen al');
  });

  it('toewijzen-knop: bevestiging eerst, daarna echte toewijzing via de kern', async () => {
    mem.planningMatrix = [
      { id: 'm-wt', source_date: '2030-08-03', day_type: 'W', assignments: { 'Chauffeur A': '12', 'Chauffeur B': 'vrij' }, raw_row: '' },
    ];
    mem.planning = [{ id: 'p-a', driverId: '3', date: '2030-08-03', line: '12', startTime: '08:00', endTime: '16:00' }];
    await webhook({ callback_query: { id: 'cb4', data: 'wt|2030-08-03|11|4', message: { chat: { id: 777 } } } }, 'test-secret');
    const bevestig = verzonden[0].knoppen?.flat().find((k) => k.data === 'wt2|2030-08-03|11|4');
    expect(bevestig).toBeTruthy();

    verzonden.length = 0;
    await webhook({ callback_query: { id: 'cb5', data: 'wt2|2030-08-03|11|4', message: { chat: { id: 777 } } } }, 'test-secret');
    expect(verzonden[0].tekst).toContain('toegewezen aan');
    expect(verzonden[0].tekst).toContain('Chauffeur B');
    expect(mem.planning.some((r: any) => r.line === '11' && String(r.driverId) === '4' && r.date === '2030-08-03')).toBe(true);
    expect(mem.planningMatrix[0].assignments['Chauffeur B']).toBe('11');
  });

  it('vrije tekst gaat naar de assistent (zonder sleutel: nette uitlegzin)', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    await webhook({ message: { chat: { id: 777 }, text: 'wie kan er zaterdag rijden?' } }, 'test-secret');
    expect(verzonden[0].tekst).toContain('nog niet geactiveerd');
  });

  it('briefing-cron is dicht zonder cron-secret', async () => {
    const res = await api('GET', '/api/cron/telegram-briefing', {});
    expect(res.status).toBe(401);
  });

  it('parseDagAanduiding: jaargrens-rol, kalender-echtheid en weekdagen', async () => {
    const { parseDagAanduiding } = await import('../api/telegram');
    // Zonder jaar rolt een verleden datum naar volgend jaar (december-case).
    expect(parseDagAanduiding('03/01', '2026-12-28')).toBe('2027-01-03');
    expect(parseDagAanduiding('29/12', '2026-12-28')).toBe('2026-12-29');
    // Onbestaande datums zijn null, geen "Invalid Date"-weergave verderop.
    expect(parseDagAanduiding('31/02', '2026-08-23')).toBeNull();
    expect(parseDagAanduiding('2026-02-31', '2026-08-23')).toBeNull();
    // Weekdag = eerstvolgende (2026-08-23 is een zondag).
    expect(parseDagAanduiding('vrijdag', '2026-08-23')).toBe('2026-08-28');
    expect(parseDagAanduiding('zondag', '2026-08-23')).toBe('2026-08-23');
    expect(parseDagAanduiding('morgen', '2026-08-23')).toBe('2026-08-24');
  });

  it('/ziekmeld zonder argument stuurt een hulptekst die Telegram-HTML overleeft', async () => {
    await webhook({ message: { chat: { id: 777 }, text: '/ziekmeld' } }, 'test-secret');
    expect(verzonden).toHaveLength(1);
    expect(verzonden[0].tekst).toContain('Gebruik');
    // Geen rauwe tags — die laten Telegram het hele bericht weigeren.
    expect(verzonden[0].tekst).not.toMatch(/<naam>|<dag>/);
  });

  it('zm-knop van gisteren registreert vanaf vandaag, niet met terugwerkende kracht', async () => {
    const vandaag = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Brussels' });
    const morgen = new Date(Date.parse(`${vandaag}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
    const gisteren = new Date(Date.parse(`${vandaag}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);
    mem.leave = [];
    await webhook({ callback_query: { id: 'cb-oud', data: `zm|3|${gisteren}|${morgen}`, message: { chat: { id: 777 } } } }, 'test-secret');
    const record = mem.leave.find((l: any) => l.type === 'ziekte' && String(l.userId) === '3');
    expect(record).toMatchObject({ startDate: vandaag, endDate: morgen });
    expect(verzonden[0].tekst).toContain('start bijgesteld naar vandaag');
  });

  it('/gaten escapet dienstcodes zodat één rare code het bericht niet sloopt', async () => {
    const vandaag = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Brussels' });
    mem.planningMatrix = [
      { id: 'm-esc', source_date: vandaag, day_type: 'week', assignments: { 'Chauffeur A': '12' }, raw_row: '' },
    ];
    mem.coverageExpectations = { week: ['12', '11<x>'] };
    await webhook({ message: { chat: { id: 777 }, text: '/gaten' } }, 'test-secret');
    expect(verzonden[0].tekst).toContain('11&lt;x&gt;');
    expect(verzonden[0].tekst).not.toContain('11<x>');
  });

  it('/ziek somt de actuele ziekmeldingen op', async () => {
    const vandaag = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Brussels' });
    mem.leave = [
      { id: 'l-z', userId: '3', startDate: vandaag, endDate: vandaag, type: 'ziekte', status: 'approved', comment: '', createdAt: '2026-08-01T06:00:00Z', decidedAt: '2026-08-01T06:00:00Z' },
    ];
    await webhook({ message: { chat: { id: 777 }, text: '/ziek' } }, 'test-secret');
    expect(verzonden).toHaveLength(1);
    expect(verzonden[0].tekst).toContain('Chauffeur A');
  });
});

describe('verbeterronde 22-08 — voorstel, batch-advies en maandoverzicht', () => {
  it('GET /api/coverage-expectations/voorstel stelt lijsten voor uit de praktijk (staf-only)', async () => {
    mem.planningMatrix = [
      { id: 'v-1', source_date: '2030-09-01', day_type: 'school', assignments: { 'Chauffeur A': '2101', 'Chauffeur B': 'vrij' }, raw_row: '' },
      { id: 'v-2', source_date: '2030-09-02', day_type: 'school', assignments: { 'Chauffeur A': '2101', 'Chauffeur B': '2102' }, raw_row: '' },
    ];
    const res = await api('GET', '/api/coverage-expectations/voorstel?from=2030-09-01&to=2030-09-30', { token: 'tok-planner' });
    expect(res.status).toBe(200);
    expect(res.json.voorstellen).toEqual([
      { dayType: 'school', dagen: 2, codes: [{ code: '2101', dagen: 2 }, { code: '2102', dagen: 1 }] },
    ]);
    expect((await api('GET', '/api/coverage-expectations/voorstel?from=2030-09-01&to=2030-09-30', { token: 'tok-a' })).status).toBe(403);
  });

  it('POST /api/coverage-advisor/batch geeft per gat de passende topkandidaten in één call', async () => {
    // Chauffeur A rijdt dienst 12 op 01-09; Chauffeur B is vrij → kandidaat
    // voor het gat op dienst 11 diezelfde dag.
    mem.planning = [
      { id: 'b-1', driverId: '3', date: '2030-09-01', line: '12', startTime: '08:00', endTime: '16:00' },
    ];
    const res = await api('POST', '/api/coverage-advisor/batch', {
      token: 'tok-planner',
      body: { items: [{ date: '2030-09-01', code: '11' }, { date: '2030-09-02', code: '12' }] },
    });
    expect(res.status).toBe(200);
    expect(res.json.items).toHaveLength(2);
    const eerste = res.json.items[0];
    expect(eerste.date).toBe('2030-09-01');
    expect(eerste.passend.map((k: any) => k.name)).toContain('Chauffeur B');
    // Ongeldige input wordt geweigerd.
    expect((await api('POST', '/api/coverage-advisor/batch', { token: 'tok-planner', body: { items: [] } })).status).toBe(400);
  });

  it('GET /api/month-planning?format=summary telt zoals het xlsx-tabblad en weigert chauffeurs', async () => {
    mem.planningMatrix = [
      { id: 's-1', source_date: '2030-09-01', day_type: 'school', assignments: { 'Chauffeur A': '12', 'Chauffeur B': 'vrij' }, raw_row: '' },
    ];
    mem.planningCodes = [{ code: 'vrij', category: 'absence', description: 'Geen dienst', countsAsShift: false, isPaidAbsence: false, isDayOff: true }];
    const res = await api('GET', '/api/month-planning?month=2030-09&format=summary', { token: 'tok-planner' });
    expect(res.status).toBe(200);
    const rijA = res.json.rijen.find((r: any) => r.naam === 'Chauffeur A');
    const rijB = res.json.rijen.find((r: any) => r.naam === 'Chauffeur B');
    expect(rijA).toMatchObject({ diensten: 1, dagen: 1 });
    expect(rijB).toMatchObject({ vrij: 1, dagen: 1 });
    expect((await api('GET', '/api/month-planning?month=2030-09&format=summary', { token: 'tok-a' })).status).toBe(403);
  });
});
