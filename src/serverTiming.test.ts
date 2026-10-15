// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'node:net';
import { markeer, serverTiming } from '../api/_lib/serverTiming';

let basis = '';
let server: any;
const regels: string[] = [];
let klok = 0;

beforeAll(async () => {
  const app = express();
  app.use('/api', serverTiming({ traagMs: 1500, now: () => klok, log: (r) => regels.push(r) }));
  app.get('/api/snel', (_req, res) => { klok += 12; res.json({ ok: true }); });
  app.get('/api/users/:id', (_req, res) => { klok += 2000; res.json({ ok: true }); });
  app.get('/api/feed/:token.ics', (_req, res) => { klok += 1600; res.status(500).send('stuk'); });
  // Een route achter een "middleware" die tussentijden noteert, zoals authenticate.
  app.get('/api/gemarkeerd', (_req, res) => {
    klok += 40; markeer(res, 'limiet');
    klok += 10; markeer(res, 'auth');
    klok += 900; markeer(res, 'profiel');
    klok += 50; markeer(res, 'toestel');
    klok += 700; res.json({ ok: true });
  });
  await new Promise<void>((r) => { server = app.listen(0, '127.0.0.1', () => r()); });
  basis = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => { await new Promise<void>((r) => server.close(() => r())); });

describe('serverTiming', () => {
  it('zet Server-Timing op elk antwoord en logt niets onder de drempel', async () => {
    regels.length = 0;
    const res = await fetch(`${basis}/api/snel?naam=Jan`);
    expect(res.headers.get('server-timing')).toBe('app;dur=12');
    await res.text();
    expect(regels).toEqual([]);
  });

  it('logt een traag request als één regel met het routepatroon: geen id, geen querystring', async () => {
    regels.length = 0;
    const res = await fetch(`${basis}/api/users/4711?email=jan@vhb.be`);
    expect(res.headers.get('server-timing')).toBe('app;dur=2000');
    await res.text();
    await new Promise((r) => setTimeout(r, 10));
    expect(regels).toHaveLength(1);
    expect(regels[0]).toMatch(/^\[traag\] GET \/api\/users\/:id 2000ms \| instantie \d+s, request \d+$/);
  });

  it('splitst een traag request op in de genoteerde stappen plus de route, in header én logregel', async () => {
    regels.length = 0;
    const res = await fetch(`${basis}/api/gemarkeerd`);
    expect(res.headers.get('server-timing')).toBe('app;dur=1700, limiet;dur=40, auth;dur=10, profiel;dur=900, toestel;dur=50, route;dur=700');
    await res.text();
    await new Promise((r) => setTimeout(r, 10));
    expect(regels).toHaveLength(1);
    expect(regels[0]).toMatch(/^\[traag\] GET \/api\/gemarkeerd 1700ms \| limiet 40 · auth 10 · profiel 900 · toestel 50 · route 700 \| instantie \d+s, request \d+$/);
  });

  it('markeer zonder de middleware is een no-op', async () => {
    const app = express();
    app.get('/los', (_req, res) => { markeer(res, 'auth'); res.json({ ok: true }); });
    const s: any = await new Promise((r) => { const x = app.listen(0, '127.0.0.1', () => r(x)); });
    const res = await fetch(`http://127.0.0.1:${(s.address() as AddressInfo).port}/los`);
    expect(res.status).toBe(200);
    expect(res.headers.get('server-timing')).toBeNull();
    await res.text();
    await new Promise<void>((r) => s.close(() => r()));
  });

  it('ook bij een foutstatus, en een geheim in het pad komt niet in de log', async () => {
    regels.length = 0;
    await (await fetch(`${basis}/api/feed/s3cr3t-t0ken-abcdef123456.ics`)).text();
    await new Promise((r) => setTimeout(r, 10));
    expect(regels).toHaveLength(1);
    expect(regels[0]).toMatch(/^\[traag\] GET \/api\/feed\/:token\.ics 1600ms \| instantie \d+s, request \d+$/);
  });

  it('zonder gematchte route worden id-achtige segmenten gemaskeerd', async () => {
    regels.length = 0;
    klok = 0;
    const app = express();
    let t = 0;
    app.use('/api', serverTiming({ traagMs: 0, now: () => (t += 5), log: (r) => regels.push(r) }));
    const s: any = await new Promise((r) => { const x = app.listen(0, '127.0.0.1', () => r(x)); });
    await (await fetch(`http://127.0.0.1:${(s.address() as AddressInfo).port}/api/bestaat-niet/12345/0b9f6c1e-aaaa-bbbb-cccc-1234567890ab?x=1`)).text();
    await new Promise((r) => setTimeout(r, 10));
    await new Promise<void>((r) => s.close(() => r()));
    expect(regels).toHaveLength(1);
    expect(regels[0]).toMatch(/^\[traag\] GET \/api\/bestaat-niet\/:id\/:id \d+ms \| instantie \d+s, request \d+$/);
  });
});
