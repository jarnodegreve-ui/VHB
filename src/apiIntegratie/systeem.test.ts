// @vitest-environment node
import {
  api,
  mem,
} from './harnas';
import { describe, it, expect } from 'vitest';

describe('bulk-wipe-vangrail (PR #71)', () => {
  it('weigert een save die >50% van de diensten zou verwijderen (409)', async () => {
    // Als admin: een planner strandt eerder al op de verwijder-grens (403, zie hieronder).
    const res = await api('POST', '/api/services', { token: 'tok-admin', body: mem.services.slice(0, 2) });
    expect(res.status).toBe(409);
    expect(mem.services).toHaveLength(6);
  });

  it('laat een planner geen dienst verwijderen, ook niet via een handgemaakte POST (403); een admin wel', async () => {
    // UI-recht en serverrecht moeten overeenkomen (Jarno 22-09): het rijmenu
    // toont "Verwijderen" alleen voor admins, dus de server weigert een
    // planner-save waarin een dienst ontbreekt, ongeacht hoe die tot stand kwam.
    const zonderLaatste = mem.services.slice(0, -1);
    const planner = await api('POST', '/api/services', { token: 'tok-planner', body: zonderLaatste });
    expect(planner.status).toBe(403);
    expect(planner.json.error).toMatch(/alleen beschikbaar voor admins/);
    expect(mem.services).toHaveLength(6); // niks gewijzigd

    // Wijzigen en toevoegen blijft voor een planner gewoon kunnen.
    const gewijzigd = await api('POST', '/api/services', { token: 'tok-planner', body: mem.services.map((s: any, i: number) => (i === 0 ? { ...s, startTime: '06:15' } : { ...s })) });
    expect(gewijzigd.status).toBe(200);
    expect(mem.services).toHaveLength(6);

    const admin = await api('POST', '/api/services', { token: 'tok-admin', body: mem.services.slice(0, -1) });
    expect(admin.status).toBe(200);
    expect(mem.services).toHaveLength(5);
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
  it('accepteert een foutmelding zonder authenticatie (200 + referentie) en kapt lange velden af', async () => {
    const res = await api('POST', '/api/client-errors', {
      body: { message: 'x'.repeat(5000), source: 'error-toast', url: '/dashboard' },
    });
    expect(res.status).toBe(200);
    expect(mem.clientErrors).toHaveLength(1);
    expect(mem.clientErrors[0].message).toHaveLength(1000);
    // Korte referentie voor het foutscherm = begin van de fingerprint in hoofdletters.
    expect(res.json).toEqual({ ok: true, referentie: String(mem.clientErrors[0].fingerprint).slice(0, 6).toUpperCase() });
    expect(res.json.referentie).toMatch(/^[0-9A-F]{6}$/);
  });

  it('weigert een te grote body (413), eigen 32 kB-limiet i.p.v. de globale 5 MB (controle 05-09, nr. 31)', async () => {
    const teGroot = await api('POST', '/api/client-errors', { body: { message: 'x'.repeat(40_000) } });
    expect(teGroot.status).toBe(413);
    expect(mem.clientErrors).toHaveLength(0);
    // Een gewone melding (ruim onder de limiet) blijft gewoon binnenkomen.
    expect((await api('POST', '/api/client-errors', { body: { message: 'boem', stack: 'y'.repeat(3000) } })).status).toBe(200);
  });

  it('weigert een melding zonder message (400)', async () => {
    const res = await api('POST', '/api/client-errors', { body: { source: 'window.onerror' } });
    expect(res.status).toBe(400);
    expect(mem.clientErrors).toHaveLength(0);
  });

  it('vervangt een opgegeven userId door de échte gebruiker bij een geldig token', async () => {
    const res = await api('POST', '/api/client-errors', { token: 'tok-a', body: { message: 'boem', userId: '1' } });
    expect(res.status).toBe(200);
    expect(mem.clientErrors[0].userId).toBe('3');
  });

  it('markeert een userId zonder geldige sessie als onbevestigd', async () => {
    const res = await api('POST', '/api/client-errors', { body: { message: 'boem', userId: '1' } });
    expect(res.status).toBe(200);
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

describe('foutgroepen (fingerprint, groepering, status, regressie)', () => {
  const meld = (message: string, extra: Record<string, unknown> = {}) =>
    api('POST', '/api/client-errors', { body: { message, source: 'error-toast', release: 'aaa1111', view: 'verlof', breadcrumbs: [{ t: '2026-09-06T10:00:00Z', soort: 'navigatie', tekst: 'verlof' }], ...extra } });

  it('geeft elk rapport een fingerprint en context; dezelfde fout met andere getallen deelt de fingerprint', async () => {
    await meld('Kon dienst 2515 niet laden');
    await meld('Kon dienst 2607 niet laden');
    await meld('Iets heel anders');
    expect(mem.clientErrors).toHaveLength(3);
    expect(mem.clientErrors[0].fingerprint).toMatch(/^[0-9a-f]{16}$/);
    expect(mem.clientErrors[0].fingerprint).toBe(mem.clientErrors[1].fingerprint);
    expect(mem.clientErrors[2].fingerprint).not.toBe(mem.clientErrors[0].fingerprint);
    expect(mem.clientErrors[0].release).toBe('aaa1111');
    expect(mem.clientErrors[0].view).toBe('verlof');
    expect(mem.clientErrors[0].breadcrumbs).toEqual([{ t: '2026-09-06T10:00:00Z', soort: 'navigatie', tekst: 'verlof' }]);
  });

  it('neemt de rol van de sessie, niet van de client', async () => {
    await api('POST', '/api/client-errors', { token: 'tok-a', body: { message: 'boem', role: 'admin' } });
    expect(mem.clientErrors[0].role).toBe('chauffeur');
    // Zonder sessie: de opgegeven rol blijft (afgekapt), zoals de rest van de context.
    await api('POST', '/api/client-errors', { body: { message: 'boem2', role: 'planner' } });
    expect(mem.clientErrors[1].role).toBe('planner');
  });

  it('GET ?groepeer=1 groepeert per fingerprint (admin), met aantal, releases en unieke gebruikers', async () => {
    await meld('Kon dienst 1 niet laden');
    await meld('Kon dienst 2 niet laden', { release: 'bbb2222' });
    await api('POST', '/api/client-errors', { token: 'tok-a', body: { message: 'Kon dienst 3 niet laden', source: 'error-toast', release: 'bbb2222' } });
    await meld('Iets anders');
    expect((await api('GET', '/api/client-errors?groepeer=1', { token: 'tok-planner' })).status).toBe(403);
    const res = await api('GET', '/api/client-errors?groepeer=1', { token: 'tok-admin' });
    expect(res.status).toBe(200);
    expect(res.json.statusBeschikbaar).toBe(true);
    expect(res.json.groepen).toHaveLength(2);
    const g = res.json.groepen.find((x: any) => x.message.startsWith('Kon dienst'));
    expect(g.aantal).toBe(3);
    expect(g.releases.sort()).toEqual(['aaa1111', 'bbb2222']);
    expect(g.gebruikers).toBe(1); // alleen chauffeur A had een sessie
    expect(g.status).toBe('open');
    expect(g.laatsteVoorval.message).toBeUndefined();
    expect(g.laatsteVoorval.release).toBe('bbb2222');
    // De platte lijst blijft bestaan.
    expect(Array.isArray((await api('GET', '/api/client-errors', { token: 'tok-admin' })).json)).toBe(true);
  });

  it('status zetten (admin) en automatisch heropenen bij een regressie in een andere release', async () => {
    await meld('Kon dienst 1 niet laden');
    const fp = mem.clientErrors[0].fingerprint;
    expect((await api('POST', '/api/client-errors/status', { token: 'tok-planner', body: { fingerprint: fp, status: 'opgelost' } })).status).toBe(403);
    expect((await api('POST', '/api/client-errors/status', { token: 'tok-admin', body: { fingerprint: fp, status: 'kapot' } })).status).toBe(400);
    expect((await api('POST', '/api/client-errors/status', { token: 'tok-admin', body: { fingerprint: 'nope', status: 'opgelost' } })).status).toBe(400);
    const zet = await api('POST', '/api/client-errors/status', { token: 'tok-admin', body: { fingerprint: fp, status: 'opgelost', release: 'aaa1111' } });
    expect(zet.status).toBe(200);
    expect(mem.clientErrorStatus[0]).toMatchObject({ fingerprint: fp, status: 'opgelost', release: 'aaa1111', door: '1' });
    expect(mem.activity.some((a) => a.action === 'Foutgroep opgelost')).toBe(true);

    // Zelfde release opnieuw: blijft opgelost (fix nog niet uitgerold).
    await meld('Kon dienst 2 niet laden');
    let groepen = (await api('GET', '/api/client-errors?groepeer=1', { token: 'tok-admin' })).json.groepen;
    expect(groepen[0].status).toBe('opgelost');
    expect(groepen[0].regressie).toBe(false);

    // Andere release, ná het oplossen: regressie → open, en teruggeschreven.
    await meld('Kon dienst 3 niet laden', { release: 'ccc3333' });
    groepen = (await api('GET', '/api/client-errors?groepeer=1', { token: 'tok-admin' })).json.groepen;
    expect(groepen[0].status).toBe('open');
    expect(groepen[0].regressie).toBe(true);
    expect(mem.clientErrorStatus.find((s: any) => s.fingerprint === fp)).toMatchObject({ status: 'open', door: 'regressie' });
  });

  it('zonder de statustabel: groepen blijven werken, statusacties geven 503 met migratie-hint', async () => {
    mem.clientErrorStatusTabel = false;
    await meld('Kon dienst 1 niet laden');
    const res = await api('GET', '/api/client-errors?groepeer=1', { token: 'tok-admin' });
    expect(res.status).toBe(200);
    expect(res.json.statusBeschikbaar).toBe(false);
    expect(res.json.groepen).toHaveLength(1);
    const zet = await api('POST', '/api/client-errors/status', { token: 'tok-admin', body: { fingerprint: mem.clientErrors[0].fingerprint, status: 'opgelost' } });
    expect(zet.status).toBe(503);
    expect(zet.json.error).toContain('2026-09-06_client_errors_groepen.sql');
  });

  it('de weekmail slaat genegeerde groepen over', async () => {
    await meld('Ruisfout 1');
    const fp = mem.clientErrors[0].fingerprint;
    mem.clientErrorStatus = [{ fingerprint: fp, status: 'genegeerd', release: null, bijgewerktOp: null, door: '1' }];
    await meld('Echte fout');
    const res = await api('GET', '/api/cron/error-digest', { headers: { Authorization: 'Bearer test-cron-secret' } });
    expect(res.status).toBe(200);
    expect(res.json.count).toBe(1);
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

  it('houdt de limiet per token bij, een andere gebruiker wordt niet geraakt', async () => {
    for (let i = 0; i < 55; i++) await api('GET', '/api/leave', { token: 'tok-a' });
    // tok-b heeft een eigen budget en mag gewoon door.
    const res = await api('GET', '/api/leave', { token: 'tok-b' });
    expect(res.status).toBe(200);
  });
});

// Controle-ronde 09-09, nr. 4: de knop "Schrijftest" in Systeemstatus riep
// /api/test aan, een route die nooit bestond (structureel 404).
describe('POST /api/health/echo (schrijftest in Systeemstatus)', () => {
  it('admin krijgt een echo, er wordt niets geschreven', async () => {
    const voor = JSON.stringify(mem.activity);
    const res = await api('POST', '/api/health/echo', { token: 'tok-admin', body: { test: true } });
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ status: 'ok', ontvangen: true });
    expect(JSON.stringify(mem.activity)).toBe(voor);
  });

  it('alleen voor admins, en niet zonder aanmelding', async () => {
    expect((await api('POST', '/api/health/echo', { token: 'tok-planner', body: { test: true } })).status).toBe(403);
    expect((await api('POST', '/api/health/echo', { token: 'tok-a', body: { test: true } })).status).toBe(403);
    expect((await api('POST', '/api/health/echo', { body: { test: true } })).status).toBe(401);
  });

  it('de oude route bestaat niet (dat was de bug)', async () => {
    expect((await api('POST', '/api/test', { token: 'tok-admin', body: { test: true } })).status).toBe(404);
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

describe('beveiliging (controleronde 16-08)', () => {
  it('A, /api/planning is per chauffeur gescoped, ook met een vreemde ?driverId', async () => {
    const eigen = await api('GET', '/api/planning', { token: 'tok-a' });
    expect(eigen.status).toBe(200);
    expect(eigen.json.every((s: any) => String(s.driverId) === '3')).toBe(true);
    expect(eigen.json.some((s: any) => String(s.driverId) === '4')).toBe(false);
    // Bypass-poging: kale fetch met andermans id → nog steeds alleen eigen rijen.
    const vreemd = await api('GET', '/api/planning?driverId=4', { token: 'tok-a' });
    expect(vreemd.json.every((s: any) => String(s.driverId) === '3')).toBe(true);
  });

  it('A, planner/admin mag wél gericht een andere chauffeur opvragen', async () => {
    const res = await api('GET', '/api/planning?driverId=4', { token: 'tok-planner' });
    expect(res.status).toBe(200);
    expect(res.json.every((s: any) => String(s.driverId) === '4')).toBe(true);
  });

  it('E, push-subscribe weigert een intern/loopback-endpoint (SSRF)', async () => {
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

  it('C, nieuw toestel boven de bovengrens wordt geweigerd, een bekend token nog wel', async () => {
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

  it('D, decidedAt is server-gezaghebbend bij een afwijzing via de array-route', async () => {
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

  it('D, decidedAt is server-gezaghebbend bij goedkeuring via de array-route', async () => {
    // Force-approve pending→approved via de array-route mag alleen admin.
    const all = mem.swaps.map((s: any) => (s.id === 's-1' ? { ...s, status: 'approved', decidedAt: '2000-01-01T00:00:00Z' } : s));
    const res = await api('POST', '/api/swaps', { token: 'tok-admin', body: all });
    expect(res.status).toBe(200);
    const saved = mem.swaps.find((s: any) => s.id === 's-1');
    expect(saved.status).toBe('approved');
    expect(saved.decidedAt).not.toBe('2000-01-01T00:00:00Z');
    expect(Date.parse(saved.decidedAt)).toBeGreaterThan(Date.parse('2026-01-01'));
  });

  it('G, het bedrijfsbrede noodbericht is rate-limited', async () => {
    let last: any;
    for (let i = 0; i < 8; i++) {
      last = await api('POST', '/api/send-urgent-update-email', { token: 'tok-admin', body: { update: { title: 't', content: 'c' } } });
    }
    expect(last.status).toBe(429); // max 6/uur → de latere calls worden geweigerd
  });
});

describe('gedeelde zod-contracten (shared/schemas): 400 met veldfouten', () => {
  const REV = 'x-record-revision';
  const revVan = async (pad: string, token: string, id: string): Promise<string> => {
    const res = await api('GET', pad, { token });
    return res.json.find((r: any) => String(r.id) === id)._rev as string;
  };

  it('POST /api/users/one: ongeldige e-mail → veldfouten.email (NL) + details, niets opgeslagen', async () => {
    const res = await api('POST', '/api/users/one', { token: 'tok-admin', body: { name: 'Nieuw', email: 'nieuw@', role: 'chauffeur' } });
    expect(res.status).toBe(400);
    expect(res.json).toEqual({
      error: 'Ongeldige invoer',
      details: 'e-mailadres: Vul een geldig e-mailadres in',
      veldfouten: { email: 'Vul een geldig e-mailadres in' },
    });
    expect(mem.users).toHaveLength(4);
  });

  it('POST /api/users/one: meerdere fouten tegelijk, elk bij zijn veld', async () => {
    const res = await api('POST', '/api/users/one', { token: 'tok-admin', body: { name: '', role: 'baas', phone: 'bel me', password: 'kort', startDate: '1-1-2020' } });
    expect(res.status).toBe(400);
    expect(res.json.veldfouten).toEqual({
      name: 'Vul een naam in',
      role: 'Kies een rol',
      phone: 'Vul een geldig telefoonnummer in',
      password: 'Gebruik een wachtwoord van minstens 10 tekens',
      startDate: 'Vul een geldige datum in (dd/mm/jjjj)',
    });
  });

  it('PUT /api/users/:id: veldfouten gaan vóór de revisie-check en wijzigen niets', async () => {
    const rev = await revVan('/api/users', 'tok-admin', '3');
    const res = await api('PUT', '/api/users/3', { token: 'tok-admin', body: { ...mem.users[2], verlofBudget: -3 }, headers: { [REV]: rev } });
    expect(res.status).toBe(400);
    expect(res.json.veldfouten).toEqual({ verlofBudget: 'Verlofbudget kan niet negatief zijn' });
    expect(mem.users.find((u: any) => u.id === '3')?.verlofBudget).toBeUndefined();
    // Zonder revisie-header maar mét geldige body blijft de bestaande 400 (header ontbreekt).
    const zonder = await api('PUT', '/api/users/3', { token: 'tok-admin', body: { ...mem.users[2] } });
    expect(zonder.status).toBe(400);
    expect(zonder.json.veldfouten).toBeUndefined();
  });

  it('POST /api/users (lijst): rij-fout → veldfouten["<rij>.<veld>"] en details noemt de rij', async () => {
    const res = await api('POST', '/api/users', {
      token: 'tok-admin',
      body: [...mem.users, { id: '9', name: 'Nieuwe Collega', email: 'nieuw@vhb.be', role: 'chauffeur', isActive: true, password: 'kort' }],
    });
    expect(res.status).toBe(400);
    expect(res.json.veldfouten).toEqual({ '4.password': 'Gebruik een wachtwoord van minstens 10 tekens' });
    expect(res.json.details).toBe('Rij 5 (Nieuwe Collega): wachtwoord: Gebruik een wachtwoord van minstens 10 tekens');
    expect(mem.users).toHaveLength(4);
  });

  it('POST /api/diversions/one: einddatum vóór startdatum → veldfouten.endDate', async () => {
    const res = await api('POST', '/api/diversions/one', { token: 'tok-planner', body: { line: '1', title: 'X', description: 'y', startDate: '2026-09-10', endDate: '2026-09-01' } });
    expect(res.status).toBe(400);
    expect(res.json.veldfouten).toEqual({ endDate: 'Einddatum ligt vóór begindatum' });
    expect(res.json.details).toBe('einddatum: Einddatum ligt vóór begindatum');
    expect(mem.diversions).toHaveLength(0);
  });

  it('PUT /api/diversions/:id: ongeldige startdatum → veldfouten.startDate, record ongewijzigd', async () => {
    mem.diversions = [{ id: 'o-1', line: '12', title: 'Werken N70', description: 'Omrijden via …', startDate: '2026-07-01' }];
    const rev = await revVan('/api/diversions', 'tok-planner', 'o-1');
    const res = await api('PUT', '/api/diversions/o-1', { token: 'tok-planner', body: { ...mem.diversions[0], startDate: '2026-02-30' }, headers: { [REV]: rev } });
    expect(res.status).toBe(400);
    expect(res.json.veldfouten).toEqual({ startDate: 'Vul een geldige startdatum in (dd/mm/jjjj)' });
    expect(mem.diversions[0].startDate).toBe('2026-07-01');
  });

  it('POST /api/updates/one: lege inhoud → veldfouten.content; POST /api/updates (lijst): onbekende categorie → 400, niets gewist', async () => {
    const een = await api('POST', '/api/updates/one', { token: 'tok-planner', body: { date: '2026-09-03', title: 'X', content: '   ' } });
    expect(een.status).toBe(400);
    expect(een.json.veldfouten).toEqual({ content: 'Schrijf een bericht' });
    expect(mem.updates).toHaveLength(6);

    const lijst = await api('POST', '/api/updates', { token: 'tok-planner', body: [{ ...mem.updates[0], category: 'geheim' }, ...mem.updates.slice(1)] });
    expect(lijst.status).toBe(400);
    expect(lijst.json.veldfouten).toEqual({ '0.category': 'Onbekende categorie' });
    expect(lijst.json.details).toBe('Rij 1 (Update 1): categorie: Onbekende categorie');
    expect(mem.updates).toHaveLength(6);
  });

  it('bestaande 409-paden blijven: geldige body, bezet e-mailadres → 409 (geen 400)', async () => {
    const res = await api('POST', '/api/users/one', { token: 'tok-admin', body: { name: 'Dubbel', email: 'a@vhb.be' } });
    expect(res.status).toBe(409);
    expect(res.json.conflict).toBe('email');
  });
});

describe('onderhoudsmodus (/api/onderhoud + schrijfblok)', () => {
  const ONDERHOUD = { actief: true, tekst: 'Even geduld, we migreren.', schrijfblok: true };

  it('publieke route geeft zonder sessie alleen actief + tekst', async () => {
    mem.appSettings.onderhoud = ONDERHOUD;
    const res = await api('GET', '/api/onderhoud/publiek', { device: null });
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ actief: true, tekst: 'Even geduld, we migreren.' });
  });

  it('zonder instelling: geen onderhoud (fail-open), leesbaar voor elke ingelogde rol', async () => {
    const res = await api('GET', '/api/onderhoud', { token: 'tok-a' });
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ actief: false, tekst: '', schrijfblok: false });
    expect((await api('GET', '/api/onderhoud', { device: null })).status).toBe(401);
  });

  it('PUT is admin-only, valideert met het gedeelde schema en logt de omslag', async () => {
    expect((await api('PUT', '/api/onderhoud', { token: 'tok-planner', body: ONDERHOUD })).status).toBe(403);
    const ongeldig = await api('PUT', '/api/onderhoud', { token: 'tok-admin', body: { actief: 'ja' } });
    expect(ongeldig.status).toBe(400);
    expect(ongeldig.json.veldfouten.actief).toBe('Kies aan of uit');
    const aan = await api('PUT', '/api/onderhoud', { token: 'tok-admin', body: ONDERHOUD });
    expect(aan.status).toBe(200);
    expect(aan.json).toEqual(ONDERHOUD);
    expect(mem.appSettings.onderhoud).toEqual(ONDERHOUD);
    expect(mem.activity.map((a) => a.action)).toEqual(['Onderhoudsmodus aangezet']);
    // Tekstcorrectie zonder omslag: geen extra logregel.
    await api('PUT', '/api/onderhoud', { token: 'tok-admin', body: { ...ONDERHOUD, tekst: 'Bijna klaar.' } });
    expect(mem.activity).toHaveLength(1);
    const uit = await api('PUT', '/api/onderhoud', { token: 'tok-admin', body: { actief: false, tekst: '', schrijfblok: false } });
    expect(uit.status).toBe(200);
    expect(mem.activity.map((a) => a.action)).toEqual(['Onderhoudsmodus aangezet', 'Onderhoudsmodus uitgezet']);
  });

  it('schrijfblok: schrijfacties van niet-admins krijgen 503 met code onderhoud, lezen en admins gaan door', async () => {
    mem.appSettings.onderhoud = ONDERHOUD;
    const chauffeur = await api('POST', '/api/meldingen/gelezen', { token: 'tok-a', body: {} });
    expect(chauffeur.status).toBe(503);
    expect(chauffeur.json).toEqual({ error: 'Het portaal is even in onderhoud, probeer het zo opnieuw.', code: 'onderhoud' });
    expect((await api('POST', '/api/meldingen/gelezen', { token: 'tok-planner', body: {} })).status).toBe(503);
    expect((await api('PATCH', '/api/me/voorkeuren', { token: 'tok-a', body: { dashboard: { verborgen: [], volgorde: [] } } })).status).toBe(503);
    // Lezen blijft werken.
    expect((await api('GET', '/api/leave', { token: 'tok-a' })).status).toBe(200);
    // Admin kan door (en dus ook de modus weer uitzetten).
    expect((await api('POST', '/api/meldingen/gelezen', { token: 'tok-admin', body: {} })).status).toBe(200);
    const uit = await api('PUT', '/api/onderhoud', { token: 'tok-admin', body: { ...ONDERHOUD, actief: false } });
    expect(uit.status).toBe(200);
    expect((await api('POST', '/api/meldingen/gelezen', { token: 'tok-a', body: {} })).status).toBe(200);
  });

  it('schrijfblok: sessie-boekhouding, toestelregistratie en foutrapportage blijven open', async () => {
    mem.appSettings.onderhoud = ONDERHOUD;
    expect((await api('POST', '/api/auth/session', { token: 'tok-a', body: { action: 'resume' } })).status).not.toBe(503);
    mem.devices = [];
    const registratie = await api('POST', '/api/devices/register', { token: 'tok-a', device: 'dev-1', body: { name: 'iPhone · app' } });
    expect(registratie.status).toBe(200);
    const fout = await api('POST', '/api/client-errors', { token: 'tok-a', device: 'dev-1', body: { message: 'boem' } });
    expect(fout.status).toBe(200);
  });

  it('alleen een banner (zonder schrijfblok) blokkeert niets', async () => {
    mem.appSettings.onderhoud = { ...ONDERHOUD, schrijfblok: false };
    expect((await api('POST', '/api/meldingen/gelezen', { token: 'tok-a', body: {} })).status).toBe(200);
  });

  it('een verlopen `tot` zet het onderhoud vanzelf uit', async () => {
    mem.appSettings.onderhoud = { ...ONDERHOUD, tot: '2020-01-01T00:00:00+01:00' };
    expect((await api('GET', '/api/onderhoud/publiek', { device: null })).json.actief).toBe(false);
    expect((await api('POST', '/api/meldingen/gelezen', { token: 'tok-a', body: {} })).status).toBe(200);
  });
});
