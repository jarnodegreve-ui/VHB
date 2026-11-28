import { describe, expect, it } from 'vitest';
import { bouwMaandoverzichtAoa, dienstMinuten, formatMinutenAlsUren } from '../api/_lib/helpers';

/** Maandoverzicht-tabblad in de xlsx-export: per-chauffeur maandtelling. */
describe('dienstMinuten', () => {
  it('somt segmentduren, met nacht- en busvak-notatie', () => {
    expect(dienstMinuten({ startTime: '06:00', endTime: '14:00' })).toBe(480);
    // Gesplitste dienst: beide segmenten tellen.
    expect(dienstMinuten({ startTime: '06:00', endTime: '09:00', startTime2: '15:00', endTime2: '18:30' })).toBe(390);
    // Busvak-uren ≥ 24: 22:00–26:16 = 4u16.
    expect(dienstMinuten({ startTime: '22:00', endTime: '26:16' })).toBe(256);
    // Impliciete nachtdienst (einde ≤ start): 22:00–06:00 = 8u.
    expect(dienstMinuten({ startTime: '22:00', endTime: '06:00' })).toBe(480);
    // Zonder bruikbare tijden: null.
    expect(dienstMinuten({ startTime: '', endTime: '' })).toBeNull();
  });

  it('formatMinutenAlsUren schrijft uu:mm', () => {
    expect(formatMinutenAlsUren(0)).toBe('0:00');
    expect(formatMinutenAlsUren(485)).toBe('8:05');
  });
});

describe('bouwMaandoverzichtAoa', () => {
  const services = [{ serviceNumber: '2101', startTime: '06:00', endTime: '14:00' }];
  const planningCodes = [
    { code: 'eek5', countsAsShift: true, isPaidAbsence: false, isDayOff: false },
    { code: 'bv', countsAsShift: false, isPaidAbsence: true, isDayOff: false },
    { code: 'vrij', countsAsShift: false, isPaidAbsence: false, isDayOff: true },
    { code: 'ta', countsAsShift: false, isPaidAbsence: false, isDayOff: false },
  ];

  it('telt per chauffeur diensten, uren en afwezigheden op de actuele cel-waarheid', () => {
    const dates = ['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04', '2026-09-05'];
    const cells = {
      c1: {
        '2026-09-01': { code: '2101', kind: 'service' },
        '2026-09-02': { code: 'EEK5', kind: 'service' },
        '2026-09-03': { code: 'ziek', kind: 'absence' },
        '2026-09-04': { code: 'bv', kind: 'leave' },
        '2026-09-05': { code: 'ta', kind: 'absence' },
      },
    } as Record<string, Record<string, { code: string; kind: string }>>;
    const aoa = bouwMaandoverzichtAoa('2026-09', dates, [{ id: 'c1', name: 'Jan Peeters' }], cells, services, planningCodes);
    // Rij 0-2: titel/uitleg/leeg; rij 3: koppen; rij 4: Jan.
    expect(aoa[3][0]).toBe('chauffeur');
    expect(aoa[4]).toEqual(['Jan Peeters', 1, '8:00', 1, 1, 1, 0, 'ta×1', 5]);
    // Laatste rij: totalen.
    expect(aoa[aoa.length - 1][0]).toBe('totaal');
    expect(aoa[aoa.length - 1][8]).toBe(5);
  });

  it('laat een chauffeur zonder cellen gewoon op nul staan', () => {
    const aoa = bouwMaandoverzichtAoa('2026-09', ['2026-09-01'], [{ id: 'cx', name: 'Leeg' }], {}, services, planningCodes);
    expect(aoa[4]).toEqual(['Leeg', 0, '0:00', 0, 0, 0, 0, '', 0]);
  });
});

/** De kop noemt de grens van de planning als de maand erop gekapt is (26-11).
 *  Of ze gekapt is, beslist de route (src/apiIntegratie/planning.test.ts). */
