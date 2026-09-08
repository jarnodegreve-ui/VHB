// @vitest-environment node
/**
 * Vangnet na de storing van 08-09-2026: `import { z } from './zod'` (zonder
 * .js) in shared/schemas werkte in vitest en in de Vite-bundel, maar de
 * Vercel-functie (Node ESM) kon de module niet vinden en élke API-aanroep
 * gaf FUNCTION_INVOCATION_FAILED. Alles wat de server importeert (api/ en
 * shared/) moet relatieve imports mét .js-extensie schrijven.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '..');
const loop = (dir: string, uit: string[] = []): string[] => {
  for (const naam of fs.readdirSync(dir)) {
    const p = path.join(dir, naam);
    if (fs.statSync(p).isDirectory()) loop(p, uit);
    else if (/\.ts$/.test(p) && !/\.test\.ts$/.test(p)) uit.push(p);
  }
  return uit;
};

describe('server-side ESM-imports', () => {
  it('relatieve imports in api/ en shared/ eindigen op .js', () => {
    const fouten: string[] = [];
    for (const bestand of [...loop(path.join(ROOT, 'api')), ...loop(path.join(ROOT, 'shared'))]) {
      const bron = fs.readFileSync(bestand, 'utf8');
      for (const m of bron.matchAll(/from\s+['"](\.{1,2}\/[^'"]+)['"]/g)) {
        if (!/\.(js|json)$/.test(m[1])) fouten.push(`${path.relative(ROOT, bestand)}: ${m[1]}`);
      }
    }
    expect(fouten).toEqual([]);
  });
});
