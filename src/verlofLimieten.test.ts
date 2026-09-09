import { describe, expect, it } from 'vitest';
import { limietVoorDag, parseVerlofLimieten, sorteerPeriodes, STANDAARD_VERLOF_LIMIETEN, verlofLimietenSchema } from '../shared/schemas/verlofLimieten';

describe('verloflimieten (per periode instelbaar, 09-09)', () => {
  const limieten = {
    standaard: 2,
    periodes: [
      { id: 'zomer', naam: 'Zomervakantie', van: '2026-07-01', tot: '2026-08-31', max: 4 },
      { id: 'kerst', naam: 'Kerstvakantie', van: '2026-12-21', tot: '2027-01-04', max: 3 },
    ],
  };

  it('geeft de standaard buiten elke periode en het periodemaximum erbinnen (grenzen inclusief)', () => {
    expect(limietVoorDag(limieten, '2026-06-30')).toBe(2);
    expect(limietVoorDag(limieten, '2026-07-01')).toBe(4);
    expect(limietVoorDag(limieten, '2026-08-31')).toBe(4);
    expect(limietVoorDag(limieten, '2026-09-01')).toBe(2);
    expect(limietVoorDag(limieten, '2027-01-04')).toBe(3);
  });

  it('bij overlap wint de eerste periode in de lijst', () => {
    const overlap = { standaard: 2, periodes: [
      { id: 'a', naam: 'Ruim', van: '2026-07-01', tot: '2026-08-31', max: 5 },
      { id: 'b', naam: 'Bouwverlof', van: '2026-07-20', tot: '2026-08-05', max: 1 },
    ] };
    expect(limietVoorDag(overlap, '2026-07-25')).toBe(5);
    // Na sorteren op startdatum blijft dat zo; de editor sorteert altijd.
    expect(limietVoorDag({ ...overlap, periodes: sorteerPeriodes(overlap.periodes) }, '2026-07-25')).toBe(5);
  });

  it('sorteert op startdatum, dan naam', () => {
    const uit = sorteerPeriodes([
      { id: '1', naam: 'Zomer', van: '2026-07-01', tot: '2026-08-31', max: 4 },
      { id: '2', naam: 'Krokus', van: '2026-02-16', tot: '2026-02-22', max: 2 },
      { id: '3', naam: 'Aardig', van: '2026-02-16', tot: '2026-02-18', max: 2 },
    ]);
    expect(uit.map((p) => p.id)).toEqual(['3', '2', '1']);
  });

  it('valt terug op de standaard bij rommel uit de database', () => {
    expect(parseVerlofLimieten(null)).toEqual(STANDAARD_VERLOF_LIMIETEN);
    expect(parseVerlofLimieten({ standaard: 'veel' })).toEqual(STANDAARD_VERLOF_LIMIETEN);
    expect(parseVerlofLimieten({})).toEqual({ standaard: 2, periodes: [] });
  });

  it('weigert een einddatum vóór de startdatum, een niet-geheel getal en meer dan 200', () => {
    const basis = { id: 'x', naam: 'Test', van: '2026-07-10', tot: '2026-07-01', max: 2 };
    expect(verlofLimietenSchema.safeParse({ standaard: 2, periodes: [basis] }).success).toBe(false);
    expect(verlofLimietenSchema.safeParse({ standaard: 2.5, periodes: [] }).success).toBe(false);
    expect(verlofLimietenSchema.safeParse({ standaard: 201, periodes: [] }).success).toBe(false);
    expect(verlofLimietenSchema.safeParse({ standaard: 0, periodes: [{ ...basis, tot: '2026-07-10' }] }).success).toBe(true);
  });
});
