import * as XLSX from "xlsx";
import type { DagRij, MaandRij, PuntRij, SessieDetail, Totalen } from "./ocpiOverzicht.js";

/**
 * Excel-exports van de laadpalenpagina (herwerking 08-09-2026). Server-side
 * met dezelfde xlsx-bibliotheek als de maandplanning: de client-bundel blijft
 * zonder de 430 kB van SheetJS. Getallen blijven getallen (Excel rekent er
 * dan mee), tijdstippen worden Brusselse tekst "2026-08-14 02:15" zodat ze
 * in elke Excel-taalinstelling hetzelfde lezen.
 */

/** Formule-injectie neutraliseren, zelfde regel als helpers.veilig: de
 *  laadpuntnamen en classificaties komen van een externe partij. */
const veilig = (raw: unknown): string => {
  const s = String(raw ?? "");
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
};

const BRUSSEL = "Europe/Brussels";
const tijdstip = (iso: string | null): string => {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = new Intl.DateTimeFormat("nl-BE", { timeZone: BRUSSEL, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(d);
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  return `${g("year")}-${g("month")}-${g("day")} ${g("hour")}:${g("minute")}`;
};
const uur = (iso: string | null): string => (iso ? tijdstip(iso).slice(11) : "");
const WEEKDAG = ["zo", "ma", "di", "wo", "do", "vr", "za"];
const weekdag = (dag: string) => WEEKDAG[new Date(`${dag}T00:00:00Z`).getUTCDay()] ?? "";
const minutenAlsUren = (min: number | null): string => (min === null ? "" : `${Math.floor(min / 60)}:${String(min % 60).padStart(2, "0")}`);
const leeg = (v: number | null | undefined): number | "" => (typeof v === "number" ? v : "");

export const KLASSE_TEKST: Record<string, string> = {
  OK: "in orde",
  HANDSHAKE_FAIL: "handshake mislukt",
  HANDSHAKE_CANCELED: "handshake afgebroken",
  LOW_POWER: "te laag vermogen",
  ABRUPT_STOP: "abrupt gestopt",
  ABRUPTLY_CANCELED: "abrupt geannuleerd",
  NOT_IDENTIFIED: "niet herkend",
};
const klasseTekst = (k: string | null): string => (k ? (KLASSE_TEKST[k] ?? k.toLowerCase().replace(/_/g, " ")) : "");

const puntNaam = (p: { evseId: string | null; physicalReference: string | null; evseUid: string }) => p.evseId ?? p.physicalReference ?? p.evseUid;

const kolombreedtes = (ws: XLSX.WorkSheet, breedtes: number[]) => { ws["!cols"] = breedtes.map((wch) => ({ wch })); };

/** Werkboek voor één periode (maand of vrije periode): Overzicht · Per dag ·
 *  Per laadpunt · Sessies. */
export const bouwPeriodeXlsx = (opts: {
  label: string;
  van: string;
  tot: string;
  totalen: Totalen;
  vorige?: { label: string; kwh: number; piekKw: number | null; laadbeurten: number } | null;
  dagen: DagRij[];
  punten: PuntRij[];
  sessies: SessieDetail[];
  puntNaamVan: (uid: string) => string;
  busVan: (evseId: string | null) => string | null;
  gemaaktOp: string;
}): Buffer => {
  const t = opts.totalen;
  const overzicht: unknown[][] = [
    ["VHB laadplein", opts.label],
    ["Periode", `${opts.van} t/m ${opts.tot}`],
    ["Gemaakt op", tijdstip(opts.gemaaktOp)],
    [],
    ["Kengetal", "Waarde", "Eenheid", "Toelichting"],
    ["Verbruik", t.kwh, "kWh", "Som van de laadsessies die in de periode startten (Brusselse tijd)."],
    ["Laadbeurten", t.laadbeurten, "", "Sessies met energie (kWh > 0)."],
    ["Mislukte aankoppelingen", t.mislukt, "", "Sessies met een ChargEye-classificatie anders dan OK."],
    ["Laaddagen", t.laaddagen, "", "Dagen met verbruik."],
    ["Gemiddeld per laaddag", t.gemPerLaaddag, "kWh", ""],
    ["Hoogste dag", t.hoogsteDag ? t.hoogsteDag.kwh : "", "kWh", t.hoogsteDag ? `${weekdag(t.hoogsteDag.dag)} ${t.hoogsteDag.dag}` : ""],
    ["Piekvermogen (kwartier)", leeg(t.piekKw), "kW", t.piekDag ? `${weekdag(t.piekDag)} ${t.piekDag} om ${uur(t.piekTs)}${typeof t.piekCharging === "number" ? `, ${t.piekCharging} bussen aan de lader` : ""}` : "geen meting"],
    ["Gemiddelde dagpiek", leeg(t.gemDagpiekKw), "kW", `over ${t.piekDagen} dagen met meting`],
    ["Laadtijd totaal", Math.round((t.laadMin / 60) * 10) / 10, "uur", "Som van de effectieve laadtijd van alle sessies."],
  ];
  if (opts.vorige) {
    overzicht.push([], ["Vergelijking", opts.vorige.label, "", ""]);
    overzicht.push(["Verbruik vorige periode", opts.vorige.kwh, "kWh", t.kwh && opts.vorige.kwh ? `${Math.round(((t.kwh - opts.vorige.kwh) / opts.vorige.kwh) * 1000) / 10} % t.o.v. vorige` : ""]);
    overzicht.push(["Piek vorige periode", leeg(opts.vorige.piekKw), "kW", ""]);
    overzicht.push(["Laadbeurten vorige periode", opts.vorige.laadbeurten, "", ""]);
  }

  const dagen: unknown[][] = [["Dag", "Weekdag", "kWh", "Laadbeurten", "Mislukt", "Sessies totaal", "Piek kW", "Piek om", "Bussen aan de lader bij piek"]];
  for (const d of opts.dagen) dagen.push([d.dag, weekdag(d.dag), d.kwh, d.laadbeurten, d.mislukt, d.sessies, leeg(d.piekKw), uur(d.piekTs), leeg(d.piekCharging)]);
  dagen.push(["Totaal", "", t.kwh, t.laadbeurten, t.mislukt, t.sessies, leeg(t.piekKw), uur(t.piekTs), leeg(t.piekCharging)]);

  const punten: unknown[][] = [["Laadpunt", "Bus", "Referentie CPO", "kWh", "Aandeel %", "Laadbeurten", "Mislukt", "Laadtijd (u:mm)", "Gem. kW", "Max. kW", "Max. vermogen paal kW"]];
  for (const p of opts.punten) punten.push([veilig(puntNaam(p)), opts.busVan(p.evseId) ?? "", veilig(p.physicalReference ?? ""), p.kwh, p.aandeel, p.laadbeurten, p.mislukt, minutenAlsUren(p.laadMin), leeg(p.gemKw), leeg(p.maxKw), leeg(p.maxElectricPowerKw)]);
  punten.push(["Totaal", "", "", t.kwh, 100, t.laadbeurten, t.mislukt, minutenAlsUren(t.laadMin), "", "", ""]);

  const sessies: unknown[][] = [["Start", "Einde", "Dag", "Laadpunt", "Bus", "kWh", "Duur (u:mm)", "Laadtijd (u:mm)", "Gem. kW", "Max. kW", "Batterij start %", "Batterij einde %", "Status", "Classificatie", "Voertuig", "Sessie-id"]];
  for (const s of opts.sessies) {
    const naam = opts.puntNaamVan(s.evseUid);
    sessies.push([
      tijdstip(s.start), tijdstip(s.eind), s.dag, veilig(naam), opts.busVan(naam) ?? "", s.kwh,
      minutenAlsUren(s.duurMin), minutenAlsUren(s.laadMin), leeg(s.gemKw), leeg(s.maxKw), leeg(s.socStart), leeg(s.socEind),
      s.ongeldig ? "ongeldig" : s.laadbeurt ? "geladen" : s.mislukt ? "mislukt" : "leeg",
      veilig(klasseTekst(s.klasse)), veilig(s.voertuig ?? ""), s.id,
    ]);
  }

  const wb = XLSX.utils.book_new();
  const wsO = XLSX.utils.aoa_to_sheet(overzicht); kolombreedtes(wsO, [28, 14, 8, 60]);
  const wsD = XLSX.utils.aoa_to_sheet(dagen); kolombreedtes(wsD, [12, 8, 10, 12, 9, 14, 9, 9, 24]);
  const wsP = XLSX.utils.aoa_to_sheet(punten); kolombreedtes(wsP, [10, 6, 16, 10, 10, 12, 9, 14, 9, 9, 20]);
  const wsS = XLSX.utils.aoa_to_sheet(sessies); kolombreedtes(wsS, [17, 17, 11, 10, 6, 9, 11, 13, 9, 9, 13, 13, 10, 20, 40, 38]);
  XLSX.utils.book_append_sheet(wb, wsO, "Overzicht");
  XLSX.utils.book_append_sheet(wb, wsD, "Per dag");
  XLSX.utils.book_append_sheet(wb, wsP, "Per laadpunt");
  XLSX.utils.book_append_sheet(wb, wsS, "Sessies");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
};

/** Werkboek voor de historiek: Per maand + matrix laadpunt × maand. */
export const bouwHistoriekXlsx = (opts: {
  maanden: MaandRij[];
  matrix: Array<{ evseId: string | null; physicalReference: string | null; evseUid: string; perMaand: Record<string, number>; totaal: number }>;
  busVan: (evseId: string | null) => string | null;
  gemaaktOp: string;
}): Buffer => {
  const perMaand: unknown[][] = [["Maand", "kWh", "Laadbeurten", "Mislukt", "Sessies totaal", "Laaddagen", "Gem. kWh per laaddag", "Hoogste dag kWh", "Hoogste dag", "Piek kW", "Piekdag", "Piek om", "Gem. dagpiek kW", "Dagen met piekmeting", "Laadtijd (uur)"]];
  for (const m of opts.maanden) {
    perMaand.push([m.maand, m.kwh, m.laadbeurten, m.mislukt, m.sessies, m.laaddagen, m.gemPerLaaddag, m.hoogsteDag?.kwh ?? "", m.hoogsteDag?.dag ?? "", leeg(m.piekKw), m.piekDag ?? "", uur(m.piekTs), leeg(m.gemDagpiekKw), m.piekDagen, Math.round((m.laadMin / 60) * 10) / 10]);
  }
  const som = (f: (m: MaandRij) => number) => Math.round(opts.maanden.reduce((a, m) => a + f(m), 0) * 10) / 10;
  const piekste = opts.maanden.reduce<MaandRij | null>((best, m) => (m.piekKw !== null && (!best || (best.piekKw ?? 0) < m.piekKw) ? m : best), null);
  perMaand.push(["Totaal", som((m) => m.kwh), som((m) => m.laadbeurten), som((m) => m.mislukt), som((m) => m.sessies), som((m) => m.laaddagen), "", "", "", leeg(piekste?.piekKw ?? null), piekste?.piekDag ?? "", uur(piekste?.piekTs ?? null), "", som((m) => m.piekDagen), som((m) => m.laadMin / 60)]);

  const maandKeys = opts.maanden.map((m) => m.maand);
  const matrix: unknown[][] = [["Laadpunt", "Bus", ...maandKeys, "Totaal kWh"]];
  for (const r of opts.matrix) matrix.push([veilig(r.evseId ?? r.physicalReference ?? r.evseUid), opts.busVan(r.evseId) ?? "", ...maandKeys.map((m) => r.perMaand[m] ?? 0), r.totaal]);
  matrix.push(["Totaal", "", ...maandKeys.map((m) => Math.round(opts.matrix.reduce((a, r) => a + (r.perMaand[m] ?? 0), 0) * 10) / 10), Math.round(opts.matrix.reduce((a, r) => a + r.totaal, 0) * 10) / 10]);

  const wb = XLSX.utils.book_new();
  const wsM = XLSX.utils.aoa_to_sheet([["VHB laadplein, historiek per maand", "", `gemaakt op ${tijdstip(opts.gemaaktOp)}`], [], ...perMaand]);
  kolombreedtes(wsM, [10, 10, 12, 9, 14, 10, 20, 15, 12, 9, 12, 9, 15, 20, 14]);
  const wsX = XLSX.utils.aoa_to_sheet(matrix); kolombreedtes(wsX, [10, 6, ...maandKeys.map(() => 9), 11]);
  XLSX.utils.book_append_sheet(wb, wsM, "Per maand");
  XLSX.utils.book_append_sheet(wb, wsX, "Laadpunt per maand");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
};
