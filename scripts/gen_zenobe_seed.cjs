#!/usr/bin/env node
/*
 * Genereert supabase/_seed_zenobe_reference.sql uit "data upload zenobe.xlsx".
 *
 * Bronnen (alle drie op het bureaublad, of geef de map als arg mee):
 *   data upload zenobe.xlsx tab 'voertuigen'  -> vehicles      (busnr -> MIX-id, bustype)
 *                           tab 'chauffeurs'  -> chauffeur_ids  (naam -> employee_id)
 *                           tab 'dienstloop'  -> service_loops  (dagtype+loop -> tijden/km/cat)
 *                           tab 'upload'      -> service_loops.route_id (stabiel per loop)
 *   bus-toewijzing.xlsx                       -> loop_vehicle_defaults (intern N -> 613000+N)
 *   diensten.xlsx                             -> dienst_loops  (dienst -> 1-3 loops)
 *
 * Gebruik:
 *   node scripts/gen_zenobe_seed.cjs                 # bestanden op ~/Desktop
 *   node scripts/gen_zenobe_seed.cjs "/pad/naar/map" # andere map
 */
const fs = require("node:fs");
const path = require("node:path");
const XLSX = require("xlsx");

const dir = process.argv[2] || path.join(require("node:os").homedir(), "Desktop");
const load = (name) => XLSX.readFile(path.join(dir, name)); // GEEN cellDates: tijden als ruwe fractie -> >24u (25:20) blijft intact
const wb = load("data upload zenobe.xlsx");
const wbBus = load("bus-toewijzing.xlsx");
const wbDienst = load("diensten.xlsx");

const sheetOf = (book, name) => XLSX.utils.sheet_to_json(book.Sheets[name], { header: 1, defval: null, raw: true });
const sheet = (name) => sheetOf(wb, name);

const q = (v) => (v === null || v === undefined || v === "" ? "NULL" : `'${String(v).replace(/'/g, "''")}'`);
const n = (v) => (v === null || v === undefined || v === "" || Number.isNaN(Number(v)) ? "NULL" : String(Number(v)));

// Excel-tijd (fractie van een dag) -> "HH:MM". Ondersteunt >24u (bv. 1.0556 -> 25:20),
// zodat nacht-loops die na middernacht eindigen correct blijven.
function timeToHHMM(v) {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") {
    const secs = Math.round(v * 86400);
    const h = Math.floor(secs / 3600), m = Math.floor((secs % 3600) / 60);
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  }
  return String(v);
}

// --- vehicles ---------------------------------------------------------------
// Bustype afgeleid uit de loop-categorie (G=18m, S/K=12m) die elke bus reed.
const STANDAARD = new Set([613026, 613028, 613029, 613030, 613031, 613032, 613033]);
const voertuigen = sheet("voertuigen").slice(1).filter((r) => r[0] != null);
const vehicles = voertuigen.map((r) => ({
  nummer: Number(r[0]),
  mix_id: String(r[1]),
  bustype: STANDAARD.has(Number(r[0])) ? "12m" : "18m",
}));

// --- chauffeur_ids ----------------------------------------------------------
const chauffeurs = sheet("chauffeurs").slice(1)
  .filter((r) => r[0] != null && String(r[0]).trim() !== "")
  .map((r) => ({ naam: String(r[0]).trim(), employee_id: String(r[1]).trim() }));

// --- service_loops (uit dienstloop) -----------------------------------------
// kolommen: A dagloopnr | B dagtype | C ritorder(=loopnummer) | D cat | E begin | F einde | G km
const dl = sheet("dienstloop").slice(1);
const loops = new Map(); // "dagtype-loop" -> record
for (const r of dl) {
  const dagtype = r[1], loop = r[2];
  if (dagtype == null || loop == null) continue;
  loops.set(`${dagtype}-${loop}`, {
    dagtype: Number(dagtype),
    loopnummer: Number(loop),
    begin_tijd: timeToHHMM(r[4]),
    einde_tijd: timeToHHMM(r[5]),
    km: r[6] == null ? null : Number(r[6]),
    categorie: r[3] == null ? null : String(r[3]).trim(),
    route_id: null,
  });
}

