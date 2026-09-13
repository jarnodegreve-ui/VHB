import { nameIdIndex, sortedNameToken, toLookupToken } from "../helpers.js";
import { legRuilenOverMaandbeeld, type OverlayCel, type OverlayRuil } from "./ruilOverlay.js";

/**
 * De cel-waarheid van een maand: wat de planning per chauffeur per dag zegt,
 * met de goedgekeurde dienstruilen en afwezigheden erover gelegd. Stond
 * inline in GET /api/month-planning (api/index.ts); sinds fase B van de
 * Access-migratie (13-09) is dit een pure functie, zodat de dagafsluiting
 * dezelfde waarheid gebruikt als het maandbord. Gedrag ongewijzigd
 * (karakterisatietest in src/lib/celWaarheid.test.ts).
 */

export type CelWaarheidMatrixRij = { source_date: string; day_type?: string; assignments: unknown };
export type CelWaarheidUser = { id: string | number; name: string; role?: string; isActive?: boolean; section?: string | null; startDate?: string | null };
export type CelWaarheidService = { serviceNumber?: unknown; startTime?: string | null; endTime?: string | null; startTime2?: string | null; endTime2?: string | null; startTime3?: string | null; endTime3?: string | null; loopnr?: unknown; loopnr2?: unknown; loopnr3?: unknown };
export type CelWaarheidCode = { code: string; category?: string; description?: string | null };
export type CelWaarheidLeave = { userId?: unknown; startDate?: unknown; endDate?: unknown; status?: unknown; type?: unknown };

export type CelWaarheidInvoer = {
  rows: CelWaarheidMatrixRij[];
  users: CelWaarheidUser[];
  services: CelWaarheidService[];
  codes: CelWaarheidCode[];
  leave: CelWaarheidLeave[];
  swaps: OverlayRuil[];
};

export type CelWaarheidChauffeur = { id: string; name: string; section: string; startDate: string };
export type CelWaarheidUitkomst = {
  month: string;
  dates: string[];
  monthRows: CelWaarheidMatrixRij[];
  chauffeurs: CelWaarheidChauffeur[];
  cells: Record<string, Record<string, OverlayCel>>;
};

const SECTION_ORDER = ["Reguliere", "Nacht", "Flexi", "Schoolvervoer"];
const sectionRank = (s: string) => {
  const i = SECTION_ORDER.findIndex((x) => x.toLowerCase() === s.trim().toLowerCase());
  return i === -1 ? SECTION_ORDER.length : i;
};
const seniorityKey = (d: string) => d || "9999-12-31"; // geen startdatum → achteraan
const norm = (v: unknown) => String(v ?? "").trim().toLowerCase();

const LEAVE_CODE: Record<string, string> = { ziekte: "ziek", betaald_verlof: "bv", klein_verlet: "kv" };
const LEAVE_FALLBACK: Record<string, { kind: string; label: string }> = {
  ziekte: { kind: "absence", label: "Ziek" },
  betaald_verlof: { kind: "leave", label: "Betaald Verlof" },
  klein_verlet: { kind: "absence", label: "Klein Verlet" },
};

/** Actieve chauffeurs in de bordvolgorde: sectie → anciënniteit → naam. */
export const chauffeursVoorBord = (users: CelWaarheidUser[]): CelWaarheidChauffeur[] =>
  users
    .filter((u) => u.isActive !== false && u.role === "chauffeur" && norm(u.name) !== "beheerder")
    .map((u) => ({ id: String(u.id), name: u.name, section: String(u.section ?? "").trim(), startDate: String(u.startDate ?? "").trim() }))
    .sort((a, b) =>
      sectionRank(a.section) - sectionRank(b.section)
      || seniorityKey(a.startDate).localeCompare(seniorityKey(b.startDate))
      || a.name.localeCompare(b.name),
    );

