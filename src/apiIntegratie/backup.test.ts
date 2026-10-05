// @vitest-environment node
import {
  api,
  mem,
} from './harnas';
import { describe, it, expect } from 'vitest';

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

// De vorm die getPlanningCodesData geeft: zes velden, geen id.
const PLANNINGSCODES_ZOALS_DE_EXPORT = [
  { code: 'bv', category: 'leave', description: 'Betaald verlof', countsAsShift: false, isPaidAbsence: true, isDayOff: false },
  { code: 'vrij', category: 'absence', description: 'Geen dienst', countsAsShift: false, isPaidAbsence: false, isDayOff: true },
];

describe('droge herstelrun (POST /api/restore?droog=1)', () => {
  const backup = (collections: any) => ({ exportedAt: new Date().toISOString(), version: 2, collections });

  it('zegt wat een herstel zou doen en schrijft niets', async () => {
    const voor = { services: mem.services.length, leave: mem.leave.length, log: mem.activity.length };
    const res = await api('POST', '/api/restore?droog=1', {
      token: 'tok-admin',
      body: backup({ users: mem.users, services: mem.services.slice(0, 1), leave: [] }),
    });
    expect(res.status).toBe(200);
    expect(res.json.droog).toBe(true);
    const services = res.json.plan.regels.find((r: any) => r.collectie === 'services');
    expect(services).toMatchObject({ backup: 1, live: voor.services, weg: voor.services - 1, blijft: 1 });
    expect(res.json.plan.blokkades).toEqual([]);
    // Niets geschreven, ook geen logregel.
    expect(mem.services).toHaveLength(voor.services);
    expect(mem.leave).toHaveLength(voor.leave);
    expect(mem.activity).toHaveLength(voor.log);
  });

  it('is alleen voor admins', async () => {
    const res = await api('POST', '/api/restore?droog=1', { token: 'tok-planner', body: backup({ users: mem.users }) });
    expect(res.status).toBe(403);
  });

  it('een back-up met dubbele id’s wordt ook bij een echt herstel geweigerd, vóór er iets geschreven is', async () => {
    const voor = mem.services.length;
    const dubbel = [mem.services[0], mem.services[0]];
    const droog = await api('POST', '/api/restore?droog=1', { token: 'tok-admin', body: backup({ users: mem.users, services: dubbel }) });
    expect(droog.json.plan.blokkades.join(' ')).toMatch(/dubbele id/);
    const echt = await api('POST', '/api/restore', { token: 'tok-admin', body: backup({ users: mem.users, services: dubbel }) });
    expect(echt.status).toBe(400);
    expect(echt.json.error).toMatch(/dubbele id/);
    expect(mem.services).toHaveLength(voor);
  });

  // Regressie 01-10: de planningscodes hebben geen id (de code is de sleutel),
  // de droge run eiste er een. Elke back-up van het portaal zelf was daardoor
  // geblokkeerd, in de restore-proef en bij een echt herstel.
  it('de back-up die het portaal zelf maakt is zonder blokkade terug te zetten, ook de planningscodes', async () => {
    mem.planningCodes = PLANNINGSCODES_ZOALS_DE_EXPORT;
    const eigen = await api('GET', '/api/backup', { token: 'tok-admin' });
    const droog = await api('POST', '/api/restore?droog=1', { token: 'tok-admin', body: eigen.json });
    expect(droog.json.plan.blokkades).toEqual([]);
    expect(droog.json.plan.regels.find((r: any) => r.collectie === 'planningCodes')).toMatchObject({ backup: 2, live: 2, erbij: 0, weg: 0, blijft: 2 });
    const echt = await api('POST', '/api/restore', { token: 'tok-admin', body: eigen.json });
    expect(echt.status).toBe(200);
    expect(echt.json.summary.planningCodes).toBe(2);
  });
});

