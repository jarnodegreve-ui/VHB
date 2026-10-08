// @vitest-environment node
import { api, mem } from './harnas';
import { describe, expect, it } from 'vitest';

/**
 * Mededeling voor de chauffeurs (08-10): één app_settings-sleutel, lezen voor
 * iedereen die ingelogd is, schrijven alleen voor admins.
 */
describe('mededeling voor de chauffeurs', () => {
  it('geeft zonder instelling "geen mededeling" terug, voor elke rol', async () => {
    const res = await api('GET', '/api/mededeling', { token: 'tok-a' });
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ tekst: '', tonen: false, tot: null });
    expect((await api('GET', '/api/mededeling', { token: 'tok-planner' })).status).toBe(200);
    expect((await api('GET', '/api/mededeling')).status).toBe(401);
  });

  it('alleen een admin zet ze; een chauffeur en een planner krijgen 403', async () => {
    const body = { tekst: 'Opgelet, vanaf 11/12 nieuwe dienstregeling!', tonen: true, tot: '2026-12-11' };
    expect((await api('PUT', '/api/mededeling', { token: 'tok-a', body })).status).toBe(403);
    expect((await api('PUT', '/api/mededeling', { token: 'tok-planner', body })).status).toBe(403);
    const res = await api('PUT', '/api/mededeling', { token: 'tok-admin', body });
    expect(res.status).toBe(200);
    expect(res.json).toEqual(body);
    expect(mem.appSettings.ritblad_mededeling).toEqual(body);
    expect((await api('GET', '/api/mededeling', { token: 'tok-a' })).json).toEqual(body);
    expect(mem.activity.some((a: any) => a.action === 'Mededeling voor de chauffeurs aangezet' && /11\/12\/2026/.test(a.message))).toBe(true);
  });

  it('weigert tonen zonder tekst, een te lange tekst en een ongeldige dag (400 met veldfout)', async () => {
    const zonderTekst = await api('PUT', '/api/mededeling', { token: 'tok-admin', body: { tekst: '  ', tonen: true } });
    expect(zonderTekst.status).toBe(400);
    expect(zonderTekst.json.veldfouten.tekst).toMatch(/tekst/);
    expect((await api('PUT', '/api/mededeling', { token: 'tok-admin', body: { tekst: 'x'.repeat(161), tonen: false } })).status).toBe(400);
    expect((await api('PUT', '/api/mededeling', { token: 'tok-admin', body: { tekst: 'Ok', tonen: true, tot: '11/12/2026' } })).status).toBe(400);
    // Uit met een lege tekst mag: dat is de uitgangsstand.
    expect((await api('PUT', '/api/mededeling', { token: 'tok-admin', body: { tekst: '', tonen: false } })).status).toBe(200);
  });

  it('logt het uitzetten, niet een tekstcorrectie van een uitgezette mededeling', async () => {
    await api('PUT', '/api/mededeling', { token: 'tok-admin', body: { tekst: 'Aan', tonen: true } });
    mem.activity = [];
    await api('PUT', '/api/mededeling', { token: 'tok-admin', body: { tekst: 'Uit', tonen: false } });
    expect(mem.activity.map((a: any) => a.action)).toEqual(['Mededeling voor de chauffeurs uitgezet']);
    mem.activity = [];
    await api('PUT', '/api/mededeling', { token: 'tok-admin', body: { tekst: 'Uit, andere tekst', tonen: false } });
    expect(mem.activity).toHaveLength(0);
  });
});
