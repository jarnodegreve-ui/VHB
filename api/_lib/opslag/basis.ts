import { db } from "../../db.js";

export const requireDb = () => {
  if (!db) {
    throw new Error("Supabase is niet geconfigureerd. Stel SUPABASE_URL en SUPABASE_ANON_KEY (en SUPABASE_SERVICE_ROLE_KEY) in als env vars.");
  }
  return db;
};

// Herkent een rpc-fout die betekent "deze Postgres-functie bestaat niet"
// (de transactionele replace-SQL is nog niet gedraaid). ENKEL dan vallen we
// terug op het JS-pad. Bij een échte fout NIET terugvallen: de transactie is
// dan al teruggerold (tabel intact) en delete+insert zou alsnog kunnen wissen.
export const isMissingDbFunction = (error: any): boolean =>
  error?.code === "PGRST202" ||
  /could not find the function|function .*does not exist|schema cache/i.test(String(error?.message ?? ""));

// Supabase/PostgREST cap'pt by default op 1000 rijen per response. Voor
// tabellen die door de tijd groeien (planning, matrix_rows, leave, ...)
// MOETEN we expliciet paginëren — anders raakt elke caller stilletjes
// data kwijt zodra de tabel de cap overschrijdt. Dat was de oorzaak van
// het "eind mei verdwijnt"-incident.
const PAGE_SIZE = 1000;
// Hoeveel vervolgpagina's tegelijk: ruim voor wat we hebben (planning = 3
// pagina's), maar begrensd zodat een grote tabel de pool niet leegtrekt.
const PAGINA_PARALLEL = 6;

/** Derde argument van de query-bouwer: geef het door aan `.select(kolommen,
 *  telling)`. Alleen de eerste pagina krijgt het mee (count: 'exact'). */
export type PaginaTelling = { count: "exact" };
type PaginaAntwoord<T> = { data: T[] | null; error: any; count?: number | null };

// Geëxporteerd zodat ook de losse opslagmodules (api/_lib/loonStorage.ts)
// dezelfde paginering gebruiken in plaats van een eigen limit.
//
// PARALLEL (ronde 3, 19-09): de pagina's kwamen strikt na elkaar, dus een
// tabel van 3 pagina's kostte 3 roundtrips achter elkaar. Een bouwer die het
// derde argument doorgeeft aan `.select('*', telling)` krijgt op de eerste
// pagina het exacte totaal terug; de overige pagina's gaan dan gelijktijdig
// weg en worden in dezelfde volgorde aaneengezet. Klopt het totaal achteraf
// niet met de telling (de tabel wijzigde tussendoor), dan begint de oude
// seriële lus opnieuw: die is traag maar stopt pas op een niet-volle pagina.
// Bouwers zonder telling (of met `max`) blijven serieel, exact zoals vroeger.
// Voorwaarde voor beide paden: een stabiele, unieke sortering in de bouwer.
export const paginatedFetch = async <T = any>(
  buildQuery: (from: number, to: number, telling?: PaginaTelling) => PromiseLike<PaginaAntwoord<T>>,
  max?: number,
): Promise<T[]> => {
  const serieel = async (all: T[], vanaf: number): Promise<T[]> => {
    let from = vanaf;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { data, error } = await buildQuery(from, from + PAGE_SIZE - 1);
      if (error) throw error;
      const batch = (data ?? []) as T[];
      all.push(...batch);
      if (max !== undefined && all.length >= max) return all.slice(0, max);
      if (batch.length < PAGE_SIZE) break;
      from += PAGE_SIZE;
    }
    return all;
  };

  const eerste = await buildQuery(0, PAGE_SIZE - 1, { count: "exact" });
  if (eerste.error) throw eerste.error;
  const eersteBatch = (eerste.data ?? []) as T[];
  if (max !== undefined && eersteBatch.length >= max) return eersteBatch.slice(0, max);
  if (eersteBatch.length < PAGE_SIZE) return eersteBatch;

  const totaal = typeof eerste.count === "number" && Number.isFinite(eerste.count) ? eerste.count : null;
  if (totaal === null || max !== undefined || totaal <= PAGE_SIZE) {
    return serieel([...eersteBatch], PAGE_SIZE);
  }

  const paginas = Math.ceil(totaal / PAGE_SIZE);
  const rest: T[][] = [];
  for (let start = 1; start < paginas; start += PAGINA_PARALLEL) {
    const nummers = Array.from({ length: Math.min(PAGINA_PARALLEL, paginas - start) }, (_, i) => start + i);
    const antwoorden = await Promise.all(nummers.map((n) => buildQuery(n * PAGE_SIZE, n * PAGE_SIZE + PAGE_SIZE - 1)));
    for (const a of antwoorden) {
      if (a.error) throw a.error;
      rest.push((a.data ?? []) as T[]);
    }
  }
  const all = [...eersteBatch];
  for (const batch of rest) all.push(...batch);
  // Elke pagina behalve de laatste hoort vol te zijn en het totaal hoort te
  // kloppen; anders is de tabel tussendoor gewijzigd → opnieuw, serieel.
  const middenVol = rest.slice(0, -1).every((b) => b.length === PAGE_SIZE);
  if (all.length !== totaal || !middenVol) return serieel([], 0);
  return all;
};

export const isEchteIsoDag = (v: unknown): boolean => {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
};
