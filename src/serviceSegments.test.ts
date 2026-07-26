// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { getServiceSegments } from '../api/storage';

/**
 * Een loop is het deel van een dienst waaronder bepaalde ritten vallen: elk
 * tijdsblok van een dienst heeft zijn eigen loopnummer, en dat nummer moet
 * met het juiste blok meereizen naar de planning-rij (chauffeurs zien het bij
 * hun uren). Deze test bewaakt die koppeling.
 */
describe('getServiceSegments: loopnummer hoort bij het juiste dienstdeel', () => {
  it('koppelt elk loopnummer aan zijn eigen tijdsblok', () => {
    const segments = getServiceSegments({
      id: 's1',
      serviceNumber: '4101',
      startTime: '06:12', endTime: '09:30', loopnr: '12',
      startTime2: '15:41', endTime2: '18:20', loopnr2: '34',
    } as any);
    expect(segments).toHaveLength(2);
    expect(segments[0]).toMatchObject({ startTime: '06:12', endTime: '09:30', segment: 1, loopnr: '12' });
    expect(segments[1]).toMatchObject({ startTime: '15:41', endTime: '18:20', segment: 2, loopnr: '34' });
  });

  it('slaat blokken zonder geldige tijden over zonder de nummering te verschuiven', () => {
    const segments = getServiceSegments({
      id: 's2',
      serviceNumber: '4102',
      startTime: '05:00', endTime: '12:00', loopnr: '7',
      startTime2: '--', endTime2: '--', loopnr2: 'x',
      startTime3: '18:00', endTime3: '26:16', loopnr3: '9',
    } as any);
    expect(segments.map((s) => s.segment)).toEqual([1, 3]);
    expect(segments.map((s) => s.loopnr)).toEqual(['7', '9']);
  });

  it('een ontbrekend loopnummer geeft een lege string, geen undefined', () => {
    const segments = getServiceSegments({
      id: 's3', serviceNumber: '4103', startTime: '07:00', endTime: '15:00',
    } as any);
    expect(segments[0].loopnr).toBe('');
  });
});
