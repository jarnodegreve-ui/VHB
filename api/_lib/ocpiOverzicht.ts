import { brusselsDay } from "../helpers.js";

/**
 * Laadpalen: de zuivere rekenlaag voor maandoverzicht, historiek en de
 * sessielijst (herwerking 08-09-2026). Geen database, geen Express: alleen
 * rijen in, cijfers uit, zodat alles hier met unit-tests dicht te timmeren
 * is (src/ocpiOverzicht.test.ts).
 *
 * Kernregels, dezelfde als de bestaande verbruikskaart (api/ocpi.ts):
 *  - Een sessie telt op de Brusselse kalenderdag waarop hij STARTTE.
 *  - INVALID-sessies (door ChargEye ongeldig verklaard) tellen nergens mee.
 *  - "Laadbeurt" = sessie met energie (kWh > 0). "Mislukt" = ChargEye's
 *    technicalFailClassification anders dan OK (HANDSHAKE_FAIL, LOW_POWER,
 *    ABRUPT_STOP, …): stekker in, maar er is niet geladen. De rest (0 kWh,
 *    OK) is een lege aankoppeling en telt alleen in het totaal.
 *  - De dagpiek is de hoogste kwartierwaarde van het totale laadvermogen
 *    (capaciteitstarief), Brusselse dag van het kwartier.
 */

const rond1 = (n: number) => Math.round(n * 10) / 10;
const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};

/** Brusselse kalenderdag van een tijdstip, "" bij onleesbare input. */
export const dagVan = (iso: unknown): string => {
  const s = String(iso ?? "");
  if (!s || Number.isNaN(new Date(s).getTime())) return "";
  return brusselsDay(s);
};

/** Wat de sessielaag per rij nodig heeft. `periodes` = raw.charging_periods,
 *  `klasse` = raw.custom.technicalFailClassification, `voertuig` =
 *  raw.custom.vehicle.model. De endpoints selecteren precies die JSON-paden
 *  (PostgREST `raw->…`), de volledige raw hoeft niet over de lijn. */
export type SessieBron = {
  id?: unknown;
  evse_uid?: unknown;
  start_date_time?: unknown;
  end_date_time?: unknown;
  kwh?: unknown;
  status?: unknown;
  periodes?: unknown;
  klasse?: unknown;
  voertuig?: unknown;
};

export type SessieDetail = {
  id: string;
  evseUid: string;
  /** Brusselse kalenderdag van de start ("" als de start onleesbaar is). */
  dag: string;
  start: string | null;
  eind: string | null;
  status: string;
  /** Totale aankoppelduur in minuten (start → eind), null zolang de sessie loopt. */
  duurMin: number | null;
  /** Minuten waarin er effectief geladen werd (som van de TIME-dimensies). */
  laadMin: number | null;
  kwh: number;
  /** Gemiddeld vermogen over de laadtijd (kWh / laaduren). */
  gemKw: number | null;
  /** Hoogste gemiddelde vermogen van één laadblok (of een POWER-meting). */
  maxKw: number | null;
  socStart: number | null;
  socEind: number | null;
  voertuig: string | null;
  /** ChargEye-classificatie: OK, HANDSHAKE_FAIL, LOW_POWER, … (null = niet meegestuurd). */
  klasse: string | null;
  ongeldig: boolean;
  laadbeurt: boolean;
  mislukt: boolean;
};

type Periode = { start_date_time?: unknown; dimensions?: Array<{ type?: unknown; volume?: unknown }> };

/** Eén sessie → afgeleide cijfers. Verdraagt rommelige CPO-data: ontbrekende
 *  periodes, tekst-getallen, kapotte tijdstempels. */
