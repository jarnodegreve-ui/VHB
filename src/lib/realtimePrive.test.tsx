// @vitest-environment jsdom
import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * Het live-updates-kanaal is privé (beveiligingstest 07-11, keuze 2) en valt
 * één keer terug op een publieke join als Realtime de privé-join weigert
 * (policy nog niet gedraaid). Een nagebootste Supabase-client legt vast welke
 * kanalen er geopend en weer verwijderd worden.
 */
type NepKanaal = { naam: string; opts: unknown; cb?: (status: string, err?: Error) => void; on: () => NepKanaal; subscribe: (cb: (status: string, err?: Error) => void) => NepKanaal };
const sb = vi.hoisted(() => {
  const kanalen: NepKanaal[] = [];
  const verwijderd: NepKanaal[] = [];
  const client = {
    channel(naam: string, opts?: unknown) {
      const k = { naam, opts } as NepKanaal;
      k.on = () => k;
      k.subscribe = (cb) => { k.cb = cb; return k; };
      kanalen.push(k);
      return k;
    },
    removeChannel: async (k: NepKanaal) => { verwijderd.push(k); return 'ok'; },
    from: () => ({ select: () => ({ limit: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }) }),
  };
  return { kanalen, verwijderd, client };
});
vi.mock('./supabase', () => ({ supabase: sb.client, isSupabaseConfigured: true }));

import { KANAAL, useRealtimeSync } from './realtime';

const refetchers = () => ({ refetchLeave: vi.fn(), refetchSwaps: vi.fn(), refetchDiversions: vi.fn(), refetchUpdates: vi.fn(), refetchAll: vi.fn() });
const even = () => new Promise((r) => setTimeout(r, 0));

afterEach(() => { sb.kanalen.length = 0; sb.verwijderd.length = 0; });

describe('useRealtimeSync: privé-kanaal met terugval', () => {
  it('opent het kanaal privé', () => {
    const { unmount } = renderHook(() => useRealtimeSync(true, refetchers()));
    expect(sb.kanalen).toHaveLength(1);
    expect(sb.kanalen[0].naam).toBe(KANAAL);
    expect(sb.kanalen[0].opts).toEqual({ config: { private: true } });
    unmount();
  });

  it('valt bij een geweigerde privé-join één keer terug op een publiek kanaal, en daarna niet meer', async () => {
    const r = refetchers();
    const { unmount } = renderHook(() => useRealtimeSync(true, r));
    sb.kanalen[0].cb!('CHANNEL_ERROR', new Error('Unauthorized: You do not have permissions to read from this Channel topic'));
    await even();
    // Het geweigerde kanaal is eerst echt weg (anders gaf channel() het terug).
    expect(sb.verwijderd).toEqual([sb.kanalen[0]]);
    expect(sb.kanalen).toHaveLength(2);
    expect(sb.kanalen[1].naam).toBe(KANAAL);
    expect(sb.kanalen[1].opts).toBeUndefined();
    // De eerste aansluiting telt als de start: geen catch-up.
    sb.kanalen[1].cb!('SUBSCRIBED');
    await even();
    expect(r.refetchAll).not.toHaveBeenCalled();
    // Weigert ook de publieke join (project op "private only"), dan stopt het hier.
    sb.kanalen[1].cb!('CHANNEL_ERROR', new Error('Unauthorized'));
    await even();
    expect(sb.kanalen).toHaveLength(2);
    unmount();
    expect(sb.verwijderd).toHaveLength(2);
  });

  it('bouwt geen terugval meer als de hook intussen afgebroken is', async () => {
    const { unmount } = renderHook(() => useRealtimeSync(true, refetchers()));
    sb.kanalen[0].cb!('CHANNEL_ERROR', new Error('Unauthorized'));
    unmount();
    await even();
    expect(sb.kanalen).toHaveLength(1);
  });

  it('een reconnect op het privé-kanaal doet gewoon de volledige catch-up', async () => {
    vi.useFakeTimers();
    try {
      const r = refetchers();
      const { unmount } = renderHook(() => useRealtimeSync(true, r));
      sb.kanalen[0].cb!('SUBSCRIBED');
      sb.kanalen[0].cb!('SUBSCRIBED');
      await vi.advanceTimersByTimeAsync(1000);
      expect(r.refetchAll).toHaveBeenCalledTimes(1);
      unmount();
    } finally {
      vi.useRealTimers();
    }
  });
});
