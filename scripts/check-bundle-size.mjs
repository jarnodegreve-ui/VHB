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
 * Budget verhogen? Mag, maar doe het expliciet hier, met een reden erbij.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const BUDGET_KB = 600; // gzip, alle JS in dist/assets samen zonder de lazy pdf/xlsx-chunks (stand 14-09: ±528 kB)

// Deelbudgetten in kB gzip: stand van 14-09 + ±10 % marge.
const DEELBUDGET_KB = {
  // 18-09: main (3646295) faalt zelf op de 70-kB-grens in CI. Dezelfde bron
  // meet lokaal 69,92 kB; de badgebranch heeft evenveel ongecomprimeerde
  // bytes (232.726). 2 kB marge voorkomt dat gzip-/hashvariatie blokkeert.
  index: 72,
  'react-vendor': 68, // 61 kB
  'ui-vendor': 68, // 62 kB (lucide + motion; zit bewust in het kritieke pad, zie vite.config.ts)
  'supabase-vendor': 64, // 57 kB
  'zod-vendor': 26, // 24 kB (lazy, maar elk beheerscherm en het dashboard laden hem)
};

// Warmup-set in kB gzip (stand 14-09: chauffeur 75 kB / 29 bestanden, staf
// 100 kB / 36 bestanden). Het dashboard trekt via parseDashboardVoorkeuren
// zod-vendor (24 kB) mee; dat zit in beide sets.
// Golf 4 (15-09): staf 100 → 112 kB door VerlofBeoordeling, verlofkalender-paneel en
// planningsoverzicht-acties; budget mee omhoog met dezelfde ±10 % marge.
// 17-09: chauffeur 83 → 86. De set mat op main 82,81 kB lokaal en nét boven 83
// op de CI-runner, dus het budget was geen marge meer maar een struikeldraad:
// 0,12 kB feature-code (knop Afhandelen in Dienstruil) liet hem omvallen
// terwijl er lokaal nog ruimte leek. Nieuwe waarde = de gemeten 82,9 + ±3 kB,
// gelijk in geest aan de ±10 % marge van de andere deelbudgetten.
const WARMUP_BUDGET_KB = { chauffeur: 86, staf: 124 };

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
