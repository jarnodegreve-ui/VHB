/**
 * Zuivere kern van de beleidsdrift-check (verbeterronde 07-09, nr. 10):
 * normaliseren, vergelijken en leesbaar tonen van het document dat
 * public.security_snapshot() teruggeeft (supabase/2026-09-08_security_snapshot.sql).
 * Geen I/O, geen env: dat zit in scripts/beleid-drift.mjs. Getest in
 * src/lib/beleidDrift.test.ts.
 *
 * Het document heeft vier secties (tabellen, policies, grants, functies), elk
 * een lijst records. Elk record krijgt hier één stabiele sleutel (bv.
 * "policy public.planning › planning_read_authenticated"); de vergelijking
 * gebeurt per sleutel, per veld. Tekstvelden (using, with_check, definitie)
 * worden op whitespace samengetrokken zodat een herformattering in de SQL
 * Editor geen drift is, maar een andere voorwaarde wél.
 */

/** @typedef {Record<string, unknown>} Record_ */
/** @typedef {{ versie: number, tabellen: Record_[], policies: Record_[], grants: Record_[], functies: Record_[] }} Snapshot */
/** @typedef {{ veld: string, oud: unknown, nieuw: unknown }} VeldVerschil */
/** @typedef {{ toegevoegd: Array<{ sleutel: string, waarde: Record_ }>, verwijderd: Array<{ sleutel: string, waarde: Record_ }>, gewijzigd: Array<{ sleutel: string, velden: VeldVerschil[] }> }} Diff */

/** @type {ReadonlyArray<'tabellen' | 'policies' | 'grants' | 'functies'>} */
export const SECTIES = ['tabellen', 'policies', 'grants', 'functies'];

/** Velden met SQL-tekst: whitespace samentrekken vóór de vergelijking. */
const TEKSTVELDEN = new Set(['using', 'with_check', 'definitie']);
/** Velden met een lijst rollen: sorteren, volgorde is betekenisloos. */
const LIJSTVELDEN = new Set(['rollen', 'execute']);

/** @param {unknown} s */
export const samentrekken = (s) => (typeof s === 'string' ? s.replace(/\s+/g, ' ').trim() : s);

/**
 * Eén stabiele, unieke sleutel per record; de tekst is ook wat de diff toont.
 * @param {string} sectie
 * @param {Record_} item
 */
export function sleutelVan(sectie, item) {
  switch (sectie) {
    case 'tabellen':
      return `tabel ${item.tabel}`;
    case 'policies':
      return `policy ${item.schema}.${item.tabel} › ${item.policy}`;
    case 'grants':
      return `grant ${item.tabel} › ${item.grantee} › ${item.privilege}`;
    case 'functies':
      return `functie ${item.functie}`;
    default:
      throw new Error(`Onbekende sectie: ${sectie}`);
  }
}

/**
 * Object met alfabetisch gesorteerde sleutels (recursief), zodat JSON.stringify
 * altijd dezelfde tekst geeft, ongeacht de volgorde waarin Postgres of een
 * eerdere versie van dit script de velden opbouwde.
 * @template T
 * @param {T} waarde
 * @returns {T}
 */
export function sorteerSleutels(waarde) {
  if (Array.isArray(waarde)) return /** @type {T} */ (waarde.map(sorteerSleutels));
  if (waarde && typeof waarde === 'object') {
    /** @type {Record<string, unknown>} */
    const uit = {};
    for (const k of Object.keys(waarde).sort()) uit[k] = sorteerSleutels(/** @type {Record<string, unknown>} */ (waarde)[k]);
    return /** @type {T} */ (uit);
  }
  return waarde;
}

/** @param {unknown} item @returns {Record_} */
function normaliseerRecord(item) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('Record is geen object');
  /** @type {Record_} */
  const uit = {};
  for (const [k, v] of Object.entries(item)) {
    if (TEKSTVELDEN.has(k)) uit[k] = samentrekken(v);
    else if (LIJSTVELDEN.has(k)) uit[k] = Array.isArray(v) ? v.map(String).sort() : v;
    else uit[k] = v;
  }
  return sorteerSleutels(uit);
}

/**
 * Ruw document (van de RPC of uit het snapshotbestand) → genormaliseerd:
 * vaste secties, records gesorteerd op sleutel, tekst samengetrokken,
 * sleutels alfabetisch. Idempotent: normaliseer(normaliseer(x)) == normaliseer(x).
 * @param {unknown} ruw
 * @returns {Snapshot}
 */
export function normaliseer(ruw) {
  if (!ruw || typeof ruw !== 'object' || Array.isArray(ruw)) throw new Error('Snapshot is geen object');
  const bron = /** @type {Record<string, unknown>} */ (ruw);
  /** @type {Snapshot} */
  const uit = { versie: typeof bron.versie === 'number' ? bron.versie : 1, tabellen: [], policies: [], grants: [], functies: [] };
  for (const sectie of SECTIES) {
    const lijst = bron[sectie];
    if (lijst == null) continue;
    if (!Array.isArray(lijst)) throw new Error(`Sectie ${sectie} is geen lijst`);
    const records = lijst.map(normaliseerRecord);
    records.sort((a, b) => sleutelVan(sectie, a).localeCompare(sleutelVan(sectie, b), 'en'));
    uit[sectie] = records;
  }
  return uit;
}

