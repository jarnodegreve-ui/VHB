import { describe, expect, it } from 'vitest';
import { limietVoorDag, parseVerlofLimieten } from './schemas/verlofLimieten';

describe('verloflimiet per dag uit de dagtypekalender (11-10)', () => {
  const limieten = parseVerlofLimieten({
    standaard: 2,
    periodes: [{ id: 'z', naam: 'zomer', van: '2027-07-01', tot: '2027-08-31', max: 7 }],
    perDag: { '2027-07-21': 0, '2027-01-04': 2, '2027-10-30': 7 },
  });

  it('de kalender wint van de periodes en van de standaard', () => {
    expect(limietVoorDag(limieten, '2027-07-21')).toBe(0);
    expect(limietVoorDag(limieten, '2027-07-22')).toBe(7);
    expect(limietVoorDag(limieten, '2027-10-30')).toBe(7);
    expect(limietVoorDag(limieten, '2027-10-29')).toBe(2);
  });

  it('zonder perDag gedraagt alles zich als voorheen', () => {
    const oud = parseVerlofLimieten({ standaard: 3, periodes: [] });
    expect(oud.perDag).toBeUndefined();
    expect(limietVoorDag(oud, '2027-07-21')).toBe(3);
  });
});