export const sessieDetail = (s: SessieBron): SessieDetail => {
  const status = String(s.status ?? "").toUpperCase();
  const kwh = Math.max(0, num(s.kwh) ?? 0);
  const start = typeof s.start_date_time === "string" && s.start_date_time ? s.start_date_time : null;
  const eind = typeof s.end_date_time === "string" && s.end_date_time ? s.end_date_time : null;
  const startMs = start ? new Date(start).getTime() : NaN;
  const eindMs = eind ? new Date(eind).getTime() : NaN;
  const duurMin = Number.isFinite(startMs) && Number.isFinite(eindMs) && eindMs >= startMs ? Math.round((eindMs - startMs) / 60000) : null;

  const periodes: Periode[] = Array.isArray(s.periodes) ? (s.periodes as Periode[]) : [];
  let laadUren = 0;
  let maxKw: number | null = null;
  let socStart: number | null = null;
  let socEind: number | null = null;
  for (const p of periodes) {
    const dims = Array.isArray(p?.dimensions) ? p.dimensions : [];
    const dim = (type: string): number | null => {
      const d = dims.find((x) => x?.type === type);
      return d ? num(d.volume) : null;
    };
    const tijd = dim("TIME");
    const energie = dim("ENERGY") ?? dim("ENERGY_IMPORT");
    if (tijd !== null && tijd > 0) {
      laadUren += tijd;
      // Blokgemiddelde alleen voor blokken van minstens 3 minuten: een
      // meetblok van seconden geeft anders fantasievermogens.
      if (energie !== null && energie > 0 && tijd >= 0.05) maxKw = Math.max(maxKw ?? 0, energie / tijd);
    }
    let power = dim("POWER");
    if (power !== null && power > 700) power = power / 1000; // watt → kW (zie dimensiesUitRaw)
    if (power !== null && power > 0) maxKw = Math.max(maxKw ?? 0, power);
    const soc = dim("STATE_OF_CHARGE");
    if (soc !== null) {
      if (socStart === null) socStart = soc;
      socEind = soc;
    }
  }
  const laadMin = periodes.length > 0 ? Math.round(laadUren * 60) : null;
  const gemKw = laadUren > 0.05 && kwh > 0 ? rond1(kwh / laadUren) : null;
  const klasseRuw = typeof s.klasse === "string" ? s.klasse.trim().slice(0, 80) : "";
  const klasse = klasseRuw || null;
  const ongeldig = status === "INVALID";
  const laadbeurt = !ongeldig && kwh > 0;
  const mislukt = !ongeldig && klasse !== null && klasse !== "OK";
  const voertuigRuw = typeof s.voertuig === "string" ? s.voertuig.trim().slice(0, 120) : "";
  return {
    id: String(s.id ?? ""),
    evseUid: String(s.evse_uid ?? ""),
    dag: dagVan(start),
    start,
    eind,
    status,
    duurMin,
    laadMin,
    kwh: rond1(kwh),
    gemKw,
    maxKw: maxKw === null ? null : rond1(maxKw),
    socStart: socStart === null ? null : Math.round(socStart),
    socEind: socEind === null ? null : Math.round(socEind),
    voertuig: voertuigRuw || null,
    klasse,
    ongeldig,
    laadbeurt,
    mislukt,
  };
};

/** Dagpiek: hoogste kwartier van een Brusselse dag. */
export type DagPiek = { kw: number; ts: string | null; charging: number };

/** Snapshots (kwartier-slots) → piek per Brusselse dag; bij gelijke stand
 *  wint het vroegste slot. */
export const dagpiekenUitSnapshots = (
  slots: Array<{ ts?: unknown; total_power_kw?: unknown; charging?: unknown }>,
): Map<string, DagPiek> => {
  const uit = new Map<string, DagPiek>();
  const gesorteerd = [...slots].sort((a, b) => String(a.ts ?? "").localeCompare(String(b.ts ?? "")));
  for (const r of gesorteerd) {
    const dag = dagVan(r.ts);
    if (!dag) continue;
    const kw = rond1(Math.max(0, num(r.total_power_kw) ?? 0));
    const cur = uit.get(dag);
    if (!cur || kw > cur.kw) uit.set(dag, { kw, ts: String(r.ts), charging: Math.max(0, Math.round(num(r.charging) ?? 0)) });
  }
  return uit;
};

