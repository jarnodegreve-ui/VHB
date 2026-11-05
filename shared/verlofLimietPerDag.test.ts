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

describe('overlappende periodes: de kortste wint (controle-ronde 04-11, punt 37)', () => {
  const zomer = { id: 'z', naam: 'zomer', van: '2027-07-01', tot: '2027-08-31', max: 5 };
  const bouwverlof = { id: 'b', naam: 'bouwverlof', van: '2027-07-19', tot: '2027-07-25', max: 0 };

  it('een korte, strengere periode binnen een lange geldt op haar dagen; erbuiten de lange, daarbuiten de standaard', () => {
    const limieten = parseVerlofLimieten({ standaard: 2, periodes: [zomer, bouwverlof] });
    expect(limietVoorDag(limieten, '2027-07-21')).toBe(0);
    expect(limietVoorDag(limieten, '2027-07-19')).toBe(0);
    expect(limietVoorDag(limieten, '2027-07-25')).toBe(0);
    expect(limietVoorDag(limieten, '2027-07-10')).toBe(5);
    expect(limietVoorDag(limieten, '2027-07-26')).toBe(5);
    expect(limietVoorDag(limieten, '2027-09-01')).toBe(2);
  });

  it('de volgorde in de lijst maakt niet uit', () => {
    const omgekeerd = parseVerlofLimieten({ standaard: 2, periodes: [bouwverlof, zomer] });
    expect(limietVoorDag(omgekeerd, '2027-07-21')).toBe(0);
    expect(limietVoorDag(omgekeerd, '2027-07-10')).toBe(5);
  });

  it('bij gelijke lengte wint de eerste in de lijst', () => {
    const a = { id: 'a', naam: 'a', van: '2027-07-05', tot: '2027-07-11', max: 3 };
    const b = { id: 'b', naam: 'b', van: '2027-07-08', tot: '2027-07-14', max: 4 };
    expect(limietVoorDag(parseVerlofLimieten({ standaard: 2, periodes: [a, b] }), '2027-07-09')).toBe(3);
    expect(limietVoorDag(parseVerlofLimieten({ standaard: 2, periodes: [b, a] }), '2027-07-09')).toBe(4);
    expect(limietVoorDag(parseVerlofLimieten({ standaard: 2, periodes: [a, b] }), '2027-07-13')).toBe(4);
  });

  it('het maximum uit de dagtypekalender blijft van alles winnen', () => {
    const limieten = parseVerlofLimieten({ standaard: 2, periodes: [zomer, bouwverlof], perDag: { '2027-07-21': 7 } });
    expect(limietVoorDag(limieten, '2027-07-21')).toBe(7);
  });
});
