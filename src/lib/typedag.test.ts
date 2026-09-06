import { describe, it, expect } from 'vitest';
import { feestdagNaam, feestdagenVanJaar, isSchoolvakantie, typedag } from './typedag';

describe('typedag, De Lijn-regelingen', () => {
  it('berekent de Pasen-afgeleiden correct (computus)', () => {
    // Pasen 2026 = 5 april; 2027 = 28 maart.
    expect(feestdagenVanJaar(2026)['2026-04-06']).toBe('Paasmaandag');
    expect(feestdagenVanJaar(2026)['2026-05-14']).toBe('O.L.H. Hemelvaart');
    expect(feestdagenVanJaar(2026)['2026-05-25']).toBe('Pinkstermaandag');
    expect(feestdagenVanJaar(2027)['2027-03-29']).toBe('Paasmaandag');
  });

  it('een feestdag op een weekdag rijdt zon-/feestdagregeling', () => {
    // 21 juli 2026 is een dinsdag.
    expect(feestdagNaam('2026-07-21')).toBe('Nationale feestdag');
    expect(typedag('2026-07-21')).toBe('zon-feestdag');
  });

  it('weekend- en weekdagregelingen', () => {
    expect(typedag('2026-09-19')).toBe('zaterdag');
    expect(typedag('2026-09-20')).toBe('zon-feestdag'); // zondag
    expect(typedag('2026-09-15')).toBe('schooldag'); // dinsdag buiten vakantie
  });

  it('schoolvakantie op een weekdag = vakantieregeling', () => {
    expect(isSchoolvakantie('2026-07-15')).toBe(true);
    expect(typedag('2026-07-15')).toBe('vakantiedag');
    // Maar een feestdag ín de vakantie blijft zon-/feestdag (21/7).
    expect(typedag('2026-07-21')).toBe('zon-feestdag');
  });

  it('kerstvakantie loopt over de jaargrens heen', () => {
    expect(isSchoolvakantie('2026-12-28')).toBe(true);
    expect(isSchoolvakantie('2027-01-03')).toBe(true);
    expect(isSchoolvakantie('2027-01-04')).toBe(false);
  });
});
