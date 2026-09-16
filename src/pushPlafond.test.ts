// @vitest-environment node
/**
 * Plafond op push-abonnementen per gebruiker (api/push.ts): bij meer dan
 * MAX_PUSH_ABONNEMENTEN_PER_USER vervallen de oudste (controle-ronde 16-09,
 * nr. 18). In-memory push_subscriptions-tabel met de paar query-builder-
 * ketens die savePushSubscription en snoeiPushAbonnementen gebruiken.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Rij = { user_id: string; endpoint: string; p256dh: string; auth: string; created_at: string };
const mem = vi.hoisted(() => ({ rijen: [] as Rij[], klok: 0 }));

vi.mock('../api/db.js', () => {
  const tabel = () => {
    let selectie: Rij[] = [];
    let filters: Array<(r: Rij) => boolean> = [];
    const pas = () => mem.rijen.filter((r) => filters.every((f) => f(r)));
    const b: any = {
      select: () => { selectie = []; return b; },
      eq: (k: keyof Rij, v: string) => { filters.push((r) => r[k] === v); return b; },
      neq: (k: keyof Rij, v: string) => { filters.push((r) => r[k] !== v); return b; },
      in: (k: keyof Rij, vs: string[]) => { filters.push((r) => vs.includes(r[k])); return b; },
      order: (k: keyof Rij, { ascending }: { ascending: boolean }) => {
        selectie = pas().sort((a, c) => (a[k] < c[k] ? -1 : 1) * (ascending ? 1 : -1));
        return Promise.resolve({ data: selectie, error: null });
      },
      delete: () => {
        const d: any = {
          eq: (k: keyof Rij, v: string) => { filters.push((r) => r[k] === v); return d; },
          neq: (k: keyof Rij, v: string) => { filters.push((r) => r[k] !== v); return d; },
          in: (k: keyof Rij, vs: string[]) => { filters.push((r) => vs.includes(r[k])); return d; },
          then: (ok: (v: unknown) => void) => { mem.rijen = mem.rijen.filter((r) => !filters.every((f) => f(r))); filters = []; ok({ error: null }); },
        };
        return d;
      },
      upsert: async (rij: Omit<Rij, 'created_at'>) => {
        const i = mem.rijen.findIndex((r) => r.endpoint === rij.endpoint);
        if (i >= 0) Object.assign(mem.rijen[i], rij);
        else mem.rijen.push({ ...rij, created_at: new Date(mem.klok++).toISOString() });
        return { error: null };
      },
    };
    return b;
  };
  return { db: { from: () => tabel() }, supabase: null, supabaseAdmin: null };
});
vi.mock('../api/storage.js', () => ({ bewaarMeldingen: vi.fn() }));

const { savePushSubscription, snoeiPushAbonnementen, MAX_PUSH_ABONNEMENTEN_PER_USER } = await import('../api/push.js');

const abonneer = (userId: string, n: number) => savePushSubscription({ userId, endpoint: `https://push.example/${userId}/${n}`, p256dh: 'k', auth: 'a' });
const endpointsVan = (userId: string) => mem.rijen.filter((r) => r.user_id === userId).map((r) => r.endpoint);

beforeEach(() => { mem.rijen = []; mem.klok = 0; });

describe('push-abonnementen, plafond per gebruiker', () => {
  it('houdt er hooguit MAX over en gooit de oudste weg', async () => {
    for (let i = 1; i <= MAX_PUSH_ABONNEMENTEN_PER_USER + 3; i++) await abonneer('u1', i);
    const over = endpointsVan('u1');
    expect(over).toHaveLength(MAX_PUSH_ABONNEMENTEN_PER_USER);
    expect(over).not.toContain('https://push.example/u1/1');
    expect(over).not.toContain('https://push.example/u1/3');
    expect(over).toContain(`https://push.example/u1/${MAX_PUSH_ABONNEMENTEN_PER_USER + 3}`);
  });

  it('raakt abonnementen van een andere gebruiker niet', async () => {
    await abonneer('u2', 1);
    for (let i = 1; i <= MAX_PUSH_ABONNEMENTEN_PER_USER + 1; i++) await abonneer('u1', i);
    expect(endpointsVan('u2')).toEqual(['https://push.example/u2/1']);
  });

  it('snoeit niets onder het plafond', async () => {
    for (let i = 1; i <= 3; i++) await abonneer('u1', i);
    expect(await snoeiPushAbonnementen('u1')).toBe(0);
    expect(endpointsVan('u1')).toHaveLength(3);
  });
});
