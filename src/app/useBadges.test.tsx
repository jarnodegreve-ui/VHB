import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const werk = vi.hoisted(() => ({ bereken: vi.fn((_invoer: unknown) => ({ attentionCount: 3 })), geladen: 0 }));
vi.mock('../lib/lazyRetry', () => ({
  metRetry: () => () => { werk.geladen += 1; return Promise.resolve({ berekenWerkvoorraad: werk.bereken }); },
}));
const telRuilenDieOpMijWachten = vi.hoisted(() => vi.fn(() => 2));
vi.mock('../lib/ruilWachtOpMij', () => ({ telRuilenDieOpMijWachten }));

import type { User } from '../types';
import type { Werkvoorraad } from '../lib/werkvoorraad';
import { useAppBadge, useBadges, useWerkvoorraad } from './useBadges';

/**
 * De tellers voor de badges, de werkvoorraad van de planner en de badge op
 * het app-icoon, zoals ze tot 07-10 in App.tsx stonden.
 */
const chauffeur = { id: '3', name: 'Chauffeur A', role: 'chauffeur' } as User;
const planner = { id: '2', name: 'Pieter Planner', role: 'planner' } as User;
const technieker = { id: '5', name: 'Tom Technieker', role: 'technieker' } as User;

type BadgeData = Parameters<typeof useBadges>[1];
const verlof = (extra: Partial<Record<string, unknown>>) => ({ id: 'l', userId: '3', type: 'betaald_verlof', status: 'approved', decidedAt: '2026-10-05T10:00:00Z', ...extra });
const badgeData = (extra: Partial<BadgeData> = {}): BadgeData => ({
  leaveRequests: [], lastSeenLeaveDecisionAt: null, swaps: [], swapsGeladen: true, usersGeladen: true, ...extra,
} as unknown as BadgeData);

beforeEach(() => { werk.bereken.mockClear(); werk.geladen = 0; telRuilenDieOpMijWachten.mockClear(); });

describe('useBadges', () => {
  it('telt eigen beslissingen sinds het laatst gezien moment, zonder ziekte en zonder wachtende aanvragen', () => {
    const leaveRequests = [
      verlof({ id: 'a', decidedAt: '2026-10-05T10:00:00Z' }),            // gezien
      verlof({ id: 'b', decidedAt: '2026-10-06T10:00:00Z' }),            // nieuw
      verlof({ id: 'c', decidedAt: '2026-10-06T11:00:00Z', status: 'rejected' }), // nieuw
      verlof({ id: 'd', decidedAt: '2026-10-06T12:00:00Z', type: 'ziekte' }),    // ziekte telt niet
      verlof({ id: 'e', status: 'pending', decidedAt: undefined }),      // nog niet beslist
      verlof({ id: 'f', userId: '4', decidedAt: '2026-10-06T13:00:00Z' }), // van een collega
    ];
    const { result } = renderHook(() => useBadges(chauffeur, badgeData({ leaveRequests, lastSeenLeaveDecisionAt: '2026-10-05T12:00:00Z' } as Partial<BadgeData>)));
    expect(result.current.unseenLeaveDecisionCount).toBe(2);
    const alles = renderHook(() => useBadges(chauffeur, badgeData({ leaveRequests } as Partial<BadgeData>)));
    expect(alles.result.current.unseenLeaveDecisionCount).toBe(3);
    const niemand = renderHook(() => useBadges(null, badgeData({ leaveRequests } as Partial<BadgeData>)));
    expect(niemand.result.current.unseenLeaveDecisionCount).toBe(0);
  });

  it('wachtende verlofaanvragen en ruilen (pending én accepted) voor de planner; ruilen op mij alleen voor een chauffeur', () => {
    const leaveRequests = [verlof({ id: 'a', status: 'pending' }), verlof({ id: 'b', status: 'pending', userId: '4' }), verlof({ id: 'c' })];
    const swaps = [{ id: 's1', status: 'pending' }, { id: 's2', status: 'accepted' }, { id: 's3', status: 'approved' }, { id: 's4', status: 'rejected' }];
    const p = renderHook(() => useBadges(planner, badgeData({ leaveRequests, swaps } as Partial<BadgeData>)));
    expect(p.result.current.pendingLeaveCount).toBe(2);
    expect(p.result.current.pendingSwapsCount).toBe(2);
    expect(p.result.current.targetedSwapsCount).toBe(0);
    expect(telRuilenDieOpMijWachten).not.toHaveBeenCalled();
    const c = renderHook(() => useBadges(chauffeur, badgeData({ leaveRequests, swaps } as Partial<BadgeData>)));
    expect(c.result.current.targetedSwapsCount).toBe(2);
    expect(telRuilenDieOpMijWachten).toHaveBeenCalledWith(swaps, '3');
  });

  it('ruilDataKlaar vraagt ruilen én namen', () => {
    expect(renderHook(() => useBadges(planner, badgeData({ swapsGeladen: false }))).result.current.ruilDataKlaar).toBe(false);
    expect(renderHook(() => useBadges(planner, badgeData({ usersGeladen: false }))).result.current.ruilDataKlaar).toBe(false);
    expect(renderHook(() => useBadges(planner, badgeData())).result.current.ruilDataKlaar).toBe(true);
  });
});

