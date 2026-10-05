// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ontbrekendeMigraties, VERWACHTE_MIGRATIES } from '../api/_lib/migratieLijst';

/**
 * De API kent de migraties uit een kopie (een Vercel-functie krijgt het
 * JSON-manifest niet mee). Deze test houdt kopie en manifest gelijk: wie een
 * migratie toevoegt aan supabase/volgorde.json en ze hier vergeet, zou in
 * Systeemstatus nooit zien dat ze op productie nog moet draaien.
 */
describe('migratielijst', () => {
  const manifest = JSON.parse(readFileSync('supabase/volgorde.json', 'utf8')) as { volgorde: string[] };

  it('is gelijk aan supabase/volgorde.json, in dezelfde volgorde', () => {
    expect([...VERWACHTE_MIGRATIES]).toEqual(manifest.volgorde.map((f) => f.replace(/^supabase\//, '')));
  });

  it('meldt wat in het register ontbreekt', () => {
    const alles = [...VERWACHTE_MIGRATIES];
    expect(ontbrekendeMigraties(alles)).toEqual([]);
    expect(ontbrekendeMigraties(alles.slice(0, -1))).toEqual([alles[alles.length - 1]]);
  });
});
