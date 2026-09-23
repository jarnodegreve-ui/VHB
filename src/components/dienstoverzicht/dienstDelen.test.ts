import { describe, expect, it } from 'vitest';
import type { Service } from '../../types';
import { delenVan, dienstSorteerWaarde, hasValidTime, tijdvak, zoekDiensten } from './dienstDelen';

const dienst = (d: Partial<Service> & { id: string; serviceNumber: string }): Service =>
  ({ startTime: '', endTime: '', ...d }) as Service;

const D2515 = dienst({ id: 'a', serviceNumber: '2515', loopnr: '4505', startTime: '07:08', endTime: '08:34', loopnr2: '4510', startTime2: '15:13', endTime2: '21:55', loopnr3: '4515', startTime3: '24:10', endTime3: '25:10' });
const D2101 = dienst({ id: 'b', serviceNumber: '2101', loopnr: '4500', startTime: '04:36', endTime: '07:52', loopnr2: '4611', startTime2: '13:39', endTime2: '17:29' });
const D2607 = dienst({ id: 'c', serviceNumber: '2607', loopnr: '4500', startTime: '15:41', endTime: '26:16', loopnr2: '9999', startTime2: '', endTime2: '' });

describe('dienstDelen', () => {
  it('hasValidTime aanvaardt busvaktijden en weigert lege of halve tijden', () => {
    expect(hasValidTime('24:10', '25:10')).toBe(true);
    expect(hasValidTime('6:00', '47:59')).toBe(true);
    expect(hasValidTime('07:08', '')).toBe(false);
    expect(hasValidTime(undefined, '08:00')).toBe(false);
    expect(hasValidTime('7u', '08:00')).toBe(false);
  });

  it('tijdvak gebruikt een en-dash zonder spaties', () => {
    expect(tijdvak('04:36', '07:52')).toBe('04:36–07:52');
  });

  it('delenVan geeft deel 1 altijd en deel 2/3 alleen met geldige tijden', () => {
    expect(delenVan(D2515).map((d) => [d.nr, d.loop, d.start, d.eind])).toEqual([
      [1, '4505', '07:08', '08:34'], [2, '4510', '15:13', '21:55'], [3, '4515', '24:10', '25:10'],
    ]);
    expect(delenVan(D2101)).toHaveLength(2);
    // Een loopnummer zonder tijden maakt geen deel.
    expect(delenVan(D2607)).toHaveLength(1);
    expect(delenVan(dienst({ id: 'x', serviceNumber: '1' }))).toEqual([{ nr: 1, loop: '', start: '', eind: '' }]);
  });

  it('zoekDiensten zoekt op dienstnummer en de drie loopnummers', () => {
    const alle = [D2515, D2101, D2607];
    expect(zoekDiensten(alle, '')).toBe(alle);
    expect(zoekDiensten(alle, '  ').map((s) => s.id)).toEqual(['a', 'b', 'c']);
    expect(zoekDiensten(alle, '4515').map((s) => s.id)).toEqual(['a']);
    expect(zoekDiensten(alle, '4500').map((s) => s.id)).toEqual(['b', 'c']);
    expect(zoekDiensten(alle, '21').map((s) => s.id)).toEqual(['b']);
  });

  it('dienstSorteerWaarde: volgorde uit de lijst, lege loop of start = null (achteraan)', () => {
    const volgorde = new Map([['a', 0], ['b', 1]]);
    expect(dienstSorteerWaarde(D2101, 'volgorde', volgorde)).toBe(1);
    expect(dienstSorteerWaarde(D2101, 'dienst', volgorde)).toBe('2101');
    expect(dienstSorteerWaarde(dienst({ id: 'x', serviceNumber: '1' }), 'loop1', volgorde)).toBeNull();
    expect(dienstSorteerWaarde(dienst({ id: 'x', serviceNumber: '1' }), 'start', volgorde)).toBeNull();
  });
});
