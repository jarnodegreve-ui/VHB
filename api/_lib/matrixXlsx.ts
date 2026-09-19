import { normalizePlanningMatrixDate, sortedNameToken, veilig } from "../helpers.js";
import type { PlanningMatrixRow } from "../types.js";

// --- Excel-werk van de planningsmatrix, met de xlsx-bibliotheek LUI geladen ---
// (ronde 3, 19-09) Deze functies stonden in api/helpers.ts, dat in het
// auth-pad zit: `import * as XLSX from "xlsx"` bovenaan kostte daardoor bij
// ELKE koude start het inlezen van ±1 MB SheetJS, ook voor een request dat
// nooit een Excel aanraakt. De bibliotheek komt nu pas binnen wanneer een
// import- of exportroute haar echt nodig heeft; de functies zijn daarom async.
export type XlsxModule = typeof import("xlsx");
let xlsxBelofte: Promise<XlsxModule> | null = null;
/** De xlsx-bibliotheek, één keer per instantie geladen bij het eerste gebruik. */
export const laadXlsx = (): Promise<XlsxModule> => (xlsxBelofte ??= import("xlsx"));

/**
 * Bouwt een praktijk-tab-Excel uit de ACTUELE cel-waarheid van de maand-
 * planning — de omgekeerde richting van de praktijk-tab-parser, in exact
 * hetzelfde formaat (sheet 'praktijk', kolom A datum als Excel-serial, B
 * dagtype, één kolom per chauffeur, afsluitende 'aantal'-kolom). Doel: de
 * planner start zijn volgende Excel-bewerking op de werkelijke stand
 * (wissels, toewijzingen, ziektes verwerkt) in plaats van op de verouderde
 * upload — en het bestand is direct her-importeerbaar.
 */
export const bouwMatrixXlsx = async (
  dates: string[],
  dayTypeByDate: Map<string, string>,
  chauffeurs: Array<{ id: string; name: string }>,
  cells: Record<string, Record<string, { code: string; kind: string }>>,
  // Optioneel tweede tabblad "maandoverzicht": per-chauffeur maandtelling
  // (diensten/uren/ziekte/verlof) als voorbereiding op de loonadministratie.
  maandoverzicht?: unknown[][],
): Promise<Buffer> => {
  const XLSX = await laadXlsx();
  const serial = (iso: string) => {
    const ms = Date.parse(`${iso}T00:00:00Z`) - Date.parse("1899-12-30T00:00:00Z");
    return Math.round(ms / 86400000);
  };
  const aoa: unknown[][] = [["datum", "dagtype", ...chauffeurs.map((c) => veilig(c.name)), "aantal"]];
  for (const iso of dates) {
    const codes = chauffeurs.map((c) => veilig(cells[c.id]?.[iso]?.code ?? ""));
    const aantal = chauffeurs.filter((c) => cells[c.id]?.[iso]?.kind === "service").length;
    aoa.push([serial(iso), dayTypeByDate.get(iso) ?? "", ...codes, aantal]);
  }
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), "praktijk");
  if (maandoverzicht && maandoverzicht.length > 0) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(maandoverzicht), "maandoverzicht");
  }
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
};

// Headers in de praktijk-tab die GEEN echte chauffeur zijn en dus
// genegeerd moeten worden bij assignment-detectie.
const PLANNING_MATRIX_NON_DRIVER_HEADERS = new Set([
  "",
  "undefined",
  "flexi/invallers",
  "flexi",
  "invallers",
  "aantal",
]);

// Excel serial → ISO YYYY-MM-DD. SheetJS rondt naar dichtstbijzijnde dag;
// we negeren tijd-fractie omdat de praktijk-tab dagniveau is.
const excelSerialToIso = (XLSX: XlsxModule, serial: number): string | null => {
  if (!Number.isFinite(serial) || serial <= 0) return null;
  const parsed = (XLSX as any).SSF?.parse_date_code?.(serial);
  if (!parsed || !parsed.y || !parsed.m || !parsed.d) return null;
  const y = String(parsed.y).padStart(4, "0");
  const m = String(parsed.m).padStart(2, "0");
  const d = String(parsed.d).padStart(2, "0");
  return `${y}-${m}-${d}`;
};

