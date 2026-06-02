// Zenobe-export: bouwt het upload-bestand voor het Zenobe-portaal uit de
// planning-matrix + de referentietabellen (zie supabase/zenobe_export_schema.sql).
//
// Keten: matrix (chauffeur -> dienstnummer) -> dienst_loops (dienst -> loops)
//        -> service_loops (loop -> tijden/route) + loop_vehicle_defaults (loop -> bus)
//        -> vehicles (bus -> MIX-id) + chauffeur_ids (naam -> employee_id).
import { db } from "./db.js";
import { toLookupToken } from "./helpers.js";
import type { PlanningMatrixRow } from "./types.js";

const requireDb = () => {
  if (!db) throw new Error("Supabase is niet geconfigureerd.");
  return db;
};

// CSV-formaat zoals het portaal het verwacht (sample.csv): puntkomma-gescheiden.
export const ZENOBE_HEADER = [
  "Date",
  "Shift Begin Time",
  "Shift End Time",
  "Running Board",
  "DEPOT",
  "Vehicle",
  "Driver",
  "RouteId",
] as const;

const RUNNING_BOARD = "DEPOT1";
const DEPOT = "VHB";

export interface ZenobeRow {
  // Kolommen exact zoals ze in het CSV komen.
  date: string;        // DD/MM/YYYY
  beginTime: string;   // HH:MM:SS
  endTime: string;     // HH:MM:SS
  runningBoard: string;
  depot: string;
  vehicle: string;     // MIX-id (leeg als bus geen Zenobe-bus is)
  driver: string;      // employee_id (leeg als chauffeur niet gevonden)
  routeId: string;
  // Metadata voor de UI / overrides.
  rowKey: string;
  sourceDate: string;  // YYYY-MM-DD
  dagtype: number | null;
  dienst: number;
  driverName: string;
  loopnummer: number;
  volgorde: number;
  busnummer: number | null;
  status: "ok" | "warning";
  issues: string[];
}

export interface ZenobeExport {
  range: { from: string; to: string };
  header: string[];
  rows: ZenobeRow[];
  vehicles: Record<string, { mixId: string; bustype: string }>;
  stats: {
    matrixDays: number;
    assignmentsTotal: number;
    absencesSkipped: number;
    rowsGenerated: number;
    rowsWithWarning: number;
  };
  warnings: string[];
}

// "YYYY-MM-DD" -> "DD/MM/YYYY"
const toPortalDate = (iso: string): string => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || "");
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
};

// "HH:MM" (kan >24u zijn, bv. "25:20") -> "HH:MM:SS"
const toPortalTime = (hhmm: string | null | undefined): string => {
  if (!hhmm) return "";
  return /^\d{1,2}:\d{2}$/.test(hhmm) ? `${hhmm}:00` : String(hhmm);
};