/** Rijen uit ocpi_dagpieken → dezelfde map. */
export const dagpiekenUitTabel = (
  rijen: Array<{ dag?: unknown; piek_kw?: unknown; piek_ts?: unknown; charging?: unknown }>,
): Map<string, DagPiek> => {
  const uit = new Map<string, DagPiek>();
  for (const r of rijen) {
    const dag = String(r.dag ?? "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dag)) continue;
    uit.set(dag, { kw: rond1(Math.max(0, num(r.piek_kw) ?? 0)), ts: typeof r.piek_ts === "string" ? r.piek_ts : null, charging: Math.max(0, Math.round(num(r.charging) ?? 0)) });
  }
  return uit;
};

/** Twee bronnen samenvoegen: per dag de hoogste. De permanente tabel en de
 *  rollende snapshots overlappen; wie hoger is, wint. */
export const voegPiekenSamen = (...bronnen: Array<Map<string, DagPiek>>): Map<string, DagPiek> => {
  const uit = new Map<string, DagPiek>();
  for (const bron of bronnen) {
    for (const [dag, p] of bron) {
      const cur = uit.get(dag);
      if (!cur || p.kw > cur.kw) uit.set(dag, p);
    }
  }
  return uit;
};

/** Alle kalenderdagen van `van` t/m `tot` (ISO-strings, geen tijdzone). */
export const dagenReeks = (van: string, tot: string): string[] => {
  const uit: string[] = [];
  const d = new Date(`${van}T00:00:00Z`);
  const einde = new Date(`${tot}T00:00:00Z`);
  for (let guard = 0; d <= einde && guard < 400; guard++) {
    uit.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return uit;
};

export type DagRij = {
  dag: string;
  kwh: number;
  sessies: number;
  laadbeurten: number;
  mislukt: number;
  piekKw: number | null;
  piekTs: string | null;
  piekCharging: number | null;
};

/** Per kalenderdag in de periode: verbruik, tellingen en de dagpiek. Dagen
 *  zonder data staan er met 0 / null in, zodat de reeks doorloopt. */
export const bouwDagen = (
  periode: { van: string; tot: string },
  sessies: SessieDetail[],
  pieken: Map<string, DagPiek>,
): DagRij[] => {
  const per = new Map<string, { kwh: number; sessies: number; laadbeurten: number; mislukt: number }>();
  for (const s of sessies) {
    if (s.ongeldig || !s.dag || s.dag < periode.van || s.dag > periode.tot) continue;
    const cur = per.get(s.dag) ?? { kwh: 0, sessies: 0, laadbeurten: 0, mislukt: 0 };
    cur.kwh += s.kwh;
    cur.sessies += 1;
    if (s.laadbeurt) cur.laadbeurten += 1;
    if (s.mislukt) cur.mislukt += 1;
    per.set(s.dag, cur);
  }
  return dagenReeks(periode.van, periode.tot).map((dag) => {
    const v = per.get(dag);
    const p = pieken.get(dag);
    return {
      dag,
      kwh: rond1(v?.kwh ?? 0),
      sessies: v?.sessies ?? 0,
      laadbeurten: v?.laadbeurten ?? 0,
      mislukt: v?.mislukt ?? 0,
      piekKw: p ? p.kw : null,
      piekTs: p?.ts ?? null,
      piekCharging: p ? p.charging : null,
    };
  });
};

export type PuntRij = {
  evseUid: string;
  evseId: string | null;
  physicalReference: string | null;
  maxElectricPowerKw: number | null;
  kwh: number;
  /** Aandeel in het totaal van de periode, 0–100. */
  aandeel: number;
  sessies: number;
  laadbeurten: number;
  mislukt: number;
  laadMin: number;
  gemKw: number | null;
  maxKw: number | null;
};

/** Per laadpunt over de periode. Elk bekend laadpunt krijgt een rij (ook met
 *  0), een onbekende uid alleen als er kWh op staat. */
export const bouwPunten = (
  periode: { van: string; tot: string },
  sessies: SessieDetail[],
  evses: Array<{ uid: string; evse_id?: string | null; physical_reference?: string | null; max_electric_power?: number | null }>,
): PuntRij[] => {
  const per = new Map<string, { kwh: number; sessies: number; laadbeurten: number; mislukt: number; laadMin: number; laadUrenMetKwh: number; kwhMetTijd: number; maxKw: number | null }>();
  for (const s of sessies) {
    if (s.ongeldig || !s.dag || s.dag < periode.van || s.dag > periode.tot || !s.evseUid) continue;
    const cur = per.get(s.evseUid) ?? { kwh: 0, sessies: 0, laadbeurten: 0, mislukt: 0, laadMin: 0, laadUrenMetKwh: 0, kwhMetTijd: 0, maxKw: null };
    cur.kwh += s.kwh;
    cur.sessies += 1;
    if (s.laadbeurt) cur.laadbeurten += 1;
    if (s.mislukt) cur.mislukt += 1;
    if (s.laadMin !== null) cur.laadMin += s.laadMin;
    if (s.laadMin !== null && s.laadMin > 3 && s.kwh > 0) { cur.laadUrenMetKwh += s.laadMin / 60; cur.kwhMetTijd += s.kwh; }
    if (s.maxKw !== null) cur.maxKw = Math.max(cur.maxKw ?? 0, s.maxKw);
    per.set(s.evseUid, cur);
  }
  const totaal = [...per.values()].reduce((a, v) => a + v.kwh, 0);
  const maak = (uid: string, e: { evse_id?: string | null; physical_reference?: string | null; max_electric_power?: number | null } | null): PuntRij => {
    const v = per.get(uid);
    return {
      evseUid: uid,
      evseId: e?.evse_id ?? null,
      physicalReference: e?.physical_reference ?? null,
      maxElectricPowerKw: typeof e?.max_electric_power === "number" ? rond1(e.max_electric_power / 1000) : null,
      kwh: rond1(v?.kwh ?? 0),
      aandeel: totaal > 0 && v ? Math.round((v.kwh / totaal) * 1000) / 10 : 0,
      sessies: v?.sessies ?? 0,
      laadbeurten: v?.laadbeurten ?? 0,
      mislukt: v?.mislukt ?? 0,
      laadMin: v?.laadMin ?? 0,
      gemKw: v && v.laadUrenMetKwh > 0 ? rond1(v.kwhMetTijd / v.laadUrenMetKwh) : null,
      maxKw: v?.maxKw ?? null,
    };
  };
  const rijen = evses.map((e) => { const r = maak(e.uid, e); per.delete(e.uid); return r; });
  for (const [uid, v] of per) if (v.kwh > 0) rijen.push(maak(uid, null));
  return rijen;
};

export type Totalen = {
  kwh: number;
  sessies: number;
  laadbeurten: number;
  mislukt: number;
  /** Dagen met verbruik. */
  laaddagen: number;
  gemPerLaaddag: number;
  hoogsteDag: { dag: string; kwh: number } | null;
  piekKw: number | null;
  piekTs: string | null;
  piekDag: string | null;
  piekCharging: number | null;
  /** Gemiddelde van de dagpieken over dagen met een meting. */
  gemDagpiekKw: number | null;
  /** Dagen waarvoor een piekmeting bestaat (bewaking van de dekking). */
  piekDagen: number;
  laadMin: number;
};

/** Totalen over een reeks dagrijen (maand, vrije periode, jaar). */
export const bouwTotalen = (dagen: DagRij[], sessies: SessieDetail[] = []): Totalen => {
  let kwh = 0; let sess = 0; let laadbeurten = 0; let mislukt = 0; let laaddagen = 0;
  let hoogste: { dag: string; kwh: number } | null = null;
  let piek: { kw: number; ts: string | null; dag: string; charging: number | null } | null = null;
  let piekSom = 0; let piekDagen = 0;
  for (const d of dagen) {
    kwh += d.kwh; sess += d.sessies; laadbeurten += d.laadbeurten; mislukt += d.mislukt;
    if (d.kwh > 0) laaddagen += 1;
    if (d.kwh > 0 && (!hoogste || d.kwh > hoogste.kwh)) hoogste = { dag: d.dag, kwh: d.kwh };
    if (d.piekKw !== null) {
      piekDagen += 1; piekSom += d.piekKw;
      if (!piek || d.piekKw > piek.kw) piek = { kw: d.piekKw, ts: d.piekTs, dag: d.dag, charging: d.piekCharging };
    }
  }
  const laadMin = sessies.reduce((a, s) => a + (s.ongeldig ? 0 : (s.laadMin ?? 0)), 0);
  return {
    kwh: rond1(kwh),
    sessies: sess,
    laadbeurten,
    mislukt,
    laaddagen,
    gemPerLaaddag: laaddagen > 0 ? rond1(kwh / laaddagen) : 0,
    hoogsteDag: hoogste,
    piekKw: piek?.kw ?? null,
    piekTs: piek?.ts ?? null,
    piekDag: piek?.dag ?? null,
    piekCharging: piek?.charging ?? null,
    gemDagpiekKw: piekDagen > 0 ? rond1(piekSom / piekDagen) : null,
    piekDagen,
    laadMin,
  };
};

export type MaandRij = Totalen & { maand: string; dagen: number; klassen: Record<string, number> };

/** Eerste en laatste kalenderdag van "YYYY-MM". */
export const maandGrenzenVan = (maand: string): { van: string; tot: string } => {
  const [j, m] = maand.split("-").map(Number);
  const laatste = new Date(Date.UTC(j, m, 0)).getUTCDate();
  return { van: `${maand}-01`, tot: `${maand}-${String(laatste).padStart(2, "0")}` };
};

/** Historiek: één rij per kalendermaand van de eerste sessie t/m `totMaand`
 *  (doorlopend, ook lege maanden). */
export const bouwMaanden = (
  sessies: SessieDetail[],
  pieken: Map<string, DagPiek>,
  totMaand: string,
): MaandRij[] => {
  const dagen = sessies.map((s) => s.dag).filter(Boolean).sort();
  const eerste = dagen[0]?.slice(0, 7) ?? null;
  if (!eerste) return [];
  const uit: MaandRij[] = [];
  let maand = eerste;
  for (let guard = 0; maand <= totMaand && guard < 240; guard++) {
    const grenzen = maandGrenzenVan(maand);
    const inMaand = sessies.filter((s) => s.dag.slice(0, 7) === maand);
    const dagRijen = bouwDagen(grenzen, inMaand, pieken);
    const klassen: Record<string, number> = {};
    for (const s of inMaand) if (s.mislukt && s.klasse) klassen[s.klasse] = (klassen[s.klasse] ?? 0) + 1;
    uit.push({ maand, dagen: dagRijen.length, klassen, ...bouwTotalen(dagRijen, inMaand) });
    const [j, m] = maand.split("-").map(Number);
    const volgende = new Date(Date.UTC(j, m, 1));
    maand = `${volgende.getUTCFullYear()}-${String(volgende.getUTCMonth() + 1).padStart(2, "0")}`;
  }
  return uit;
};

/** Verbruik per laadpunt per maand (matrix voor de historiek-export). */
export const bouwPuntMatrix = (
  sessies: SessieDetail[],
  maanden: string[],
  evses: Array<{ uid: string; evse_id?: string | null; physical_reference?: string | null }>,
): Array<{ evseUid: string; evseId: string | null; physicalReference: string | null; perMaand: Record<string, number>; totaal: number }> => {
  const per = new Map<string, Record<string, number>>();
  for (const s of sessies) {
    if (s.ongeldig || !s.evseUid || !s.dag) continue;
    const m = s.dag.slice(0, 7);
    const rij = per.get(s.evseUid) ?? {};
    rij[m] = (rij[m] ?? 0) + s.kwh;
    per.set(s.evseUid, rij);
  }
  const maak = (uid: string, e: { evse_id?: string | null; physical_reference?: string | null } | null) => {
    const rij = per.get(uid) ?? {};
    const perMaand: Record<string, number> = {};
    let totaal = 0;
    for (const m of maanden) { perMaand[m] = rond1(rij[m] ?? 0); totaal += rij[m] ?? 0; }
    return { evseUid: uid, evseId: e?.evse_id ?? null, physicalReference: e?.physical_reference ?? null, perMaand, totaal: rond1(totaal) };
  };
  const uit = evses.map((e) => { const r = maak(e.uid, e); per.delete(e.uid); return r; });
  for (const uid of per.keys()) { const r = maak(uid, null); if (r.totaal > 0) uit.push(r); }
  return uit;
};
