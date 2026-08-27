// @vitest-environment node
/**
 * Maandverbruik per laadpunt (27-08-2026): de zuivere rekenhelpers uit
 * api/ocpi.ts. De maandgrens is het verraderlijke stuk: depotladen start
 * 's avonds laat, dus een sessie die om 00:30 Brusselse tijd op de 1e begint
 * staat in UTC nog op de laatste dag van de vorige maand.
 */
import { describe, it, expect, beforeAll } from 'vitest';

// Vóór de import: api/ocpi.ts leidt zijn host-allowlist bij module-load af.
process.env.OCPI_CPO_VERSIONS_URL = 'https://cpo.example.com/ocpi/versions';

let ocpi: typeof import('../api/ocpi.js');
beforeAll(async () => {
  ocpi = await import('../api/ocpi.js');
});

const evses = [
  { uid: 'CS-1', evse_id: '12.A', physical_reference: 'mal.1.1' },
  { uid: 'CS-2', evse_id: '12.B', physical_reference: 'mal.1.2' },
];

describe('brusselseMaand / huidigeBrusselseMaand', () => {
  it('bucket op de Brusselse kalendermaand, niet op UTC', () => {
    expect(ocpi.brusselseMaand('2026-07-31T21:30:00Z')).toBe('2026-07'); // 23:30 lokaal (zomertijd)
    expect(ocpi.brusselseMaand('2026-07-31T22:30:00Z')).toBe('2026-08'); // 00:30 lokaal, 1 augustus
    expect(ocpi.brusselseMaand('2026-12-31T23:30:00Z')).toBe('2027-01'); // wintertijd +1
    expect(ocpi.brusselseMaand('2026-08-15T12:00:00Z')).toBe('2026-08');
  });
  it('geeft een lege string bij ontbrekende of onleesbare input', () => {
    expect(ocpi.brusselseMaand(null)).toBe('');
    expect(ocpi.brusselseMaand(undefined)).toBe('');
    expect(ocpi.brusselseMaand('rommel')).toBe('');
  });
  it('kent de huidige maand in Brusselse tijd', () => {
    expect(ocpi.huidigeBrusselseMaand(new Date('2026-08-31T22:30:00Z'))).toBe('2026-09');
    expect(ocpi.huidigeBrusselseMaand(new Date('2026-08-31T21:30:00Z'))).toBe('2026-08');
  });
});

describe('verbruikPerLaadpunt', () => {
  it('telt de kWh per laadpunt op binnen de maand en geeft 0 voor stille punten', () => {
    const rijen = ocpi.verbruikPerLaadpunt('2026-08', [
      { evse_uid: 'CS-1', start_date_time: '2026-08-03T20:00:00Z', kwh: 120.25, status: 'COMPLETED' },
      { evse_uid: 'CS-1', start_date_time: '2026-08-04T20:00:00Z', kwh: 80.11, status: 'ACTIVE' },
      { evse_uid: 'CS-1', start_date_time: '2026-07-31T21:30:00Z', kwh: 999, status: 'COMPLETED' }, // nog juli
      { evse_uid: 'CS-1', start_date_time: '2026-08-31T22:30:00Z', kwh: 999, status: 'COMPLETED' }, // al september
    ], evses);
    expect(rijen).toEqual([
      { evseUid: 'CS-1', evseId: '12.A', physicalReference: 'mal.1.1', kwh: 200.4, sessies: 2 },
      { evseUid: 'CS-2', evseId: '12.B', physicalReference: 'mal.1.2', kwh: 0, sessies: 0 },
    ]);
  });

  it('slaat INVALID-sessies over (door ChargEye ongeldig verklaard)', () => {
    const rijen = ocpi.verbruikPerLaadpunt('2026-08', [
      { evse_uid: 'CS-2', start_date_time: '2026-08-10T20:00:00Z', kwh: 50, status: 'INVALID' },
      { evse_uid: 'CS-2', start_date_time: '2026-08-11T20:00:00Z', kwh: 10, status: 'completed' },
    ], evses);
    expect(rijen.find((r) => r.evseUid === 'CS-2')).toMatchObject({ kwh: 10, sessies: 1 });
  });

  it('houdt een onbekende uid alleen als er kWh op staat', () => {
    const rijen = ocpi.verbruikPerLaadpunt('2026-08', [
      { evse_uid: 'WEG-1', start_date_time: '2026-08-10T20:00:00Z', kwh: 33.3, status: 'COMPLETED' },
      { evse_uid: 'WEG-2', start_date_time: '2026-08-10T20:00:00Z', kwh: 0, status: 'COMPLETED' },
      { evse_uid: '', start_date_time: '2026-08-10T20:00:00Z', kwh: 77, status: 'COMPLETED' },
    ], evses);
    expect(rijen).toHaveLength(3);
    expect(rijen[2]).toEqual({ evseUid: 'WEG-1', evseId: null, physicalReference: null, kwh: 33.3, sessies: 1 });
  });

  it('telt een sessie zonder bruikbare kWh wel als sessie, maar als 0 kWh', () => {
    const rijen = ocpi.verbruikPerLaadpunt('2026-08', [
      { evse_uid: 'CS-1', start_date_time: '2026-08-10T20:00:00Z', kwh: null, status: 'COMPLETED' },
      { evse_uid: 'CS-1', start_date_time: '2026-08-11T20:00:00Z', kwh: 'x', status: 'COMPLETED' },
    ], evses);
    expect(rijen[0]).toMatchObject({ kwh: 0, sessies: 2 });
  });
});

describe('maandVenster / maandPlus / MAAND_RE', () => {
  it('neemt een dag marge aan beide kanten van de kalendermaand', () => {
    expect(ocpi.maandVenster('2026-08')).toEqual({ van: '2026-07-31T00:00:00.000Z', tot: '2026-09-02T00:00:00.000Z' });
    expect(ocpi.maandVenster('2026-12')).toEqual({ van: '2026-11-30T00:00:00.000Z', tot: '2027-01-02T00:00:00.000Z' });
  });
  it('bladert over jaargrenzen heen', () => {
    expect(ocpi.maandPlus('2026-01', -1)).toBe('2025-12');
    expect(ocpi.maandPlus('2026-12', 1)).toBe('2027-01');
    expect(ocpi.maandPlus('2026-08', 0)).toBe('2026-08');
  });
  it('accepteert alleen YYYY-MM', () => {
    expect(ocpi.MAAND_RE.test('2026-08')).toBe(true);
    expect(ocpi.MAAND_RE.test('2026-13')).toBe(false);
    expect(ocpi.MAAND_RE.test('2026-8')).toBe(false);
    expect(ocpi.MAAND_RE.test('2026-08-01')).toBe(false);
    expect(ocpi.MAAND_RE.test("2026-08' or 1=1")).toBe(false);
  });
});
