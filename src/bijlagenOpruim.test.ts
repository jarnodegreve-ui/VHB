// @vitest-environment node
/**
 * Uitgestelde opruiming van PDF-bijlagen (29-09, controle-ronde nr. 12).
 * Twee lagen: de pure keuze (welk bestand mag weg) en de echte opslag tegen
 * een in-memory Supabase (tabellen + Storage). De kern van de fix: een
 * verwijderde omleiding of update laat haar PDF's staan, zodat "Ongedaan
 * maken" ze kan terughangen; pas de nachtcron ruimt ze op.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mem = vi.hoisted(() => ({
  tabellen: { diversions: [] as any[], updates: [] as any[], activity_log: [] as any[] } as Record<string, any[]>,
  // bucket → pad → { size, updated_at }
  buckets: { diversions: new Map<string, { size: number; updated_at: string }>(), 'update-bijlagen': new Map<string, { size: number; updated_at: string }>() } as Record<string, Map<string, { size: number; updated_at: string }>>,
  verwijderd: [] as Array<{ bucket: string; paden: string[] }>,
  lijstFaalt: false,
}));

vi.mock('../api/db.js', () => {
  const tabel = (naam: string) => {
    let rijen = [...(mem.tabellen[naam] ?? [])];
    const b: any = {
      select: () => b,
      order: () => b,
      eq: (kolom: string, waarde: unknown) => { rijen = rijen.filter((r) => r[kolom] === waarde); return b; },
      gte: (kolom: string, waarde: string) => { rijen = rijen.filter((r) => String(r[kolom]) >= waarde); return b; },
      range: async (from: number, to: number) => ({ data: rijen.slice(from, to + 1), error: null }),
      upsert: async (nieuw: any[]) => {
        for (const rij of nieuw) {
          const i = mem.tabellen[naam].findIndex((r) => String(r.id) === String(rij.id));
          if (i >= 0) mem.tabellen[naam][i] = { ...mem.tabellen[naam][i], ...rij }; else mem.tabellen[naam].push({ ...rij });
        }
        return { error: null };
      },
      delete: () => ({
        in: async (_kolom: string, ids: string[]) => {
          mem.tabellen[naam] = mem.tabellen[naam].filter((r) => !ids.includes(String(r.id)));
          return { error: null };
        },
      }),
    };
    return b;
  };
  const storage = {
    from: (bucket: string) => ({
      // Zoals Supabase: `search` is ruim (elke naam waarin de term voorkomt).
      list: async (_pad: string, opts: { limit: number; offset?: number; search?: string }) => {
        if (mem.lijstFaalt) return { data: null, error: { message: 'storage onbereikbaar' } };
        const alle = [...mem.buckets[bucket].entries()]
          .filter(([name]) => !opts.search || name.toLowerCase().includes(opts.search.toLowerCase()))
          .sort(([a], [b]) => a.localeCompare(b));
        const vanaf = opts.offset ?? 0;
        return {
          data: alle.slice(vanaf, vanaf + opts.limit).map(([name, m]) => ({ id: `id-${name}`, name, updated_at: m.updated_at, created_at: m.updated_at, metadata: { size: m.size } })),
          error: null,
        };
      },
      remove: async (paden: string[]) => {
        mem.verwijderd.push({ bucket, paden });
        for (const pad of paden) mem.buckets[bucket].delete(pad);
        return { data: [], error: null };
      },
    }),
  };
  const client = { from: (naam: string) => tabel(naam), storage };
  return { supabase: client, supabaseAdmin: client, db: client };
});

const { saveDiversionsData, saveUpdatesData, bestaandeDiversionBijlagen, bestaandeUpdateBijlagen, lijstBijlageBestanden } = await import('../api/storage.js');
const { kiesWeesBijlagen, mogelijkeEigenaars, ruimWeesBijlagenOp, WEES_MARGE_MS, WEES_MAX_PER_BEURT } = await import('../api/_lib/bijlagenOpruim.js');

const NU = Date.parse('2026-09-29T02:00:00Z');
const OUD = '2026-09-01T08:00:00Z';
const omleiding = (id: string, extra: Record<string, unknown> = {}) => ({ id, line: '12', title: `Omleiding ${id}`, description: 'x', startDate: '2026-09-01', ...extra });
const update = (id: string) => ({ id, date: '2026-09-01', title: `Update ${id}`, content: 'x', category: 'algemeen' });
const hang = (bucket: string, pad: string, updated_at = OUD) => mem.buckets[bucket].set(pad, { size: 1234, updated_at });
const log = (type: string, id: string, op: string, action = type === 'diversion' ? 'Omleiding verwijderd' : 'Update verwijderd') =>
  mem.tabellen.activity_log.push({ id: `l-${mem.tabellen.activity_log.length}`, entity_type: type, entity_id: id, created_at: op, action });

beforeEach(() => {
  mem.tabellen.diversions = [omleiding('o-1'), omleiding('o-2')];
  mem.tabellen.updates = [update('u-1'), update('u-2')];
  mem.tabellen.activity_log = [];
  mem.buckets.diversions.clear();
  mem.buckets['update-bijlagen'].clear();
  mem.verwijderd = [];
  mem.lijstFaalt = false;
});

describe('mogelijkeEigenaars', () => {
  it('leest <id>-<slot>.pdf, ook bij een id met koppeltekens', () => {
    expect(mogelijkeEigenaars('u-1-2.pdf', 2, false)).toEqual(['u-1']);
    expect(mogelijkeEigenaars('3f2a9c1e-77aa-4b1c-9d2e-0a1b2c3d4e5f-5.pdf', 5, false)).toEqual(['3f2a9c1e-77aa-4b1c-9d2e-0a1b2c3d4e5f']);
  });

  it('een naam die twee dingen kan zijn geeft beide eigenaars', () => {
    // o-1.pdf = slot 1 van omleiding "o", of de oude sleutel van omleiding "o-1".
    expect(mogelijkeEigenaars('o-1.pdf', 5, true)).toEqual(['o', 'o-1']);
  });

  it('een slot buiten bereik is geen slot; zonder oude sleutel is het dan niets van ons', () => {
    expect(mogelijkeEigenaars('u-1-3.pdf', 2, false)).toEqual([]);
    expect(mogelijkeEigenaars('1759123456789.pdf', 5, true)).toEqual(['1759123456789']);
  });

  it('blijft af van alles wat geen bijlage in onze vorm is', () => {
    expect(mogelijkeEigenaars('notities.txt', 5, true)).toEqual([]);
    expect(mogelijkeEigenaars('map/o-1-1.pdf', 5, true)).toEqual([]);
    expect(mogelijkeEigenaars('.pdf', 5, true)).toEqual([]);
  });
});

describe('kiesWeesBijlagen', () => {
  const basis = { bestaandeIds: new Set(['o-2']), verwijderd: new Set(['o-1', 'o']), recentGelogd: new Set<string>(), nu: NU, maxSlot: 5, metOudeSleutel: true };

  it('kiest alleen bestanden waarvan het record weg is', () => {
    const bestanden = [
      { naam: 'o-1-1.pdf', gewijzigdOp: OUD },
      { naam: 'o-2-1.pdf', gewijzigdOp: OUD },
      { naam: 'o-2.pdf', gewijzigdOp: OUD },
    ];
    expect(kiesWeesBijlagen({ ...basis, bestanden })).toEqual(['o-1-1.pdf']);
  });

  it('laat staan wat binnen de marge gewijzigd of gelogd is', () => {
    const net = new Date(NU - WEES_MARGE_MS + 60_000).toISOString();
    const opDeGrens = new Date(NU - WEES_MARGE_MS).toISOString();
    expect(kiesWeesBijlagen({ ...basis, bestanden: [{ naam: 'o-1-1.pdf', gewijzigdOp: net }] })).toEqual([]);
    expect(kiesWeesBijlagen({ ...basis, bestanden: [{ naam: 'o-1-1.pdf', gewijzigdOp: opDeGrens }] })).toEqual(['o-1-1.pdf']);
    // Oud bestand, maar het record is pas zonet verwijderd (staat in het log).
    expect(kiesWeesBijlagen({ ...basis, recentGelogd: new Set(['o-1']), bestanden: [{ naam: 'o-1-1.pdf', gewijzigdOp: OUD }] })).toEqual([]);
  });

  it('zonder bewijs in het log dat het record verwijderd is, blijft het bestand staan', () => {
    const bestanden = [{ naam: 'onbekend-1.pdf', gewijzigdOp: OUD }, { naam: 'oud-plan.pdf', gewijzigdOp: OUD }];
    expect(kiesWeesBijlagen({ ...basis, bestanden })).toEqual([]);
    expect(kiesWeesBijlagen({ ...basis, verwijderd: new Set(['onbekend']), bestanden })).toEqual(['onbekend-1.pdf']);
  });

  it('twijfel is laten staan: geen datum, of een van de mogelijke eigenaars bestaat nog', () => {
    expect(kiesWeesBijlagen({ ...basis, bestanden: [{ naam: 'o-1-1.pdf', gewijzigdOp: null }, { naam: 'o-1-2.pdf', gewijzigdOp: 'geen datum' }] })).toEqual([]);
    // "o-1.pdf" kan de oude sleutel van o-1 zijn (weg) of slot 1 van "o" (bestaat).
    expect(kiesWeesBijlagen({ ...basis, bestaandeIds: new Set(['o']), bestanden: [{ naam: 'o-1.pdf', gewijzigdOp: OUD }] })).toEqual([]);
    expect(kiesWeesBijlagen({ ...basis, bestaandeIds: new Set(['o-1']), bestanden: [{ naam: 'o-1.pdf', gewijzigdOp: OUD }] })).toEqual([]);
  });
});

describe('opslag: verwijderen laat de bestanden staan', () => {
  it('saveDiversionsData verwijdert de rij maar raakt Storage niet aan', async () => {
    hang('diversions', 'o-1-1.pdf');
    hang('diversions', 'o-1.pdf');
    await saveDiversionsData([omleiding('o-2')]);
    expect(mem.tabellen.diversions.map((d) => d.id)).toEqual(['o-2']);
    expect(mem.verwijderd).toEqual([]);
    expect([...mem.buckets.diversions.keys()].sort()).toEqual(['o-1-1.pdf', 'o-1.pdf']);
  });

  it('saveUpdatesData verwijdert de rij maar raakt Storage niet aan', async () => {
    hang('update-bijlagen', 'u-1-1.pdf');
    await saveUpdatesData([update('u-2')]);
    expect(mem.tabellen.updates.map((u) => u.id)).toEqual(['u-2']);
    expect(mem.verwijderd).toEqual([]);
    expect(mem.buckets['update-bijlagen'].has('u-1-1.pdf')).toBe(true);
  });

  it('de bestaanscontrole leest Storage per id en slot, met de grootte uit Storage', async () => {
    hang('diversions', 'o-1-2.pdf');
    hang('diversions', 'o-1.pdf');
    hang('diversions', 'o-2-1.pdf');
    hang('update-bijlagen', 'u-1-2.pdf');
    expect(await bestaandeDiversionBijlagen('o-1')).toEqual({ slots: [{ slot: 2, sizeBytes: 1234 }], oudeSleutel: true });
    expect(await bestaandeDiversionBijlagen('o-9')).toEqual({ slots: [], oudeSleutel: false });
    expect(await bestaandeUpdateBijlagen('u-1')).toEqual([{ slot: 2, sizeBytes: 1234 }]);
  });

  it('de bestaanscontrole kijkt alleen naar de exacte naam, niet naar wat op het id lijkt', async () => {
    // "o-1" komt ook voor in de namen van o-10 en o-11: die tellen niet mee.
    hang('diversions', 'o-10-1.pdf');
    hang('diversions', 'o-11.pdf');
    hang('diversions', 'xo-1-2.pdf');
    hang('diversions', 'o-1-6.pdf');
    expect(await bestaandeDiversionBijlagen('o-1')).toEqual({ slots: [], oudeSleutel: false });
  });

  it('is Storage niet te lezen, dan gooit de bestaanscontrole: niet te controleren is niet "bestaat niet"', async () => {
    hang('diversions', 'o-1-1.pdf');
    mem.lijstFaalt = true;
    await expect(bestaandeDiversionBijlagen('o-1')).rejects.toBeTruthy();
    await expect(bestaandeUpdateBijlagen('u-1')).rejects.toBeTruthy();
  });
});

describe('ruimWeesBijlagenOp', () => {
  it('ruimt op wat bij een verdwenen record hoort en laat de rest staan', async () => {
    hang('diversions', 'o-1-1.pdf');
    hang('diversions', 'o-9-1.pdf');
    hang('diversions', 'o-9.pdf');
    hang('diversions', 'logo.png');
    hang('update-bijlagen', 'u-2-1.pdf');
    hang('update-bijlagen', 'u-9-2.pdf');
    // Geen logregel over een verwijdering: herkomst onbekend, dus afblijven.
    hang('diversions', 'o-7-1.pdf');
    log('diversion', 'o-9', '2026-09-20T09:00:00Z');
    log('update', 'u-9', '2026-09-20T09:00:00Z');
    expect(await ruimWeesBijlagenOp(NU)).toEqual({ omleidingen: 2, updates: 1, overgeslagen: [] });
    expect([...mem.buckets.diversions.keys()].sort()).toEqual(['logo.png', 'o-1-1.pdf', 'o-7-1.pdf']);
    expect([...mem.buckets['update-bijlagen'].keys()]).toEqual(['u-2-1.pdf']);
  });

  it('blijft een dag van een pas verwijderd record af, zodat ongedaan maken nog kan', async () => {
    hang('diversions', 'o-9-1.pdf');
    log('diversion', 'o-9', new Date(NU - 60_000).toISOString());
    expect(await ruimWeesBijlagenOp(NU)).toEqual({ omleidingen: 0, updates: 0, overgeslagen: [] });
    expect(mem.buckets.diversions.has('o-9-1.pdf')).toBe(true);
    // Een dag later (de logregel valt buiten de marge) mag het weg.
    expect((await ruimWeesBijlagenOp(NU + WEES_MARGE_MS)).omleidingen).toBe(1);
  });

  it('gooit niets weg als er geen enkel record gelezen is', async () => {
    mem.tabellen.diversions = [];
    hang('diversions', 'o-1-1.pdf');
    log('diversion', 'o-1', '2026-09-20T09:00:00Z');
    expect(await ruimWeesBijlagenOp(NU)).toEqual({ omleidingen: 0, updates: 0, overgeslagen: ['omleidingen: geen records gelezen'] });
    expect(mem.buckets.diversions.has('o-1-1.pdf')).toBe(true);
  });

  it('slaat de bucket over als de lijst niet te lezen is, en gooit niet', async () => {
    hang('diversions', 'o-9-1.pdf');
    mem.lijstFaalt = true;
    await expect(lijstBijlageBestanden('diversions')).rejects.toBeTruthy();
    expect(await ruimWeesBijlagenOp(NU)).toEqual({ omleidingen: 0, updates: 0, overgeslagen: ['omleidingen: mislukt', 'updates: mislukt'] });
    expect(mem.verwijderd).toEqual([]);
  });

  it('ruimt per nacht hoogstens een vast aantal bestanden op', async () => {
    for (let i = 0; i < WEES_MAX_PER_BEURT + 7; i += 1) {
      hang('update-bijlagen', `weg-${String(i).padStart(4, '0')}-1.pdf`);
      log('update', `weg-${String(i).padStart(4, '0')}`, '2026-09-20T09:00:00Z');
    }
    expect((await ruimWeesBijlagenOp(NU)).updates).toBe(WEES_MAX_PER_BEURT);
    expect(mem.buckets['update-bijlagen'].size).toBe(7);
  });
});
