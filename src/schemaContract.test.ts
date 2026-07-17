import { describe, expect, it } from 'vitest';
import { TABLE_PROBES, probeColumns } from '../api/schemaProbes';
import {
  toDatabaseUser,
  toDatabaseSwap,
  toDatabaseLeave,
  toDatabaseDiversion,
  toDatabaseService,
  toDatabasePlanningCode,
} from '../api/helpers';

/**
 * Contracttest mappers ↔ schema-probes.
 *
 * De import brak al 2× op kolom-mismatches (quoted camelCase vs lowercase,
 * NOT NULL-defaults) — precies de laag die de integratietests wegmocken.
 * Deze test sluit de keten: elke kolom die een toDatabase*-mapper schrijft
 * MOET in api/schemaProbes.ts staan, en die lijst wordt door
 * GET /api/health/schema live tegen productie gevalideerd. Een nieuwe
 * mapper-kolom zonder probe-update faalt dus hier in CI, en een probe-kolom
 * zonder migratie faalt op de health-check.
 */
describe('schema-contract: mappers schrijven enkel geprobe-de kolommen', () => {
  const cases: Array<{ table: string; row: Record<string, unknown> }> = [
    {
      table: 'users',
      row: toDatabaseUser({
        id: '1', name: 'Test', role: 'chauffeur', employeeId: 'VHB-1',
        lastLogin: '2026-01-01T00:00:00Z', activeSessions: 0, isActive: true,
        phone: '0470', email: 'a@b.be', verlofBudget: 24, showInContacts: true, section: 'Reguliere',
      }),
    },
    {
      table: 'swaps',
      row: toDatabaseSwap({
        id: '1', shiftId: 's1', requesterId: 'u1', targetDriverId: 'u2',
        status: 'pending', createdAt: '2026-01-01T00:00:00Z', reason: 'x',
        decidedAt: undefined, returnDate: '2026-01-02', returnCode: 'vrij',
      }),
    },
    {
      table: 'leave',
      row: toDatabaseLeave({
        id: '1', userId: 'u1', startDate: '2026-01-01', endDate: '2026-01-02',
        type: 'betaald_verlof' as any, status: 'pending' as any, comment: 'x',
        createdAt: '2026-01-01T00:00:00Z', decidedAt: undefined,
      }),
    },
    {
      table: 'diversions',
      row: toDatabaseDiversion({
        id: '1', line: '284', title: 't', description: 'd',
        startDate: '2026-01-01', endDate: '2026-01-02',
        pdfUrl: undefined, mapCoordinates: undefined,
      }),
    },
    {
      table: 'services',
      row: toDatabaseService({ id: '1', serviceNumber: '4101', startTime: '06:00', endTime: '14:00' }),
    },
    {
      table: 'planning_codes',
      row: toDatabasePlanningCode({
        code: 'bv', category: 'leave', description: 'Verlof',
        countsAsShift: false, isPaidAbsence: true, isDayOff: true,
      }),
    },
  ];

  for (const { table, row } of cases) {
    it(`${table}: mapper-kolommen ⊆ probe-lijst`, () => {
      const allowed = new Set(probeColumns(table));
      expect(allowed.size).toBeGreaterThan(0);
      const written = Object.keys(row);
      const unknown = written.filter((k) => !allowed.has(k));
      expect(unknown, `kolommen zonder schema-probe (voeg toe aan api/schemaProbes.ts + draai de migratie): ${unknown.join(', ')}`).toEqual([]);
    });
  }

  it('ShiftRecord-velden (planning) ⊆ probe-lijst', () => {
    // planning heeft geen mapper: .insert(ShiftRecord) schrijft de velden 1-op-1.
    const shift = {
      id: '1', date: '2026-01-01', startTime: '06:00', endTime: '14:00',
      line: '4101', busNumber: '', loopnr: '', driverId: 'u1',
    };
    const allowed = new Set(probeColumns('planning'));
    expect(Object.keys(shift).filter((k) => !allowed.has(k))).toEqual([]);
  });

  it('elke probe-tabel heeft een niet-lege kolomlijst', () => {
    for (const probe of TABLE_PROBES) {
      expect(probe.columns.split(',').length, probe.table).toBeGreaterThan(2);
    }
  });
});
