import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const rt = vi.hoisted(() => ({ aanroepen: [] as Array<{ enabled: boolean; refetchers: Record<string, unknown> }> }));
vi.mock('../lib/realtime', () => ({
  useRealtimeSync: (enabled: boolean, refetchers: Record<string, unknown>) => { rt.aanroepen.push({ enabled, refetchers }); },
}));
const meldLive = vi.hoisted(() => vi.fn());
vi.mock('../lib/liveSignaal', () => ({ meldLive }));

import type { User } from '../types';
import { useLiveUpdates, type LiveBronnen } from './useLiveUpdates';

/**
 * Welke bron na welk realtime-event opnieuw wordt opgehaald, zoals het tot
 * 07-10 in App.tsx stond. Vastgelegd per rol: het stille signaal, de dekking
 * voor staf, het planningfilter van een chauffeur en de catch-ups.
 */
type Fn = ReturnType<typeof vi.fn>;
type Bronnen = LiveBronnen & Record<keyof LiveBronnen, Fn>;
const maakBronnen = (): Bronnen => {
  const b: Record<string, Fn> = {};
  for (const k of ['fetchLeave', 'fetchSwaps', 'fetchDiversions', 'fetchUpdates', 'fetchMyNotes', 'fetchMeldingen', 'fetchPlanning', 'fetchPlanningMatrix', 'fetchPlanningMatrixHistory', 'refreshCoverageGaps', 'fetchUsers']) {
    b[k] = vi.fn(async () => undefined);
  }
  return b as unknown as Bronnen;
};
type Refetchers = {
  refetchLeave: (soort?: 'verlof' | 'ziekte') => unknown;
  refetchSwaps: () => unknown; refetchDiversions: () => unknown; refetchUpdates: () => unknown;
  refetchNotes: () => unknown; refetchMeldingen: () => unknown; meldingenUserId?: string;
  refetchPlanning: () => unknown; refetchMatrix: () => unknown; refetchAll: () => unknown;
  refetchLicht: (o: { planning: boolean }) => unknown;
};
const laatste = () => rt.aanroepen[rt.aanroepen.length - 1] as { enabled: boolean; refetchers: Refetchers };

const chauffeur = { id: '3', name: 'Chauffeur A', role: 'chauffeur' } as User;
const planner = { id: '2', name: 'Pieter Planner', role: 'planner' } as User;

beforeEach(() => { rt.aanroepen.length = 0; meldLive.mockClear(); });

