import { isoDate } from './availability';
import { KIND_LABEL } from './planningKind';
import { WEEKDAY_LETTER_MON } from './format';
import type { CellKind, MonthCell, MonthPlanning } from './monthPlanning';

/**
 * Pure hulpfuncties van de Maandplanning (src/views/CapacityView.tsx), zonder
 * React: datumrekenwerk, de maand in de URL, het samenvoegen van twee
 * maanden in één venster, de rijen van de dagweergave, de legende en het
 * maandoverzicht. Het laden en de celtypes staan in monthPlanning.ts.
 * Verplaatst uit de view op 09-10 (stap 1 van de splitsing); het gedrag
 * ligt vast in maandplanning.test.ts.
 */

export type Chauffeur = MonthPlanning['drivers'][number];
export type Cellen = MonthPlanning['cells'];
/** De cel die in het detailvenster open staat. */
export type GekozenCel = { driverName: string; driverId: string; iso: string; cell: MonthCell };

/** Maandag (ISO-datum) van de week waarin `iso` valt. */
export const mondayOf = (iso: string) => {
  const d = new Date(`${iso}T00:00:00`);
  const day = d.getDay();
  d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day));
  return isoDate(d);
};
export const addDaysIso = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + n);
  return isoDate(d);
};
export const monthOf = (iso: string) => iso.slice(0, 7);

/** Hoofdmaand in de URL (`/maandplanning/2026-10`) — spiegel van `viewMonth`;
 *  een ongeldige waarde wordt genegeerd. */
const MAAND_PARAM = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Wachttijd waarbinnen opeenvolgende planningswijzigingen tot één stille
 *  verversing samenvouwen. Ruim genoeg voor een salvo schrijfacties, kort
 *  genoeg dat het bord niet merkbaar achterloopt op een collega. */
export const PLANNING_SALVO_MS = 1200;
export const maandUitParam = (p: string | null): Date | null =>
  p && MAAND_PARAM.test(p) ? new Date(Number(p.slice(0, 4)), Number(p.slice(5, 7)) - 1, 1) : null;
export const maandNaarParam = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

/** Vaste redenen voor een handmatige dienstwissel; bij 'Andere correctie' is
 *  de vrije toelichting verplicht (de server eist altijd een reden). De
 *  ondertekende papieren ruil staat erbij sinds 18-09 (Jarno): die komt als
 *  briefje binnen en is het bewijsstuk waarnaar het ruiloverzicht verwijst. */
export const WISSEL_REDENEN = ['Ziekte', 'Mondelinge dienstruil', 'Ruil op papier ondertekend', 'Andere correctie'] as const;

/** Sleutel van een dienstnotitie: chauffeur en dag. */
export const noteKey = (driverId: string, iso: string) => `${driverId}:${iso}`;

export const formatDayMonth = (iso: string) => {
  const d = new Date(`${iso}T00:00:00`);
  try { return d.toLocaleDateString('nl-BE', { day: 'numeric', month: 'short' }); }
  catch { return iso; }
};

/** Dagkop van het raster: weekdagletter, dagnummer, weekend en maandag. */
export const dayHeader = (iso: string) => {
  const d = new Date(`${iso}T00:00:00`);
  const jsDay = d.getDay();
  return {
    letter: WEEKDAY_LETTER_MON[jsDay === 0 ? 6 : jsDay - 1],
    day: d.getDate(),
    weekend: jsDay === 0 || jsDay === 6,
    isMonday: jsDay === 1,
  };
};

export const sectionOf = (d: { section?: string | null }) => (d.section || 'Overige');
// Kop boven een sectie: de opgeslagen waarde is de korte ploegnaam uit
// gebruikersbeheer ("Reguliere"); in het bord leest "Reguliere diensten"
// beter (Jarno 09-09). Alleen weergave, de data en de keuzelijst blijven.
export const sectieLabel = (naam: string) => (/^regulier/i.test(naam.trim()) ? 'Reguliere diensten' : naam);