// --- route_id uit upload-historie (stabiel per loop) ------------------------
// kolommen: A date | H routeId(idx7) | K dagtype(idx10) | L loop(idx11)
const up = sheet("upload").slice(1);
const routeCount = new Map();   // key -> Map(routeId -> count)
for (const r of up) {
  const routeId = r[7], dagtype = r[10], loop = r[11];
  if (dagtype == null || loop == null) continue;
  if (routeId == null || routeId === "") continue;
  const key = `${dagtype}-${loop}`;
  if (!routeCount.has(key)) routeCount.set(key, new Map());
  const m = routeCount.get(key);
  m.set(String(routeId), (m.get(String(routeId)) || 0) + 1);
}

// meest voorkomende route_id terugschrijven naar de loops (en losse loops toevoegen die niet in dienstloop staan)
const ambiguousRoutes = [];
for (const [key, m] of routeCount) {
  const sorted = [...m.entries()].sort((a, b) => b[1] - a[1]);
  const best = sorted[0][0];
  if (sorted.length > 1) ambiguousRoutes.push({ key, options: sorted });
  if (!loops.has(key)) {
    const [dagtype, loop] = key.split("-").map(Number);
    loops.set(key, { dagtype, loopnummer: loop, begin_tijd: null, einde_tijd: null, km: null, categorie: null, route_id: best });
  } else {
    loops.get(key).route_id = best;
  }
}

// --- loop_vehicle_defaults uit bus-toewijzing.xlsx --------------------------
// kolommen: A dagloopnr | B dagtype | C ritorder(loop) | ... | I Bus (intern, 2-cijfer)
// Intern busnummer N -> Zenobe-nummer 613000+N (geverifieerd tegen historie).
const bt = sheetOf(wbBus, wbBus.SheetNames[0]).slice(1);
const defaults = [];
const nonZenobeBuses = new Set();
const zenobeNummers = new Set(vehicles.map((v) => v.nummer));
let skippedDefaults = 0;
for (const r of bt) {
  const dagtype = r[1], loop = r[2], busIntern = r[8];
  if (dagtype == null || loop == null || busIntern == null || busIntern === "") continue;
  const nummer = 613000 + Number(busIntern);
  // Bussen zonder MIX-id (5,6,23,24,25,44 -> 613005..) horen niet in deze lijst
  // thuis: foute invoer in bus-toewijzing. Niet seeden -> de loop toont
  // "geen standaardbus" en de planner kiest 'm in de preview.
  if (!zenobeNummers.has(nummer)) {
    nonZenobeBuses.add(nummer);
    skippedDefaults += 1;
    continue;
  }
  defaults.push({ dagtype: Number(dagtype), loopnummer: Number(loop), default_busnummer: nummer });
}

// --- dienst_loops uit diensten.xlsx -----------------------------------------
// kolommen: A dienst | B loop1 C begin1 D einde1 | E loop2 F begin2 G einde2 | H loop3 I begin3 J einde3
const dn = sheetOf(wbDienst, "diensten").slice(1);
const dienstLoops = [];
for (const r of dn) {
  const dienst = r[0];
  if (dienst == null) continue;
  const segs = [
    { loop: r[1], begin: r[2], einde: r[3] },
    { loop: r[4], begin: r[5], einde: r[6] },
    { loop: r[7], begin: r[8], einde: r[9] },
  ];
  let volgorde = 0;
  for (const s of segs) {
    if (s.loop == null || s.loop === "" || s.loop === "--") continue;
    volgorde += 1;
    dienstLoops.push({
      dienst: Number(dienst),
      volgorde,
      loopnummer: Number(s.loop),
      begin_tijd: timeToHHMM(s.begin),
      einde_tijd: timeToHHMM(s.einde),
    });
  }
}