type WerkData = Parameters<typeof useWerkvoorraad>[1];
const werkData = (extra: Partial<WerkData> = {}): WerkData => ({
  users: [], shifts: [], leaveRequests: [], swaps: [], planningMatrixHistory: [], coverageDays: [], vervaldata: [], pendingDevices: [], ...extra,
} as unknown as WerkData);

describe('useWerkvoorraad', () => {
  it('laadt de berekening nooit voor een chauffeur of technieker: werkvoorraad blijft null', async () => {
    const { result } = renderHook(() => useWerkvoorraad(chauffeur, werkData()));
    await act(async () => {});
    expect(result.current.isStafRol).toBe(false);
    expect(result.current.werkvoorraad).toBeNull();
    const t = renderHook(() => useWerkvoorraad(technieker, werkData()));
    await act(async () => {});
    expect(t.result.current.werkvoorraad).toBeNull();
    expect(werk.geladen).toBe(0);
  });

  it('voor staf: module één keer laden, berekenen met alle bronnen en "nu", en alleen opnieuw als de gegevens wijzigen', async () => {
    const data = werkData({ swaps: [{ id: 's1', status: 'pending' }] } as Partial<WerkData>);
    const { result, rerender } = renderHook(({ d }: { d: WerkData }) => useWerkvoorraad(planner, d), { initialProps: { d: data } });
    expect(result.current.isStafRol).toBe(true);
    expect(result.current.werkvoorraad).toBeNull();
    await act(async () => {});
    expect(werk.geladen).toBe(1);
    expect(result.current.werkvoorraad).toEqual({ attentionCount: 3 });
    expect(werk.bereken).toHaveBeenCalledTimes(1);
    const invoer = werk.bereken.mock.calls[0][0] as Record<string, unknown>;
    expect(invoer.swaps).toBe(data.swaps);
    expect(invoer.matrixHistory).toBe(data.planningMatrixHistory);
    expect(invoer.now).toBeInstanceOf(Date);
    rerender({ d: data });
    expect(werk.bereken).toHaveBeenCalledTimes(1);
    rerender({ d: { ...data, swaps: [] } as WerkData });
    expect(werk.bereken).toHaveBeenCalledTimes(2);
    expect(werk.geladen).toBe(1);
  });
});

describe('useAppBadge', () => {
  const setAppBadge = vi.fn(() => Promise.resolve());
  const clearAppBadge = vi.fn(() => Promise.resolve());
  beforeEach(() => {
    setAppBadge.mockClear(); clearAppBadge.mockClear();
    Object.defineProperty(navigator, 'setAppBadge', { configurable: true, value: setAppBadge });
    Object.defineProperty(navigator, 'clearAppBadge', { configurable: true, value: clearAppBadge });
  });
  afterEach(() => {
    delete (navigator as unknown as { setAppBadge?: unknown }).setAppBadge;
    delete (navigator as unknown as { clearAppBadge?: unknown }).clearAppBadge;
  });

  it('staf: de werkvoorraad; chauffeur en technieker: de ongelezen meldingen; niemand of nul: badge weg', () => {
    const w = { attentionCount: 4 } as Werkvoorraad;
    expect(renderHook(() => useAppBadge(planner, true, w, 9)).result.current).toBe(4);
    expect(setAppBadge).toHaveBeenLastCalledWith(4);
    expect(renderHook(() => useAppBadge(planner, true, null, 9)).result.current).toBe(0);
    expect(clearAppBadge).toHaveBeenCalledTimes(1);
    expect(renderHook(() => useAppBadge(chauffeur, false, null, 2)).result.current).toBe(2);
    expect(setAppBadge).toHaveBeenLastCalledWith(2);
    expect(renderHook(() => useAppBadge(technieker, false, null, 1)).result.current).toBe(1);
    expect(setAppBadge).toHaveBeenLastCalledWith(1);
    expect(renderHook(() => useAppBadge(null, false, null, 5)).result.current).toBe(0);
    expect(clearAppBadge).toHaveBeenCalledTimes(2);
  });

  it('zonder badging-ondersteuning gebeurt er niets', () => {
    delete (navigator as unknown as { setAppBadge?: unknown }).setAppBadge;
    expect(renderHook(() => useAppBadge(planner, true, { attentionCount: 4 } as Werkvoorraad, 0)).result.current).toBe(4);
    expect(setAppBadge).not.toHaveBeenCalled();
  });
});