export function berekenCelWaarheid(month: string, invoer: CelWaarheidInvoer): CelWaarheidUitkomst {
  const { rows, users, services, codes, leave, swaps } = invoer;
  const monthRows = rows
    .filter((r) => String(r.source_date ?? "").startsWith(`${month}-`))
    .sort((a, b) => String(a.source_date).localeCompare(String(b.source_date)));
  const dates = monthRows.map((r) => String(r.source_date));

  // Naam- en code-resolutie identiek aan buildPlanningFromMatrix (toLookupToken
  // strikt: accenten/interpunctie/hoofdletters genormaliseerd). Groepering +
  // volgorde per sectie (users.section) en anciënniteit (users.startDate).
  const chauffeurs = chauffeursVoorBord(users);
  // Volgorde-onafhankelijke index: zowel "Jan Janssen" als "Janssen Jan"
  // matcht; botsende sleutels vallen weg i.p.v. last-wins (zie nameIdIndex).
  const idByNameKey = nameIdIndex(chauffeurs);

  // Code-resolutie — zelfde token-normalisatie als de matrix-import. Label +
  // uren-segmenten gaan mee zodat de UI per cel een detail kan tonen.
  const serviceByNorm = new Map(services.map((s) => [toLookupToken(String(s.serviceNumber ?? "")), s]));
  const codeByNorm = new Map(codes.map((c) => [toLookupToken(c.code), c]));
  const withLoop = (times: string, loopnr: unknown) => {
    const loop = String(loopnr ?? "").trim();
    return loop ? `${times} (loop ${loop})` : times;
  };
  const segmentsOf = (s: CelWaarheidService): string[] => [
    s.startTime && s.endTime ? withLoop(`${s.startTime} - ${s.endTime}`, s.loopnr) : "",
    s.startTime2 && s.endTime2 ? withLoop(`${s.startTime2} - ${s.endTime2}`, s.loopnr2) : "",
    s.startTime3 && s.endTime3 ? withLoop(`${s.startTime3} - ${s.endTime3}`, s.loopnr3) : "",
  ].filter(Boolean);
  const resolve = (code: string): { kind: string; label: string; segments: string[] } | null => {
    const n = toLookupToken(code);
    if (!n) return null;
    const svc = serviceByNorm.get(n);
    if (svc) return { kind: "service", label: `Dienst ${svc.serviceNumber}`, segments: segmentsOf(svc) };
    const pc = codeByNorm.get(n);
    if (pc) return { kind: String(pc.category), label: pc.description || String(pc.code).toUpperCase(), segments: [] };
    return { kind: "unknown", label: "Onbekende code", segments: [] };
  };

  // BEWUSTE KEUZE (Jarno, 01-08-2026): afwezigheidscodes, ziekte incluis,
  // blijven voor iedereen zichtbaar, gelijk aan het bord in het lokaal. Zie
  // de toelichting bij de route (api/index.ts) en commit f2a9b33 voor de
  // maskering mocht die ooit terug moeten.
  const cells: Record<string, Record<string, OverlayCel>> = {};
  for (const row of monthRows) {
    const date = String(row.source_date);
    const assignments = row.assignments && typeof row.assignments === "object" && !Array.isArray(row.assignments) ? (row.assignments as Record<string, unknown>) : {};
    for (const [driverName, rawCode] of Object.entries(assignments)) {
      const id = idByNameKey.get(toLookupToken(driverName)) ?? idByNameKey.get(sortedNameToken(driverName));
      if (!id) continue;
      const code = String(rawCode ?? "").trim();
      if (!code) continue;
      const r = resolve(code);
      if (!r) continue;
      if (!cells[id]) cells[id] = {};
      cells[id][date] = { code, kind: r.kind, label: r.label, segments: r.segments };
    }
  }

  const chauffeurIds = new Set(chauffeurs.map((c) => c.id));

  // Goedgekeurde dienstruilen over het maandbeeld (api/_lib/ruilOverlay.ts).
  const naamVanId = (id: string) => chauffeurs.find((c) => c.id === id)?.name ?? "";
  legRuilenOverMaandbeeld(cells, swaps, { dates, chauffeurIds, naamVanId });

  // Goedgekeurde afwezigheden uit de verlof-module overschrijven de matrix-
  // cel; ziekte als laatste zodat die bij overlap wint. De overdekte dienst
  // blijft als hiddenService meegestuurd (moet herverdeeld worden).
  const overlayLeave = leave
    .filter((l) => l?.status === "approved")
    .sort((a, b) => (String(a.type) === "ziekte" ? 1 : 0) - (String(b.type) === "ziekte" ? 1 : 0));
  for (const l of overlayLeave) {
    const id = String(l.userId ?? "");
    if (!chauffeurIds.has(id)) continue;
    const code = LEAVE_CODE[String(l.type)];
    if (!code) continue;
    const start = String(l.startDate ?? "");
    const eind = String(l.endDate ?? "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(eind) || start > eind) continue;
    const r = resolve(code);
    const cel = !r || r.kind === "unknown" ? LEAVE_FALLBACK[String(l.type)] : r;
    for (const date of dates) {
      if (start <= date && date <= eind) {
        if (!cells[id]) cells[id] = {};
        const overdekt = cells[id][date];
        cells[id][date] = {
          code, kind: cel.kind, label: cel.label, segments: [],
          ...(overdekt?.kind === "service" ? { hiddenService: overdekt.code } : {}),
        };
      }
    }
  }

  return { month, dates, monthRows, chauffeurs, cells };
}