/** Tooltip van een cel: type, code en wat er aan de hand is. */
export const celTitel = (cell: MonthCell, heeftNotitie: boolean) => [
  `${KIND_LABEL[cell.kind]} · ${cell.code}`,
  cell.hiddenService ? `dienst ${cell.hiddenService} nog niet herverdeeld` : '',
  cell.swapId
    ? cell.swapAway
      ? `dienst ${cell.swapManual ? 'overgezet' : 'weggeruild'} naar ${cell.swapTo || 'een collega'}`
      : (cell.swapManual ? `handmatig overgezet van ${cell.swapFrom || 'een collega'}` : `geruild met ${cell.swapFrom || 'een collega'}`)
    : '',
  heeftNotitie ? 'notitie' : '',
].filter(Boolean).join(' · ') + ', klik voor details';

// Chauffeurs en cellen van hoofd- én extra maand samen (venster over een
// maandgrens); de hoofdmaand bepaalt de volgorde.
export const voegChauffeursSamen = (basis: Chauffeur[], extra: Chauffeur[]): Chauffeur[] => {
  if (extra.length === 0) return basis;
  const ids = new Set(basis.map((d) => d.id));
  return [...basis, ...extra.filter((d) => !ids.has(d.id))];
};
export const voegCellenSamen = (basis: Cellen, extraCells: Cellen): Cellen => {
  if (Object.keys(extraCells).length === 0) return basis;
  const merged: Record<string, Record<string, MonthCell>> = {};
  for (const id of new Set([...Object.keys(basis), ...Object.keys(extraCells)])) {
    merged[id] = { ...(extraCells[id] ?? {}), ...(basis[id] ?? {}) };
  }
  return merged;
};

// Werkdagen per chauffeur uit de maandcellen — voedt de vervanger-sortering
// (minst gewerkt die week eerst). hiddenService telt mee als werkdag: de
// dienst staat dan nog op naam (ziekte-overlay), dus die dag is niet vrij.
export const werkdagenUitCellen = (cells: Cellen): Map<string, Set<string>> => {
  const per = new Map<string, Set<string>>();
  for (const [driverId, perDag] of Object.entries(cells)) {
    const set = new Set<string>();
    for (const [iso, cel] of Object.entries(perDag)) {
      if (cel && (cel.kind === 'service' || cel.hiddenService)) set.add(iso);
    }
    per.set(driverId, set);
  }
  return per;
};

export type Sectie = { naam: string; drivers: Chauffeur[] };
// Het desktopraster per sectie (één tbody per sectie). De API levert de
// chauffeurs al op sectie → naam, dus een nieuwe groep begint waar de
// sectie wisselt, precies waar de sectiekop vroeger tussen de rijen stond.
export const groepeerPerSectie = (zichtbareDrivers: Chauffeur[]): Sectie[] => {
  const gridSecties: Sectie[] = [];
  for (const drv of zichtbareDrivers) {
    const naam = sectionOf(drv);
    const laatste = gridSecties[gridSecties.length - 1];
    if (laatste && laatste.naam === naam) laatste.drivers.push(drv);
    else gridSecties.push({ naam, drivers: [drv] });
  }
  return gridSecties;
};

export type DagRij = { drv: Chauffeur; cell: MonthCell | undefined };
// Rijen van de mobiele dag-weergave: hoofdlijst per sectie (op dienstnummer,
// zoals het bord in het lokaal) + ingeklapte rest-groep. Zie het state-blok
// "Mobiel: dag-weergave" in de view voor het waarom.
export const bouwDagRijen = (zichtbareDrivers: Chauffeur[], cells: Cellen, mobielDag: string | null) => {
  const secties: Array<{ naam: string; rijen: DagRij[] }> = [];
  const rust: DagRij[] = [];
  if (!mobielDag) return { secties, rust };
  for (const drv of zichtbareDrivers) {
    const cell = cells[drv.id]?.[mobielDag];
    // Hoofdlijst = wat er die dag rijdt of aandacht vraagt: diensten én
    // afwezigheidscellen met een nog niet herverdeelde dienst eronder.
    if (cell && (cell.kind === 'service' || cell.hiddenService)) {
      const naam = sectionOf(drv);
      const laatste = secties[secties.length - 1];
      if (laatste && laatste.naam === naam) laatste.rijen.push({ drv, cell });
      else secties.push({ naam, rijen: [{ drv, cell }] });
    } else {
      // Vrij/afwezig/niets gepland: meestal ruis — ingeklapt onderaan.
      rust.push({ drv, cell });
    }
  }
  const codeVan = (r: DagRij) => String(r.cell?.hiddenService ?? r.cell?.code ?? '');
  for (const s of secties) s.rijen.sort((a, b) => codeVan(a).localeCompare(codeVan(b), undefined, { numeric: true }));
  return { secties, rust };
};

