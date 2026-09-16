import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PUSH_SYNC_KEY, hersyncPushSubscription, moetPushHersyncen } from './push';

/** Push-abonnement opnieuw registreren (controle 16-09, nr. 8): throttle en stempel. */

const DAG = 24 * 60 * 60 * 1000;
const stempel = (endpoint: string, at: number) => JSON.stringify({ endpoint, at });

describe('moetPushHersyncen', () => {
  it('stuurt zonder stempel, bij een ander endpoint, na 24 u en bij een kapotte stempel', () => {
    const nu = 1_800_000_000_000;
    expect(moetPushHersyncen(null, 'https://push/a', nu)).toBe(true);
    expect(moetPushHersyncen(stempel('https://push/a', nu - 1000), 'https://push/a', nu)).toBe(false);
    expect(moetPushHersyncen(stempel('https://push/a', nu - DAG + 1), 'https://push/a', nu)).toBe(false);
    expect(moetPushHersyncen(stempel('https://push/a', nu - DAG), 'https://push/a', nu)).toBe(true);
    expect(moetPushHersyncen(stempel('https://push/oud', nu), 'https://push/nieuw', nu)).toBe(true);
    expect(moetPushHersyncen('{geen json', 'https://push/a', nu)).toBe(true);
  });
});

/** In-memory localStorage: Node >= 22 zet zelf een (lege, functieloze)
 *  `localStorage`-global die jsdom's exemplaar in vitest verdringt. */
const maakOpslag = () => {
  const data = new Map<string, string>();
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => { data.set(k, String(v)); },
    removeItem: (k: string) => { data.delete(k); },
    clear: () => data.clear(),
    key: (i: number) => [...data.keys()][i] ?? null,
    get length() { return data.size; },
  };
};

describe('hersyncPushSubscription', () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const opslag = maakOpslag();
    vi.stubGlobal('localStorage', opslag);
    if (window !== (globalThis as unknown as Window)) Object.defineProperty(window, 'localStorage', { value: opslag, configurable: true });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('post het abonnement, stempelt, en slaat een verse stempel over tenzij force', async () => {
    const sub = { endpoint: 'https://push/a', keys: { p256dh: 'p', auth: 'a' } };
    expect(await hersyncPushSubscription(sub, { Authorization: 'Bearer t' })).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/push/subscribe');
    expect(JSON.parse(String(init.body))).toEqual(sub);
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer t');
    expect(JSON.parse(localStorage.getItem(PUSH_SYNC_KEY)!).endpoint).toBe('https://push/a');

    expect(await hersyncPushSubscription(sub, {})).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(await hersyncPushSubscription(sub, {}, { force: true })).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('stempelt niet bij een serverfout en doet niets zonder endpoint', async () => {
    fetchMock.mockResolvedValue(new Response('', { status: 500 }));
    expect(await hersyncPushSubscription({ endpoint: 'https://push/b' }, {})).toBe(false);
    expect(localStorage.getItem(PUSH_SYNC_KEY)).toBeNull();
    expect(await hersyncPushSubscription({}, {})).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
