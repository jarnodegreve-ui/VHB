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
const PRINT = /Print(MonthlySchedule|LeaveYear|GeleBoek|Dienstwissels)View\.tsx$/;
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
  // Native datumveld oogt per browser anders (Safari desktop het slechtst):
  // altijd DateInput (Field.tsx) — de eigen kiezer met dezelfde waarde-API.
  // JSX-attributen verwerken geen escapes: pattern="\\d" levert een patroon
  // met een letterlijke backslash op en keurt élke invoer af (Beheer
  // dienstoverzicht, 15-09). Schrijf pattern="\d{2}" of pattern={'\\d{2}'}.
  { naam: 'pattern met dubbele backslash in een JSX-string (keurt alles af)', re: /\bpattern="[^"]*\\\\[^"]*"/g },
  { naam: 'native type="date" (gebruik DateInput uit Field.tsx)', re: /\btype=["']date["']/g, skip: /DatePicker\.tsx$/ },
  // Drie losse puntjes in zichtbare tekst: typografisch één teken (…). De
  // spread-operator (`...props`, `[...x]`) wordt gevolgd door een
  // identifier/haak en matcht niet; commentaar wordt vooraf weggehaald.
  { naam: 'drie puntjes in UI-tekst (gebruik …)', re: /\.\.\.(?=[\s'"`<})]|$)/gm, zonderCommentaar: true },
  // Em dash als zinsscheiding in zichtbare tekst: Jarno (06-09) wil overal een
  // komma. Een losse '—' als leegte-waarde (geen spaties eromheen) mag blijven.
  { naam: 'em dash in UI-tekst (gebruik een komma)', re: / — /g, zonderCommentaar: true },
  // Motion-ladder: duration-fast/base/slow (150/220/320 ms, index.css). De
  // minuutwijzer in DienstBalk (duration-1000) is de bewuste uitzondering.
  { naam: 'duration-NNN buiten de motion-ladder (gebruik duration-fast/base/slow)', re: /\bduration-\d+\b/g, zonderCommentaar: true, skip: /components\/DienstBalk\.tsx$/ },
  // Fabrieksschaduwen naast de gestemde stapels: elev-1/2/3 (kaart / zwevend /
  // modal), elev-accent (goud), of de oppervlakklasse zelf (surface-card,
  // glass-modal, bottom-dock, surface-table). Primitieven (knopvarianten met
  // kleurschaduw) blijven buiten schot.
  // Sinds ronde 5 (F1) ook in primitives en ui: de bron van waarheid droeg
  // de enige gekleurde gloed en fabrieksschaduwen van de app.
  { naam: 'shadow-sm/md/lg/xl (gebruik elev-1/2/3, elev-pil, elev-accent of een oppervlakklasse)', re: /(?<![\w-])(?:[\w-]+:)*shadow-(?:sm|md|lg|xl|2xl)\b/g, zonderCommentaar: true },
  { naam: 'transition-all (gebruik transition-colors, of niets: ios-pressable regelt de transities)', re: /\btransition-all\b/g, zonderCommentaar: true },
  { naam: 'losse tracking-tight (de ladder zet 0 op ≤16 px, de koprollen dragen hun eigen spatiëring)', re: /\btracking-(?:tighter|tight)\b/g, zonderCommentaar: true, skip: new RegExp(`components\\/primitives\\.tsx$|${PRINT.source}`) },
  { naam: 'kop zonder typografie-rol (text-page/section/card/subsection/row-title, text-greeting, text-micro of text-label)', re: /<h[1-6]\b[^>]*className="(?![^"]*\btext-(?:page|section|card|subsection|row)-title\b|[^"]*\btext-greeting\b|[^"]*\btext-micro\b|[^"]*\btext-label\b)[^"]*"/g, zonderCommentaar: true, skip: new RegExp(`(?:main|PreAppScreens|ToestelGeblokkeerd|TweeStapsScherm|LoginView|PrintBlad)\\.tsx$|${PRINT.source}`) },
  // Hairline-ladder: border-hairline-subtle / border-hairline /
  // border-hairline-strong (en ring-hairline[-strong]) i.p.v. rauwe slate-
  // randen; flipt in dark via de tokens. Primitieven, Table en print blijven
  // hun eigen (bewuste) randen houden.
  { naam: 'border-slate-NNN / ring-slate-NNN (gebruik border-hairline-subtle | border-hairline | border-hairline-strong)', re: /\b(?:border|ring)-slate-\d+(?:\/\d+)?\b/g, zonderCommentaar: true, skip: new RegExp(`components\\/(?:primitives|Card|Field|Table)\\.tsx$|${PRINT.source}`) },
  // divide-slate-* glipte langs de regel hierboven (controle 16-09, nr. 15):
  // scheidingslijnen in lijsten en tabellen horen op dezelfde ladder, anders
  // wijkt hun gewicht in dark mode af van de randen eromheen.
  { naam: 'divide-slate-NNN (gebruik divide-hairline-subtle | divide-hairline | divide-hairline-strong)', re: /\bdivide-slate-\d+(?:\/\d+)?\b/g, zonderCommentaar: true, skip: new RegExp(`components\\/(?:primitives|Card|Field|Table)\\.tsx$|${PRINT.source}`) },
  // Rij-hover had zes recepten door elkaar (controle 16-09, nr. 14); in dark
  // mode lichtte elk scherm daardoor anders op. Eén token: surface-row-hover
  // voor rijen, surface-soft-hover voor kaartachtige vlakken.
  { naam: 'hover:bg-slate-50/100 (gebruik hover:bg-surface-soft-hover, of hover:bg-surface-row-hover op een bg-surface-row-rij)', re: /(?<!group-)\bhover:bg-slate-(?:50|100)(?:\/\d+)?\b/g, zonderCommentaar: true, skip: new RegExp(`components\\/(?:primitives|Card|Field|Table)\\.tsx$|${PRINT.source}`) },
  // Lopende tekst heeft een rol (golf 2, punt 5): text-body (15/1.55) of
  // text-body-sm (13/1.55), allebei met text-wrap: pretty. Een losse
  // leading-relaxed is dan een recept naast de rol. De textarea in Field.tsx
  // is een input, geen tekstrol, en blijft.
  { naam: 'leading-relaxed (gebruik text-body of text-body-sm)', re: /\bleading-relaxed\b/g, zonderCommentaar: true, skip: PRIMITIVES },
  // Rauwe ISO-datum in beeld: '2026-09-17' leest als jaar/maand/dag en dat
  // vond Jarno onduidelijk (17-09). Elke datum die een mens ziet gaat door
  // src/lib/format.ts: formatDatumDMJ / formatPeriodeDMJ (17/09/2026) of
  // formatDateHuman / formatShortDay / formatDayLong ("do 17 september").
  // Deze regel kijkt naar JSX-uitvoer ({req.startDate}), niet naar sleutels
  // of URL's in template-literals.
  // Z-ladder (ronde 5): lagen heten z-sticky, z-topbar, z-zwevend, z-menu,
  // z-modal, z-toast… (index.css). `relative z-10` voor lokale stapeling in
  // een positioned ouder mag; z-20…50 en z-[N] niet.
  { naam: 'z-index buiten de ladder (gebruik z-sticky/z-topbar/z-zwevend/z-menu/z-modal/z-toast… uit index.css)', re: /(?<![\w-])(?:[\w-]+:)*z-(?:\[\d+\]|20|30|40|50)\b/g, zonderCommentaar: true },
  { naam: 'datumveld rechtstreeks in beeld (gebruik formatDatumDMJ/formatPeriodeDMJ/formatDateHuman uit lib/format)', re: /(?<![=$\w])\{[A-Za-z_$][\w$.?]*\.(?:startDate|endDate|shiftDate|returnDate|leaveStart|leaveEnd|validUntil|date|datum)\}/g, zonderCommentaar: true },
];

// text-2xs (11 px) is sinds golf 2 alleen nog voor badges, tellers en de
// text-micro-rol; lopende meta-tekst staat op text-xs (12). Toegestaan:
// `rounded-full` op dezelfde regel (teller/badge), of een `2xs:`-toelichting
// in de drie regels erboven (dichte matrixcel, as-label in een grafiek,
// compacte dienstbalk). Primitieven, navigatie, bel en print zijn uitgezonderd.
const TWEE_XS_SKIP = new RegExp(`components\\/(?:primitives|Table|BottomNav|Navigation|MeldingenBel)\\.tsx$|${PRINT.source}`);

/** Bron zonder //- en /* *\/-commentaar (voor regels die alleen UI-tekst
 *  bekijken). Regelnummers blijven kloppen: commentaar wordt vervangen
 *  door spaties, nieuwe regels blijven staan. */
const zonderCommentaar = (bron) => bron
  .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
  .replace(/(^|[^:'"`\\])\/\/[^\n]*/g, (m, voor) => voor + ' '.repeat(m.length - voor.length));

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

/**
 * (c2) Tekst-elementen (p/span/div/td/…) met `text-slate-400` in hun className
 * — ook wanneer dat blok over meerdere regels loopt — waarvan de inhoud
 * echte leestekst is: letters of cijfers in literale tekst of in een
 * string-literal binnen `{…}`. Inhoud met alleen symbolen ("—", "→", "·"),
 * alleen `{expressie}` zonder string, of alleen kind-elementen (icoon) telt
 * als decoratie/placeholder en wordt overgeslagen.
 */
function slate400Leestekst(bron) {
  const treffers = [];
  const TEKST_TAGS = /^(?:p|span|div|td|th|li|a|label|h[1-6]|small|strong|em|b|dt|dd|legend|summary|figcaption)$/;
  const tagRe = /<([A-Za-z][\w.]*)\b([^<>]*?(?:\{[^{}]*\}[^<>]*?)*?)(\/?)>/g;
  for (const m of bron.matchAll(tagRe)) {
    const [heel, naam, attrs, zelfSluitend] = m;
    if (zelfSluitend || !TEKST_TAGS.test(naam)) continue;
    // Niet: placeholder:/hover:/group-hover:-varianten, en `!text-slate-400`
    // (bewuste override op een donker vlak).
    if (!/(?<![:\w!-])text-slate-400\b/.test(attrs)) continue;
    const rest = bron.slice(m.index + heel.length);
    const paar = new RegExp(`<${naam}\\b[^<>]*?(?<!\/)>|</${naam}>`, 'g');
    let diepte = 1; let einde = -1;
    for (const t of rest.matchAll(paar)) {
      diepte += t[0].startsWith('</') ? -1 : 1;
      if (diepte === 0) { einde = t.index; break; }
    }
    if (einde < 0) continue;
    const inhoud = rest.slice(0, einde).replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
    // Literale tekst = alles buiten tags en buiten {…}; uit de expressies
    // tellen alleen string-literals mee ('dag', "onbekend").
    const strings = [...inhoud.matchAll(/\{[^{}]*\}/g)].flatMap((e) => [...e[0].matchAll(/(['"`])((?:(?!\1)[^\\]|\\.)*)\1/g)].map((q) => q[2]));
    const literaal = inhoud.replace(/\{[^{}]*\}/g, ' ').replace(/<[^<>]*>/g, ' ');
    const tekst = `${literaal} ${strings.join(' ')}`;
    if (!/[\p{L}\p{N}]/u.test(tekst)) continue;
    treffers.push({ index: m.index, tag: `<${naam}>` });
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
      const tekst = regel.zonderCommentaar ? zonderCommentaar(bron) : bron;
      for (const m of tekst.matchAll(regel.re)) {
        const lijn = bron.slice(0, m.index).split('\n').length;
        console.log(`src/${rel}:${lijn}  ${regel.naam}  →  ${m[0]}`);
        fouten++;
      }
    }
    // (a) Elke view rendert één kop: PageHeader (h1), een eigen <h1>, of
    // PrintBlad (het printblad zet de titel zelf als h1).
    if (/views\/(?:.*\/)?[^/]*View\.tsx$/.test(p) && !PRINT.test(p) && !/Modal/.test(naam) && !/<PageHeader\b|<h1\b|<PrintBlad\b/.test(bron)) {
      waarschuw(rel, 1, 'view zonder PageHeader of <h1> (één kop per scherm)');
    }
    // (b) title= als enige uitleg.
    for (const t of titleAlsEnigeUitleg(bron)) {
      waarschuw(rel, bron.slice(0, t.index).split('\n').length, `title= als enige uitleg op ${t.tag} zonder tekst/aria-label (gebruik InfoTip, zichtbaar label of aria-label)`);
    }
    // (c) text-slate-400 op leestekst (te licht, ±2,5:1): alleen voor iconen,
    // placeholders en decoratie. Per regel: kleur + tekstmaat, geen icoon.
    if (!PRINT.test(p)) {
      const gemeld = new Set();
      bron.split('\n').forEach((l, i) => {
        const zonderPlaceholder = l.replace(/placeholder:text-slate-400/g, '');
        if (!/\btext-slate-400\b/.test(zonderPlaceholder)) return;
        if (!/\btext-(?:2xs|xs|sm|base)\b/.test(l)) return;
        if (/\bsize=\{/.test(l) && !/<(?:p|span|div|td|th|li|a|button|label|h[1-6])\b/.test(l)) return;
        gemeld.add(i + 1);
        waarschuw(rel, i + 1, 'text-slate-400 op leestekst (gebruik text-slate-500; slate-400 alleen voor iconen/placeholder)');
      });
      // (c2) Zelfde regel per tekst-element, over regelgrenzen heen: een
      // multi-line className-blok, of een <span className="text-slate-400">
      // dat de tekstmaat van zijn ouder erft (controle 05-09 nr. 21). Dezelfde
      // uitzonderingen: placeholder:/hover:-varianten, een `!`-override
      // (bewust, login), en inhoud zonder letters/cijfers (icoon, streepje,
      // pijl, `{icoon}`) — dat is decoratie, geen leestekst.
      for (const t of slate400Leestekst(bron)) {
        const lijn = bron.slice(0, t.index).split('\n').length;
        if (gemeld.has(lijn)) continue;
        gemeld.add(lijn);
        waarschuw(rel, lijn, `text-slate-400 op leestekst in ${t.tag} (gebruik text-slate-500; slate-400 alleen voor iconen/placeholder)`);
      }
    }
    // text-2xs buiten badges/tellers: toegestaan met `rounded-full` op de regel
    // of een `2xs:`-toelichting op de regel(s) erboven.
    if (!TWEE_XS_SKIP.test(p)) {
      const lijnen = zonderCommentaar(bron).split('\n');
      const ruw = bron.split('\n');
      lijnen.forEach((l, i) => {
        if (!/(?<![\w-])text-2xs(?![\w-])/.test(l)) return;
        if (/\brounded-full\b/.test(l)) return;
        if (/2xs:/.test(ruw.slice(Math.max(0, i - 3), i).join('\n'))) return;
        console.log(`src/${rel}:${i + 1}  text-2xs buiten badge/teller (gebruik text-xs, of motiveer met een 2xs:-toelichting erboven)`);
        fouten++;
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

// Typografie-rollen: `cn()` (src/lib/cn.ts) kent elke `.text-<rol>` uit
// src/index.css als eigen tailwind-merge-groep. Een rol die daar ontbreekt
// ziet tailwind-merge als tekstKLEUR en gooit hij weg zodra er een
// `text-<kleur>` naast staat (kopje rendert dan als gewone tekst). Rol + kleur
// via cn() is dus toegestaan; een nieuwe rol zonder config-regel niet.
// src/lib/cn.test.ts controleert daarbovenop de eigenschappen per rol.
{
  const css = zonderCommentaar(fs.readFileSync(path.join(ROOT, 'index.css'), 'utf8'));
  const inCss = new Set([...css.matchAll(/\.text-([a-z0-9-]+)\s*\{/g)].map((m) => m[1]));
  const blok = fs.readFileSync(path.join(ROOT, 'lib/cn.ts'), 'utf8').match(/TYPOGRAFIE_ROLLEN = \{([\s\S]*?)\} as const/);
  const inConfig = new Set(blok ? [...blok[1].matchAll(/^\s*'([a-z0-9-]+)'\s*:/gm)].map((m) => m[1]) : []);
  if (!blok || inCss.size === 0) {
    console.log('src/lib/cn.ts:1  typografie-rollen: TYPOGRAFIE_ROLLEN of de .text-<rol>-klassen in src/index.css niet gevonden (vangnet kan niet vergelijken)');
    fouten++;
  }
  for (const rol of inCss) {
    if (inConfig.has(rol)) continue;
    console.log(`src/index.css  typografie-rol .text-${rol} staat niet in TYPOGRAFIE_ROLLEN (src/lib/cn.ts): cn() gooit hem weg naast een text-<kleur>`);
    fouten++;
  }
  for (const rol of inConfig) {
    if (inCss.has(rol)) continue;
    console.log(`src/lib/cn.ts  TYPOGRAFIE_ROLLEN kent '${rol}', maar src/index.css heeft geen .text-${rol} (meer)`);
    fouten++;
  }
}

if (fouten) { console.error(`\n✗ design-lint: ${fouten} bevinding(en).${waarschuwingen ? ` (+ ${waarschuwingen} waarschuwing(en))` : ''}`); process.exit(1); }
if (waarschuwingen) console.log(`\n✓ design-lint: geen fouten; ${waarschuwingen} waarschuwing(en) (hard met VHB_LINT_STRIKT=1).`);
else console.log('✓ design-lint: schoon.');
