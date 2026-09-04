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

const BUDGET_KB = 600; // gzip, alle JS in dist/assets samen (stand 30/07: 499 kB)

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
  const size = zlib.gzipSync(fs.readFileSync(path.join(dir, f))).length;
  total += size;
  perFile.push([f, size]);
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