describe('useLiveUpdates', () => {
  it('geeft de actief-vlag en het eigen id voor het meldingenkanaal door', () => {
    const b = maakBronnen();
    renderHook(() => useLiveUpdates(false, chauffeur, b));
    expect(laatste().enabled).toBe(false);
    expect(laatste().refetchers.meldingenUserId).toBe('3');
    renderHook(() => useLiveUpdates(true, null, b));
    expect(laatste().enabled).toBe(true);
    expect(laatste().refetchers.meldingenUserId).toBeUndefined();
  });

  it('verlof: signaal en verversen; voor staf ook de dekking', () => {
    const b = maakBronnen();
    renderHook(() => useLiveUpdates(true, chauffeur, b));
    laatste().refetchers.refetchLeave('verlof');
    expect(meldLive).toHaveBeenCalledWith('verlof');
    expect(b.fetchLeave).toHaveBeenCalledTimes(1);
    expect(b.refreshCoverageGaps).not.toHaveBeenCalled();
    const s = maakBronnen();
    renderHook(() => useLiveUpdates(true, planner, s));
    laatste().refetchers.refetchLeave();
    expect(s.fetchLeave).toHaveBeenCalledTimes(1);
    expect(s.refreshCoverageGaps).toHaveBeenCalledTimes(1);
  });

  it('ziekte is geen verlof: staf krijgt "Ziekmelding bijgewerkt", een chauffeur geen signaal', () => {
    const b = maakBronnen();
    renderHook(() => useLiveUpdates(true, chauffeur, b));
    laatste().refetchers.refetchLeave('ziekte');
    expect(meldLive).not.toHaveBeenCalled();
    expect(b.fetchLeave).toHaveBeenCalledTimes(1);
    const s = maakBronnen();
    renderHook(() => useLiveUpdates(true, planner, s));
    laatste().refetchers.refetchLeave('ziekte');
    expect(meldLive).toHaveBeenCalledWith('ziekte');
    expect(s.refreshCoverageGaps).toHaveBeenCalledTimes(1);
  });

  it('ruil, omleidingen en updates: signaal plus verversen; notities en meldingen stil', () => {
    const b = maakBronnen();
    renderHook(() => useLiveUpdates(true, chauffeur, b));
    const r = laatste().refetchers;
    r.refetchSwaps(); r.refetchDiversions(); r.refetchUpdates(); r.refetchNotes(); r.refetchMeldingen();
    expect(meldLive.mock.calls.map((c) => c[0])).toEqual(['ruil', 'omleidingen', 'updates']);
    expect(b.fetchSwaps).toHaveBeenCalledTimes(1);
    expect(b.fetchDiversions).toHaveBeenCalledWith(undefined, { silent: true });
    expect(b.fetchUpdates).toHaveBeenCalledTimes(1);
    expect(b.fetchMyNotes).toHaveBeenCalledTimes(1);
    expect(b.fetchMeldingen).toHaveBeenCalledTimes(1);
  });

  it('planning: chauffeur alleen eigen diensten en een seintje voor de Maandplanning; staf alles plus dekking en matrix', () => {
    const gezien = vi.fn();
    window.addEventListener('vhb-planning-changed', gezien);
    const b = maakBronnen();
    renderHook(() => useLiveUpdates(true, chauffeur, b));
    laatste().refetchers.refetchPlanning();
    expect(meldLive).toHaveBeenCalledWith('planning');
    expect(b.fetchPlanning).toHaveBeenCalledWith(undefined, { driverId: '3' }, { silent: true });
    expect(gezien).toHaveBeenCalledTimes(1);
    expect(b.refreshCoverageGaps).not.toHaveBeenCalled();
    laatste().refetchers.refetchMatrix();
    expect(b.fetchPlanningMatrix).not.toHaveBeenCalled();

    const s = maakBronnen();
    renderHook(() => useLiveUpdates(true, planner, s));
    laatste().refetchers.refetchPlanning();
    expect(s.fetchPlanning).toHaveBeenCalledWith(undefined, undefined, { silent: true });
    expect(s.refreshCoverageGaps).toHaveBeenCalledTimes(1);
    laatste().refetchers.refetchMatrix();
    expect(s.fetchPlanningMatrix).toHaveBeenCalledTimes(1);
    expect(s.fetchPlanningMatrixHistory).toHaveBeenCalledTimes(1);
    window.removeEventListener('vhb-planning-changed', gezien);
  });

  it('volledige catch-up: alles stil opnieuw, voor staf ook dekking, matrix en gebruikers; geen signaal', () => {
    const b = maakBronnen();
    renderHook(() => useLiveUpdates(true, chauffeur, b));
    laatste().refetchers.refetchAll();
    for (const k of ['fetchMyNotes', 'fetchMeldingen', 'fetchLeave', 'fetchSwaps', 'fetchDiversions', 'fetchUpdates', 'fetchPlanning'] as const) expect(b[k]).toHaveBeenCalledTimes(1);
    expect(b.fetchPlanning).toHaveBeenCalledWith(undefined, { driverId: '3' }, { silent: true });
    expect(b.fetchUsers).not.toHaveBeenCalled();
    expect(b.refreshCoverageGaps).not.toHaveBeenCalled();
    expect(meldLive).not.toHaveBeenCalled();
    const s = maakBronnen();
    renderHook(() => useLiveUpdates(true, planner, s));
    laatste().refetchers.refetchAll();
    expect(s.fetchUsers).toHaveBeenCalledTimes(1);
    expect(s.refreshCoverageGaps).toHaveBeenCalledTimes(1);
    expect(s.fetchPlanningMatrix).toHaveBeenCalledTimes(1);
  });

  it('lichte catch-up: meldingen, verlof en ruilen; de planning alleen als haar versie wijzigde', () => {
    const b = maakBronnen();
    renderHook(() => useLiveUpdates(true, planner, b));
    laatste().refetchers.refetchLicht({ planning: false });
    expect(b.fetchMeldingen).toHaveBeenCalledTimes(1);
    expect(b.fetchLeave).toHaveBeenCalledTimes(1);
    expect(b.fetchSwaps).toHaveBeenCalledTimes(1);
    expect(b.fetchPlanning).not.toHaveBeenCalled();
    laatste().refetchers.refetchLicht({ planning: true });
    expect(b.fetchPlanning).toHaveBeenCalledWith(undefined, undefined, { silent: true });
    expect(b.refreshCoverageGaps).toHaveBeenCalledTimes(1);
    expect(b.fetchPlanningMatrix).toHaveBeenCalledTimes(1);
    expect(meldLive).not.toHaveBeenCalled();
  });
});
