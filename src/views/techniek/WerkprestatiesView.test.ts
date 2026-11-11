import { describe, expect, it } from 'vitest';
import { beginNaLaatsteTaak } from './WerkprestatiesView';
import type { Werkprestatie } from '../../lib/techniek';

/**
 * Het voorstel voor Begin bij een nieuwe taak in het dagboek (ronde 6,
 * 11-11): het einde van de laatste taak van die dag van dezelfde technieker.
 */
const taak = (id: string, over: Partial<Werkprestatie> = {}): Werkprestatie => ({
  id, datum: '2026-11-11', mecanicienId: '55', vehicleId: null, werkcode: 'H', omschrijving: 'Werk',
  beginTijd: null, eindeTijd: null, werkuren: 1, kmstand: null, defectId: null, ...over,
} as Werkprestatie);

describe('beginNaLaatsteTaak', () => {
  it('geeft niets op een dag zonder taken', () => {
    expect(beginNaLaatsteTaak([], '2026-11-11', '55')).toBe('');
  });

  it('geeft het einde van de enige taak', () => {
    expect(beginNaLaatsteTaak([taak('a', { beginTijd: '08:00', eindeTijd: '09:30' })], '2026-11-11', '55')).toBe('09:30');
  });

  it('neemt de laatste taak van de dag, ook als ze eerder geregistreerd is', () => {
    const rijen = [
      taak('middag', { beginTijd: '13:00', eindeTijd: '14:15', createdAt: '2026-11-11T07:00:00.000Z' }),
      taak('ochtend', { beginTijd: '08:00', eindeTijd: '09:00', createdAt: '2026-11-11T15:00:00.000Z' }),
    ];
    expect(beginNaLaatsteTaak(rijen, '2026-11-11', '55')).toBe('14:15');
  });

  it('slaat taken zonder eindtijd over', () => {
    const rijen = [
      taak('a', { beginTijd: '08:00', eindeTijd: '09:00' }),
      taak('b', { beginTijd: '09:00', eindeTijd: null }),
      taak('c'),
    ];
    expect(beginNaLaatsteTaak(rijen, '2026-11-11', '55')).toBe('09:00');
    expect(beginNaLaatsteTaak([taak('c'), taak('b', { beginTijd: '09:00' })], '2026-11-11', '55')).toBe('');
  });

  it('kijkt alleen naar die dag en naar dezelfde technieker', () => {
    const rijen = [
      taak('gisteren', { datum: '2026-11-10', beginTijd: '15:00', eindeTijd: '17:00' }),
      taak('collega', { mecanicienId: '56', beginTijd: '10:00', eindeTijd: '12:00' }),
      taak('eigen', { beginTijd: '08:00', eindeTijd: '08:45' }),
    ];
    expect(beginNaLaatsteTaak(rijen, '2026-11-11', '55')).toBe('08:45');
    expect(beginNaLaatsteTaak(rijen, '2026-11-12', '55')).toBe('');
  });

  it('volgt de volgorde van de lijst: een taak over middernacht is de laatste', () => {
    const rijen = [
      taak('avond', { beginTijd: '20:00', eindeTijd: '22:00' }),
      taak('nacht', { beginTijd: '22:00', eindeTijd: '02:00' }),
    ];
    expect(beginNaLaatsteTaak(rijen, '2026-11-11', '55')).toBe('02:00');
  });

  it('laat de lijst zelf ongemoeid', () => {
    const rijen = [taak('b', { beginTijd: '13:00', eindeTijd: '14:00' }), taak('a', { beginTijd: '08:00', eindeTijd: '09:00' })];
    beginNaLaatsteTaak(rijen, '2026-11-11', '55');
    expect(rijen.map((r) => r.id)).toEqual(['b', 'a']);
  });
});
