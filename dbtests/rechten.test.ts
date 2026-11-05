/**
 * De rechten van de database die de migraties opbouwen (supabase/volgorde.json)
 * zijn de rechten van productie. Sinds 30-10-2026 geeft Supabase een nieuwe
 * tabel geen Data-API-rechten meer (anon, authenticated én service_role) en
 * zet setup_security.sql die stand ook lokaal: elke migratie geeft haar
 * rechten dus zelf. Een tabel zonder `grant ... to service_role` breekt in een
 * vers project de API met "permission denied"; hier faalt ze in de PR.
 * Bron: public.security_snapshot() (2026-09-08, alleen service_role), dezelfde
 * functie als de nachtelijke beleidsdrift-check tegen supabase/beleid-snapshot.json.
 * Grens: information_schema kent het PG17-recht MAINTAIN niet, dus een
 * achtergebleven maintain ziet deze test niet; de rechtenproef in
 * scripts/db-opbouwen.mjs en de Deel-A-controle van 2026-09-29 wel.
 */
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { db } from '../api/_lib/db';

type Grant = { tabel: string; grantee: string; privilege: string };
type Snapshot = { tabellen: Array<{ tabel: string; rls: boolean }>; grants: Grant[] };

/** Wat de API minstens nodig heeft; `grant all` geeft ook truncate, references en trigger. */
const API_RECHTEN = ['SELECT', 'INSERT', 'UPDATE', 'DELETE'];

/** Per tabel de rechten als "grantee privilege" (anon, authenticated, service_role en PUBLIC). */
const rechtenPerTabel = (s: Snapshot): Map<string, Set<string>> => {
  const map = new Map<string, Set<string>>();
  for (const t of s.tabellen) map.set(t.tabel, new Set());
  for (const g of s.grants) {
    if (!map.has(g.tabel)) map.set(g.tabel, new Set());
    map.get(g.tabel)!.add(`${g.grantee} ${g.privilege}`);
  }
  return map;
};

const productie = JSON.parse(readFileSync('supabase/beleid-snapshot.json', 'utf8')) as Snapshot;
const productieRechten = rechtenPerTabel(productie);

let lokaal: Snapshot;
let lokaalRechten: Map<string, Set<string>>;

beforeAll(async () => {
  const { data, error } = await db!.rpc('security_snapshot');
  if (error) throw new Error(`security_snapshot(): ${error.message}`);
  lokaal = data as Snapshot;
  lokaalRechten = rechtenPerTabel(lokaal);
});

describe('rechten van de opgebouwde database', () => {
  it('beschrijft een echte database (geen leeg snapshot)', () => {
    expect(lokaal.tabellen.length).toBeGreaterThanOrEqual(40);
    expect(lokaal.tabellen.map((t) => t.tabel)).toEqual(expect.arrayContaining(['users', 'planning', 'swaps', 'leave', 'schema_migraties']));
  });

  it('heeft op elke tabel RLS aan', () => {
    expect(lokaal.tabellen.filter((t) => !t.rls).map((t) => t.tabel)).toEqual([]);
  });

  it('geeft service_role alles, anon niets en authenticated hoogstens SELECT, op elke tabel', () => {
    const fouten: string[] = [];
    for (const { tabel } of lokaal.tabellen) {
      const rechten = lokaalRechten.get(tabel) ?? new Set<string>();
      const mist = API_RECHTEN.filter((p) => !rechten.has(`service_role ${p}`));
      if (mist.length > 0) {
        fouten.push(`${tabel}: service_role mist ${mist.join(', ')}; zet in de migratie: grant all on table public.${tabel} to service_role;`);
      }
      const teRuim = [...rechten].filter((r) => r.startsWith('anon ') || r.startsWith('PUBLIC ') || (r.startsWith('authenticated ') && r !== 'authenticated SELECT'));
      if (teRuim.length > 0) fouten.push(`${tabel}: te ruim voor de browser: ${teRuim.sort().join(', ')}`);
    }
    expect(fouten).toEqual([]);
  });

  it('is per tabel gelijk aan productie (supabase/beleid-snapshot.json)', () => {
    const fouten: string[] = [];
    let vergeleken = 0;
    for (const { tabel } of lokaal.tabellen) {
      const prod = productieRechten.get(tabel);
      // Een tabel die productie nog niet kent (nieuwe migratie): daarvoor geldt de regel hierboven.
      if (!prod) continue;
      vergeleken += 1;
      const hier = lokaalRechten.get(tabel) ?? new Set<string>();
      const teveel = [...hier].filter((r) => !prod.has(r)).sort();
      const tekort = [...prod].filter((r) => !hier.has(r)).sort();
      if (teveel.length > 0 || tekort.length > 0) {
        fouten.push(`${tabel}: hier wel, productie niet: [${teveel.join(', ')}]; productie wel, hier niet: [${tekort.join(', ')}]`);
      }
    }
    expect(vergeleken).toBeGreaterThanOrEqual(40);
    expect(fouten).toEqual([]);
  });
});