// --- SQL bouwen -------------------------------------------------------------
const out = [];
out.push("-- AUTOGEGENEREERD door scripts/gen_zenobe_seed.cjs — niet handmatig bewerken.");
out.push("-- Bronnen: data upload zenobe.xlsx, bus-toewijzing.xlsx, diensten.xlsx");
out.push("-- Run in de Supabase SQL editor NA zenobe_export_schema.sql.");
out.push("begin;");
out.push("");

out.push("delete from public.dienst_loops;");
out.push("delete from public.loop_vehicle_defaults;");
out.push("delete from public.service_loops;");
out.push("delete from public.chauffeur_ids;");
out.push("delete from public.vehicles;");
out.push("");

out.push("insert into public.vehicles (nummer, mix_id, bustype) values");
out.push(vehicles.map((v) => `  (${v.nummer}, ${q(v.mix_id)}, ${q(v.bustype)})`).join(",\n") + ";");
out.push("");

out.push("insert into public.chauffeur_ids (naam, employee_id) values");
out.push(chauffeurs.map((c) => `  (${q(c.naam)}, ${q(c.employee_id)})`).join(",\n") + ";");
out.push("");

const loopRows = [...loops.values()].sort((a, b) => a.dagtype - b.dagtype || a.loopnummer - b.loopnummer);
out.push("insert into public.service_loops (dagtype, loopnummer, begin_tijd, einde_tijd, km, categorie, route_id) values");
out.push(loopRows.map((l) =>
  `  (${l.dagtype}, ${l.loopnummer}, ${q(l.begin_tijd)}, ${q(l.einde_tijd)}, ${n(l.km)}, ${q(l.categorie)}, ${q(l.route_id)})`
).join(",\n") + ";");
out.push("");

const defRows = defaults.sort((a, b) => a.dagtype - b.dagtype || a.loopnummer - b.loopnummer);
out.push("insert into public.loop_vehicle_defaults (dagtype, loopnummer, default_busnummer) values");
out.push(defRows.map((d) => `  (${d.dagtype}, ${d.loopnummer}, ${n(d.default_busnummer)})`).join(",\n") + ";");
out.push("");

const dienstRows = dienstLoops.sort((a, b) => a.dienst - b.dienst || a.volgorde - b.volgorde);
out.push("insert into public.dienst_loops (dienst, volgorde, loopnummer, begin_tijd, einde_tijd) values");
out.push(dienstRows.map((d) =>
  `  (${d.dienst}, ${d.volgorde}, ${d.loopnummer}, ${q(d.begin_tijd)}, ${q(d.einde_tijd)})`
).join(",\n") + ";");
out.push("");
out.push("commit;");

const outPath = path.join(__dirname, "..", "supabase", "_seed_zenobe_reference.sql");
fs.writeFileSync(outPath, out.join("\n") + "\n");

console.log(`vehicles:              ${vehicles.length}`);
console.log(`chauffeur_ids:         ${chauffeurs.length}`);
console.log(`service_loops:         ${loopRows.length}`);
console.log(`loop_vehicle_defaults: ${defRows.length}`);
console.log(`dienst_loops:          ${dienstRows.length} (uit ${new Set(dienstRows.map((d) => d.dienst)).size} diensten)`);
if (ambiguousRoutes.length) {
  console.log(`\nLET OP — ${ambiguousRoutes.length} loop(s) met wisselende RouteId (meest voorkomende gekozen):`);
  for (const a of ambiguousRoutes) console.log(`  ${a.key}: ${a.options.map(([r, c]) => `${r}(${c}x)`).join("  ")}`);
}
if (nonZenobeBuses.size) {
  console.log(`\nOvergeslagen — ${nonZenobeBuses.size} foute bus(sen) in bus-toewijzing (geen MIX-id):`);
  console.log(`  ${[...nonZenobeBuses].sort((a, b) => a - b).join(", ")}`);
  console.log(`  -> ${skippedDefaults} default(s) niet geseed; die loops tonen "geen standaardbus" in de preview.`);
}
console.log(`\nGeschreven: ${outPath}`);
