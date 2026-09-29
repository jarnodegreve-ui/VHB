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
  // Zoals max-rows in PostgREST: de server geeft zonder fout hoogstens
  // zoveel rijen per verzoek terug, hoeveel er ook gevraagd zijn.
  maxRijen: null as number | null,
  // Tabellen waarvan de gerichte lezing (`.in('id', …)`) mislukt of iets
  // teruggeeft wat niet gevraagd was.
  gerichtFaalt: new Set<string>(),
  gerichtVreemd: new Set<string>(),
  // Elke lezing van een tabel: naam + of ze gericht was.
  lezingen: [] as Array<{ tabel: string; gericht: boolean }>,
}));

vi.mock('../api/db.js', () => {
  const tabel = (naam: string) => {
    let rijen = [...(mem.tabellen[naam] ?? [])];
    const volgorde: Array<{ kolom: string; oplopend: boolean }> = [];
    let gerichtOpId = false;
    const gesorteerd = () => [...rijen].sort((x, y) => {
      for (const { kolom, oplopend } of volgorde) {
        const c = String(x[kolom] ?? '').localeCompare(String(y[kolom] ?? ''));
        if (c !== 0) return oplopend ? c : -c;
      }
      return 0;
    });
    const begrens = (lijst: any[]) => (mem.maxRijen === null ? lijst : lijst.slice(0, mem.maxRijen));
    const b: any = {
      select: () => b,
      order: (kolom: string, opts?: { ascending?: boolean }) => { volgorde.push({ kolom, oplopend: opts?.ascending !== false }); return b; },
      eq: (kolom: string, waarde: unknown) => { rijen = rijen.filter((r) => r[kolom] === waarde); return b; },
      gte: (kolom: string, waarde: string) => { rijen = rijen.filter((r) => String(r[kolom]) >= waarde); return b; },
      in: (kolom: string, waarden: string[]) => {
        if (kolom === 'id') gerichtOpId = true;
        rijen = rijen.filter((r) => waarden.includes(String(r[kolom])));
        return b;
      },
      range: async (from: number, to: number) => {
        mem.lezingen.push({ tabel: naam, gericht: gerichtOpId });
        return { data: begrens(gesorteerd().slice(from, to + 1)), error: null };
      },
      // Zonder range: de query zelf is het antwoord (gerichte lezing).
      then: (klaar: (antwoord: { data: any[] | null; error: unknown }) => unknown, mis?: (fout: unknown) => unknown) => {
        mem.lezingen.push({ tabel: naam, gericht: gerichtOpId });
        const antwoord = gerichtOpId && mem.gerichtFaalt.has(naam)
          ? { data: null, error: { message: 'database onbereikbaar' } }
          : gerichtOpId && mem.gerichtVreemd.has(naam)
            ? { data: [{ id: 'niet-gevraagd' }], error: null }
            : { data: begrens(gesorteerd()), error: null };
        return Promise.resolve(antwoord).then(klaar, mis);
      },
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

const { saveDiversionsData, saveUpdatesData, bestaandeDiversionBijlagen, bestaandeUpdateBijlagen, lijstBijlageBestanden, bestaandeRecordIds, logregelsVanEntiteiten, GERICHTE_LEZING_MAX } = await import('../api/storage.js');
const { laatsteVerwijdering } = await import('../api/_lib/bijlagenActies.js');
const { begrensBeurt, kandidaatBijlagen, kiesWeesBijlagen, mogelijkeEigenaars, ruimWeesBijlagenOp, WEES_MARGE_MS, WEES_MAX_PER_BEURT } = await import('../api/_lib/bijlagenOpruim.js');

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
  mem.maxRijen = null;
  mem.gerichtFaalt.clear();
  mem.gerichtVreemd.clear();
  mem.lezingen = [];
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

describe('laatsteVerwijdering', () => {
  const regel = (entityId: string, action: string, createdAt: string) => ({ entityId, action, createdAt });
  const ACTIE = 'Omleiding verwijderd';

  it('de laatste regel is de verwijdering: bewijs, met het moment', () => {
    const regels = [regel('o-1', 'Omleiding toegevoegd', '2026-09-01T08:00:00Z'), regel('o-1', ACTIE, '2026-09-20T09:00:00Z')];
    expect(laatsteVerwijdering(regels, 'o-1', ACTIE)).toEqual({ op: Date.parse('2026-09-20T09:00:00Z') });
    // De volgorde van de lijst doet er niet toe, het tijdstip wel.
    expect(laatsteVerwijdering([...regels].reverse(), 'o-1', ACTIE)).toEqual({ op: Date.parse('2026-09-20T09:00:00Z') });
  });

  it('volgt er na de verwijdering nog iets (hersteld, gewijzigd, bijlage), dan is er geen bewijs', () => {
    for (const later of ['Omleiding hersteld', 'Bijlagen hersteld', 'Omleiding gewijzigd', 'Bijlage toegevoegd', 'Omleiding toegevoegd']) {
      const regels = [regel('o-1', ACTIE, '2026-09-20T09:00:00Z'), regel('o-1', later, '2026-09-20T09:00:04Z')];
      expect(laatsteVerwijdering(regels, 'o-1', ACTIE), later).toBeNull();
    }
  });

  it('kijkt alleen naar het gevraagde id', () => {
    const regels = [regel('o-1', ACTIE, '2026-09-20T09:00:00Z'), regel('o-2', 'Omleiding hersteld', '2026-09-21T09:00:00Z')];
    expect(laatsteVerwijdering(regels, 'o-1', ACTIE)).not.toBeNull();
    expect(laatsteVerwijdering(regels, 'o-2', ACTIE)).toBeNull();
    expect(laatsteVerwijdering(regels, 'o-3', ACTIE)).toBeNull();
  });

  it('twijfel is geen bewijs: onleesbaar tijdstip, of een andere regel op dezelfde milliseconde', () => {
    expect(laatsteVerwijdering([regel('o-1', ACTIE, 'geen datum')], 'o-1', ACTIE)).toBeNull();
    const gelijk = [regel('o-1', ACTIE, '2026-09-20T09:00:00.000Z'), regel('o-1', 'Omleiding hersteld', '2026-09-20T09:00:00.000Z')];
    expect(laatsteVerwijdering(gelijk, 'o-1', ACTIE)).toBeNull();
  });
});

describe('gerichte lezingen', () => {
  it('bestaandeRecordIds geeft precies de gevraagde id\'s die bestaan', async () => {
    expect(await bestaandeRecordIds('diversions', ['o-1', 'o-9', 'o-1'])).toEqual(new Set(['o-1']));
    expect(await bestaandeRecordIds('updates', ['u-2', 'u-1'])).toEqual(new Set(['u-1', 'u-2']));
    expect(await bestaandeRecordIds('diversions', [])).toEqual(new Set());
  });

  it('bestaandeRecordIds gooit bij een fout, een onverwacht antwoord of te veel id\'s', async () => {
    mem.gerichtFaalt.add('diversions');
    await expect(bestaandeRecordIds('diversions', ['o-1'])).rejects.toBeTruthy();
    mem.gerichtFaalt.clear();
    mem.gerichtVreemd.add('diversions');
    await expect(bestaandeRecordIds('diversions', ['o-1'])).rejects.toThrow(/onverwacht antwoord/);
    mem.gerichtVreemd.clear();
    await expect(bestaandeRecordIds('diversions', Array.from({ length: 101 }, (_, i) => `x-${i}`))).rejects.toThrow(/hoogstens 100/);
  });

  it('logregelsVanEntiteiten geeft de regels van de gevraagde id\'s en het type, nieuwste eerst', async () => {
    log('diversion', 'o-9', '2026-09-20T09:00:00Z');
    log('diversion', 'o-9', '2026-09-20T09:00:05Z', 'Omleiding hersteld');
    log('diversion', 'o-8', '2026-09-21T09:00:00Z');
    log('update', 'o-9', '2026-09-22T09:00:00Z');
    expect(await logregelsVanEntiteiten('diversion', ['o-9'])).toEqual([
      { entityId: 'o-9', action: 'Omleiding hersteld', createdAt: '2026-09-20T09:00:05Z' },
      { entityId: 'o-9', action: 'Omleiding verwijderd', createdAt: '2026-09-20T09:00:00Z' },
    ]);
  });

  it('een afgekapt log verliest de oudste regels, nooit de laatste', async () => {
    log('diversion', 'o-9', '2026-09-20T09:00:00Z');
    for (let i = 0; i < 6; i += 1) log('diversion', 'o-9', `2026-09-21T09:00:0${i}Z`, 'Omleiding gewijzigd');
    log('diversion', 'o-9', '2026-09-22T09:00:00Z', 'Omleiding hersteld');
    mem.maxRijen = 3;
    const regels = await logregelsVanEntiteiten('diversion', ['o-9']);
    expect(regels).toHaveLength(3);
    expect(regels[0].action).toBe('Omleiding hersteld');
    expect(laatsteVerwijdering(regels, 'o-9', 'Omleiding verwijderd')).toBeNull();
  });
});

describe('kandidaatBijlagen (stap 1: wat komt in aanmerking)', () => {
  const basis = { bekendeIds: new Set(['o-2']), nu: NU, maxSlot: 5, metOudeSleutel: true };

  it('kiest alleen bestanden waarvan geen mogelijke eigenaar in de lijst staat', () => {
    const bestanden = [
      { naam: 'o-1-1.pdf', gewijzigdOp: OUD },
      { naam: 'o-2-1.pdf', gewijzigdOp: OUD },
      { naam: 'o-2.pdf', gewijzigdOp: OUD },
      { naam: 'logo.png', gewijzigdOp: OUD },
    ];
    expect(kandidaatBijlagen({ ...basis, bestanden })).toEqual(['o-1-1.pdf']);
  });

  it('laat staan wat binnen de marge gewijzigd is', () => {
    const net = new Date(NU - WEES_MARGE_MS + 60_000).toISOString();
    const opDeGrens = new Date(NU - WEES_MARGE_MS).toISOString();
    expect(kandidaatBijlagen({ ...basis, bestanden: [{ naam: 'o-1-1.pdf', gewijzigdOp: net }] })).toEqual([]);
    expect(kandidaatBijlagen({ ...basis, bestanden: [{ naam: 'o-1-1.pdf', gewijzigdOp: opDeGrens }] })).toEqual(['o-1-1.pdf']);
  });

  it('twijfel is laten staan: geen datum, of een van de mogelijke eigenaars bestaat nog', () => {
    expect(kandidaatBijlagen({ ...basis, bestanden: [{ naam: 'o-1-1.pdf', gewijzigdOp: null }, { naam: 'o-1-2.pdf', gewijzigdOp: 'geen datum' }] })).toEqual([]);
    // "o-1.pdf" kan de oude sleutel van o-1 zijn (weg) of slot 1 van "o" (bestaat).
    expect(kandidaatBijlagen({ ...basis, bekendeIds: new Set(['o']), bestanden: [{ naam: 'o-1.pdf', gewijzigdOp: OUD }] })).toEqual([]);
    expect(kandidaatBijlagen({ ...basis, bekendeIds: new Set(['o-1']), bestanden: [{ naam: 'o-1.pdf', gewijzigdOp: OUD }] })).toEqual([]);
  });
});

describe('begrensBeurt', () => {
  it('hoogstens 100 bestanden en hoogstens 100 id\'s om gericht na te kijken', () => {
    // Bij omleidingen heeft elke naam twee mogelijke eigenaars: 50 bestanden = 100 id's.
    const namen = Array.from({ length: 120 }, (_, i) => `weg-${String(i).padStart(4, '0')}-1.pdf`);
    const omleidingen = begrensBeurt(namen, { maxSlot: 5, metOudeSleutel: true });
    expect(omleidingen.namen).toHaveLength(50);
    expect(omleidingen.ids).toHaveLength(100);
    expect(omleidingen.ids.length).toBeLessThanOrEqual(GERICHTE_LEZING_MAX);
    const updates = begrensBeurt(namen, { maxSlot: 2, metOudeSleutel: false });
    expect(updates.namen).toHaveLength(WEES_MAX_PER_BEURT);
    expect(updates.ids).toHaveLength(100);
  });
});

describe('kiesWeesBijlagen (stap 2: wat mag echt weg)', () => {
  const ACTIE = 'Omleiding verwijderd';
  const regel = (entityId: string, action: string, createdAt: string) => ({ entityId, action, createdAt });
  const LANG_GELEDEN = '2026-09-20T09:00:00Z';
  const basis = { bestaandeIds: new Set<string>(), actie: ACTIE, nu: NU, maxSlot: 5, metOudeSleutel: true };

  it('weg mag alleen wat het log als verwijderd kent', () => {
    const kandidaten = ['onbekend-1.pdf', 'o-1-1.pdf'];
    expect(kiesWeesBijlagen({ ...basis, kandidaten, regels: [] })).toEqual([]);
    expect(kiesWeesBijlagen({ ...basis, kandidaten, regels: [regel('o-1', ACTIE, LANG_GELEDEN)] })).toEqual(['o-1-1.pdf']);
  });

  it('de gerichte lezing wint: bestaat een mogelijke eigenaar toch, dan blijft het bestand', () => {
    const regels = [regel('o-1', ACTIE, LANG_GELEDEN)];
    expect(kiesWeesBijlagen({ ...basis, kandidaten: ['o-1-1.pdf'], regels, bestaandeIds: new Set(['o-1']) })).toEqual([]);
    // o-1-1.pdf kan ook de oude sleutel van een omleiding o-1-1 zijn.
    expect(kiesWeesBijlagen({ ...basis, kandidaten: ['o-1-1.pdf'], regels, bestaandeIds: new Set(['o-1-1']) })).toEqual([]);
  });

  it('een verwijdering telt alleen als ze de laatste logregel is', () => {
    const hersteld = [regel('o-1', ACTIE, LANG_GELEDEN), regel('o-1', 'Omleiding hersteld', '2026-09-20T09:00:04Z'), regel('o-1', 'Bijlagen hersteld', '2026-09-20T09:00:04Z')];
    expect(kiesWeesBijlagen({ ...basis, kandidaten: ['o-1-1.pdf'], regels: hersteld })).toEqual([]);
    const opnieuwVerwijderd = [...hersteld, regel('o-1', ACTIE, '2026-09-21T09:00:00Z')];
    expect(kiesWeesBijlagen({ ...basis, kandidaten: ['o-1-1.pdf'], regels: opnieuwVerwijderd })).toEqual(['o-1-1.pdf']);
  });

  it('blijft de marge lang van een verse verwijdering af', () => {
    const vers = [regel('o-1', ACTIE, new Date(NU - WEES_MARGE_MS + 60_000).toISOString())];
    expect(kiesWeesBijlagen({ ...basis, kandidaten: ['o-1-1.pdf'], regels: vers })).toEqual([]);
    expect(kiesWeesBijlagen({ ...basis, kandidaten: ['o-1-1.pdf'], regels: vers, nu: NU + 60_000 })).toEqual(['o-1-1.pdf']);
  });

  it('zegt de laatste regel van de ANDERE mogelijke eigenaar iets anders, dan blijft het bestand', () => {
    // o-1.pdf: oude sleutel van o-1 (verwijderd), of slot 1 van "o" (pas gewijzigd).
    const regels = [regel('o-1', ACTIE, LANG_GELEDEN), regel('o', 'Omleiding gewijzigd', '2026-09-22T09:00:00Z')];
    expect(kiesWeesBijlagen({ ...basis, kandidaten: ['o-1.pdf'], regels })).toEqual([]);
    expect(kiesWeesBijlagen({ ...basis, kandidaten: ['o-1.pdf'], regels: [regels[0]] })).toEqual(['o-1.pdf']);
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

  // Tegenlezing 29-09, punt 2. Na "Ongedaan maken" blijft de logregel van de
  // verwijdering nog een jaar staan. Wie naar "ooit verwijderd" kijkt, houdt
  // voor zo'n record alleen de brede lijst als verdediging over.
  describe('een bestaand record verliest zijn PDF niet', () => {
    const veel = (n: number) => Array.from({ length: n }, (_, i) => omleiding(`d-${String(i).padStart(4, '0')}`));

    it('de brede lijst is afgekapt (500 van 700): de gerichte lezing houdt de PDF tegen, er wordt niets gewist', async () => {
      mem.tabellen.diversions = veel(700);
      mem.maxRijen = 500;
      // d-0600 bestaat, maar valt buiten de 500 rijen die de server teruggaf.
      // Zijn laatste logregel is een oude verwijdering (het record kwam
      // terug langs een weg die niet logt, zoals een herstel uit back-up).
      hang('diversions', 'd-0600-1.pdf');
      log('diversion', 'd-0600', '2026-09-20T09:00:00Z');
      expect(await ruimWeesBijlagenOp(NU)).toEqual({ omleidingen: 0, updates: 0, overgeslagen: [] });
      expect(mem.verwijderd).toEqual([]);
      expect(mem.buckets.diversions.has('d-0600-1.pdf')).toBe(true);
      // De brede lijst gaf het record niet, de gerichte lezing wel.
      expect(mem.lezingen).toContainEqual({ tabel: 'diversions', gericht: true });
    });

    it('ooit verwijderd en hersteld: de oude verwijder-logregel is geen bewijs meer', async () => {
      // o-5 is verwijderd en vier seconden later hersteld. Het record bestaat,
      // maar stel dat geen enkele lezing het laat zien: het log alleen volstaat.
      hang('diversions', 'o-5-1.pdf');
      log('diversion', 'o-5', '2026-09-20T09:00:00Z');
      log('diversion', 'o-5', '2026-09-20T09:00:04Z', 'Omleiding hersteld');
      log('diversion', 'o-5', '2026-09-20T09:00:04Z', 'Bijlagen hersteld');
      expect(await ruimWeesBijlagenOp(NU)).toEqual({ omleidingen: 0, updates: 0, overgeslagen: [] });
      expect(mem.buckets.diversions.has('o-5-1.pdf')).toBe(true);
      // Hetzelfde bij een update.
      hang('update-bijlagen', 'u-5-1.pdf');
      log('update', 'u-5', '2026-09-20T09:00:00Z');
      log('update', 'u-5', '2026-09-20T09:00:04Z', 'Update hersteld');
      expect(await ruimWeesBijlagenOp(NU)).toEqual({ omleidingen: 0, updates: 0, overgeslagen: [] });
      expect(mem.verwijderd).toEqual([]);
    });

    it('de gerichte lezing mislukt: de hele bucket blijft die nacht staan, de andere bucket gaat door', async () => {
      hang('diversions', 'o-9-1.pdf');
      log('diversion', 'o-9', '2026-09-20T09:00:00Z');
      hang('update-bijlagen', 'u-9-1.pdf');
      log('update', 'u-9', '2026-09-20T09:00:00Z');
      mem.gerichtFaalt.add('diversions');
      expect(await ruimWeesBijlagenOp(NU)).toEqual({ omleidingen: 0, updates: 1, overgeslagen: ['omleidingen: mislukt'] });
      expect(mem.buckets.diversions.has('o-9-1.pdf')).toBe(true);
      expect(mem.buckets['update-bijlagen'].has('u-9-1.pdf')).toBe(false);
    });

    it('de gerichte lezing geeft iets terug wat niet gevraagd was: de bucket blijft staan', async () => {
      hang('diversions', 'o-9-1.pdf');
      log('diversion', 'o-9', '2026-09-20T09:00:00Z');
      mem.gerichtVreemd.add('diversions');
      expect(await ruimWeesBijlagenOp(NU)).toEqual({ omleidingen: 0, updates: 0, overgeslagen: ['omleidingen: mislukt'] });
      expect(mem.verwijderd).toEqual([]);
    });
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
