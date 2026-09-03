#!/usr/bin/env node
/**
 * Design-lint: houdt het design-systeem dicht (fase A, 03-09-2026).
 * Faalt op patronen die buiten de tokens/primitieven vallen. Draait via
 * `npm run lint:design` (en in CI vóór de typecheck).
 *
 * Verbeterronde 03-09 (nr. 15) voegde drie heuristische regels toe (kop per
 * view, `title=` als enige uitleg, `text-slate-400` op leestekst). Zolang er
 * bestaande bevindingen zijn, zijn dat waarschuwingen (exit 0); met
 * `VHB_LINT_STRIKT=1` tellen ze als fout — zet dat aan zodra de lijst leeg is.
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

const STRIKT = process.env.VHB_LINT_STRIKT === '1';
let fouten = 0;
let waarschuwingen = 0;
const waarschuw = (rel, lijn, tekst) => {
  console.log(`${STRIKT ? '' : '⚠ '}src/${rel}:${lijn}  ${tekst}`);
  if (STRIKT) fouten++; else waarschuwingen++;
};

/**
 * (b) `title="…"` als enige uitleg: een element zonder tekstinhoud en zonder
 * aria-label/label krijgt zijn betekenis alleen via de hover-tooltip — die
 * bestaat niet op touch (gebruik InfoTip, een zichtbaar label of aria-label).
 * Heuristiek per JSX-tag: `title=` in de tag, geen `aria-label`/`label`/
 * `aria-labelledby`, en (self-closing intrinsiek element) óf (geen tekst
 * tussen open- en sluittag). Self-closing hoofdlettercomponenten
 * (`<PageHeader title=… />`) slaan we over: daar is `title` de zichtbare kop.
 */
function titleAlsEnigeUitleg(bron) {
  const treffers = [];
  const tagRe = /<([A-Za-z][\w.]*)\b([^<>]*?(?:\{[^{}]*\}[^<>]*?)*?)(\/?)>/g;
  for (const m of bron.matchAll(tagRe)) {
    const [heel, naam, attrs, zelfSluitend] = m;
    if (!/\btitle=/.test(attrs)) continue;
    // <iframe title> ís de toegankelijke naam (WCAG 4.1.2) — geen tooltip.
    if (naam === 'iframe') continue;
    if (/\b(aria-label|aria-labelledby|label)=/.test(attrs)) continue;
    const intrinsiek = /^[a-z]/.test(naam);
    let inhoud = null;
    if (zelfSluitend) {
      if (!intrinsiek) continue;
      inhoud = '';
    } else {
      // Inhoud tot de bijbehorende sluittag (zelfde naam, genest meegeteld).
      const rest = bron.slice(m.index + heel.length);
      const paar = new RegExp(`<${naam.replace('.', '\\.')}\\b[^<>]*?(?<!\/)>|</${naam.replace('.', '\\.')}>`, 'g');
      let diepte = 1; let einde = -1;
      for (const t of rest.matchAll(paar)) {
        diepte += t[0].startsWith('</') ? -1 : 1;
        if (diepte === 0) { einde = t.index; break; }
      }
      if (einde < 0) continue;
      inhoud = rest.slice(0, einde)
        .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
        .replace(/<[^<>]*>/g, '')
        .replace(/\{\s*['"`][\s]*['"`]\s*\}/g, '')
        .trim();
    }
    if (inhoud === '') treffers.push({ index: m.index, tag: `<${naam}${zelfSluitend ? ' />' : '>'}` });
  }
  return treffers;
}

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
    // (a) Elke view rendert één kop: PageHeader (h1) of een eigen <h1>.
    if (/views\/(?:.*\/)?[^/]*View\.tsx$/.test(p) && !PRINT.test(p) && !/Modal/.test(naam) && !/<PageHeader\b|<h1\b/.test(bron)) {
      waarschuw(rel, 1, 'view zonder PageHeader of <h1> (één kop per scherm)');
    }
    // (b) title= als enige uitleg.
    for (const t of titleAlsEnigeUitleg(bron)) {
      waarschuw(rel, bron.slice(0, t.index).split('\n').length, `title= als enige uitleg op ${t.tag} zonder tekst/aria-label (gebruik InfoTip, zichtbaar label of aria-label)`);
    }
    // (c) text-slate-400 op leestekst (te licht, ±2,5:1): alleen voor iconen,
    // placeholders en decoratie. Per regel: kleur + tekstmaat, geen icoon.
    if (!PRINT.test(p)) {
      bron.split('\n').forEach((l, i) => {
        const zonderPlaceholder = l.replace(/placeholder:text-slate-400/g, '');
        if (!/\btext-slate-400\b/.test(zonderPlaceholder)) return;
        if (!/\btext-(?:2xs|xs|sm|base)\b/.test(l)) return;
        if (/\bsize=\{/.test(l) && !/<(?:p|span|div|td|th|li|a|button|label|h[1-6])\b/.test(l)) return;
        waarschuw(rel, i + 1, 'text-slate-400 op leestekst (gebruik text-slate-500; slate-400 alleen voor iconen/placeholder)');
      });
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
if (fouten) { console.error(`\n✗ design-lint: ${fouten} bevinding(en).${waarschuwingen ? ` (+ ${waarschuwingen} waarschuwing(en))` : ''}`); process.exit(1); }
if (waarschuwingen) console.log(`\n✓ design-lint: geen fouten; ${waarschuwingen} waarschuwing(en) (hard met VHB_LINT_STRIKT=1).`);
else console.log('✓ design-lint: schoon.');
