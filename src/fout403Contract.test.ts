import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Foutcontract voor 403 (3D.2, Jarno 23-09): de client toont de reden van een
 * 403 aan de gebruiker, dus elke 403 in api/ geeft een vaste, geschreven
 * gebruikerszin terug. Geen doorgegeven foutobject, geen `.message`, geen
 * template met variabelen. Faalt deze test, schrijf dan een gebruikerszin of
 * laat de reden weg (de client toont dan de algemene vervolgstap).
 */
const bestanden = (dir: string): string[] => readdirSync(dir).flatMap((f) => {
  const p = join(dir, f);
  if (statSync(p).isDirectory()) return f === 'node_modules' ? [] : bestanden(p);
  return p.endsWith('.ts') && !p.endsWith('.test.ts') ? [p] : [];
});

describe('403-antwoorden zijn client-safe', () => {
  const bronnen = bestanden(join(__dirname, '..', 'api')).map((p) => ({ p, tekst: readFileSync(p, 'utf8') }));

  it('elke status(403).json(...) geeft een vaste tekst of een vaste constante', () => {
    const fout: string[] = [];
    let aantal = 0;
    for (const { p, tekst } of bronnen) {
      for (const m of tekst.matchAll(/status\(403\)\.json\(([^\n]*)/g)) {
        aantal++;
        const arg = m[1];
        const letterlijk = /^\{\s*error:\s*"[^"$`]*"(,\s*code:\s*"[a-z_]+")?\s*\}\);?/.test(arg);
        const constante = /^SESSIE_INGETROKKEN\)/.test(arg);
        if (!letterlijk && !constante) fout.push(`${p}: ${arg.slice(0, 100)}`);
      }
    }
    expect(aantal).toBeGreaterThan(20);
    expect(fout).toEqual([]);
  });

  it('403 via een foutobject of een poortbesluit draagt ook een vaste tekst', () => {
    const fout: string[] = [];
    for (const { p, tekst } of bronnen) {
      for (const m of tekst.matchAll(/status:\s*403,([\s\S]{0,160})/g)) {
        const rest = m[1];
        if (!/error:\s*"[^"$`]*"/.test(rest) || /\.message|\$\{|String\(err|err\b/.test(rest.split('}')[0])) fout.push(`${p}: ${rest.slice(0, 100)}`);
      }
    }
    expect(fout).toEqual([]);
  });

  it('de constanten en het poortverdict die als 403 terugkomen zijn vaste teksten', () => {
    const middleware = bronnen.find((b) => b.p.endsWith(join('api', 'middleware.ts')))!.tekst;
    expect(middleware).toMatch(/SESSIE_INGETROKKEN\s*=\s*\{\s*error:\s*"[^"$`]+"/);
    expect(middleware).toMatch(/verdict\.body \?\? \{ error: "[^"$`]+"/);
  });
});
