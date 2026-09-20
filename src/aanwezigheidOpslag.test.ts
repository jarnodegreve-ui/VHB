// @vitest-environment node
/**
 * Opslagkant van de aanwezigheid (api/storage.ts › noteerAanwezigheid), met
 * de plaats van aanmelden erbij.
 *
 * De eis die hier bewaakt wordt: Jarno draait migraties met de hand, dus de
 * code gaat live vóór of ná 2026-09-20_user_presence_locatie.sql en dat mag
 * niet uitmaken. Zonder de kolommen land/regio/stad moet de registratie
 * exact blijven doen wat ze vóór 20-09 deed, en een fout in het plaatspad mag
 * de aanwezigheid zelf nooit kosten.
 *
 * Supabase is gemockt als een in-memory user_presence die zich gedraagt als
 * PostgREST: een onbekende kolom in insert/update geeft PGRST204, een waarde
 * die de check-constraint breekt geeft 23514.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mem = vi.hoisted(() => ({
  rijen: [] as Array<Record<string, unknown>>,
  /** Kolommen die de tabel kent; zonder migratie ontbreken land/regio/stad. */
  kolommen: new Set<string>(),
  schrijfpogingen: [] as Array<{ soort: 'insert' | 'update'; payload: Record<string, unknown>; fout: string | null }>,
  volgnummer: 0,
}));

const BASIS = ['id', 'user_id', 'role', 'started_at', 'last_seen_at'];
const MET_PLAATS = [...BASIS, 'land', 'regio', 'stad'];

vi.mock('../api/db.js', () => {
  const controleer = (payload: Record<string, unknown>): { code: string; message: string } | null => {
    for (const kolom of Object.keys(payload)) {
      if (!mem.kolommen.has(kolom)) {
        return { code: 'PGRST204', message: `Could not find the '${kolom}' column of 'user_presence' in the schema cache` };
      }
    }
    const stad = payload.stad;
    if (typeof stad === 'string' && stad.length > 80) {
      return { code: '23514', message: 'new row for relation "user_presence" violates check constraint "user_presence_stad_check"' };
    }
    return null;
  };
  const tabel = () => ({
    select: () => {
      let gefilterd = [...mem.rijen];
      const q: any = {
        eq: (kolom: string, waarde: unknown) => { gefilterd = gefilterd.filter((r) => r[kolom] === waarde); return q; },
        order: (kolom: string, { ascending }: { ascending: boolean }) => {
          gefilterd.sort((a, b) => String(a[kolom]).localeCompare(String(b[kolom])) * (ascending ? 1 : -1));
          return q;
        },
        limit: async (n: number) => ({ data: gefilterd.slice(0, n), error: null }),
      };
      return q;
    },
    insert: async (payload: Record<string, unknown>) => {
      const error = controleer(payload);
      mem.schrijfpogingen.push({ soort: 'insert', payload, fout: error?.code ?? null });
      if (error) return { error };
      mem.volgnummer += 1;
      mem.rijen.push({ id: `rij-${mem.volgnummer}`, ...payload });
      return { error: null };
    },
    update: (payload: Record<string, unknown>) => ({
      eq: async (_kolom: string, id: string) => {
        const error = controleer(payload);
        mem.schrijfpogingen.push({ soort: 'update', payload, fout: error?.code ?? null });
        if (error) return { error };
        const rij = mem.rijen.find((r) => r.id === id);
        if (rij) Object.assign(rij, payload);
        return { error: null };
      },
    }),
  });
  const client = { from: (_naam: string) => tabel() };
  return { supabase: client, supabaseAdmin: client, db: client };
});

const { noteerAanwezigheid, vergeetPresenceLocatie } = await import('../api/storage.js');

const GENT = { land: 'BE', regio: 'VOV', stad: 'Gent' };
const LILLE = { land: 'FR', regio: 'HDF', stad: 'Lille' };
// Zone-loze ISO-strings: de test meet de sessielogica, niet de tijdzone van
// de machine (draait identiek onder TZ=UTC en TZ=Europe/Brussels).
const om = (klok: string) => new Date(`2026-09-20T${klok}:00`);

beforeEach(() => {
  mem.rijen = [];
  mem.schrijfpogingen = [];
  mem.volgnummer = 0;
  mem.kolommen = new Set(MET_PLAATS);
  vergeetPresenceLocatie();
  vi.useRealTimers();
});

