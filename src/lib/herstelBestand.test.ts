import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { HERSTEL_LIJSTEN } from '../../shared/herstelPlan';
import { herstelVerzending } from './herstelBestand';

describe('herstelVerzending', () => {
  const admin = { id: '1', role: 'admin' };

  it('stuurt alleen wat het herstel terugzet: geen activiteitenlog, geen referentie-exports', () => {
    const bestand = {
      exportedAt: '2026-10-01T02:00:00Z',
      version: 2,
      collections: {
        users: [admin],
        planning: [],
        dienstregelingen: [{ id: 'dr-1', geldigVanaf: '2026-09-01' }],
        services: [{ id: 'd1', dienstregelingId: 'dr-1' }],
        diversions: [],
        updates: [],
        leave: [],
        swaps: [],
        planningCodes: [{ code: 'bv' }],
        planningMatrixRows: [],
        coverageExpectations: { week: ['2101'] },
        activityLog: Array.from({ length: 5000 }, (_, i) => ({ id: `log-${i}`, details: 'x'.repeat(300) })),
      },
      authUsers: [{ id: 'a', email: 'a@vhb.be' }],
      ocpiRegistration: { token: 'geheim' },
      userDocuments: [{ id: 'doc' }],
      ritblaadje: { id: 'current' },
    };
    const verzending = herstelVerzending(bestand);
    expect(Object.keys(verzending).sort()).toEqual(['collections', 'exportedAt', 'version']);
    expect(Object.keys(verzending.collections).sort()).toEqual([...HERSTEL_LIJSTEN, 'coverageExpectations'].sort());
    expect(verzending.collections.planningCodes).toBe(bestand.collections.planningCodes);
    expect(verzending.exportedAt).toBe('2026-10-01T02:00:00Z');
    // Het log was ±1,5 MB van het bestand; wat vertrekt is een fractie.
    expect(JSON.stringify(verzending).length).toBeLessThan(JSON.stringify(bestand).length / 100);
  });

  it('voegt geen collectie toe die niet in het bestand zit: ontbrekend betekent ongemoeid laten', () => {
    const verzending = herstelVerzending({ collections: { users: [admin], activityLog: [] } });
    expect(verzending).toEqual({ collections: { users: [admin] } });
    expect('swaps' in verzending.collections).toBe(false);
  });

  it('elke collectie die de server bij een herstel terugzet, gaat ook mee vanuit het scherm', () => {
    // 16-10: restoreFromBackup zette sinds 08-10 de dienstregelingversies terug,
    // maar HERSTEL_LIJSTEN kende ze niet: het scherm liet ze weg uit wat het
    // opstuurde en de droge run toonde ze niet. Gelezen uit de bron, want de
    // integratietests bootsen restoreFromBackup na.
    const bron = fs.readFileSync(path.resolve(__dirname, '../../api/_lib/opslag/backups.ts'), 'utf8');
    const begin = bron.indexOf('export const restoreFromBackup');
    expect(begin).toBeGreaterThan(-1);
    const terugGezet = new Set([...bron.slice(begin).matchAll(/collections\.(\w+)/g)].map((m) => m[1]));
    expect(terugGezet.size).toBeGreaterThan(8);
    const verzonden = new Set<string>([...HERSTEL_LIJSTEN, 'coverageExpectations']);
    expect([...terugGezet].filter((c) => !verzonden.has(c))).toEqual([]);
  });
});
