#!/usr/bin/env node
/**
 * Grenzen-lint (05-10, audit punt 6): houdt de lagen uit elkaar. Faalt op een
 * import die een grens oversteekt. Draait via `npm run lint:grenzen` en in de
 * CI-job `checks`. Zonder dependencies, zoals design-lint.
 *
 *  1. shared/ staat op zichzelf: geen import uit src/ of api/.
 *  2. src/ (de browser) importeert niets uit api/ (de server).
 *  3. api/ importeert niets uit src/.
 *     Tests mogen bij 1 tot 3 wel oversteken: ze vergelijken lagen juist.
 *  4. De opslaglaag (api/_lib/opslag/) is alleen bereikbaar via api/storage.ts.
 *     De integratietests bootsen dat ene bestand na; een route die een
 *     domeinbestand rechtstreeks importeert, valt daar stil buiten.
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const IS_TEST = /\.(test|spec)\.tsx?$|\/__fixtures__\//;

const REGELS = [
  { naam: 'shared/ importeert uit src/ of api/', map: 'shared', verboden: /^(src|api)\//, tests: false },
  { naam: 'src/ importeert uit api/ (server-code in de browser)', map: 'src', verboden: /^api\//, tests: false },
  { naam: 'api/ importeert uit src/', map: 'api', verboden: /^src\//, tests: false },
  {
    naam: 'api/_lib/opslag/ rechtstreeks geïmporteerd (ga via api/storage.ts)',
    map: 'api', verboden: /^api\/_lib\/opslag\//, tests: true,
    behalve: (bestand) => bestand === 'api/storage.ts' || bestand.startsWith('api/_lib/opslag/'),
  },
  { naam: 'api/_lib/opslag/ rechtstreeks geïmporteerd (ga via api/storage.ts)', map: 'src', verboden: /^api\/_lib\/opslag\//, tests: true },
  { naam: 'api/_lib/opslag/ rechtstreeks geïmporteerd (ga via api/storage.ts)', map: 'dbtests', verboden: /^api\/_lib\/opslag\//, tests: true },
];

const bestanden = (map) => {
  const uit = [];
  const loop = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const vol = path.join(dir, e.name);
      if (e.isDirectory()) loop(vol);
      else if (/\.(ts|tsx|mts|mjs)$/.test(e.name)) uit.push(vol);
    }
  };
  loop(path.join(ROOT, map));
  return uit;
};

const IMPORT = /(?:from\s+|import\s*\(\s*|import\s+)["'](\.{1,2}\/[^"']+)["']/g;
const fouten = [];
for (const regel of REGELS) {
  for (const vol of bestanden(regel.map)) {
    const rel = path.relative(ROOT, vol).split(path.sep).join('/');
    if (!regel.tests && IS_TEST.test(rel)) continue;
    if (regel.behalve?.(rel)) continue;
    const regels = fs.readFileSync(vol, 'utf8').split('\n');
    regels.forEach((tekst, i) => {
      for (const m of tekst.matchAll(IMPORT)) {
        const doel = path.relative(ROOT, path.resolve(path.dirname(vol), m[1])).split(path.sep).join('/');
        if (regel.verboden.test(doel)) fouten.push(`${rel}:${i + 1}  ${regel.naam}\n    ${tekst.trim()}`);
      }
    });
  }
}

if (fouten.length > 0) {
  console.error(`Grenzen-lint: ${fouten.length} overtreding(en)\n\n${fouten.join('\n')}`);
  process.exit(1);
}
console.log('Grenzen-lint: geen overtredingen.');
