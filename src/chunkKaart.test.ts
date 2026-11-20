// @vitest-environment node
/**
 * De chunk-kaart van de warmup draagt alleen de views die de warmup leest
 * (20-11-2026). De plugin in vite.config.ts en de bewaker in
 * scripts/check-bundle-size.mjs lezen dezelfde kern; deze tests leggen vast
 * welke views dat zijn en dat een onleesbare lijst nooit een lege kaart geeft.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ZOD_VRIJE_VIEWS, beperkKaart, kaartSleutels, leesViewLoaders } from '../scripts/chunk-kaart-kern.mjs';

const LOADERS = fs.readFileSync(path.resolve(__dirname, 'app/viewLoaders.ts'), 'utf8');

describe('chunk-kaart van de warmup', () => {
  it('leest uit viewLoaders.ts de tabel view → pad en WARMUP_VIEWS voor beide rollen, zonder drift', () => {
    const { padPerView, drift, warmup } = leesViewLoaders(LOADERS);
    expect(padPerView.size).toBeGreaterThan(30);
    expect(padPerView.get('mijn-dag')).toBe('views/MijnDagView');
    expect(drift).toEqual([]);
    expect(warmup.chauffeur).toContain('mijn-dag');
    expect(warmup.staf).toContain('vandaag');
  });

  it('de kaart draagt de paden van elke warmup-view en de zod-vrije startschermen, en niets anders', () => {
    const { padPerView, warmup } = leesViewLoaders(LOADERS);
    const sleutels = kaartSleutels(LOADERS);
    expect(sleutels).not.toBeNull();
    const verwacht = new Set([...[...warmup.chauffeur, ...warmup.staf].map((v) => padPerView.get(v)), ...ZOD_VRIJE_VIEWS]);
    expect([...sleutels!].sort()).toEqual([...verwacht].sort());
    // Een scherm dat niet opgewarmd wordt, staat er niet in.
    expect(sleutels!.has(padPerView.get('verlof')!)).toBe(false);
    expect(sleutels!.size).toBeLessThan(padPerView.size);
  });

  it('een lijst die niet te lezen is geeft null: de plugin schrijft dan de volledige kaart, nooit een lege', () => {
    expect(kaartSleutels('export const VIEWS = {};')).toBeNull();
    // Eén rol zonder views.
    expect(kaartSleutels(LOADERS.replace(/staf:\s*\[[^\]]*\]/, 'staf: []'))).toBeNull();
    // Een warmup-view zonder regel in de tabel.
    expect(kaartSleutels(LOADERS.replace(/chauffeur:\s*\[/, "chauffeur: ['bestaat-niet', "))).toBeNull();
    const kaart = { 'views/A': ['/assets/a.js'], 'views/B': ['/assets/b.js'] };
    expect(beperkKaart(kaart, null)).toBe(kaart);
  });

  it('beperken houdt per view dezelfde lijst en dezelfde volgorde', () => {
    const kaart = { 'views/A': ['/assets/a.js', '/assets/x.js'], 'views/B': ['/assets/b.js'], 'views/C': ['/assets/c.js', '/assets/x.js'] };
    const klein = beperkKaart(kaart, new Set(['views/C', 'views/A']));
    expect(Object.keys(klein)).toEqual(['views/A', 'views/C']);
    expect(klein['views/A']).toBe(kaart['views/A']);
    expect(klein['views/C']).toBe(kaart['views/C']);
  });

  it('meldt een pad dat afwijkt van de import ernaast', () => {
    const bron = "export const VIEWS = {\n  a: view('views/A', () => import('../views/B')),\n};";
    expect(leesViewLoaders(bron).drift).toEqual([{ view: 'a', pad: 'views/A', importPad: 'views/B' }]);
  });
});
