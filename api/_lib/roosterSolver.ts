/**
 * Roostersolver in het portaal (verbeterronde 07-09, nr. 13).
 *
 * De CP-SAT-solver (rostering/, op Render) wil één JSON-verzoek: dagtypes,
 * diensten per dagtype, kalender, chauffeurs, afwezigheden en config. Dit
 * bestand bouwt dat verzoek uit de portaaldata:
 *
 *  - dagtype per datum: dezelfde regels als Openstaande diensten
 *    (coverage_expectations: __weekdagen__, __weekdagen_<vanaf>__ en
 *    __uitzonderingen__), zodat solver en dekking dezelfde taal spreken;
 *  - diensten per dagtype: de verwachte dienstnummers uit diezelfde config,
 *    met de tijden uit het dienstoverzicht (tot drie blokken, 24+-notatie
 *    over middernacht);
 *  - chauffeurs: actieve chauffeurs, code = personeelsnummer;
 *  - afwezigheden: goedgekeurd verlof en ziekte in de periode.
 *
 * Aannames die de solver nodig heeft en het portaal niet kent, staan hier
 * expliciet en komen als waarschuwing terug in de UI: contracturen (één
 * waarde voor iedereen, instelbaar) en rijtijd (85 % van de diensttijd).
 * Zuiver, unit-getest (src/roosterSolver.test.ts).
 */
import { createHmac } from "node:crypto";
import { DEFAULT_WEEKDAYS, WEEKDAY_PERIOD_KEY_RE, normalizeCode, parseOverrides, resolveDayTypeMetBron, type WeekdagPeriode } from "../coverageGaps.js";
import type { AppUser, LeaveRecord, ServiceRecord as Service } from "../types.js";

export const SOLVER_URL_STANDAARD = "https://vhb-planner-api.onrender.com";
export const REKENTIJD_STANDAARD_S = 45;
export const REKENTIJD_MAX_S = 120;
export const CONTRACTUREN_STANDAARD = "38:00";
/** Rijtijd als aandeel van de diensttijd: het dienstoverzicht kent geen rijtijd. */
export const RIJTIJD_AANDEEL = 0.85;

type Segment = [string, string];

export type SolverVerzoek = {
  meta: { uitgegeven: string; door: string; van: string; tot: string; bron: "vhb-portaal" };
  dagtypes: Array<{ code: string; omschrijving: string; weekend: boolean }>;
  diensten: Array<{ dagtype: string; code: string; type: "V" | "L" | "G" | "D" | "N"; segmenten: Segment[]; rijtijd: string; voertuigtype: null }>;
  kalender: Array<{ datum: string; dagtype: string }>;
  chauffeurs: Array<{ code: string; naam: string; contracturen: string; actief_van?: string }>;
  afwezigheden: Array<{ chauffeur: string; van: string; tot: string; reden: "VER" | "ZIE" | "KV" }>;
  config: { solver: { max_time_s: number; workers: number } };
};

export type BouwResultaat = { verzoek: SolverVerzoek; waarschuwingen: string[] };

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIJD_RE = /^(\d{1,2}):(\d{2})$/;

export const naarMinuten = (hhmm: string): number | null => {
  const m = TIJD_RE.exec(String(hhmm ?? "").trim());
  if (!m) return null;
  const u = Number(m[1]);
  const min = Number(m[2]);
  if (min > 59) return null;
  return u * 60 + min;
};

export const naarHHMM = (minuten: number): string => {
  const m = Math.max(0, Math.round(minuten));
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
};

/** Contracturen-invoer: "38", "38:00" of "38,5" → "HH:MM". Null = ongeldig. */
export const normaliseerContracturen = (invoer: string): string | null => {
  const s = String(invoer ?? "").trim().replace(",", ".");
  if (!s) return null;
  if (TIJD_RE.test(s)) {
    const m = naarMinuten(s);
    return m !== null && m > 0 && m <= 60 * 60 ? naarHHMM(m) : null;
  }
  const n = Number(s);
  if (!Number.isFinite(n) || n <= 0 || n > 60) return null;
  return naarHHMM(Math.round(n * 60));
};

