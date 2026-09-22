/**
 * Bundelgrootte-bewaking (verbetervoorstel 12, 30/07): waarschuwt in CI
 * wanneer de JavaScript-bundel merkbaar zwaarder wordt, laadtijd op 4G in
 * de bus is de maat. Bewust een harde fout, anders leest niemand de
 * waarschuwing.
 *
 * Vier bewakers (sinds 14-09, punt 18 van het next-level-plan, naast het
 * oude totaalbudget):
 *  1. totaal: alle JS in dist/assets samen zonder de lazy pdf/xlsx-chunks;
 *  2. deelbudgetten op de startbundel (index-*.js) en op elke vendor-chunk,
 *     zodat een regressie in de schil niet verdwijnt in de marge van het totaal;
 *  3. de warmup-set: alles wat warmViews (src/app/viewLoaders.ts) na de LCP
 *     voor een chauffeur resp. staf ophaalt, gemeten via de chunk-kaart die
 *     de build achteraan index-*.js schrijft (vite.config.ts, vhb-view-chunks);
 *  4. zod-vangrails op de sourcemap: node_modules/zod mag niet in index-*.js
 *     zitten, ook niet in een chunk die index statisch importeert, en de
 *     `z.config({ jitless: true })`-aanroep (shared/schemas/zod.ts) moet in
 *     een lazy chunk blijven bestaan (Rollup schudde hem op 14-09 een keer
 *     weg bij een verkeerde treeshake-vlag; dan komen de CSP-eval-meldingen
 *     terug). Vroeger keek dit script naar de strings `safeParse|ZodError`
 *     in de code; de sourcemap-bronnen zijn eenduidig.
 *
 *  5. zod-vrije startschermen (ronde 3, 19-09): de chunk-set van Mijn dag,
 *     het chauffeursdashboard, de plannercockpit en het rooster (de schermen
 *     waar de app op opent: `STARTSCHERMEN` plus de cockpit) mag
 *     node_modules/zod niet bevatten, ook niet via een gedeelde chunk. Ze
 *     lezen constanten en de voorkeuren-parser uit de zod-vrije modules
 *     shared/dashboardVoorkeuren.ts en shared/meldingSoorten.ts; een import
 *     uit shared/schemas/* (behalve constanten.ts of `import type`) zet
 *     zod-vendor (85 kB) terug in het eerste scherm.
 *
 * Budget verhogen? Mag, maar doe het expliciet hier, met een reden erbij.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

// gzip, alle JS in dist/assets samen zonder de lazy pdf/xlsx-chunks.
// 20-09: 600 → 615. Gemeten: main 585,9 kB (14-09 was dat ±528), met de
// pagina Rapporten 602,0 kB (+16,1: scherm, printblad, gedeelde
// filterbouwstenen, voorbeeld in het designsysteem, alles lui geladen). Dat
// is 2 kB over het oude budget; 615 = de gemeten stand plus ±2 % marge, niet
// meer. Dit totaal groeit met elk nieuw lui geladen scherm; wat de start
// bewaakt zijn de deelbudgetten hieronder (index, vendors, warmup, zod-vrij),
// en die zijn niet verschoven.
// 21-09: 615 → 630. Gemeten: main 614 kB (na rapportstap 2 en 3), met stap 4
// (ruilen en planning: zes definities, de maandkiezer en de tabel die in haar
// kader blijft schuiven) 617 kB (+3, alles in de lui geladen rapportchunks).
// 630 = de eerste meting van stap 4 (617,1) plus ±2 % (629,4), afgerond. De
// entry staat op 73,45 kB (budget 74, ongewijzigd) en de warmup-sets op 63 en
// 121 kB (66 en 124): de rapportcode zit niet in de entry en niet in de warmup.
// 22-09 (ronde 5, F2): 630 → 645. Gemeten in CI 634 kB: de nieuwe primitieven
// (Popover, Tooltip, Tabs, Sheet, Callout, Stat) en vijf nieuwe secties in
// het designsysteem-scherm, dat lui laadt. De entry staat op 75,75 kB (budget
// 76) en de warmup-sets op 65 en 127 (66 en 128): het kritieke pad groeide
// ±1,3 kB door Popover in het accountmenu, Callout in de offline-balk en
// SearchField in de toolbar. 645 = 634 plus ±2 %, afgerond; de deelbudgetten
// blijven de echte bewaker van de start.
const BUDGET_KB = 645;

// Deelbudgetten in kB gzip: stand van 14-09 + ±10 % marge.
const DEELBUDGET_KB = {
  // 18-09: main (3646295) faalt zelf op de 70-kB-grens in CI. Dezelfde bron
  // meet lokaal 69,92 kB; de badgebranch heeft evenveel ongecomprimeerde
  // bytes (232.726). 2 kB marge voorkomt dat gzip-/hashvariatie blokkeert.
  // 19-09 (ronde 3): 72 → 74. De startbundel groeit 70,0 → 71,7 kB door de
  // laadlogica zelf (poort per rol met uitgestelde collecties, gelijkheids-
  // check in de datalaag, refetch-regime, rustige polls); dat hoort in de
  // schil. Daartegenover staat 24 kB zod-vendor minder op elk startscherm en
  // 3 tot 5 calls minder in de poort. Zelfde ±2 kB marge als hierboven.
  // 21-09: 74 → 76. De bel in de topbar is een uitklapmenu geworden en houdt
  // dus open/dicht-gedrag (useDropdown) en een lazy-grens in de schil; het
  // paneel zelf (motion, acht iconen) is een eigen chunk, zoals bij
  // WerkvoorraadMenu. Lokaal 73,97 kB, wat op 74 geen marge meer is maar een
  // struikeldraad: de CI-runner mat dezelfde bron eerder ±0,3 kB hoger.
  // 22-09 (fase 2, startbundel-trim): 77 → 74 (na de skeletten-stap 76 → 77). De entry zakte 75,55 → 71,69 kB
  // doordat de werkvoorraad-berekening, de agenda-export (roosterIcs +
  // shared/ics) en de avatar-stapel lui laden (zie App.tsx); budget mee omlaag
  // zodat die winst niet stil wegsijpelt, met dezelfde ±2 kB marge.
  index: 74,
  'react-vendor': 68, // 61 kB
  'ui-vendor': 68, // 62 kB (lucide + motion; zit bewust in het kritieke pad, zie vite.config.ts)
  'supabase-vendor': 64, // 57 kB
  'zod-vendor': 26, // 24 kB (lazy, maar elk beheerscherm en het dashboard laden hem)
};

// Warmup-set in kB gzip (stand 14-09: chauffeur 75 kB / 29 bestanden, staf
// 100 kB / 36 bestanden). Tot 19-09 trok het dashboard via
// parseDashboardVoorkeuren zod-vendor (24 kB) mee in beide sets; sinds de
// zod-vrije startschermen (bewaker 5) zit zod alleen nog in de staf-set, via
// de beheerschermen dekking en verlofkalender.
// Golf 4 (15-09): staf 100 → 112 kB door VerlofBeoordeling, verlofkalender-paneel en
// planningsoverzicht-acties; budget mee omhoog met dezelfde ±10 % marge.
// 17-09: chauffeur 83 → 86. De set mat op main 82,81 kB lokaal en nét boven 83
// op de CI-runner, dus het budget was geen marge meer maar een struikeldraad:
// 0,12 kB feature-code (knop Afhandelen in Dienstruil) liet hem omvallen
// terwijl er lokaal nog ruimte leek. Nieuwe waarde = de gemeten 82,9 + ±3 kB,
// gelijk in geest aan de ±10 % marge van de andere deelbudgetten.
// 19-09: chauffeur 86 → 66. Zonder zod-vendor meet de set 59 kB; het oude
// budget zou zod ongemerkt laten terugkomen. Zelfde ±10 % marge.
// 22-09: Vandaag (dagbriefing, dock-tab van de planner) in de staf-warmup: +2 kB → 128.
// 22-09 (fase 2, startbundel-trim): chauffeur 66 → 70, staf 128 → 132. Geen
// nieuwe code: roosterIcs (1,25 kB, via het rooster), Avatar (0,64) en
// availability (0,52) zaten in index-*.js en tellen nu als eigen chunks mee
// in de warmup-set (gemeten 64,99 → 67,43 en 126,63 → 129,14). De entry
// zakte tegelijk 3,86 kB, dus per saldo laadt een ingelogde gebruiker
// minder, en het loginscherm laadt dit helemaal niet meer. Zelfde ±3 kB marge
// als op 17-09.
const WARMUP_BUDGET_KB = { chauffeur: 70, staf: 132 };

// Schermen waar de app op opent: hun chunk-set blijft zod-vrij (bewaker 5).
const ZOD_VRIJE_VIEWS = ['views/MijnDagView', 'views/DashboardView', 'views/PlannerDashboardWidgets', 'views/ScheduleView'];

const dir = 'dist/assets';
if (!fs.existsSync(dir)) {
  console.error('dist/assets ontbreekt, draai eerst de build.');
  process.exit(1);
}
const bestanden = fs.readdirSync(dir);
const lees = (f) => fs.readFileSync(path.join(dir, f));
const gzipKb = (f) => zlib.gzipSync(lees(f)).length / 1024;
const bronnen = (jsNaam) => {
  const mapNaam = `${jsNaam}.map`;
  if (!bestanden.includes(mapNaam)) return null;
  return JSON.parse(lees(mapNaam).toString('utf8')).sources ?? [];
};
const fouten = [];

// --- 1. totaal ---------------------------------------------------------------
let total = 0;
const perFile = [];
for (const f of bestanden) {
  if (!f.endsWith('.js')) continue;
  // pdfjs (viewer + worker, ±510 kB gz) laadt alleen bij het openen van een
  // ritblad: lazy chunk, telt niet mee in het startbudget.
  if (/^pdf(\.worker)?[.-]/.test(f)) continue;
  // xlsx (±160 kB gz) laadt alleen bij Excel-import/-export in de
  // beheerschermen, ook lazy, telt sinds 04-09 niet meer mee.
  if (/^xlsx[.-]/.test(f)) continue;
  const size = gzipKb(f);
  total += size;
  perFile.push([f, size]);
}
const totalKb = Math.round(total);
console.log(`Bundelgrootte (gzip, JS): ${totalKb} kB, budget ${BUDGET_KB} kB`);
if (totalKb > BUDGET_KB) {
  perFile.sort((a, b) => b[1] - a[1]);
  fouten.push(`BOVEN TOTAALBUDGET (${totalKb} > ${BUDGET_KB} kB). Grootste bestanden:\n${perFile.slice(0, 8).map(([f, s]) => `  ${Math.round(s).toString().padStart(4)} kB  ${f}`).join('\n')}`);
}

// --- 2. deelbudgetten --------------------------------------------------------
const indexJs = bestanden.find((f) => /^index-[^.]+\.js$/.test(f));
if (!indexJs) {
  console.error('Geen index-*.js in dist/assets.');
  process.exit(1);
}
for (const [naam, budget] of Object.entries(DEELBUDGET_KB)) {
  const f = bestanden.find((b) => new RegExp(`^${naam}-[^.]+\\.js$`).test(b));
  if (!f) {
    fouten.push(`Chunk ${naam}-*.js ontbreekt; is de manualChunks-regel in vite.config.ts veranderd? Pas dan ook DEELBUDGET_KB aan.`);
    continue;
  }
  const kb = gzipKb(f);
  console.log(`  ${naam.padEnd(16)} ${kb.toFixed(2).padStart(6)} kB  (budget ${budget})`);
  if (kb > budget) fouten.push(`${f} is ${kb.toFixed(2)} kB gzip, budget ${budget} kB.`);
}

// --- 4. zod-vangrails (vóór 3: de kaart staat in dezelfde index) -------------
const indexBronnen = bronnen(indexJs) ?? [];
const zodIn = (lijst) => lijst.some((s) => /node_modules\/zod\//.test(s));
if (zodIn(indexBronnen)) {
  fouten.push(`zod zit in de startbundel (${indexJs}.map noemt node_modules/zod). Importeer in App/LoginView/schil alleen shared/schemas/constanten.ts (of \`import type\`), niet de schemas zelf; zie ook de treeshake-regel in vite.config.ts.`);
}
const indexCode = lees(indexJs).toString('utf8');
const statischeImports = [...indexCode.matchAll(/from"\.\/([^"]+\.js)"/g)].map((m) => m[1]);
for (const dep of new Set(statischeImports)) {
  if (zodIn(bronnen(dep) ?? [])) fouten.push(`${indexJs} importeert ${dep} statisch en die chunk bevat zod: dat laadt bij het opstarten mee.`);
}
const heeftZodConfig = bestanden.some((f) => f.endsWith('.js') && f !== indexJs && lees(f).toString('utf8').includes('jitless:!0'));
if (!heeftZodConfig) {
  fouten.push('De aanroep z.config({ jitless: true }) (shared/schemas/zod.ts) ontbreekt in alle chunks; Rollup heeft hem weggeschud. Controleer treeshake.moduleSideEffects in vite.config.ts.');
}

// --- 3. warmup-set -----------------------------------------------------------
const kaartMatch = indexCode.match(/globalThis\.__VHB_VIEW_CHUNKS__=(\{.*?\});\n/);
if (!kaartMatch) {
  fouten.push('Geen chunk-kaart (globalThis.__VHB_VIEW_CHUNKS__) achteraan index-*.js; de plugin vhb-view-chunks in vite.config.ts werkt niet meer en de warmup valt terug op import().');
} else {
  const kaart = JSON.parse(kaartMatch[1]);

  // --- 5. zod-vrije startschermen --------------------------------------------
  for (const view of ZOD_VRIJE_VIEWS) {
    const files = kaart[view];
    if (!files) {
      fouten.push(`Startscherm '${view}' staat niet in de chunk-kaart; is de view hernoemd? Pas dan ZOD_VRIJE_VIEWS aan.`);
      continue;
    }
    const metZod = files.map((f) => f.replace(/^.*\/assets\//, '')).filter((f) => zodIn(bronnen(f) ?? []));
    if (metZod.length > 0) {
      fouten.push(`Startscherm '${view}' sleept zod mee via ${metZod.join(', ')}. Importeer in deze view en in wat ze statisch gebruikt alleen de zod-vrije modules (shared/dashboardVoorkeuren.ts, shared/meldingSoorten.ts, shared/schemas/constanten.ts) of 'import type'.`);
    }
  }
  console.log(`  zod-vrij         ${ZOD_VRIJE_VIEWS.map((v) => v.replace('views/', '')).join(', ')}`);

  const loaders = fs.readFileSync('src/app/viewLoaders.ts', 'utf8');
  // View → pad, en drift tussen het pad en de import ernaast.
  const padPerView = new Map();
  for (const m of loaders.matchAll(/^\s*'?([\w-]+)'?:\s*view\('([^']+)',\s*\(\)\s*=>\s*import\('\.\.\/([^']+)'\)\)/gm)) {
    const [, view, pad, importPad] = m;
    padPerView.set(view, pad);
    if (pad !== importPad) fouten.push(`viewLoaders.ts: view '${view}' noemt pad '${pad}' maar importeert '../${importPad}'.`);
  }
  if (padPerView.size === 0) fouten.push('viewLoaders.ts: geen view(...)-regels herkend; is de notatie veranderd? Pas dan de regex hier aan.');
  const warmupBlok = loaders.match(/WARMUP_VIEWS[^=]*=\s*\{([\s\S]*?)\n\};/);
  const lijst = (rol) => {
    const m = warmupBlok?.[1].match(new RegExp(`${rol}:\\s*\\[([^\\]]*)\\]`));
    return m ? [...m[1].matchAll(/'([\w-]+)'/g)].map((x) => x[1]) : [];
  };
  for (const rol of ['chauffeur', 'staf']) {
    const views = lijst(rol);
    if (views.length === 0) {
      fouten.push(`viewLoaders.ts: WARMUP_VIEWS.${rol} niet gevonden.`);
      continue;
    }
    const set = new Set();
    for (const v of views) {
      const pad = padPerView.get(v);
      const files = pad ? kaart[pad] : undefined;
      if (!files) {
        fouten.push(`Warmup-view '${v}' (pad ${pad ?? '?'}) staat niet in de chunk-kaart; de warmup zou hem via import() evalueren.`);
        continue;
      }
      files.forEach((f) => set.add(f.replace(/^.*\/assets\//, '')));
    }
    const kb = [...set].reduce((s, f) => s + (bestanden.includes(f) ? gzipKb(f) : 0), 0);
    console.log(`  warmup ${rol.padEnd(9)} ${Math.round(kb).toString().padStart(4)} kB  (${set.size} bestanden, budget ${WARMUP_BUDGET_KB[rol]})`);
    if (kb > WARMUP_BUDGET_KB[rol]) fouten.push(`Warmup-set ${rol} is ${Math.round(kb)} kB gzip, budget ${WARMUP_BUDGET_KB[rol]} kB. Nieuwe zware import in een van de warmup-views (${views.join(', ')})?`);
  }
}

if (fouten.length > 0) {
  console.error(`\n${fouten.join('\n\n')}`);
  console.error('\nNieuwe dependency erbij? Check of een lichtere variant kan, of verhoog het budget hier bewust mét reden.');
  process.exit(1);
}
console.log('✓ bundelbudget: binnen alle drempels.');
