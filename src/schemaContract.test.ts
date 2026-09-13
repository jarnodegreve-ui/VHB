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
import { toDatabaseDefect, toDatabaseDefectPatch, toDatabaseVehicle, toDatabaseVehicleExpiry, toDatabaseWerkprestatie } from '../api/_lib/techniekStorage';
import { toDatabaseDagtypeCodePatch, toDatabaseSegment, toDatabaseSegmentImport } from '../api/_lib/dienstStorage';
import { toDatabaseDagAfsluiting, toDatabaseDagPrestatieNieuw, toDatabaseDagPrestatiePatch, toDatabaseLoonCode, toDatabaseLoonMedewerker } from '../api/_lib/loonStorage';

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
        id: '1', line: '284', location: 'Eeklo', title: 't', description: 'd',
        startDate: '2026-01-01', endDate: '2026-01-02',
        pdfUrl: undefined,
      }),
    },
    {
      table: 'services',
      row: toDatabaseService({ id: '1', serviceNumber: '4101', startTime: '06:00', endTime: '14:00' }),
    },
    {
      table: 'vehicles',
      row: toDatabaseVehicle({ busnr: '613 026', kortNr: 26, nummerplaat: '2-CWF-068', chassisnr: 'x', merk: 'MAN', type: 'lijnbus', aandrijving: 'elektrisch', status: 'actief', inDienst: '2022-12-20', uitDienst: null, zitplaatsen: 40, opmerking: null }),
    },
    {
      table: 'vehicle_defects',
      row: { ...toDatabaseDefect({ vehicleId: 'v1', werktype: 'T', omschrijving: 'Bel doet het niet', gemeldDoor: 'u1' }), ...toDatabaseDefectPatch({ status: 'uitgevoerd', uitgevoerdOp: '2026-09-13', uitgevoerdWerk: 'Bel vervangen', manuren: 0.5, opmerking: null, werktype: 'T', omschrijving: 'Bel', uitgevoerdDoor: 'u2' }) },
    },
    {
      table: 'vehicle_work',
      row: toDatabaseWerkprestatie({ datum: '2026-09-13', vehicleId: 'v1', werkcode: 'H', omschrijving: 'Bel vervangen', beginTijd: '08:00', eindeTijd: '08:30', werkuren: 0.5, kmstand: 1000, defectId: 'd1', mecanicienId: 'u2' }),
    },
    {
      table: 'vehicle_expiries',
      row: toDatabaseVehicleExpiry({ vehicleId: 'v1', soort: 'keuring', validUntil: '2027-01-01', opmerking: null, updatedBy: 'u1' }),
      table: 'loon_codes',
      row: toDatabaseLoonCode('2102', { codeWeergave: '2102', omschrijving: null, dienstType: 'lijn', inExport: true, easypayActiviteit: 'LIJN', easypayTypePrest: 40140, tik1: '05:28', tik2: '12:13', tik3: '15:28', tik4: '17:27', tik5: null, tik6: null, lbRijtijd: 449, lbStat100At: 41, lbStat100Nat: 4, lbStat50Nat: 0, lbOnd: 1, lbAndWrk: 0, lbNacht: 32 }, 'u1'),
    },
    { table: 'loon_medewerkers', row: toDatabaseLoonMedewerker('u1', { easypayNr: 42, inExport: true }, 'u1') },
    { table: 'dag_afsluitingen', row: toDatabaseDagAfsluiting({ datum: '2026-09-13', geopendDoor: 'u1' }) },
    {
      table: 'dag_prestaties',
      row: { ...toDatabaseDagPrestatieNieuw({ datum: '2026-09-13', userId: 'u1', volgnr: 1, planningCode: '2102', geredenCode: '2102' }), ...toDatabaseDagPrestatiePatch({ geredenCode: '2103', overmin: 15, overminNacht: 0, overminExtra: 0, onvPremie: true, qualOngeval: false, qualPanne: true, qualVerkeersovertreding: false, qualKlantklacht: false, qualAdmfout: false, qualInterneklacht: false, qualVertragingDrSchuld: false, qualRitNtGeredenDrSchuld: false, opmerking: 'x' }, 'u1') },
    },
    { table: 'service_segment_imports', row: toDatabaseSegmentImport({ importedBy: 'u1', filename: 'et.xlsx', rijen: 1, diensten: 1, dagtypes: ['21/0'], waarschuwingen: [], bevindingen: [] }) },
    {
      table: 'service_segments',
      row: toDatabaseSegment('imp1', { serviceNumber: '2102', dagtypeCode: '21/0', volgorde: 1, type: 'RIT', startMin: 300, eindeMin: 360, duurMin: 60, loop: '4600', internLoop: null, lijn: '50', variant: null, rit: '1', voertuig: 'standaard', vertrek: 'A', vertrekCode: null, aankomst: 'B', aankomstCode: null, afstandKm: 12.5, atTijd: null, vtTijd: null }),
    },
    { table: 'dagtype_codes', row: toDatabaseDagtypeCodePatch({ portaalDagtype: 'schooldag' }) },
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
