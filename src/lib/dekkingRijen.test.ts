import { describe, expect, it } from 'vitest';
import { dagtypeStatus, onvolledigeRijen, periodeStatus, rijMelding, uitzonderingStatus } from './dekkingRijen';

const LEGE_WEEK = ['', '', '', '', '', '', ''];
const TYPES = new Set(['schooldag', 'zaterdag']);

describe('dekkingRijen: dag-type', () => {
  it('leeg zonder naam en zonder diensten', () => {
    expect(dagtypeStatus({ name: '  ', services: [] }).status).toBe('leeg');
  });
  it('deels met diensten maar zonder naam', () => {
    expect(dagtypeStatus({ name: '', services: ['4101'] })).toEqual({ status: 'deels', ontbreekt: ['een naam'] });
  });
  it('volledig met een naam, ook zonder diensten', () => {
    expect(dagtypeStatus({ name: 'zaterdag', services: [] }).status).toBe('volledig');
  });
});

describe('dekkingRijen: weekdagperiode', () => {
  it('leeg zonder datum en zonder weekdagen', () => {
    expect(periodeStatus({ vanaf: '', weekdays: LEGE_WEEK }).status).toBe('leeg');
  });
  it('deels met weekdagen maar zonder ingangsdatum', () => {
    const w = [...LEGE_WEEK];
    w[1] = 'schooldag';
    expect(periodeStatus({ vanaf: '', weekdays: w })).toEqual({ status: 'deels', ontbreekt: ['een ingangsdatum'] });
  });
  it('volledig met een ingangsdatum, ook als elke weekdag "geen" is', () => {
    expect(periodeStatus({ vanaf: '2026-09-01', weekdays: LEGE_WEEK }).status).toBe('volledig');
  });
});

describe('dekkingRijen: uitzondering', () => {
  it('leeg als niets gekozen is', () => {
    expect(uitzonderingStatus({ from: '', to: '', dayType: '' }, TYPES).status).toBe('leeg');
  });
  it('deels: somt op wat ontbreekt', () => {
    const o = uitzonderingStatus({ from: '2026-10-01', to: '', dayType: '' }, TYPES);
    expect(o).toEqual({ status: 'deels', ontbreekt: ['een datum tot en met', 'een dag-type'] });
    expect(rijMelding(o)).toBe('Onvolledig, nog nodig: een datum tot en met en een dag-type. Vul aan of verwijder de rij.');
  });
  it('een dag-type dat niet meer bestaat telt als ontbrekend', () => {
    expect(uitzonderingStatus({ from: '2026-10-01', to: '2026-10-02', dayType: 'weg' }, TYPES))
      .toEqual({ status: 'deels', ontbreekt: ['een dag-type'] });
  });
  it('volledig met van, tot en met en een bestaand dag-type', () => {
    expect(uitzonderingStatus({ from: '2026-10-01', to: '2026-10-02', dayType: 'zaterdag' }, TYPES).status).toBe('volledig');
  });
});

describe('dekkingRijen: onvolledigeRijen', () => {
  it('geeft alleen de deels ingevulde rijen, per rijsleutel', () => {
    const fouten = onvolledigeRijen({
      dayTypes: [
        { _k: 1, name: 'schooldag', services: ['4101'] },
        { _k: 2, name: '', services: [] },
        { _k: 3, name: '', services: ['4102'] },
      ],
      weekdayPeriods: [
        { _k: 4, vanaf: '', weekdays: LEGE_WEEK },
        { _k: 5, vanaf: '', weekdays: ['', 'schooldag', '', '', '', '', ''] },
      ],
      overrides: [
        { _k: 6, from: '', to: '', dayType: '' },
        { _k: 7, from: '2026-10-01', to: '2026-10-01', dayType: 'schooldag' },
        { _k: 8, from: '', to: '2026-10-01', dayType: 'schooldag' },
      ],
    });
    expect(Object.keys(fouten).sort()).toEqual(['dagtype-3', 'periode-5', 'uitzondering-8']);
    expect(fouten['uitzondering-8']).toContain('een datum van');
  });
  it('leeg object als alles volledig of helemaal leeg is', () => {
    expect(onvolledigeRijen({
      dayTypes: [{ _k: 1, name: 'schooldag', services: [] }, { _k: 2, name: '', services: [] }],
      weekdayPeriods: [{ _k: 3, vanaf: '', weekdays: LEGE_WEEK }],
      overrides: [{ _k: 4, from: '', to: '', dayType: '' }],
    })).toEqual({});
  });
});