export const buildZenobeExport = async (from: string, to: string): Promise<ZenobeExport> => {
  const client = requireDb();

  const [matrixRes, chauffeursRes, loopsRes, defaultsRes, dienstRes, vehiclesRes] = await Promise.all([
    client.from("planning_matrix_rows").select("*").gte("source_date", from).lte("source_date", to).order("source_date", { ascending: true }),
    client.from("chauffeur_ids").select("*"),
    client.from("service_loops").select("*"),
    client.from("loop_vehicle_defaults").select("*"),
    client.from("dienst_loops").select("*"),
    client.from("vehicles").select("*"),
  ]);
  for (const r of [matrixRes, chauffeursRes, loopsRes, defaultsRes, dienstRes, vehiclesRes]) {
    if (r.error) throw r.error;
  }

  const matrixRows = (matrixRes.data ?? []) as PlanningMatrixRow[];

  // Naam -> employee_id. Volgorde-onafhankelijke token zodat "Voornaam Naam"
  // en "Naam Voornaam" beide matchen (zelfde aanpak als buildPlanningFromMatrix).
  const sortedToken = (name: string) => toLookupToken(name).split(/\s+/).filter(Boolean).sort().join(" ");
  const driverIdByName = new Map<string, string>();
  for (const c of chauffeursRes.data ?? []) {
    driverIdByName.set(toLookupToken(c.naam), String(c.employee_id));
    driverIdByName.set(sortedToken(c.naam), String(c.employee_id));
  }

  const serviceLoops = new Map<string, any>();
  for (const l of loopsRes.data ?? []) serviceLoops.set(`${l.dagtype}-${l.loopnummer}`, l);

  const defaultBus = new Map<string, number>();
  for (const d of defaultsRes.data ?? []) defaultBus.set(`${d.dagtype}-${d.loopnummer}`, d.default_busnummer);

  const dienstLoops = new Map<number, Array<{ volgorde: number; loopnummer: number }>>();
  for (const d of dienstRes.data ?? []) {
    if (!dienstLoops.has(d.dienst)) dienstLoops.set(d.dienst, []);
    dienstLoops.get(d.dienst)!.push({ volgorde: d.volgorde, loopnummer: d.loopnummer });
  }
  for (const arr of dienstLoops.values()) arr.sort((a, b) => a.volgorde - b.volgorde);

  const vehicles: Record<string, { mixId: string; bustype: string }> = {};
  for (const v of vehiclesRes.data ?? []) {
    if (v.mix_id) vehicles[String(v.nummer)] = { mixId: v.mix_id, bustype: v.bustype };
  }

  const rows: ZenobeRow[] = [];
  const unknownDiensten = new Set<string>();
  const unknownDrivers = new Set<string>();
  let assignmentsTotal = 0;
  let absencesSkipped = 0;

  for (const matrixRow of matrixRows) {
    const dagtype = Number.parseInt(String(matrixRow.day_type), 10);
    const dagtypeKey = Number.isNaN(dagtype) ? null : dagtype;

    for (const [driverName, rawCode] of Object.entries(matrixRow.assignments || {})) {
      assignmentsTotal += 1;
      const dienst = Number.parseInt(String(rawCode).trim(), 10);

      // Niet-numerieke code = afwezigheid/verlof (bv, ta, vrij, ...) -> overslaan.
      if (Number.isNaN(dienst)) {
        absencesSkipped += 1;
        continue;
      }

      const loops = dienstLoops.get(dienst);
      if (!loops || loops.length === 0) {
        unknownDiensten.add(String(rawCode).trim());
        continue;
      }

      const driverId = driverIdByName.get(toLookupToken(driverName)) ?? driverIdByName.get(sortedToken(driverName)) ?? null;
      if (!driverId) unknownDrivers.add(driverName);

      for (const { volgorde, loopnummer } of loops) {
        const loopKey = `${dagtypeKey}-${loopnummer}`;
        const sl = serviceLoops.get(loopKey);
        const busnummer = defaultBus.get(loopKey) ?? null;
        const veh = busnummer != null ? vehicles[String(busnummer)] : undefined;

        const issues: string[] = [];
        if (!driverId) issues.push("chauffeur onbekend");
        if (!sl) issues.push(`loop ${loopnummer} niet in service_loops voor dagtype ${dagtypeKey}`);
        if (busnummer == null) issues.push(`geen standaardbus voor loop ${loopnummer}`);
        else if (!veh) issues.push(`bus ${busnummer} heeft geen MIX-id (niet-Zenobe?)`);

        rows.push({
          date: toPortalDate(matrixRow.source_date),
          beginTime: toPortalTime(sl?.begin_tijd),
          endTime: toPortalTime(sl?.einde_tijd),
          runningBoard: RUNNING_BOARD,
          depot: DEPOT,
          vehicle: veh?.mixId ?? "",
          driver: driverId ?? "",
          routeId: sl?.route_id ?? "",
          rowKey: `${matrixRow.source_date}|${dienst}|${volgorde}`,
          sourceDate: matrixRow.source_date,
          dagtype: dagtypeKey,
          dienst,
          driverName,
          loopnummer,
          volgorde,
          busnummer,
          status: issues.length ? "warning" : "ok",
          issues,
        });
      }
    }
  }

  rows.sort((a, b) =>
    a.sourceDate.localeCompare(b.sourceDate) ||
    a.driverName.localeCompare(b.driverName) ||
    a.dienst - b.dienst ||
    a.volgorde - b.volgorde,
  );

  const warnings: string[] = [];
  if (unknownDiensten.size) warnings.push(`Onbekende dienstnummers (niet in dienst_loops): ${[...unknownDiensten].sort().join(", ")}`);
  if (unknownDrivers.size) warnings.push(`Chauffeurs niet gevonden in chauffeur_ids: ${[...unknownDrivers].sort().join(", ")}`);

  return {
    range: { from, to },
    header: [...ZENOBE_HEADER],
    rows,
    vehicles,
    stats: {
      matrixDays: matrixRows.length,
      assignmentsTotal,
      absencesSkipped,
      rowsGenerated: rows.length,
      rowsWithWarning: rows.filter((r) => r.status === "warning").length,
    },
    warnings,
  };
};

// Serialiseert (mogelijk door de UI aangepaste) rijen naar het CSV-formaat.
const csvCell = (v: string) => (/[;"\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
export const zenobeRowsToCsv = (rows: Array<Pick<ZenobeRow, "date" | "beginTime" | "endTime" | "runningBoard" | "depot" | "vehicle" | "driver" | "routeId">>): string => {
  const lines = [ZENOBE_HEADER.join(";")];
  for (const r of rows) {
    lines.push([r.date, r.beginTime, r.endTime, r.runningBoard, r.depot, r.vehicle, r.driver, r.routeId].map((c) => csvCell(String(c ?? ""))).join(";"));
  }
  return lines.join("\r\n") + "\r\n";
};
