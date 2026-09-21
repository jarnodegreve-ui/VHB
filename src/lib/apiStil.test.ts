import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const markeerEigenSchrijfactie = vi.fn();
vi.mock('./supabase', () => ({ supabase: null }));
vi.mock('./device', () => ({ deviceHeaders: () => ({}) }));
vi.mock('./liveSignaal', () => ({ markeerEigenSchrijfactie: () => markeerEigenSchrijfactie() }));

import { apiFetch } from './api';

/**
 * `stil` is voor achtergrondregistraties (de collega kreeg een ruilaanvraag in
 * beeld): die mogen in onderhoudsmodus geen toast geven en tellen niet als
 * eigen schrijfactie. Zonder de vlag blijft het gedrag exact wat het was.
 */
describe('apiFetch, stil', () => {
  const onderhoud = vi.fn();
  const antwoord = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

  beforeEach(() => {
    onderhoud.mockReset();
    markeerEigenSchrijfactie.mockReset();
    window.addEventListener('vhb-onderhoud', onderhoud);
  });
  afterEach(() => {
    window.removeEventListener('vhb-onderhoud', onderhoud);
    vi.unstubAllGlobals();
  });

  it('schrijfblok: gewoon = toast-event, stil = geen event; de fout komt in beide gevallen terug', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => antwoord(503, { error: 'Het portaal is even in onderhoud, probeer het zo opnieuw.', code: 'onderhoud' })));
    await expect(apiFetch('/api/swaps/w1/bekeken', { method: 'POST', stil: true })).rejects.toThrow(/onderhoud/);
    expect(onderhoud).not.toHaveBeenCalled();
    await expect(apiFetch('/api/swaps/w1', { method: 'PATCH' })).rejects.toThrow(/onderhoud/);
    expect(onderhoud).toHaveBeenCalledTimes(1);
  });

  it('een geslaagde stille POST telt niet als eigen schrijfactie, een gewone wel', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => antwoord(200, { success: true }));
    vi.stubGlobal('fetch', fetchMock);
    await apiFetch('/api/swaps/w1/bekeken', { method: 'POST', stil: true });
    expect(markeerEigenSchrijfactie).not.toHaveBeenCalled();
    // `stil` is een optie van apiFetch, geen fetch-optie.
    expect(fetchMock.mock.calls[0][1]).not.toHaveProperty('stil');
    await apiFetch('/api/swaps/w1/gezien', { method: 'POST' });
    expect(markeerEigenSchrijfactie).toHaveBeenCalledTimes(1);
  });
});
