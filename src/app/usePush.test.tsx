import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Session } from '@supabase/supabase-js';

const push = vi.hoisted(() => ({
  supported: true,
  key: 'vapid-sleutel' as string | null,
  existing: null as { endpoint: string } | null,
  subscribeResult: 'subscribed' as 'subscribed' | 'denied' | 'unsupported' | 'failed',
  fetchPushPublicKey: vi.fn(),
  hersyncPushSubscription: vi.fn(),
  subscribeToPush: vi.fn(),
  unsubscribeFromPush: vi.fn(),
}));
vi.mock('../lib/push', () => ({
  isPushSupported: () => push.supported,
  fetchPushPublicKey: (...a: unknown[]) => { push.fetchPushPublicKey(...a); return Promise.resolve(push.key); },
  getExistingSubscription: () => Promise.resolve(push.existing),
  hersyncPushSubscription: (...a: unknown[]) => { push.hersyncPushSubscription(...a); return Promise.resolve(true); },
  subscribeToPush: (...a: unknown[]) => { push.subscribeToPush(...a); return Promise.resolve(push.subscribeResult); },
  unsubscribeFromPush: (...a: unknown[]) => { push.unsubscribeFromPush(...a); return Promise.resolve(true); },
}));
vi.mock('../lib/device', () => ({ deviceHeaders: () => ({ 'X-Device-Token': 'toestel' }) }));
const laatSchrijffout = vi.hoisted(() => vi.fn());
vi.mock('../lib/foutenLui', () => ({ laatSchrijffout }));

import type { User } from '../types';
import { useMeldingNavigatie, usePush } from './usePush';

/**
 * Push-notificaties en de tik op een melding, zoals ze tot 07-10 in App.tsx
 * stonden. Vastgelegd: wanneer de schakelaar verschijnt, wanneer hij "aan"
 * toont, wat de service worker mag bijsturen, en de teksten van de toasts.
 */
const luisteraars: Array<(e: MessageEvent) => void> = [];
const zetServiceWorker = () => {
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: {
      addEventListener: (_t: string, f: (e: MessageEvent) => void) => { luisteraars.push(f); },
      removeEventListener: (_t: string, f: (e: MessageEvent) => void) => { const i = luisteraars.indexOf(f); if (i >= 0) luisteraars.splice(i, 1); },
    },
  });
};
const bericht = (data: unknown) => luisteraars.slice().forEach((f) => f({ data } as MessageEvent));

const chauffeur = { id: '3', name: 'Chauffeur A', role: 'chauffeur' } as User;
const sessie = { access_token: 'tok' } as unknown as Session;
const headers = { Authorization: 'Bearer tok', 'X-Device-Token': 'toestel' };

beforeEach(() => {
  push.supported = true; push.key = 'vapid-sleutel'; push.existing = null; push.subscribeResult = 'subscribed';
  push.fetchPushPublicKey.mockClear(); push.hersyncPushSubscription.mockClear(); push.subscribeToPush.mockClear(); push.unsubscribeFromPush.mockClear();
  laatSchrijffout.mockClear();
  luisteraars.length = 0;
  zetServiceWorker();
});
afterEach(() => { delete (navigator as unknown as { serviceWorker?: unknown }).serviceWorker; });

