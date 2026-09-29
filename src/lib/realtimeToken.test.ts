import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Na de code van de twee-stapsverificatie moet de socket het aal2-token
 * krijgen (supabase/2026-09-29_rls_tweede_factor.sql: de staf-tak van verlof
 * en dienstruil leest alleen nog met aal2). De aanroep mag nooit gooien: het
 * codescherm gaat hoe dan ook door, de hartslag haalt een gemist token in.
 */
const setAuth = vi.fn<(token: string) => Promise<void>>();
const client = vi.hoisted(() => ({ huidig: null as unknown }));

vi.mock('./supabase', () => ({
  get supabase() {
    return client.huidig;
  },
}));

import { ververRealtimeToken } from './realtime';

describe('ververRealtimeToken', () => {
  beforeEach(() => {
    setAuth.mockReset();
    client.huidig = { realtime: { setAuth } };
  });

  it('geeft het nieuwe token door aan de socket', () => {
    setAuth.mockResolvedValue(undefined);
    ververRealtimeToken('token-aal2');
    expect(setAuth).toHaveBeenCalledTimes(1);
    expect(setAuth).toHaveBeenCalledWith('token-aal2');
  });

  it('slikt een afgewezen belofte', async () => {
    setAuth.mockRejectedValue(new Error('socket dicht'));
    expect(() => ververRealtimeToken('token-aal2')).not.toThrow();
    await Promise.resolve();
  });

  it('gooit niet zonder client of met een client zonder realtime (mock)', () => {
    client.huidig = null;
    expect(() => ververRealtimeToken('token-aal2')).not.toThrow();
    client.huidig = {};
    expect(() => ververRealtimeToken('token-aal2')).not.toThrow();
    expect(setAuth).not.toHaveBeenCalled();
  });
});
