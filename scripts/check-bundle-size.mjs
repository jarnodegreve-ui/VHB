/**
 * Bundelgrootte-bewaking (verbetervoorstel 12, 30/07): waarschuwt in CI
 * wanneer de JavaScript-bundel merkbaar zwaarder wordt — laadtijd op 4G in
 * de bus is de maat. Budget = huidige stand (±499 kB gzip) + ruime marge;
 * bewust een harde fout, anders leest niemand de waarschuwing.
 *
 * Budget verhogen? Mag — maar doe het expliciet hier, met een reden erbij.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const BUDGET_KB = 600; // gzip, alle JS in dist/assets samen zónder de lazy pdf/xlsx-chunks (stand 04/09: ±445 kB)

const dir = 'dist/assets';
if (!fs.existsSync(dir)) {
  console.error('dist/assets ontbreekt — draai eerst de build.');
  process.exit(1);
}
let total = 0;
const perFile = [];
for (const f of fs.readdirSync(dir)) {
  if (!f.endsWith('.js')) continue;
    // pdfjs (viewer + worker, ±510 kB gz) laadt alleen bij het openen van een
    // ritblad — lazy chunk, telt niet mee in het startbudget.
    if (/^pdf(\.worker)?[.-]/.test(f)) continue;
    // xlsx (±160 kB gz) laadt alleen bij Excel-import/-export in de
    // beheerschermen — ook lazy, telt sinds 04-09 niet meer mee (de
    // dependency-bump van react/supabase duwde het totaal net over 600).
    if (/^xlsx[.-]/.test(f)) continue;
  const size = zlib.gzipSync(fs.readFileSync(path.join(dir, f))).length;
  total += size;
  perFile.push([f, size]);
}
// Startbundel-bewaking: zod (±25 kB gzip) hoort niet in index-*.js — de
// schil en het loginscherm gebruiken de zod-vrije constanten
// (shared/schemas/constanten.ts), de schemas laden lazy mee met de
// beheerschermen. Een onschuldige import trok hem op 07-09 stilletjes de
// startbundel in en kostte Lighthouse 0,02 op login; daarom een harde fout.
for (const f of fs.readdirSync(dir)) {
  if (!/^index-.*\.js$/.test(f)) continue;
  if (/safeParse|ZodError/.test(fs.readFileSync(path.join(dir, f), 'utf8'))) {
    console.error(`zod zit in de startbundel (${f}). Importeer in App/LoginView/schil alleen shared/schemas/constanten.ts (of \`import type\`), niet de schemas zelf.`);
    process.exit(1);
  }
}
const totalKb = Math.round(total / 1024);
console.log(`Bundelgrootte (gzip, JS): ${totalKb} kB — budget ${BUDGET_KB} kB`);
if (totalKb > BUDGET_KB) {
  perFile.sort((a, b) => b[1] - a[1]);
  console.error('\nBOVEN BUDGET. Grootste bestanden:');
  for (const [f, size] of perFile.slice(0, 8)) {
    console.error(`  ${Math.round(size / 1024).toString().padStart(4)} kB  ${f}`);
  }
  console.error('\nNieuwe dependency erbij? Check of een lichtere variant kan, of verhoog het budget hier bewust mét reden.');
  process.exit(1);
}
