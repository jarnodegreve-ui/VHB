#!/usr/bin/env node
/**
 * Design-lint: houdt het design-systeem dicht (fase A, 03-09-2026).
 * Faalt op patronen die buiten de tokens/primitieven vallen. Draait via
 * `npm run lint:design` (en in CI vóór de typecheck).
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname, 'src');
const PRINT = /Print(MonthlySchedule|LeaveYear)View\.tsx$/;
const PRIMITIVES = /components\/(primitives|ui|Card|Field|Modal|SlideOver|Navigation|BottomNav)\.tsx$/;

const REGELS = [
  { naam: 'dark:-utility (kleuren flippen vanzelf via html.dark)', re: /\bdark:(?!hidden\b|block\b)[\w/[\]().-]+/g },
  { naam: 'bg-white/NN → bg-paper/NN', re: /\bbg-white\/(?:[3-9]\d|100)\b/g },
  { naam: 'rounded-sm / rounded-[…] buiten de radius-ladder', re: /\brounded-(?:sm|\[[^\]]+\])(?![\w-])/g },
  { naam: 'text-[NNpx] buiten de typografische ladder', re: /\btext-\[\d+px\]/g, skip: PRINT },
  { naam: 'icoonmaat buiten de ladder 12/14/16/18/20/24', re: /<(?!BrandSpinner|BrandLogo)[A-Z]\w*[^>]*?\bsize=\{(?:9|10|11|13|15|17|19|21|22|23|25|26|27|28|30|32)\}/g },
  { naam: 'tekst in statuskleur op 600 (gebruik 700, flipt in dark)', re: /\btext-(?:emerald|red|amber|oker|blue|rose)-600\b/g },
  { naam: 'ad-hoc micro-label (gebruik MicroLabel / text-micro)', re: /\btext-2xs font-(?:medium|semibold|bold|black) uppercase tracking-\[0\.08em\]/g, skip: PRINT },
  { naam: 'rauwe hex-kleur (gebruik tokens)', re: /#[0-9a-fA-F]{6}\b/g, skip: /(BrandLogo|BrandSpinner)\.tsx$|lib\/ui\.ts$|Field\.tsx$/ },
];

let fouten = 0;
function loop(dir) {
  for (const naam of fs.readdirSync(dir)) {
    const p = path.join(dir, naam);
    if (fs.statSync(p).isDirectory()) { loop(p); continue; }
    if (!/\.(tsx|ts)$/.test(p) || /\.test\.tsx?$/.test(p)) continue;
    const rel = path.relative(ROOT, p);
    const bron = fs.readFileSync(p, 'utf8');
    for (const regel of REGELS) {
      if (regel.skip && regel.skip.test(p)) continue;
      for (const m of bron.matchAll(regel.re)) {
        const lijn = bron.slice(0, m.index).split('\n').length;
        console.log(`src/${rel}:${lijn}  ${regel.naam}  →  ${m[0]}`);
        fouten++;
      }
    }
    // Rauwe <button> buiten de primitieven: toegestaan mét een `rauw:`-toelichting op de regel(s) erboven.
    if (!PRIMITIVES.test(p)) {
      const lijnen = bron.split('\n');
      lijnen.forEach((l, i) => {
        if (!/<button\b/.test(l)) return;
        const context = lijnen.slice(Math.max(0, i - 3), i + 1).join('\n');
        if (/rauw:/.test(context)) return;
        console.log(`src/${rel}:${i + 1}  rauwe <button> (gebruik Button/IconButton/FilterChip, of motiveer met {/* rauw: … */})`);
        fouten++;
      });
    }
  }
}
loop(ROOT);
if (fouten) { console.error(`\n✗ design-lint: ${fouten} bevinding(en).`); process.exit(1); }
console.log('✓ design-lint: schoon.');