describe('bouwMaandoverzichtAoa: de kop en de grens van de planning (26-11)', () => {
  const services = [{ serviceNumber: '2101', startTime: '06:00', endTime: '14:00' }];
  const KOP = (telling: string) => `Stand ná dienstruilen, toewijzingen en geregistreerde afwezigheden (${telling}). Uren = som van de dienstsegmenten uit het Dienstoverzicht; diensten zonder tijden tellen alleen in de dagtelling.`;
  const januari = Array.from({ length: 31 }, (_, i) => `2027-01-${String(i + 1).padStart(2, '0')}`);
  const cells = { c1: Object.fromEntries(januari.map((d) => [d, { code: '2101', kind: 'service' }])) } as Record<string, Record<string, { code: string; kind: string }>>;
  const chauffeurs = [{ id: 'c1', name: 'Jan Peeters' }];
  const bouw = (maand: string, dates: string[], gekaptOp?: string | null) =>
    bouwMaandoverzichtAoa(maand, dates, chauffeurs, cells, services, [], undefined, undefined, gekaptOp);

  it('een gekapte maand: de kop zegt over hoeveel dagen en tot wanneer', () => {
    const aoa = bouw('2027-01', januari.slice(0, 17), '2027-01-17');
    expect(aoa[1][0]).toBe(KOP('17 dagen, t/m 17/01/2027'));
    expect(aoa[4]).toEqual(['Jan Peeters', 17, '136:00', 0, 0, 0, 0, '', 17]);
    // Alleen de kop wijzigt: elke andere regel is die van dezelfde 17 dagen zonder grens.
    const zonder = bouw('2027-01', januari.slice(0, 17));
    expect(aoa.filter((_, i) => i !== 1)).toEqual(zonder.filter((_, i) => i !== 1));
  });

  it('een maand zonder kap: de kop van vroeger, ook met null of undefined', () => {
    const vroeger = bouwMaandoverzichtAoa('2027-01', januari, chauffeurs, cells, services, []);
    expect(vroeger[1][0]).toBe(KOP('31 dagen'));
    expect(JSON.stringify(bouw('2027-01', januari, null))).toBe(JSON.stringify(vroeger));
    expect(JSON.stringify(bouw('2027-01', januari, undefined))).toBe(JSON.stringify(vroeger));
    expect(JSON.stringify(bouw('2027-01', januari, ''))).toBe(JSON.stringify(vroeger));
  });

  it('een maand helemaal na de grens: 0 dagen, met de grens', () => {
    const aoa = bouw('2027-02', [], '2027-01-17');
    expect(aoa[0][0]).toBe('Maandoverzicht 2027-02');
    expect(aoa[1][0]).toBe(KOP('0 dagen, t/m 17/01/2027'));
    expect(aoa[4]).toEqual(['Jan Peeters', 0, '0:00', 0, 0, 0, 0, '', 0]);
    expect(aoa[aoa.length - 1]).toEqual(['totaal', 0, '0:00', 0, 0, 0, 0, 0, 0]);
  });
});

describe('berekenMaandoverzicht', () => {
  it('levert dezelfde telling als het xlsx-tabblad, maar als data (voor het Overzicht-venster)', async () => {
    const { berekenMaandoverzicht } = await import('../api/_lib/helpers');
    const services = [{ serviceNumber: '2101', startTime: '06:00', endTime: '14:00' }];
    const planningCodes = [{ code: 'vrij', countsAsShift: false, isPaidAbsence: false, isDayOff: true }];
    const cells = {
      c1: {
        '2026-09-01': { code: '2101', kind: 'service' },
        '2026-09-02': { code: 'vrij', kind: 'absence' },
      },
    } as Record<string, Record<string, { code: string; kind: string }>>;
    const { rijen, totaal } = berekenMaandoverzicht(['2026-09-01', '2026-09-02'], [{ id: 'c1', name: 'Jan' }], cells, services, planningCodes);
    expect(rijen).toEqual([
      { driverId: 'c1', naam: 'Jan', diensten: 1, minuten: 480, anderWerk: 0, ziek: 0, betaald: 0, vrij: 1, overig: [], dagen: 2 },
    ]);
    expect(totaal.diensten).toBe(1);
    expect(totaal.dagen).toBe(2);
  });
});

describe('berekenMaandoverzicht met dienstregelingversies (13-10)', () => {
  it('telt de uren van een dag uit de versie die op die dag geldt', async () => {
    const { berekenMaandoverzicht } = await import('../api/_lib/helpers');
    const oud = [{ serviceNumber: '2101', startTime: '06:00', endTime: '14:00' }];
    const nieuw = [{ serviceNumber: '2101', startTime: '06:00', endTime: '15:00' }];
    const versies = [{ id: 'v-sep', geldigVanaf: '2026-09-01', services: oud }, { id: 'v-nov', geldigVanaf: '2026-11-09', services: nieuw }];
    const cells = { c1: { '2026-11-08': { code: '2101', kind: 'service' }, '2026-11-09': { code: '2101', kind: 'service' } } } as Record<string, Record<string, { code: string; kind: string }>>;
    const { rijen } = berekenMaandoverzicht(['2026-11-08', '2026-11-09'], [{ id: 'c1', name: 'Jan' }], cells, oud, [], undefined, versies);
    expect(rijen[0]).toMatchObject({ diensten: 2, minuten: 480 + 540 });
    // Zonder versies: overal de meegegeven lijst.
    expect(berekenMaandoverzicht(['2026-11-08', '2026-11-09'], [{ id: 'c1', name: 'Jan' }], cells, oud, []).rijen[0].minuten).toBe(960);
  });
});
