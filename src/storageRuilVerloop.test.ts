// @vitest-environment node
/**
 * De groepering van ruil-logregels per ruil-id (beveiligingsscan 01-10). Het
 * id van een ruil kiest de aanvrager zelf; `RECORD_ID_RE` laat ook namen toe
 * die elk gewoon object al kent (`constructor`, `toString`, `__proto__`). In
 * een gewoon object gaf `perSwap[id]` dan een functie terug en gooide `.push`:
 * het verloop van álle ruilen viel weg en de drie ruilrapporten gaven een 500.
 * Hier de echte opslagfuncties, met alleen de database vervangen.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { regelsVanRuil } from '../shared/ruilVerloop';
import { RECORD_ID_RE } from '../api/_lib/collectie';

// `negeerFilter`: de database geeft ook regels van niet-gevraagde ruilen terug.
const db = vi.hoisted(() => ({ rijen: [] as Array<Record<string, unknown>>, negeerFilter: false }));

vi.mock('../api/db.js', () => {
  // Genoeg querybuilder voor de twee lezers: elke stap geeft de keten terug,
  // `in('entity_id', …)` filtert zoals PostgREST, en het antwoord is de lijst.
  const keten = (filter: string[] | null): any => new Proxy({}, {
    get: (_t, naam: string) => {
      if (naam === 'then') {
        return (ok: (v: unknown) => void) => ok({ data: db.rijen.filter((r) => !filter || db.negeerFilter || filter.includes(String(r.entity_id))), error: null, count: null });
      }
      return (...args: unknown[]) => keten(naam === 'in' && args[0] === 'entity_id' ? (args[1] as string[]) : filter);
    },
  });
  return { db: { from: () => keten(null) }, supabase: null, supabaseAdmin: null };
});

const { getSwapVerloopRegels, getSwapHistories } = await import('../api/storage.js');

const NAMEN = ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf', 'prototype'];
const GEWOON = '6f1c2d3e-0000-4000-8000-000000000001';

const logRij = (entityId: string, action: string, op: string) => ({
  id: `${entityId}-${op}`, created_at: op, actor_name: 'Chauffeur A', actor_role: 'chauffeur', category: 'swaps', action, details: '', entity_type: 'swap', entity_id: entityId,
});

beforeEach(() => {
  db.negeerFilter = false;
  db.rijen = [
    logRij(GEWOON, 'Dienstruil aangevraagd', '2026-10-01T08:00:00Z'),
    ...NAMEN.flatMap((id, i) => [
      logRij(id, 'Dienstruil aangevraagd', `2026-10-01T09:0${i}:00Z`),
      logRij(id, 'Dienstruil geaccepteerd', `2026-10-01T10:0${i}:00Z`),
    ]),
    logRij(GEWOON, 'Dienstruil goedgekeurd', '2026-10-02T08:00:00Z'),
  ];
});

describe('ruil-id dat een objectnaam is', () => {
  it('zulke id\'s blijven geldig: deze wijziging maakt niets strenger', () => {
    for (const id of [...NAMEN, GEWOON, '1759400000000-ab12cd']) expect(RECORD_ID_RE.test(id), id).toBe(true);
  });

  it('getSwapVerloopRegels zonder id\'s (staf, rapporten): elke ruil houdt zijn eigen regels', async () => {
    const perRuil = await getSwapVerloopRegels();
    expect(Object.keys(perRuil).sort()).toEqual([GEWOON, ...NAMEN].sort());
    expect(regelsVanRuil(perRuil, GEWOON).map((r) => r.action)).toEqual(['Dienstruil aangevraagd', 'Dienstruil goedgekeurd']);
    for (const id of NAMEN) {
      expect(regelsVanRuil(perRuil, id).map((r) => r.action), id).toEqual(['Dienstruil aangevraagd', 'Dienstruil geaccepteerd']);
      // Ook wie rechtstreeks leest krijgt de lijst, geen functie van Object.
      expect(Array.isArray(perRuil[id]), id).toBe(true);
    }
    // Wat de rapporten doen: over alle ruilen lopen.
    expect(Object.entries(perRuil).every(([, regels]) => Array.isArray(regels))).toBe(true);
  });

  it('getSwapVerloopRegels met id\'s (chauffeur, één ruil): alleen het gevraagde, en een id zonder regels is leeg', async () => {
    for (const id of NAMEN) {
      const perRuil = await getSwapVerloopRegels([id]);
      expect(Object.keys(perRuil), id).toEqual([id]);
      expect(regelsVanRuil(perRuil, id), id).toHaveLength(2);
    }
    db.rijen = [logRij(GEWOON, 'Dienstruil aangevraagd', '2026-10-01T08:00:00Z')];
    for (const id of NAMEN) {
      const perRuil = await getSwapVerloopRegels([id, GEWOON]);
      expect(perRuil[id], id).toBeUndefined();
      expect(regelsVanRuil(perRuil, id), id).toEqual([]);
      expect(regelsVanRuil(perRuil, GEWOON)).toHaveLength(1);
    }
    for (const id of NAMEN) expect(regelsVanRuil(await getSwapVerloopRegels([]), id), id).toEqual([]);
  });

  it('getSwapHistories (weekblad): hetzelfde, ook als de database een regel van een niet-gevraagde ruil teruggeeft', async () => {
    const alle = await getSwapHistories([GEWOON, ...NAMEN]);
    for (const id of NAMEN) expect(alle[id].map((r) => r.action), id).toEqual(['Dienstruil aangevraagd', 'Dienstruil geaccepteerd']);
    expect(alle[GEWOON]).toHaveLength(2);
    // Een regel met een objectnaam als id, terwijl alleen de gewone ruil gevraagd is.
    db.negeerFilter = true;
    const uit = await getSwapHistories([GEWOON]);
    expect(Object.keys(uit)).toEqual([GEWOON]);
    expect(uit[GEWOON]).toHaveLength(2);
    for (const id of NAMEN) expect(regelsVanRuil(uit, id), id).toEqual([]);
  });
});
