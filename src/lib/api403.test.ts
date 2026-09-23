import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./supabase', () => ({ supabase: null }));
vi.mock('./device', () => ({ deviceHeaders: () => ({}) }));
vi.mock('./liveSignaal', () => ({ markeerEigenSchrijfactie: () => {} }));

import { apiFetch } from './api';
import { schrijffout } from './fouten';

/**
 * Een gewone 403 op een actie (geen toestel-, 2FA- of deactivatiecode) draagt
 * zijn status, zodat de schrijffout de reden van de server en de vervolgstap
 * toont (3D.2: "Verwijderen van dienst 2515 is mislukt: …").
 */
describe('apiFetch, 403 op een actie', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('gooit een fout met status 403 en de servermelding; de schrijffout noemt reden en vervolgstap', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'Diensten verwijderen is alleen beschikbaar voor admins.' }), { status: 403, headers: { 'Content-Type': 'application/json' } })));
    const fout = await apiFetch('/api/services', { method: 'POST', body: '[]' }).catch((e: unknown) => e);
    expect(fout).toBeInstanceOf(Error);
    expect((fout as { status?: number }).status).toBe(403);
    const tekst = schrijffout('Verwijderen van dienst 2515', fout);
    expect(tekst).toContain('Verwijderen van dienst 2515');
    expect(tekst).toContain('Diensten verwijderen is alleen beschikbaar voor admins.');
    expect(tekst).toContain('geen rechten');
  });
});