const datumsTussen = (van: string, tot: string): string[] => {
  const uit: string[] = [];
  const d = new Date(`${van}T00:00:00Z`);
  const eind = new Date(`${tot}T00:00:00Z`);
  while (d.getTime() <= eind.getTime()) {
    uit.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return uit;
};

/** Segmenten uit een dienst (blok 1 t/m 3); eindtijd vóór begintijd = over middernacht (24+). */
export const segmentenVan = (s: Service): Segment[] => {
  const paren: Array<[string | undefined, string | undefined]> = [[s.startTime, s.endTime], [s.startTime2, s.endTime2], [s.startTime3, s.endTime3]];
  const uit: Segment[] = [];
  let vorigEind = -1;
  for (const [b, e] of paren) {
    if (!b || !e) continue;
    let begin = naarMinuten(b);
    let eind = naarMinuten(e);
    if (begin === null || eind === null) continue;
    // Volgende blok vóór het vorige eind = ook over middernacht (bv. nachtdienst met pauze).
    if (begin < vorigEind) begin += 24 * 60;
    if (eind <= begin) eind += 24 * 60;
    uit.push([naarHHMM(begin), naarHHMM(eind)]);
    vorigEind = eind;
  }
  return uit;
};

/** V/L/G/D/N afgeleid uit de tijden: de solver gebruikt dit voor eerlijkheid en kleuren. */
export const dienstType = (segmenten: Segment[]): "V" | "L" | "G" | "D" | "N" => {
  if (segmenten.length === 0) return "D";
  const begin = naarMinuten(segmenten[0][0]) ?? 0;
  const eind = naarMinuten(segmenten[segmenten.length - 1][1]) ?? 0;
  if (segmenten.length > 1) {
    const gat = (naarMinuten(segmenten[1][0]) ?? 0) - (naarMinuten(segmenten[0][1]) ?? 0);
    if (gat >= 120) return "G";
  }
  if (eind > 24 * 60 || begin >= 22 * 60) return "N";
  if (begin < 6 * 60 + 30) return "V";
  if (eind > 20 * 60) return "L";
  return "D";
};

const parseWeekdagPerioden = (stored: Record<string, string[]>): WeekdagPeriode[] =>
  Object.entries(stored)
    .flatMap(([k, v]) => {
      const m = WEEKDAY_PERIOD_KEY_RE.exec(k);
      return m && Array.isArray(v) && v.length === 7 ? [{ vanaf: m[1], weekdays: v.map((x) => String(x ?? "")) }] : [];
    })
    .sort((a, b) => a.vanaf.localeCompare(b.vanaf));

const isWeekendDagtype = (dagtype: string): boolean => /zaterdag|zondag|feestdag|weekend/i.test(dagtype);

const REDEN_PER_VERLOFTYPE: Record<string, "VER" | "ZIE" | "KV"> = { betaald_verlof: "VER", ziekte: "ZIE", klein_verlet: "KV" };

export function bouwSolverVerzoek(input: {
  van: string;
  tot: string;
  door: string;
  contracturen: string;
  rekentijdS: number;
  users: AppUser[];
  services: Service[];
  leave: LeaveRecord[];
  verwachtingen: Record<string, string[]>;
  nu?: Date;
}): BouwResultaat {
  const waarschuwingen: string[] = [];
  if (!ISO_RE.test(input.van) || !ISO_RE.test(input.tot) || input.tot < input.van) throw new Error("Ongeldige periode.");
  const datums = datumsTussen(input.van, input.tot);
  if (datums.length > 63) throw new Error("Kies een periode van hooguit negen weken.");

  const stored = input.verwachtingen;
  const basisRaw = Array.isArray(stored.__weekdagen__) ? stored.__weekdagen__ : null;
  const basis = basisRaw && basisRaw.length === 7 ? basisRaw.map((x) => String(x ?? "")) : [...DEFAULT_WEEKDAYS];
  const perioden = parseWeekdagPerioden(stored);
  const overrides = parseOverrides(stored.__uitzonderingen__);

  const kalender = datums.map((datum) => {
    const { dayType } = resolveDayTypeMetBron("", datum, basis, perioden, overrides);
    return { datum, dagtype: dayType || "onbekend" };
  });
  const dagtypeCodes = [...new Set(kalender.map((k) => k.dagtype))];
  if (dagtypeCodes.includes("onbekend")) waarschuwingen.push("Voor sommige dagen is geen dagtype bekend; stel de weekdag-toewijzing in bij Openstaande diensten.");

  const perNummer = new Map<string, Service>();
  for (const s of input.services) perNummer.set(normalizeCode(s.serviceNumber), s);

  const diensten: SolverVerzoek["diensten"] = [];
  const ontbrekend = new Set<string>();
  for (const dagtype of dagtypeCodes) {
    const verwacht = Array.isArray(stored[dagtype]) ? stored[dagtype] : [];
    if (verwacht.length === 0 && dagtype !== "onbekend") waarschuwingen.push(`Dagtype “${dagtype}” heeft geen verwachte diensten; die dagen krijgen geen dienst.`);
    const gezien = new Set<string>();
    for (const nummer of verwacht) {
      const sleutel = normalizeCode(nummer);
      if (!sleutel || gezien.has(sleutel)) continue;
      gezien.add(sleutel);
      const dienst = perNummer.get(sleutel);
      if (!dienst) { ontbrekend.add(String(nummer)); continue; }
      const segmenten = segmentenVan(dienst);
      if (segmenten.length === 0) { ontbrekend.add(String(nummer)); continue; }
      const diensttijd = segmenten.reduce((som, [b, e]) => som + ((naarMinuten(e) ?? 0) - (naarMinuten(b) ?? 0)), 0);
      diensten.push({
        dagtype,
        code: String(dienst.serviceNumber).trim(),
        type: dienstType(segmenten),
        segmenten,
        rijtijd: naarHHMM(Math.floor((diensttijd * RIJTIJD_AANDEEL) / 5) * 5),
        voertuigtype: null,
      });
    }
  }
  if (ontbrekend.size > 0) waarschuwingen.push(`Niet in het dienstoverzicht (overgeslagen): ${[...ontbrekend].sort().join(", ")}.`);

  const chauffeurs = input.users
    .filter((u) => u.role === "chauffeur" && u.isActive !== false)
    .map((u) => ({
      code: String(u.employeeId || u.id).trim(),
      naam: u.name,
      contracturen: input.contracturen,
      ...(u.startDate && ISO_RE.test(u.startDate) ? { actief_van: u.startDate } : {}),
    }));
  if (chauffeurs.length === 0) throw new Error("Geen actieve chauffeurs gevonden.");
  const codeVanUser = new Map(input.users.map((u) => [String(u.id), String(u.employeeId || u.id).trim()]));

  const afwezigheden: SolverVerzoek["afwezigheden"] = input.leave
    .filter((l) => l.status === "approved" && l.startDate <= input.tot && l.endDate >= input.van)
    .flatMap((l) => {
      const code = codeVanUser.get(String(l.userId));
      if (!code || !chauffeurs.some((c) => c.code === code)) return [];
      return [{ chauffeur: code, van: l.startDate < input.van ? input.van : l.startDate, tot: l.endDate > input.tot ? input.tot : l.endDate, reden: REDEN_PER_VERLOFTYPE[String(l.type)] ?? "VER" }];
    });

  waarschuwingen.push(`Contracturen ${input.contracturen} per week voor iedereen; rijtijd geschat op ${Math.round(RIJTIJD_AANDEEL * 100)} % van de diensttijd.`);

  const nu = input.nu ?? new Date();
  return {
    verzoek: {
      meta: { uitgegeven: nu.toISOString(), door: input.door, van: input.van, tot: input.tot, bron: "vhb-portaal" },
      dagtypes: dagtypeCodes.map((code) => ({ code, omschrijving: code, weekend: isWeekendDagtype(code) })),
      diensten,
      kalender,
      chauffeurs,
      afwezigheden,
      config: { solver: { max_time_s: Math.min(REKENTIJD_MAX_S, Math.max(10, Math.round(input.rekentijdS))), workers: 4 } },
    },
    waarschuwingen,
  };
}

/** HMAC-SHA256 over de exacte JSON-bytes; de solver controleert dezelfde bytes. */
export const tekenVerzoek = (json: string, secret: string): string =>
  `sha256=${createHmac("sha256", secret).update(json, "utf8").digest("hex")}`;