describe('noteerAanwezigheid mét de plaatskolommen', () => {
  it('opent een sessie met de plaats erbij, in één schrijfactie', async () => {
    await noteerAanwezigheid('42', 'chauffeur', { nu: om('06:05'), locatie: GENT });
    expect(mem.rijen).toHaveLength(1);
    expect(mem.rijen[0]).toMatchObject({ user_id: '42', role: 'chauffeur', ...GENT });
    expect(mem.schrijfpogingen).toHaveLength(1);
  });

  it('werkt de plaats bij wanneer ze binnen een sessie wijzigt: de laatste wint', async () => {
    await noteerAanwezigheid('42', 'chauffeur', { nu: om('06:05'), locatie: GENT });
    await noteerAanwezigheid('42', 'chauffeur', { nu: om('06:10'), locatie: LILLE });
    expect(mem.rijen).toHaveLength(1);
    expect(mem.rijen[0]).toMatchObject({ ...LILLE, last_seen_at: om('06:10').toISOString(), started_at: om('06:05').toISOString() });
    expect(mem.schrijfpogingen.map((p) => p.soort)).toEqual(['insert', 'update']);
  });

  it('wist een bekende plaats niet wanneer een later verzoek geen headers draagt', async () => {
    await noteerAanwezigheid('42', 'chauffeur', { nu: om('06:05'), locatie: GENT });
    await noteerAanwezigheid('42', 'chauffeur', { nu: om('06:10'), locatie: null });
    expect(mem.rijen[0]).toMatchObject({ ...GENT, last_seen_at: om('06:10').toISOString() });
  });

  it('schrijft zonder plaats door wanneer die onbekend is (lokaal, tests)', async () => {
    await noteerAanwezigheid('42', 'chauffeur', { nu: om('06:05') });
    expect(mem.rijen).toHaveLength(1);
    expect(mem.schrijfpogingen[0].payload).not.toHaveProperty('land');
  });

  it('een waarde die de database weigert kost de plaats, niet de aanwezigheid', async () => {
    await noteerAanwezigheid('42', 'chauffeur', { nu: om('06:05'), locatie: { land: 'BE', regio: null, stad: 'x'.repeat(81) } });
    expect(mem.schrijfpogingen.map((p) => p.fout)).toEqual(['23514', null]);
    expect(mem.rijen).toHaveLength(1);
    expect(mem.rijen[0]).not.toHaveProperty('stad');
    // Geen ontbrekende kolom, dus de volgende poging probeert de plaats gewoon weer.
    await noteerAanwezigheid('43', 'chauffeur', { nu: om('06:06'), locatie: GENT });
    expect(mem.rijen[1]).toMatchObject(GENT);
  });
});

describe('noteerAanwezigheid zónder de plaatskolommen (migratie nog niet gedraaid)', () => {
  beforeEach(() => { mem.kolommen = new Set(BASIS); });

  it('blijft sessies openen en oprekken, precies zoals vóór 20-09', async () => {
    await noteerAanwezigheid('42', 'chauffeur', { nu: om('06:05'), locatie: GENT });
    await noteerAanwezigheid('42', 'chauffeur', { nu: om('06:10'), locatie: GENT });
    // Langer dan het sessiegat stil: een nieuwe rij, geen opgerekte.
    await noteerAanwezigheid('42', 'chauffeur', { nu: om('12:00'), locatie: GENT });
    expect(mem.rijen).toHaveLength(2);
    expect(mem.rijen[0]).toEqual({ id: 'rij-1', user_id: '42', role: 'chauffeur', started_at: om('06:05').toISOString(), last_seen_at: om('06:10').toISOString() });
    expect(mem.rijen[1]).toMatchObject({ started_at: om('12:00').toISOString() });
  });

  it('betaalt de terugval één keer en onthoudt dan dat de kolommen missen', async () => {
    await noteerAanwezigheid('42', 'chauffeur', { nu: om('06:05'), locatie: GENT });
    expect(mem.schrijfpogingen.map((p) => p.fout)).toEqual(['PGRST204', null]);
    await noteerAanwezigheid('42', 'chauffeur', { nu: om('06:10'), locatie: GENT });
    await noteerAanwezigheid('43', 'chauffeur', { nu: om('06:10'), locatie: LILLE });
    // Geen nieuwe mislukte pogingen meer: rechtstreeks zonder plaats.
    expect(mem.schrijfpogingen.filter((p) => p.fout)).toHaveLength(1);
    expect(mem.schrijfpogingen.slice(2).every((p) => !('land' in p.payload))).toBe(true);
  });

  it('begint vanzelf de plaats te schrijven zodra de migratie gedraaid is, zonder nieuwe deploy', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-20T06:00:00'));
    await noteerAanwezigheid('42', 'chauffeur', { nu: om('06:00'), locatie: GENT });
    expect(mem.rijen[0]).not.toHaveProperty('land');

    // Jarno draait de migratie; dezelfde warme instantie leeft verder.
    mem.kolommen = new Set(MET_PLAATS);
    vi.setSystemTime(new Date('2026-09-20T06:05:00'));
    await noteerAanwezigheid('42', 'chauffeur', { nu: om('06:05'), locatie: GENT });
    expect(mem.rijen[0]).not.toHaveProperty('land'); // nog binnen het herkansvenster

    vi.setSystemTime(new Date('2026-09-20T06:11:00'));
    await noteerAanwezigheid('42', 'chauffeur', { nu: om('06:11'), locatie: GENT });
    expect(mem.rijen[0]).toMatchObject(GENT);
  });

  it('gooit nog steeds bij een échte fout, zodat de aanroeper ze kan smoren', async () => {
    mem.kolommen = new Set(['id']); // ook de basiskolommen weg: niets lukt
    await expect(noteerAanwezigheid('42', 'chauffeur', { nu: om('06:05'), locatie: GENT })).rejects.toMatchObject({ code: 'PGRST204' });
  });
});
