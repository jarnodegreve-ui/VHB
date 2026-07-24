import { describe, it, expect } from 'vitest';
import {
  resolveActiveSwapOverlays,
  applyOverlayToShifts,
  applyOverlayToMatrixCells,
  type SwapOverlayEntry,
  type OverlayMatrixCell,
} from '../api/_lib/swapOverlay';

const IMPORT_AT = '2026-07-01T08:00:00.000Z';

const users = [
  { id: 'u1', name: 'An Peeters' },
  { id: 'u2', name: 'Bart Claes' },
];

const shift = (id: string, driverId: string, date: string, line = '4101') =>
  ({ id, driverId, date, line, startTime: '06:00', endTime: '14:00', busNumber: '12', loopnr: '1' }) as any;

const swap = (over: Record<string, unknown>) =>
  ({
    id: 'sw1',
    shiftId: 's1',
    requesterId: 'u1',
    targetDriverId: 'u2',
    status: 'approved',
    createdAt: '2026-07-02T09:00:00.000Z',
    decidedAt: '2026-07-03T10:00:00.000Z',
    ...over,
  }) as any;

describe('resolveActiveSwapOverlays', () => {
  const shifts = [shift('s1', 'u1', '2026-07-10'), shift('s2', 'u2', '2026-07-12', '4202')];

  it('neemt een goedgekeurde ruil van ná de laatste import mee, met terugruil-dienst', () => {
    const out = resolveActiveSwapOverlays(
      [swap({ returnDate: '2026-07-12', returnCode: '4202' })],
      shifts,
      users,
      IMPORT_AT,
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      shiftId: 's1',
      date: '2026-07-10',
      fromDriverId: 'u1',
      fromName: 'An Peeters',
      toDriverId: 'u2',
      toName: 'Bart Claes',
      returnShiftId: 's2',
    });
  });

  it('slaat niet-goedgekeurde statussen en ruilen van vóór de import over', () => {
    const cases = [
      swap({ status: 'pending' }),
      swap({ status: 'accepted' }),
      swap({ status: 'completed' }),
      swap({ status: 'rejected' }),
      swap({ decidedAt: '2026-06-30T10:00:00.000Z' }), // vóór de import
      swap({ decidedAt: undefined }),
      swap({ targetDriverId: undefined }),
    ];
    expect(resolveActiveSwapOverlays(cases, shifts, users, IMPORT_AT)).toHaveLength(0);
  });

  it('slaat een ruil over waarvan de dienst niet meer bestaat', () => {
    const out = resolveActiveSwapOverlays([swap({ shiftId: 'weg' })], shifts, users, IMPORT_AT);
    expect(out).toHaveLength(0);
  });

  it("zoekt geen terugruil-dienst bij 'vrij' of een niet-matchende code", () => {
    const vrij = resolveActiveSwapOverlays(
      [swap({ returnDate: '2026-07-12', returnCode: 'vrij' })],
      shifts,
      users,
      IMPORT_AT,
    );
    expect(vrij[0].returnShiftId).toBeUndefined();
    const mismatch = resolveActiveSwapOverlays(
      [swap({ returnDate: '2026-07-12', returnCode: '9999' })],
      shifts,
      users,
      IMPORT_AT,
    );
    expect(mismatch[0].returnShiftId).toBeUndefined();
  });
});

describe('applyOverlayToShifts', () => {
  const overlay: SwapOverlayEntry = {
    swapId: 'sw1',
    shiftId: 's1',
    date: '2026-07-10',
    fromDriverId: 'u1',
    fromName: 'An Peeters',
    toDriverId: 'u2',
    toName: 'Bart Claes',
    returnShiftId: 's2',
    returnDate: '2026-07-12',
    returnCode: '4202',
  };

  it('verhuist de dienst naar de collega en de terugruil-dienst naar de aanvrager', () => {
    const input = [shift('s1', 'u1', '2026-07-10'), shift('s2', 'u2', '2026-07-12'), shift('s3', 'u1', '2026-07-20')];
    const out = applyOverlayToShifts(input, [overlay]);
    expect(out.find((s) => s.id === 's1')).toMatchObject({ driverId: 'u2', swappedWith: 'An Peeters' });
    expect(out.find((s) => s.id === 's2')).toMatchObject({ driverId: 'u1', swappedWith: 'Bart Claes' });
    expect(out.find((s) => s.id === 's3')).toMatchObject({ driverId: 'u1' });
    expect(out.find((s) => s.id === 's3')).not.toHaveProperty('swappedWith');
  });

  it('muteert de invoer niet (rauwe collectie blijft opslaanbaar)', () => {
    const input = [shift('s1', 'u1', '2026-07-10')];
    applyOverlayToShifts(input, [overlay]);
    expect(input[0].driverId).toBe('u1');
    expect(input[0]).not.toHaveProperty('swappedWith');
  });
});

describe('applyOverlayToMatrixCells', () => {
  const overlay: SwapOverlayEntry = {
    swapId: 'sw1',
    shiftId: 's1',
    date: '2026-07-10',
    fromDriverId: 'u1',
    fromName: 'An Peeters',
    toDriverId: 'u2',
    toName: 'Bart Claes',
    returnDate: '2026-07-12',
    returnCode: '4202',
  };
  const cell = (code: string): OverlayMatrixCell => ({ code, kind: 'service', label: `Dienst ${code}`, segments: [] });

  it('wisselt de celinhoud op ruildag én terugruildag, met swap-markering', () => {
    const cells = {
      u1: { '2026-07-10': cell('4101') },
      u2: { '2026-07-12': cell('4202') },
    };
    applyOverlayToMatrixCells(cells, [overlay]);
    // Ruildag: dienst van An staat nu bij Bart; An heeft die dag niets meer.
    expect(cells.u2['2026-07-10']).toMatchObject({ code: '4101', swap: { with: 'An Peeters' } });
    expect(cells.u1['2026-07-10']).toBeUndefined();
    // Terugruildag: dienst van Bart staat nu bij An.
    expect(cells.u1['2026-07-12']).toMatchObject({ code: '4202', swap: { with: 'Bart Claes' } });
    expect(cells.u2['2026-07-12']).toBeUndefined();
  });

  it('wisselt ook wanneer beide chauffeurs die dag een cel hebben', () => {
    const cells = {
      u1: { '2026-07-10': cell('4101') },
      u2: { '2026-07-10': { code: 'vrij', kind: 'absence', label: 'Vrij', segments: [] } as OverlayMatrixCell },
    };
    applyOverlayToMatrixCells(cells, [{ ...overlay, returnDate: undefined, returnCode: undefined }]);
    expect(cells.u2['2026-07-10']).toMatchObject({ code: '4101', swap: { with: 'An Peeters' } });
    expect(cells.u1['2026-07-10']).toMatchObject({ code: 'vrij', swap: { with: 'Bart Claes' } });
  });

  it('laat cellen buiten de maand (geen data) met rust', () => {
    const cells: Record<string, Record<string, OverlayMatrixCell>> = { u1: {}, u2: {} };
    applyOverlayToMatrixCells(cells, [overlay]);
    expect(cells.u1).toEqual({});
    expect(cells.u2).toEqual({});
  });
});