/**
 * Alle records van alle secties in één Map sleutel → record. Een dubbele
 * sleutel (kan in theorie bij grants met twee grantors) krijgt een volgnummer.
 * @param {Snapshot} snapshot
 * @returns {Map<string, Record_>}
 */
export function platMaken(snapshot) {
  /** @type {Map<string, Record_>} */
  const uit = new Map();
  for (const sectie of SECTIES) {
    for (const item of snapshot[sectie] ?? []) {
      let sleutel = sleutelVan(sectie, item);
      for (let n = 2; uit.has(sleutel); n++) sleutel = `${sleutelVan(sectie, item)} #${n}`;
      uit.set(sleutel, item);
    }
  }
  return uit;
}

/** @param {unknown} a @param {unknown} b */
const gelijk = (a, b) => JSON.stringify(sorteerSleutels(a)) === JSON.stringify(sorteerSleutels(b));

/**
 * Verschil tussen twee genormaliseerde snapshots, per sleutel en per veld.
 * @param {Snapshot} oud   het gecommitte snapshotbestand
 * @param {Snapshot} nieuw de live stand
 * @returns {Diff}
 */
export function vergelijk(oud, nieuw) {
  const o = platMaken(oud);
  const n = platMaken(nieuw);
  /** @type {Diff} */
  const diff = { toegevoegd: [], verwijderd: [], gewijzigd: [] };
  for (const [sleutel, waarde] of n) if (!o.has(sleutel)) diff.toegevoegd.push({ sleutel, waarde });
  for (const [sleutel, waarde] of o) if (!n.has(sleutel)) diff.verwijderd.push({ sleutel, waarde });
  for (const [sleutel, oudWaarde] of o) {
    const nieuwWaarde = n.get(sleutel);
    if (!nieuwWaarde) continue;
    const velden = [...new Set([...Object.keys(oudWaarde), ...Object.keys(nieuwWaarde)])].sort();
    /** @type {VeldVerschil[]} */
    const verschillen = [];
    for (const veld of velden) {
      if (!gelijk(oudWaarde[veld], nieuwWaarde[veld])) verschillen.push({ veld, oud: oudWaarde[veld], nieuw: nieuwWaarde[veld] });
    }
    if (verschillen.length) diff.gewijzigd.push({ sleutel, velden: verschillen });
  }
  return diff;
}

/** @param {Diff} diff */
export const heeftDrift = (diff) => diff.toegevoegd.length + diff.verwijderd.length + diff.gewijzigd.length > 0;

/** @param {unknown} v */
const toon = (v) => {
  if (v === undefined) return '(ontbreekt)';
  if (v === null) return 'null';
  if (Array.isArray(v)) return v.length ? v.map(String).join(', ') : '(leeg)';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
};

/** Waarde onder een label, met inspringing; lange tekst blijft op één regel (samengetrokken). */
const regel = (label, v, inspring = '    ') => `${inspring}${label}: ${toon(v)}`;

/**
 * Leesbare diff voor de terminal en de CI-log: + toegevoegd, - verwijderd,
 * ~ gewijzigd (per veld oud en nieuw).
 * @param {Diff} diff
 * @returns {string}
 */
export function formatteerDiff(diff) {
  /** @type {string[]} */
  const uit = [];
  for (const { sleutel, waarde } of diff.toegevoegd) {
    uit.push(`+ ${sleutel}`);
    for (const [k, v] of Object.entries(waarde)) uit.push(regel(k, v));
  }
  for (const { sleutel, waarde } of diff.verwijderd) {
    uit.push(`- ${sleutel}`);
    for (const [k, v] of Object.entries(waarde)) uit.push(regel(k, v));
  }
  for (const { sleutel, velden } of diff.gewijzigd) {
    uit.push(`~ ${sleutel}`);
    for (const { veld, oud, nieuw } of velden) {
      uit.push(`    ${veld}:`);
      uit.push(regel('oud  ', oud, '      '));
      uit.push(regel('nieuw', nieuw, '      '));
    }
  }
  return uit.join('\n');
}

/** Telling per sectie voor de samenvattende regel. @param {Snapshot} s */
export const samenvatting = (s) => SECTIES.map((sectie) => `${s[sectie].length} ${sectie}`).join(', ');

/**
 * Snapshotbestand-tekst: genormaliseerd, sleutels gesorteerd, 2 spaties,
 * afsluitende newline. Zelfde invoer → byte-voor-byte dezelfde tekst.
 * @param {Snapshot} snapshot
 */
export const serialiseer = (snapshot) => `${JSON.stringify(sorteerSleutels(normaliseer(snapshot)), null, 2)}\n`;
