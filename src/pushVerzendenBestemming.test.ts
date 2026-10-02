// @vitest-environment node
/**
 * Het versturen toetst elk abonnement opnieuw tegen de lijst van pushdiensten
 * (beveiligingsscan 01-10, keuze 10): de controle bij het abonneren dekt alleen
 * nieuwe rijen, wat al in de tabel stond niet. Een rij die niet naar een
 * pushdienst wijst wordt niet aangeroepen, niet gewist en één keer per
 * verzending gemeld met alleen de hostnaam.
 *
 * In-memory push_subscriptions-tabel en een nagemaakte web-push: er gaat geen
 * netwerkverkeer de deur uit.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

type Rij = { user_id: string; endpoint: string; p256dh: string; auth: string };
const mem = vi.hoisted(() => ({
  rijen: [] as Rij[],
  gewist: [] as string[],
  aangeroepen: [] as Array<{ endpoint: string; keys: { p256dh: string; auth: string } }>,
  antwoord: {} as Record<string, number>,
  geladen: 0,
}));

vi.mock('../api/db.js', () => ({
  db: {
    from: (tabel: string) => ({
      select: () => ({
        in: async (_kolom: string, ids: string[]) => (tabel === 'push_subscriptions'
          ? { data: mem.rijen.filter((r) => ids.includes(r.user_id)).map(({ endpoint, p256dh, auth }) => ({ endpoint, p256dh, auth })), error: null }
          : { data: [], error: null }),
      }),
      delete: () => ({
        eq: async (_kolom: string, endpoint: string) => {
          mem.gewist.push(endpoint);
          mem.rijen = mem.rijen.filter((r) => r.endpoint !== endpoint);
          return { error: null };
        },
      }),
    }),
  },
  supabase: null,
  supabaseAdmin: null,
}));
vi.mock('../api/storage.js', () => ({ bewaarMeldingen: vi.fn(async () => 0) }));
vi.mock('web-push', () => {
  return {
    default: {
      // api/push.ts stelt de sleutels in op het moment dat het de bibliotheek
      // laadt, één keer per module: zo is te tellen of ze geladen werd.
      setVapidDetails: () => { mem.geladen += 1; },
      sendNotification: async (sub: { endpoint: string; keys: { p256dh: string; auth: string } }) => {
        mem.aangeroepen.push(sub);
        const status = mem.antwoord[sub.endpoint];
        if (status) throw Object.assign(new Error('push geweigerd'), { statusCode: status });
        return { statusCode: 201 };
      },
    },
  };
});

const vorige = { pub: process.env.VAPID_PUBLIC_KEY, priv: process.env.VAPID_PRIVATE_KEY };
process.env.VAPID_PUBLIC_KEY = 'publiek';
process.env.VAPID_PRIVATE_KEY = 'geheim';
afterAll(() => {
  if (vorige.pub === undefined) delete process.env.VAPID_PUBLIC_KEY; else process.env.VAPID_PUBLIC_KEY = vorige.pub;
  if (vorige.priv === undefined) delete process.env.VAPID_PRIVATE_KEY; else process.env.VAPID_PRIVATE_KEY = vorige.priv;
});

const { sendPushToUsers, kiesPushDoelen } = await import('../api/push.js');

const rij = (user_id: string, endpoint: string): Rij => ({ user_id, endpoint, p256dh: `k-${user_id}`, auth: `a-${user_id}` });
const BERICHT = { title: 'Verlof goedgekeurd', body: '1 tot 3 juli', url: '/?view=verlof', soort: 'verlof' as const };
const FCM = 'https://fcm.googleapis.com/fcm/send/echt-toestel';
const APPLE = 'https://web.push.apple.com/QGuQyavXutnMH';

let waarschuwingen: string[] = [];
beforeEach(() => {
  mem.rijen = [];
  mem.gewist = [];
  mem.aangeroepen = [];
  mem.antwoord = {};
  waarschuwingen = [];
  vi.restoreAllMocks();
  vi.spyOn(console, 'warn').mockImplementation((...delen: unknown[]) => { waarschuwingen.push(delen.join(' ')); });
});

describe('versturen: alleen naar een echte pushdienst', () => {
  it('roept alleen de pushdiensten aan, de rest wordt overgeslagen en blijft staan', async () => {
    mem.rijen = [
      rij('3', FCM),
      rij('3', 'https://push.aanvaller.tld/geheim-pad-1'),
      rij('4', 'https://fcm.googleapis.com.aanvaller.tld/fcm/send/geheim-pad-2'),
      rij('4', 'https://intern.vhb.example:8443/geheim-pad-3'),
      rij('4', APPLE),
    ];
    await sendPushToUsers(['3', '4'], BERICHT);

    expect(mem.aangeroepen.map((s) => s.endpoint).sort()).toEqual([FCM, APPLE].sort());
    // Niets gewist: een echte dienst die op de lijst ontbreekt mag zijn
    // abonnementen niet stil verliezen.
    expect(mem.gewist).toEqual([]);
    expect(mem.rijen).toHaveLength(5);
  });

  it('meldt het overslaan één keer per verzending, met alleen de hostnamen', async () => {
    mem.rijen = [
      rij('3', FCM),
      rij('3', 'https://push.aanvaller.tld/geheim-pad-1'),
      rij('3', 'https://push.aanvaller.tld/geheim-pad-1b'),
      rij('4', 'https://fcm.googleapis.com.aanvaller.tld/fcm/send/geheim-pad-2'),
      rij('4', 'geen url'),
    ];
    await sendPushToUsers(['3', '4'], BERICHT);

    expect(waarschuwingen).toEqual([
      'Push overgeslagen voor 4 abonnementen, geen bekende pushdienst: fcm.googleapis.com.aanvaller.tld, geen geldige URL, push.aanvaller.tld.',
    ]);
    expect(waarschuwingen.join(' ')).not.toMatch(/geheim-pad|https:/);
  });

  it('laadt web-push niet eens als er geen enkele pushdienst tussen zit', async () => {
    // Een verse api/push.ts heeft de bibliotheek nog niet geladen; de teller
    // loopt op zodra dat gebeurt.
    vi.resetModules();
    const { sendPushToUsers: vers } = await import('../api/push.js');
    const voor = mem.geladen;
    mem.rijen = [rij('3', 'https://push.aanvaller.tld/geheim-pad')];
    await vers(['3'], BERICHT);

    expect(mem.aangeroepen).toEqual([]);
    expect(waarschuwingen).toEqual(['Push overgeslagen voor 1 abonnement, geen bekende pushdienst: push.aanvaller.tld.']);
    expect(mem.geladen).toBe(voor);

    // Tegenproef op de teller: met een echte pushdienst erbij wordt ze wel geladen.
    mem.rijen.push(rij('3', FCM));
    await vers(['3'], BERICHT);
    expect(mem.geladen).toBe(voor + 1);
    expect(mem.aangeroepen.map((s) => s.endpoint)).toEqual([FCM]);
  });

  it('zonder overgeslagen rijen staat er niets in het logboek', async () => {
    mem.rijen = [rij('3', FCM), rij('4', APPLE)];
    await sendPushToUsers(['3', '4'], BERICHT);
    expect(mem.aangeroepen).toHaveLength(2);
    expect(waarschuwingen).toEqual([]);
  });

  it('stuurt naar de genormaliseerde URL en ruimt een verlopen abonnement op onder de bewaarde tekst', async () => {
    const bewaard = 'https://FCM.GoogleAPIs.com./fcm/send/Verlopen';
    const genormaliseerd = 'https://fcm.googleapis.com/fcm/send/Verlopen';
    mem.rijen = [rij('3', bewaard), rij('3', 'https://push.aanvaller.tld/geheim-pad')];
    mem.antwoord[genormaliseerd] = 410;
    await sendPushToUsers(['3'], BERICHT);

    expect(mem.aangeroepen).toEqual([{ endpoint: genormaliseerd, keys: { p256dh: 'k-3', auth: 'a-3' } }]);
    // 410 = de pushdienst kent het abonnement niet meer: die rij gaat weg. De
    // overgeslagen rij is nooit aangeroepen en blijft dus staan.
    expect(mem.gewist).toEqual([bewaard]);
    expect(mem.rijen.map((r) => r.endpoint)).toEqual(['https://push.aanvaller.tld/geheim-pad']);
  });
});

describe('kiesPushDoelen', () => {
  it('telt een overgeslagen abonnement nooit als doel', () => {
    const uit = kiesPushDoelen([
      { endpoint: FCM, p256dh: 'k', auth: 'a' },
      { endpoint: 'https://push.aanvaller.tld/x', p256dh: 'k', auth: 'a' },
      { endpoint: 'http://fcm.googleapis.com/fcm/send/x', p256dh: 'k', auth: 'a' },
    ]);
    expect(uit.doelen).toEqual([{ endpoint: FCM, p256dh: 'k', auth: 'a', url: FCM }]);
    expect(uit.overgeslagen).toEqual({ aantal: 2, hosts: ['fcm.googleapis.com', 'push.aanvaller.tld'] });
  });

  it('noemt hooguit vijf hostnamen in de logregel', () => {
    const uit = kiesPushDoelen(Array.from({ length: 8 }, (_, i) => ({ endpoint: `https://host${i}.aanvaller.tld/x`, p256dh: 'k', auth: 'a' })));
    expect(uit.doelen).toEqual([]);
    expect(uit.overgeslagen.aantal).toBe(8);
    expect(uit.overgeslagen.hosts).toEqual(['host0.aanvaller.tld', 'host1.aanvaller.tld', 'host2.aanvaller.tld', 'host3.aanvaller.tld', 'host4.aanvaller.tld', 'en 3 andere']);
  });
});
