#!/usr/bin/env node
/**
 * Changelog uit de gemergede pull requests (GitHub, via `gh`):
 *
 *   npm run changelog                  → herschrijft CHANGELOG.md
 *
 * Gegroepeerd per (Brusselse) mergedatum, nieuwste eerst, met #nummer-links.
 * Geen extra dependencies: alleen `gh` (ingelogd) en Node.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);

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
  `Gemergede pull requests op \`main\`, nieuwste eerst — gegenereerd met \`npm run changelog\` (${prs.length} PR's, laatste 200). Niet met de hand bewerken.`,
  '',
];
const body = [...perDag.entries()].map(([dag, lijst]) => [`## ${dag}`, '', ...lijst.map(regel), ''].join('\n'));
fs.writeFileSync(path.join(ROOT, 'CHANGELOG.md'), `${kop.join('\n')}\n${body.join('\n')}`);
console.error(`CHANGELOG.md geschreven: ${prs.length} PR's over ${perDag.size} dagen.`);
