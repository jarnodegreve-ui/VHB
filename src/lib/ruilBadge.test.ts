import { describe, expect, it } from 'vitest';
import { geruildeDiensten, ruilBadgeLabel, ruilSleutel } from './ruilBadge';
import { HANDMATIGE_WISSEL_PREFIX } from '../../shared/schemas/constanten';
import type { SwapRequest } from '../types';

/**
 * "Geruild met X" op de eigen diensten (vraag Jarno 12-09). Matcht op datum +
 * dienstnummer, niet op de rij-id die bij elke import opnieuw gevormd wordt.
 */
const users = [{ id: 'A', name: 'An' }, { id: 'B', name: 'Bert' }, { id: 'C', name: 'Cis' }];
const swap = (extra: Partial<SwapRequest>): SwapRequest => ({
  id: 'sw1', shiftId: 'x', requesterId: 'A', targetDriverId: 'B', status: 'approved', createdAt: '2026-09-01T09:00:00Z',
  decidedAt: '2026-09-01T10:00:00Z', shiftDate: '2026-09-15', shiftLine: '2101', swapType: 'overname', ...extra,
});

describe('geruildeDiensten', () => {
  it('geeft de ontvanger "Overgenomen van" op de aangeboden dienst', () => {
    const map = geruildeDiensten('B', [swap({})], users);
    const b = map.get(ruilSleutel('2026-09-15', '2101'));
    expect(b).toMatchObject({ soort: 'overname', met: 'An', swapId: 'sw1' });
    expect(ruilBadgeLabel(b!)).toBe('Overgenomen van An');
  });

  it('geeft bij een 1-op-1-ruil beide kanten hun eigen badge', () => {
    const s = swap({ swapType: 'ruil', returnDate: '2026-09-18', returnCode: '2202' });
    const vanB = geruildeDiensten('B', [s], users);
    const vanA = geruildeDiensten('A', [s], users);
    expect(ruilBadgeLabel(vanB.get(ruilSleutel('2026-09-15', '2101'))!)).toBe('Geruild met An');
    expect(ruilBadgeLabel(vanA.get(ruilSleutel('2026-09-18', '2202'))!)).toBe('Geruild met Bert');
    // De aanvrager krijgt niets op de dienst die hij afstond.
    expect(vanA.get(ruilSleutel('2026-09-15', '2101'))).toBeUndefined();
  });

  it("een 'vrij'-tegenprestatie geeft de aanvrager geen badge", () => {
    const map = geruildeDiensten('A', [swap({ swapType: 'ruil', returnDate: '2026-09-18', returnCode: 'VRIJ' })], users);
    expect(map.size).toBe(0);
  });

  it('herkent een handmatige wissel door beheer', () => {
    const map = geruildeDiensten('B', [swap({ reason: `${HANDMATIGE_WISSEL_PREFIX}Jarno: ziek` })], users);
    expect(ruilBadgeLabel(map.get(ruilSleutel('2026-09-15', '2101'))!)).toBe('Overgezet van An');
  });

  it('telt alleen doorgevoerde ruilen (approved/completed), geen lopende of afgewezen', () => {
    const map = geruildeDiensten('B', [
      swap({ id: 'p', status: 'pending' }),
      swap({ id: 'r', status: 'rejected' }),
      swap({ id: 'c', status: 'cancelled' }),
      swap({ id: 'ok', status: 'completed' }),
    ], users);
    expect(map.get(ruilSleutel('2026-09-15', '2101'))?.swapId).toBe('ok');
  });

  it('ketting: de laatste wissel op een dienst bepaalt het label', () => {
    const map = geruildeDiensten('C', [
      swap({ id: 'sw2', requesterId: 'B', targetDriverId: 'C', decidedAt: '2026-09-02T10:00:00Z' }),
      swap({ id: 'sw1' }),
    ], users);
    expect(ruilBadgeLabel(map.get(ruilSleutel('2026-09-15', '2101'))!)).toBe('Overgenomen van Bert');
  });

  it('matcht het dienstnummer ongeacht spaties en hoofdletters, en valt terug op "een collega"', () => {
    const map = geruildeDiensten('B', [swap({ shiftLine: ' 2101 ', requesterId: 'Z' })], users);
    const b = map.get(ruilSleutel('2026-09-15', '2101'));
    expect(b?.met).toBe('een collega');
  });

  it('geeft bij dezelfde invoer (op referentie) dezelfde Map terug, bij nieuwe invoer een nieuwe', () => {
    const swaps = [swap({})];
    const a = geruildeDiensten('B', swaps, users);
    expect(geruildeDiensten('B', swaps, users)).toBe(a);
    expect(geruildeDiensten('A', swaps, users)).not.toBe(a);
    const b = geruildeDiensten('B', [...swaps], users);
    expect(b).not.toBe(a);
    expect(b.get(ruilSleutel('2026-09-15', '2101'))?.met).toBe('An');
  });
});