export type CodeLegend = {
  serviceExample: string | null;
  entries: Array<{ code: string; kind: CellKind; meaning: string }>;
  heeftRuil: boolean;
};
// Legende: de codes die in de héle maand voorkomen, elk met hun betekenis.
// Data-gedreven (geen hardgecodeerde codes) → toont "BV = Verlof", "ziek =
// Afwezig", "tk = Tijdskrediet"… precies zoals ze geïmporteerd zijn. Betekenis
// = de omschrijving uit de planningscodes indien ingesteld, anders de categorie.
export const berekenCodeLegend = (cells: Cellen): CodeLegend => {
  const map = new Map<string, { code: string; kind: CellKind; meaning: string }>();
  let serviceExample: string | null = null;
  for (const driverId of Object.keys(cells)) {
    const row = cells[driverId];
    for (const iso of Object.keys(row)) {
      const c = row[iso];
      if (c.kind === 'service') {
        if (!serviceExample) serviceExample = c.code;
        continue;
      }
      const key = c.code.trim().toLowerCase();
      if (!key || map.has(key)) continue;
      const hasDesc = !!c.label && c.label.trim().toLowerCase() !== key;
      const meaning = c.kind === 'unknown' || !hasDesc ? KIND_LABEL[c.kind] : c.label;
      map.set(key, { code: c.code, kind: c.kind, meaning });
    }
  }
  const order: CellKind[] = ['leave', 'absence', 'training', 'unknown'];
  const entries = Array.from(map.values()).sort(
    (a, b) => order.indexOf(a.kind) - order.indexOf(b.kind) || a.code.localeCompare(b.code),
  );
  const heeftRuil = Object.values(cells).some((row) => Object.values(row).some((c) => Boolean(c.swapId)));
  return { serviceExample, entries, heeftRuil };
};

// === Maandoverzicht (verbeterronde 22-08, nr. 3) =============================
// Dezelfde telling als het xlsx-tabblad (gedeelde server-berekening), maar als
// sorteerbare tabel — voor de snelle blik zonder download.
export type OverzichtRij = { driverId: string; naam: string; diensten: number; minuten: number; anderWerk: number; ziek: number; betaald: number; vrij: number; overig: Array<{ code: string; keren: number }>; dagen: number };
export type MaandOverzicht = { dagen: number; rijen: OverzichtRij[]; totaal: Record<string, number> };
export type OverzichtSortering = { kolom: keyof OverzichtRij; richting: 1 | -1 };

/** Sorteerbare kolommen van het maandoverzicht (Overig sorteert niet). */
export const OVERZICHT_KOLOMMEN = [
  ['naam', 'Chauffeur'],
  ['diensten', 'Diensten'],
  ['minuten', 'Uren'],
  ['anderWerk', 'Ander werk'],
  ['ziek', 'Ziek'],
  ['betaald', 'Betaald afw.'],
  ['vrij', 'Vrij'],
  ['dagen', 'Dagen'],
] as const;

// Kopie van formatMinutenAlsUren (api/helpers.ts) — de client mag niet
// uit api/ importeren; houd het formaat gelijk.
export const urenLabel = (minuten: number) => `${Math.floor(minuten / 60)}:${String(Math.round(minuten) % 60).padStart(2, '0')}`;

/** Tik op een kolomkop: dezelfde kolom keert om, een nieuwe cijferkolom
 *  begint aflopend, de naam oplopend. */
export const wisselOverzichtSortering = (cur: OverzichtSortering, kolom: keyof OverzichtRij): OverzichtSortering =>
  cur.kolom === kolom ? { kolom, richting: cur.richting === 1 ? -1 : 1 } : { kolom, richting: kolom === 'naam' ? 1 : -1 };

/** De rijen in de gekozen volgorde; bij gelijke waarde op naam. */
export const sorteerOverzichtRijen = (rijen: OverzichtRij[], { kolom, richting }: OverzichtSortering): OverzichtRij[] =>
  [...rijen].sort((a, b) => {
    const va = a[kolom];
    const vb = b[kolom];
    const cmp = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb));
    return cmp * richting || a.naam.localeCompare(b.naam);
  });
