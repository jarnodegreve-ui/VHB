#!/usr/bin/env node
/**
 * Changelog uit de gemergede pull requests (GitHub, via `gh`):
 *
 *   npm run changelog                  → herschrijft CHANGELOG.md
 *   npm run changelog -- --wat-is-nieuw → zet daarnaast een concept-item voor
 *                                        src/app/watIsNieuw.ts op stdout
 *   npm run changelog -- --sinds=2026-09-01 → concept alleen uit PR's vanaf die dag
 *
 * Gegroepeerd per (Brusselse) mergedatum, nieuwste eerst, met #nummer-links.
 * Geen extra dependencies: alleen `gh` (ingelogd) en Node. Het concept-item
 * verdeelt de regels bewust NIET over chauffeur/staf — dat blijft handwerk
 * (TODO in de output), net als de herformulering in gebruikerstaal.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const args = process.argv.slice(2);
const watIsNieuw = args.includes('--wat-is-nieuw');
const sinds = (args.find((a) => a.startsWith('--sinds=')) ?? '').slice('--sinds='.length);

const gh = (ghArgs) => execFileSync('gh', ghArgs, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });

let repoUrl = 'https://github.com/jarnodegreve-ui/VHB';
try {
  const info = JSON.parse(gh(['repo', 'view', '--json', 'url']));
  if (info?.url) repoUrl = String(info.url).replace(/\/$/, '');
} catch {
  // geen repo-context (bv. buiten een checkout): de vaste URL volstaat
}

const prs = JSON.parse(gh(['pr', 'list', '--state', 'merged', '--base', 'main', '--limit', '200', '--json', 'number,title,mergedAt,labels']))
  .filter((p) => p.mergedAt)
  .sort((a, b) => String(b.mergedAt).localeCompare(String(a.mergedAt)) || b.number - a.number);

// Mergedatum in Brusselse tijd (yyyy-mm-dd) — een merge om 23:30 UTC hoort bij de volgende dag.
const dagFmt = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Brussels', year: 'numeric', month: '2-digit', day: '2-digit' });
const dagVan = (iso) => dagFmt.format(new Date(iso));

const perDag = new Map();
for (const pr of prs) {
  const dag = dagVan(pr.mergedAt);
  if (!perDag.has(dag)) perDag.set(dag, []);
  perDag.get(dag).push(pr);
}

const regel = (pr) => {
  const labels = (pr.labels ?? []).map((l) => l.name).filter(Boolean);
  const titel = String(pr.title).trim().replace(/\s*\(#\d+\)\s*$/, '');
  return `- ${titel} ([#${pr.number}](${repoUrl}/pull/${pr.number}))${labels.length ? ` · _${labels.join(', ')}_` : ''}`;
};

const kop = [
  '# Changelog',
  '',
  `Gemergede pull requests op \`main\`, nieuwste eerst — gegenereerd met \`npm run changelog\` (${prs.length} PR's, laatste 200). Niet met de hand bewerken; de gebruikersgerichte samenvatting per release staat in \`src/app/watIsNieuw.ts\`.`,
  '',
];
const body = [...perDag.entries()].map(([dag, lijst]) => [`## ${dag}`, '', ...lijst.map(regel), ''].join('\n'));
fs.writeFileSync(path.join(ROOT, 'CHANGELOG.md'), `${kop.join('\n')}\n${body.join('\n')}`);
console.error(`CHANGELOG.md geschreven: ${prs.length} PR's over ${perDag.size} dagen.`);

if (watIsNieuw) {
  const nieuwsteDag = [...perDag.keys()][0];
  const keuze = sinds
    ? prs.filter((p) => dagVan(p.mergedAt) >= sinds)
    : perDag.get(nieuwsteDag) ?? [];
  const vandaag = dagFmt.format(new Date());
  const q = (s) => `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
  const regels = keuze.map((p) => `        ${q(`${String(p.title).trim().replace(/\s*\(#\d+\)\s*$/, '')} (#${p.number})`)},`);
  console.log([
    `  // Concept uit ${keuze.length} PR${keuze.length === 1 ? '' : "'s"} (${sinds ? `sinds ${sinds}` : nieuwsteDag}). Plak bovenaan WAT_IS_NIEUW in src/app/watIsNieuw.ts.`,
    `  {`,
    `    id: '${vandaag}',`,
    `    titel: 'Nieuw in het portaal',`,
    `    regels: {`,
    `      // TODO: verdeel over chauffeur en staf, herschrijf in gebruikerstaal (max 3 regels per rol), schrap wat intern is.`,
    `      chauffeur: [],`,
    `      staf: [`,
    ...regels,
    `      ],`,
    `    },`,
    `  },`,
  ].join('\n'));
}