describe('maandelijkse restore-proef (cron)', () => {
  const CRON = { headers: { Authorization: 'Bearer test-cron-secret' } };

  it('slaagt op de back-up van de nachtcron, met planningscodes erin, en mailt dan niets', async () => {
    mem.planningCodes = PLANNINGSCODES_ZOALS_DE_EXPORT;
    expect((await api('GET', '/api/cron/backup', CRON)).status).toBe(200);
    mem.emailsSent = [];
    const res = await api('GET', '/api/cron/restore-proef', CRON);
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ success: true, filename: mem.laatsteBackup!.filename });
    expect(mem.emailsSent).toHaveLength(0);
    expect(mem.hartslagen.at(-1)).toMatchObject({ naam: 'restore-proef' });
    expect(mem.hartslagen.at(-1)!.details).toContain('droge herstelrun geslaagd');
  });

  it('alarmeert per mail als de laatste back-up niet te herstellen is', async () => {
    await api('GET', '/api/cron/backup', CRON);
    const payload = JSON.parse(mem.laatsteBackup!.body);
    payload.collections.services = [payload.collections.services[0], payload.collections.services[0]];
    mem.laatsteBackup = { filename: mem.laatsteBackup!.filename, body: JSON.stringify(payload) };
    mem.emailsSent = [];
    const res = await api('GET', '/api/cron/restore-proef', CRON);
    expect(res.json.success).toBe(false);
    expect(res.json.issues).toEqual(["droge herstelrun: 'services': 1 dubbele id (d1)"]);
    expect(mem.emailsSent.filter((e) => e.context === 'restore-proef')).toHaveLength(1);
    expect(mem.hartslagen.at(-1)!.details).toMatch(/^GEFAALD: /);
  });

  it('is alleen voor de cron (401 zonder secret)', async () => {
    expect((await api('GET', '/api/cron/restore-proef')).status).toBe(401);
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

  // Tegenlezing 29-09, punt 3: de opruiming van de bijlagen praat met
  // Storage en het log. Blijft daar iets hangen, dan mag dat nooit lezen als
  // een mislukte back-up.
  it('schrijft de heartbeat van de back-up vóór de opruiming van de bijlagen begint', async () => {
    const res = await api('GET', '/api/cron/backup', { headers: { Authorization: 'Bearer test-cron-secret' } });
    expect(res.status).toBe(200);
    expect(mem.cronVolgorde[0]).toBe('heartbeat: backup');
    expect(mem.cronVolgorde.indexOf('heartbeat: backup')).toBeLessThan(mem.cronVolgorde.indexOf('opruiming: diversions'));
    // Niets opgeruimd en niets overgeslagen: geen aparte regel over de bijlagen.
    expect(mem.cronVolgorde).not.toContain('heartbeat: bijlagen-opruim');
  });

  it('Storage hangt tijdens de opruiming: de cron antwoordt binnen het budget, met heartbeat en een eigen regel over de bijlagen', async () => {
    const vorig = process.env.BIJLAGEN_OPRUIM_BUDGET_MS;
    process.env.BIJLAGEN_OPRUIM_BUDGET_MS = '150';
    mem.opslagHangt = true;
    try {
      const start = performance.now();
      const res = await api('GET', '/api/cron/backup', { headers: { Authorization: 'Bearer test-cron-secret' } });
      expect(performance.now() - start).toBeLessThan(5_000);
      expect(res.status).toBe(200);
      expect(res.json.success).toBe(true);
      expect(mem.storedBackups).toHaveLength(1);
      expect(res.json.bijlagen).toEqual({ omleidingen: 0, updates: 0, overgeslagen: ['omleidingen: geen tijd meer', 'updates: geen tijd meer'] });
      expect(mem.cronVolgorde).toEqual(['heartbeat: backup', 'opruiming: diversions', 'heartbeat: bijlagen-opruim']);
      const regel = mem.activity.find((a) => a.action === 'Cron geslaagd: bijlagen-opruim');
      expect(regel.message).toBe('Verweesde bijlagen: 0 van omleidingen en 0 van updates opgeruimd, overgeslagen: omleidingen: geen tijd meer; updates: geen tijd meer.');
    } finally {
      if (vorig === undefined) delete process.env.BIJLAGEN_OPRUIM_BUDGET_MS;
      else process.env.BIJLAGEN_OPRUIM_BUDGET_MS = vorig;
    }
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

describe('planning-import, herstelpunt en terugzetten (controle-ronde 27-08, nr. 56 + 25)', () => {
  const buildXlsx = async (dag: string, codeA: string, codeB = '') => {
    const XLSX = await import('xlsx');
    const serial = (iso: string) => Math.round((Date.parse(`${iso}T00:00:00Z`) - Date.parse('1899-12-30T00:00:00Z')) / 86400000);
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([
      ['datum', 'dagtype', 'Chauffeur A', 'Chauffeur B', 'aantal'],
      [serial(dag), 'W', codeA, codeB, [codeA, codeB].filter(Boolean).length],
    ]);
    XLSX.utils.book_append_sheet(wb, ws, 'praktijk');
    return (XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer).toString('base64');
  };
  const oudeStand = () => {
    mem.leave = [];
    mem.swaps = [];
    mem.planningMatrix = [{ id: 'm-oud', source_date: '2030-08-02', day_type: 'W', assignments: { '3': '12' }, raw_row: {} }];
    mem.planning = [{ id: 'sh-oud', driverId: '3', date: '2030-08-02', line: '12' }];
  };

  it('een import legt een herstelpunt vast en een admin zet de vorige stand terug', async () => {
    oudeStand();
    const res = await api('POST', '/api/planning-matrix/import', { token: 'tok-planner', body: { xlsxBase64: await buildXlsx('2030-08-03', '14'), filename: 'aug.xlsx' } });
    expect(res.status).toBe(200);
    expect(mem.importHistory).toHaveLength(1);
    expect(mem.importHistory[0]).toMatchObject({ filename: 'aug.xlsx', importedBy: 'Pieter Planner' });
    expect(mem.importHistory[0].snapshotPath).toBeTruthy();
    expect(mem.planningMatrix.map((r: any) => r.source_date)).toEqual(['2030-08-03']);

    const terug = await api('POST', '/api/planning-matrix/restore', { token: 'tok-admin', body: { historyId: mem.importHistory[0].id } });
    expect(terug.status).toBe(200);
    expect(terug.json).toMatchObject({ success: true, matrixDagen: 1, roosterregels: 1 });
    expect(mem.planningMatrix.map((r: any) => r.source_date)).toEqual(['2030-08-02']);
    expect(mem.planning.map((r: any) => r.id)).toEqual(['sh-oud']);
  });

  it('terugzetten is admin-only en faalt netjes op een onbekende of snapshot-loze import', async () => {
    oudeStand();
    expect((await api('POST', '/api/planning-matrix/restore', { token: 'tok-planner', body: { historyId: 'x' } })).status).toBe(403);
    expect((await api('POST', '/api/planning-matrix/restore', { token: 'tok-admin', body: {} })).status).toBe(400);
    expect((await api('POST', '/api/planning-matrix/restore', { token: 'tok-admin', body: { historyId: 'bestaat-niet' } })).status).toBe(404);
    mem.importHistory = [{ id: 'oud-zonder', createdAt: '2026-08-01T08:00:00Z', snapshotPath: null }];
    const zonder = await api('POST', '/api/planning-matrix/restore', { token: 'tok-admin', body: { historyId: 'oud-zonder' } });
    expect(zonder.status).toBe(400);
    expect(String(zonder.json.error)).toContain('geen herstelpunt');
  });

  it('weigert een leeg herstelpunt (stand van vóór de allereerste import)', async () => {
    mem.leave = []; mem.swaps = []; mem.planningMatrix = []; mem.planning = [];
    const res = await api('POST', '/api/planning-matrix/import', { token: 'tok-planner', body: { xlsxBase64: await buildXlsx('2030-08-03', '14') } });
    expect(res.status).toBe(200);
    const terug = await api('POST', '/api/planning-matrix/restore', { token: 'tok-admin', body: { historyId: mem.importHistory[0].id } });
    expect(terug.status).toBe(400);
    expect(String(terug.json.error)).toContain('leeg');
    expect(mem.planningMatrix).toHaveLength(1); // niets teruggezet
  });

  it('een mislukte historiek-insert komt als waarschuwing terug (import zelf slaagt)', async () => {
    oudeStand();
    mem.historiekFaalt = true;
    const res = await api('POST', '/api/planning-matrix/import', { token: 'tok-planner', body: { xlsxBase64: await buildXlsx('2030-08-03', '14') } });
    expect(res.status).toBe(200);
    expect(res.json.success).toBe(true);
    expect(mem.planningMatrix.map((r: any) => r.source_date)).toEqual(['2030-08-03']);
    expect((res.json.parserWaarschuwingen as string[]).some((w) => w.includes('Herstelpunt niet vastgelegd'))).toBe(true);
    expect(mem.importHistory).toHaveLength(0);
  });
});