describe('usePush', () => {
  it('zonder ondersteuning of zonder sessie wordt niets opgehaald en blijft de knop weg', async () => {
    push.supported = false;
    const showToast = vi.fn();
    const a = renderHook(() => usePush({ currentUser: chauffeur, session: sessie, showToast }));
    await act(async () => {});
    expect(push.fetchPushPublicKey).not.toHaveBeenCalled();
    expect(a.result.current.pushPublicKey).toBeNull();
    push.supported = true;
    const b = renderHook(() => usePush({ currentUser: null, session: null, showToast }));
    await act(async () => {});
    expect(push.fetchPushPublicKey).not.toHaveBeenCalled();
    expect(b.result.current.pushPublicKey).toBeNull();
  });

  it('server zonder VAPID-sleutel: knop weg, abonnement niet nagekeken', async () => {
    push.key = null;
    const { result } = renderHook(() => usePush({ currentUser: chauffeur, session: sessie, showToast: vi.fn() }));
    await act(async () => {});
    expect(push.fetchPushPublicKey).toHaveBeenCalledWith(headers);
    expect(result.current.pushPublicKey).toBeNull();
    expect(result.current.pushEnabled).toBe(false);
    expect(push.hersyncPushSubscription).not.toHaveBeenCalled();
  });

  it('bestaand abonnement: schakelaar aan en opnieuw geregistreerd (hooguit 1× per 24 u, in de lib)', async () => {
    push.existing = { endpoint: 'https://push/abc' };
    const { result } = renderHook(() => usePush({ currentUser: chauffeur, session: sessie, showToast: vi.fn() }));
    await act(async () => {});
    expect(result.current.pushPublicKey).toBe('vapid-sleutel');
    expect(result.current.pushEnabled).toBe(true);
    expect(push.hersyncPushSubscription).toHaveBeenCalledWith(push.existing, headers);
  });

  it('de service worker meldt een vervangen abonnement: met endpoint aan (geforceerd hersyncen), zonder uit', async () => {
    const { result } = renderHook(() => usePush({ currentUser: chauffeur, session: sessie, showToast: vi.fn() }));
    await act(async () => {});
    expect(result.current.pushEnabled).toBe(false);
    await act(async () => { bericht({ type: 'PUSH_SUBSCRIPTION_CHANGED', subscription: { endpoint: 'https://push/nieuw' } }); });
    expect(push.hersyncPushSubscription).toHaveBeenCalledWith({ endpoint: 'https://push/nieuw' }, headers, { force: true });
    expect(result.current.pushEnabled).toBe(true);
    await act(async () => { bericht({ type: 'PUSH_SUBSCRIPTION_CHANGED', subscription: null }); });
    expect(result.current.pushEnabled).toBe(false);
    await act(async () => { bericht({ type: 'NAVIGATE', url: '/verlof' }); });
    expect(result.current.pushEnabled).toBe(false);
  });

  it('inschakelen: geslaagd, geweigerd of mislukt, elk met zijn eigen melding', async () => {
    const showToast = vi.fn();
    const { result } = renderHook(() => usePush({ currentUser: chauffeur, session: sessie, showToast }));
    await act(async () => {});
    await act(async () => { await result.current.togglePush(); });
    expect(push.subscribeToPush).toHaveBeenCalledWith('vapid-sleutel', headers);
    expect(result.current.pushEnabled).toBe(true);
    expect(showToast).toHaveBeenLastCalledWith('Meldingen ingeschakeld, je krijgt voortaan een seintje bij planning, verlof en dienstruil.', 'success');

    await act(async () => { await result.current.togglePush(); });
    expect(push.unsubscribeFromPush).toHaveBeenCalledWith(headers);
    expect(result.current.pushEnabled).toBe(false);
    expect(showToast).toHaveBeenLastCalledWith('Meldingen uitgeschakeld.', 'info');

    push.subscribeResult = 'denied';
    await act(async () => { await result.current.togglePush(); });
    expect(result.current.pushEnabled).toBe(false);
    expect(showToast).toHaveBeenLastCalledWith('Meldingen geweigerd, sta notificaties toe in je browserinstellingen en probeer opnieuw.', 'info');

    push.subscribeResult = 'failed';
    await act(async () => { await result.current.togglePush(); });
    expect(result.current.pushEnabled).toBe(false);
    expect(laatSchrijffout).toHaveBeenCalledWith('Meldingen inschakelen', undefined, expect.any(Function));
  });

  it('resetPush zet de schakelaar uit (accountstaat gewist)', async () => {
    push.existing = { endpoint: 'https://push/abc' };
    const { result } = renderHook(() => usePush({ currentUser: chauffeur, session: sessie, showToast: vi.fn() }));
    await act(async () => {});
    expect(result.current.pushEnabled).toBe(true);
    act(() => { result.current.resetPush(); });
    expect(result.current.pushEnabled).toBe(false);
  });

  it('bij het afmelden verdwijnt de luisteraar van de service worker', async () => {
    const { unmount } = renderHook(() => usePush({ currentUser: chauffeur, session: sessie, showToast: vi.fn() }));
    await act(async () => {});
    expect(luisteraars).toHaveLength(1);
    unmount();
    expect(luisteraars).toHaveLength(0);
  });
});

describe('useMeldingNavigatie', () => {
  it('een NAVIGATE-bericht van de service worker opent het scherm met zijn record; een onbekend pad valt op het dashboard, een ander bericht doet niets', () => {
    const navigeer = vi.fn();
    const { unmount } = renderHook(() => useMeldingNavigatie(navigeer));
    expect(luisteraars).toHaveLength(1);
    act(() => { bericht({ type: 'NAVIGATE', url: '/verlof/abc-1' }); });
    expect(navigeer).toHaveBeenCalledWith('verlof', { params: ['abc-1'] });
    act(() => { bericht({ type: 'NAVIGATE', url: '/bestaat-niet' }); });
    expect(navigeer).toHaveBeenLastCalledWith('dashboard', { params: ['bestaat-niet'] });
    act(() => { bericht({ type: 'PUSH_SUBSCRIPTION_CHANGED', subscription: null }); });
    expect(navigeer).toHaveBeenCalledTimes(2);
    unmount();
    expect(luisteraars).toHaveLength(0);
  });
});
