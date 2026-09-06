import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * CI-vangrail tegen stille divergentie.
 *
 * De API-functie (Vercel serverless) mag niet cross-importeren uit `../src`
 * (dat compileert + slaagt CI maar breekt de ESM-bundle in productie — heeft
 * ooit een login-outage veroorzaakt). Daarom houden we van een paar pure
 * helpers een API-lokale kopie. Risico: iemand fixt een bug in de geteste
 * `src/lib`-versie en vergeet de `api/`-kopie → de server draait dan stil
 * andere logica dan de tests beweren.
 *
 * Deze test normaliseert beide bestanden (commentaar weg, quotes + whitespace
 * gelijk) en eist dat de logica identiek is. Wijk je bewust af, dan moet je
 * deze test bijwerken — dat dwingt een expliciete keuze af.
 */
const root = resolve(__dirname, '..', '..');

const normalize = (src: string): string =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, '') // block-commentaar (incl. JSDoc)
    .replace(/\/\/[^\n]*/g, '')       // regel-commentaar
    .replace(/["'`]/g, '"')           // quote-stijl gelijktrekken
    .replace(/\s+/g, ' ')             // whitespace samentrekken
    .trim();

const pairs: { name: string; src: string; api: string }[] = [
  { name: 'coverageGaps', src: 'src/lib/coverageGaps.ts', api: 'api/coverageGaps.ts' },
  { name: 'ics', src: 'src/lib/ics.ts', api: 'api/ics.ts' },
];

describe('gedeelde src/api-kopieën blijven in sync', () => {
  for (const { name, src, api } of pairs) {
    it(`${name}: api/-kopie is logisch identiek aan src/lib/`, () => {
      const a = normalize(readFileSync(resolve(root, src), 'utf8'));
      const b = normalize(readFileSync(resolve(root, api), 'utf8'));
      expect(b, `${api} is afgeweken van ${src}, werk de kopie (of deze test) bij`).toBe(a);
    });
  }
});
