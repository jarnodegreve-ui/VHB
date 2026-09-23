import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../lib/supabase', () => ({ supabase: null }));
vi.mock('../lib/device', () => ({ deviceHeaders: () => ({}) }));
vi.mock('../lib/liveSignaal', () => ({ markeerEigenSchrijfactie: () => {} }));

import { apiFetch, isToestelGeblokkeerd, TOESTEL_GEBLOKKEERD } from '../lib/api';
import { laadfoutOnderdrukt } from './laadfout';

const vrij = { sessieBeeindigd: false, toestelGeblokkeerd: false };

/**
 * Een toestel dat op goedkeuring wacht kreeg rode "Kon … niet laden.
 * Controleer je verbinding."-toasts, die na de goedkeuring allemaal
 * tegelijk verschenen. De toestel-403 draagt nu een code en de laadpaden
 * zwijgen erover: het wachtscherm is de melding.
 */
describe('laadfout bij een geblokkeerd toestel', () => {
  afterEach(() => vi.unstubAllGlobals());

  it.each(['device_pending', 'device_unknown', 'device_revoked'])('apiFetch gooit bij 403 %s een fout met de toestelcode', async (code) => {
    const events: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'Dit toestel wacht op goedkeuring door de planning.', code }), { status: 403, headers: { 'Content-Type': 'application/json' } })));
    vi.stubGlobal('window', { dispatchEvent: (e: Event) => { events.push(e.type); return true; } });
    const fout = await apiFetch('/api/leave').catch((e: unknown) => e);
    expect(isToestelGeblokkeerd(fout)).toBe(true);
    expect((fout as { code?: string }).code).toBe(TOESTEL_GEBLOKKEERD);
    expect((fout as Error).message).toContain('toestel');
    expect(events).toContain('vhb-device-blocked');
  });

  it('een gewone 403 of netwerkfout is geen toestelfout', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'Geen toegang.' }), { status: 403, headers: { 'Content-Type': 'application/json' } })));
    const fout = await apiFetch('/api/leave', { method: 'POST', body: '{}' }).catch((e: unknown) => e);
    expect(isToestelGeblokkeerd(fout)).toBe(false);
    expect(isToestelGeblokkeerd(new TypeError('Failed to fetch'))).toBe(false);
    expect(isToestelGeblokkeerd(null)).toBe(false);
  });

  it('meldt een gewone laadfout, maar niet bij een toestelfout, een geblokkeerd toestel of een beëindigde sessie', () => {
    expect(laadfoutOnderdrukt(vrij, new TypeError('Failed to fetch'))).toBe(false);
    expect(laadfoutOnderdrukt(vrij)).toBe(false);
    expect(laadfoutOnderdrukt(vrij, Object.assign(new Error('Dit toestel wacht op goedkeuring.'), { code: TOESTEL_GEBLOKKEERD }))).toBe(true);
    expect(laadfoutOnderdrukt({ ...vrij, toestelGeblokkeerd: true }, new TypeError('Failed to fetch'))).toBe(true);
    expect(laadfoutOnderdrukt({ ...vrij, sessieBeeindigd: true })).toBe(true);
  });
});