// Lees de praktijk-tab uit een .xls/.xlsx-buffer en bouw een
// PlanningMatrixRow[]-shape die de downstream pipeline
// (buildPlanningFromMatrix → preview → confirm) kan verwerken. Datums
// blijven Excel-serial zodat we geen locale-LUT nodig hebben, en lege
// cellen vs. lege strings blijven goed gescheiden.
export const parsePlanningMatrixXlsxMetWaarschuwingen = async (
  buffer: Buffer,
): Promise<{ rows: PlanningMatrixRow[]; waarschuwingen: string[] }> => {
  const XLSX = await laadXlsx();
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: false });
  const sheetName = workbook.SheetNames.find((name) => name.trim().toLowerCase() === "praktijk");
  if (!sheetName) {
    throw new Error(`Tabblad "praktijk" niet gevonden. Beschikbaar: ${workbook.SheetNames.join(", ")}`);
  }
  const sheet = workbook.Sheets[sheetName];
  if (!sheet || !sheet["!ref"]) {
    throw new Error('Tabblad "praktijk" is leeg.');
  }
  const range = XLSX.utils.decode_range(sheet["!ref"]);

  // Header-rij = rij 0. Verzamel alle kolomnamen.
  const header: string[] = [];
  for (let c = range.s.c; c <= range.e.c; c++) {
    const cell = sheet[XLSX.utils.encode_cell({ r: 0, c })];
    header.push(cell ? String(cell.v).trim() : "");
  }

  // Driver-block loopt van kolom 2 tot vóór de eerste "aantal"-kolom.
  const firstTotalsIndex = header.findIndex((cell, index) => index > 1 && cell.toLowerCase() === "aantal");
  if (firstTotalsIndex === -1) {
    throw new Error('Kolom "aantal" niet gevonden in praktijk-tab. Excel-structuur klopt niet.');
  }
  const driverColumns = header
    .slice(2, firstTotalsIndex)
    .map((name, offset) => ({ index: offset + 2, name }))
    .filter((column) => !PLANNING_MATRIX_NON_DRIVER_HEADERS.has(column.name.toLowerCase()));

  // Dubbele chauffeur-kolommen: assignments[naam] is laatste-wint, dus de
  // codes van de eerste kolom zouden geruisloos verdwijnen. Hard weigeren
  // met de namen erbij, zodat de planner het in de Excel kan rechtzetten.
  const seenHeaders = new Map<string, string>();
  const duplicateHeaders = new Set<string>();
  for (const column of driverColumns) {
    const key = column.name.trim().toLowerCase();
    if (!key) continue;
    if (seenHeaders.has(key)) duplicateHeaders.add(column.name.trim());
    else seenHeaders.set(key, column.name.trim());
  }
  if (duplicateHeaders.size > 0) {
    throw new Error(`Dubbele chauffeur-kolommen in de praktijk-tab: ${Array.from(duplicateHeaders).join(", ")}. Hernoem of verwijder de dubbele kolom en importeer opnieuw.`);
  }

  // Naamachtige kolommen NÁ de eerste "aantal"-kolom: daar begint het
  // tellingen-blok en daar leest de import bewust niet. Een chauffeur die per
  // ongeluk achteraan is toegevoegd, verdween tot nu geruisloos uit het
  // portaal — vandaar een expliciete (niet-blokkerende) waarschuwing.
  // Het tellingen-blok herhaalt per chauffeur de naam als kopje (de VHB-tab
  // doet dat zelfs drie keer): een naam die vóór "aantal" al als
  // chauffeur-kolom staat is dus géén vergeten chauffeur en krijgt geen
  // waarschuwing (25-08: 114 valse meldingen bij 38 chauffeurs).
  const NAAMACHTIG_RE = /^[a-zà-ÿ'’.-]+(\s+[a-zà-ÿ'’.-]+)+$/i;
  const chauffeurSleutels = new Set(driverColumns.map((column) => sortedNameToken(column.name)));
  const waarschuwingen: string[] = [];
  for (let i = firstTotalsIndex + 1; i < header.length; i++) {
    const naam = String(header[i] ?? "").trim();
    if (!naam) continue;
    const laag = naam.toLowerCase();
    if (laag === "aantal" || PLANNING_MATRIX_NON_DRIVER_HEADERS.has(laag)) continue;
    if (!NAAMACHTIG_RE.test(naam)) continue;
    if (chauffeurSleutels.has(sortedNameToken(naam))) continue;
    waarschuwingen.push(`Kolom "${naam}" staat ná de "aantal"-kolom en wordt niet geïmporteerd, staat daar een chauffeur, verplaats de kolom dan vóór "aantal" en importeer opnieuw.`);
  }

  // Voor diagnostiek bij faal: bewaar wat we wél zagen in kolom A.
  const seenColumnA: Array<{ row: number; type: string; raw: any; display?: string }> = [];

  const isValidIsoDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v);

  const rows: PlanningMatrixRow[] = [];

  for (let r = 1; r <= range.e.r; r++) {
    const dateCell = sheet[XLSX.utils.encode_cell({ r, c: 0 })];
    if (!dateCell || dateCell.v === undefined || dateCell.v === null) continue;

    // Bewaar de eerste paar cellen voor de foutmelding mocht parsing falen.
    if (seenColumnA.length < 5) {
      seenColumnA.push({ row: r, type: dateCell.t, raw: dateCell.v, display: dateCell.w });
    }

    // Strategie: probeer eerst Excel-serial (de schone-bron-format), val
    // dan terug op de tekstuele display-string of de raw string-waarde
    // via de bestaande normalizePlanningMatrixDate (handelt "06-Apr-26"
    // / "06-apr-26" / "06/04/2026"-achtige formats af).
    let sourceDate: string | null = null;
    if (dateCell.t === "n" && typeof dateCell.v === "number") {
      sourceDate = excelSerialToIso(XLSX, dateCell.v);
    }
    if (!sourceDate) {
      const candidate = String(dateCell.w ?? dateCell.v ?? "").trim();
      if (candidate) {
        const normalized = normalizePlanningMatrixDate(candidate);
        if (isValidIsoDate(normalized)) sourceDate = normalized;
      }
    }
    if (!sourceDate) continue;

    const dayTypeCell = sheet[XLSX.utils.encode_cell({ r, c: 1 })];
    const dayType = dayTypeCell ? String(dayTypeCell.v).trim() : "";

    const assignments: Record<string, string> = {};
    for (const driver of driverColumns) {
      const cell = sheet[XLSX.utils.encode_cell({ r, c: driver.index })];
      if (!cell || cell.v === undefined || cell.v === null) continue;
      const rawCode = String(cell.v).trim();
      if (!rawCode) continue;
      assignments[driver.name] = rawCode;
    }

    rows.push({
      id: `${sourceDate}-${r}`,
      source_date: sourceDate,
      day_type: dayType,
      assignments,
      raw_row: `xlsx:${sheetName}:r${r}`,
    });
  }

  if (rows.length === 0) {
    // Diagnostiek meegeven zodat de gebruiker direct ziet wat er in
    // kolom A stond — anders is "geen rijen" een blinde vlek.
    const sample = seenColumnA
      .map((s) => `R${s.row}: type=${s.type ?? "?"}, v=${JSON.stringify(s.raw)}, w=${JSON.stringify(s.display ?? "")}`)
      .join(" | ");
    const detail = sample ? ` Kolom A zag: ${sample}` : ' Kolom A was volledig leeg.';
    throw new Error(`Geen rijen met datum gevonden in praktijk-tab.${detail}`);
  }

  // Dubbele datumrijen: de maandplanning toont dan enkel de laatste rij
  // terwijl de planning-opbouw beide verwerkt (dubbele shift-ids → de hele
  // import faalt pas ná het parsen). Hard weigeren met de datums erbij.
  const seenDates = new Set<string>();
  const duplicateDates = new Set<string>();
  for (const row of rows) {
    if (seenDates.has(row.source_date)) duplicateDates.add(row.source_date);
    else seenDates.add(row.source_date);
  }
  if (duplicateDates.size > 0) {
    throw new Error(`Dubbele datumrijen in de praktijk-tab: ${Array.from(duplicateDates).sort().join(", ")}. Elke datum hoort één rij te hebben, verwijder de dubbele rij en importeer opnieuw.`);
  }

  return { rows, waarschuwingen };
};
