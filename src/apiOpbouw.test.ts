import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Bewaker van G1 (21-09): api/index.ts bouwt de app op en mount de domeinen,
 * meer niet. Het bestand was 6.344 regels, en elke wijziging raakte dezelfde
 * importkop (het merge-conflict van 21-09). Een route hoort in de module van
 * haar domein (api/_lib/<domein>Routes.ts), niet hier.
 */
const ROOT = path.resolve(__dirname, '..');
const index = fs.readFileSync(path.join(ROOT, 'api/index.ts'), 'utf8');

describe('api/index.ts blijft de opbouw', () => {
  it('registreert zelf alleen /api/health (bewust vóór de rate-limiter) en de 404', () => {
    const routes = [...index.matchAll(/^app\.(get|post|put|patch|delete|all)\(\s*["'`]([^"'`]+)/gm)].map((m) => `${m[1]} ${m[2]}`);
    expect(routes).toEqual(['get /api/health', 'all /api/*']);
  });

  it('blijft klein: opbouw, middleware, mounts', () => {
    expect(index.split('\n').length).toBeLessThan(320);
  });

  it('mount elk domein dat een routes-module heeft', () => {
    const modules = fs.readdirSync(path.join(ROOT, 'api/_lib')).filter((f) => /Routes\.ts$/.test(f)).map((f) => f.replace(/\.ts$/, ''));
    for (const m of modules) expect(index, `${m} wordt niet gemount in api/index.ts`).toContain(`./_lib/${m}.js`);
  });
});
