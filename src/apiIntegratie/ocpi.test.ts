// @vitest-environment node
import {
  api,
} from './harnas';
import { describe, it, expect } from 'vitest';

describe('OCPI 2.2.1, gehoste endpoints + handshake-auth', () => {
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

describe('OCPI-client, paginatie (parseNextLink)', () => {
  it('haalt de next-URL uit de Link-header', async () => {
    const { parseNextLink } = await import('../../api/ocpi');
    expect(parseNextLink('<https://kempower.io/api/ocpi/2.2.1/locations?offset=100&limit=100>; rel="next"'))
      .toBe('https://kempower.io/api/ocpi/2.2.1/locations?offset=100&limit=100');
  });
  it('geeft null als er geen next is', async () => {
    const { parseNextLink } = await import('../../api/ocpi');
    expect(parseNextLink('<https://x/y?offset=0>; rel="prev"')).toBeNull();
    expect(parseNextLink(null)).toBeNull();
    expect(parseNextLink('')).toBeNull();
  });
  it('kiest de next-link uit meerdere', async () => {
    const { parseNextLink } = await import('../../api/ocpi');
    expect(parseNextLink('<https://a>; rel="prev", <https://b>; rel="next"')).toBe('https://b');
  });
});

describe('OCPI-sync, autorisatie', () => {
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

describe('OCPI-dashboard, autorisatie', () => {
  it('GET /api/ocpi/dashboard is admin-only', async () => {
    expect((await api('GET', '/api/ocpi/dashboard', { token: 'tok-planner' })).status).toBe(403);
    expect((await api('GET', '/api/ocpi/dashboard', { token: 'tok-a' })).status).toBe(403);
  });
  // Laadpalen-herwerking 08-09: maand, historiek, sessies, dag en export
  // dragen dezelfde admin-guard; de periode-validatie vuurt vóór de database
  // (db is in de tests een leeg object → 500 als de guard níét zou vuren).
  it('de rapportage-endpoints zijn admin-only', async () => {
    for (const pad of ['/api/ocpi/maand', '/api/ocpi/historiek', '/api/ocpi/sessies', '/api/ocpi/dag?dag=2026-08-01', '/api/ocpi/export']) {
      expect((await api('GET', pad, { token: 'tok-planner' })).status, pad).toBe(403);
      expect((await api('GET', pad, { token: 'tok-a' })).status, pad).toBe(403);
      expect((await api('GET', pad)).status, pad).toBe(401);
    }
  });
  it('valideert de periode vóór de database wordt aangesproken', async () => {
    expect((await api('GET', '/api/ocpi/maand?maand=2026-13', { token: 'tok-admin' })).status).toBe(400);
    expect((await api('GET', '/api/ocpi/sessies?van=2026-02-30&tot=2026-03-01', { token: 'tok-admin' })).status).toBe(400);
    expect((await api('GET', '/api/ocpi/sessies?van=2026-03-02&tot=2026-03-01', { token: 'tok-admin' })).status).toBe(400);
    expect((await api('GET', '/api/ocpi/export?van=2025-01-01&tot=2026-03-01', { token: 'tok-admin' })).status).toBe(400);
    expect((await api('GET', '/api/ocpi/dag?dag=gisteren', { token: 'tok-admin' })).status).toBe(400);
  });
});

describe('OCPI leesPeriode / vorigePeriode (zuiver)', () => {
  it('leest maand, vrije periode en de standaard (lopende maand)', async () => {
    const { leesPeriode, vorigePeriode } = await import('../../api/ocpi');
    const q = (o: Record<string, string>) => (k: string) => o[k] ?? '';
    expect(leesPeriode(q({ maand: '2026-08' }))).toEqual({ ok: true, van: '2026-08-01', tot: '2026-08-31', maand: '2026-08' });
    expect(leesPeriode(q({ van: '2026-08-01', tot: '2026-08-31' }))).toEqual({ ok: true, van: '2026-08-01', tot: '2026-08-31', maand: '2026-08' });
    expect(leesPeriode(q({ van: '2026-08-04', tot: '2026-08-05' }))).toEqual({ ok: true, van: '2026-08-04', tot: '2026-08-05', maand: null });
    expect(leesPeriode(q({ van: '2026-08-05', tot: '2026-08-04' }))).toMatchObject({ ok: false });
    expect(leesPeriode(q({ van: '2025-01-01', tot: '2026-02-01' }))).toMatchObject({ ok: false });
    expect(leesPeriode(q({}))).toMatchObject({ ok: true, maand: expect.stringMatching(/^\d{4}-\d{2}$/) });
    expect(vorigePeriode('2026-01-01', '2026-01-31', '2026-01')).toEqual({ van: '2025-12-01', tot: '2025-12-31', maand: '2025-12' });
    expect(vorigePeriode('2026-08-04', '2026-08-05', null)).toEqual({ van: '2026-08-02', tot: '2026-08-03', maand: null });
  });
  it('vergelijkt een lopende maand met dezelfde dagen van de vorige maand', async () => {
    const { vorigePeriode } = await import('../../api/ocpi');
    // Halverwege september: vergelijk met 1 t/m 15 augustus, niet met heel augustus.
    expect(vorigePeriode('2026-09-01', '2026-09-30', '2026-09', '2026-09-15')).toEqual({ van: '2026-08-01', tot: '2026-08-15', maand: null });
    // Ook op de laatste dag van de lopende maand blijft de basis even lang (1 t/m 30 augustus).
    expect(vorigePeriode('2026-09-01', '2026-09-30', '2026-09', '2026-09-30')).toEqual({ van: '2026-08-01', tot: '2026-08-30', maand: null });
    // Afgesloten maand: volledige vorige maand, ook al is het vandaag.
    expect(vorigePeriode('2026-08-01', '2026-08-31', '2026-08', '2026-09-15')).toEqual({ van: '2026-07-01', tot: '2026-07-31', maand: '2026-07' });
    // Kortere vorige maand: op 30 maart is 1 t/m 28 februari gewoon heel februari.
    expect(vorigePeriode('2026-03-01', '2026-03-31', '2026-03', '2026-03-30')).toEqual({ van: '2026-02-01', tot: '2026-02-28', maand: '2026-02' });
  });
});
