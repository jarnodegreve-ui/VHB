import { describe, it, expect } from 'vitest';
import { dekkingDagtypeVanDag, klasseVanCode } from './dekkingDagtype';
import type { DagtypeKalender } from './dagtype';

/**
 * Dekking op De Lijn-codes (11-10): de instellingen hieronder zijn de echte
 * dekking van VHB op 11-10 (namen, basis = zomerregime, periode vanaf 1
 * september = schooljaar, twee feestdagen als uitzondering "zondag").
 */
const LIJSTEN = ['schooldag', 'schooldag dinsdag', 'schooldag vrijdag', 'woensdag', 'vakantie', 'vakantieperiode ma/di/wo', 'vakantieperiode donderdag', 'vakantieperiode vrijdag', 'zaterdag', 'zondag'];
const KALENDER: DagtypeKalender = {
  weekdays: ['zondag', 'vakantieperiode ma/di/wo', 'vakantieperiode ma/di/wo', 'vakantieperiode ma/di/wo', 'vakantieperiode donderdag', 'vakantieperiode vrijdag', 'zaterdag'],
  perioden: [{ vanaf: '2026-09-01', weekdays: ['zondag', 'schooldag', 'schooldag dinsdag', 'woensdag', 'schooldag', 'schooldag vrijdag', 'zaterdag'] }],
  overrides: [{ from: '2026-07-21', to: '2026-07-21', dayType: 'zondag' }, { from: '2026-08-15', to: '2026-08-15', dayType: 'zondag' }],
};
const KOPPELING: Record<string, string | null> = {
  '21': 'schooldag', '22': 'schooldag', '23': 'schooldag', '24': 'schooldag', '25': 'schooldag', '26': 'zaterdag', '27': 'zondag', '28': 'zondag',
  '31': 'vakantie', '32': 'vakantie', '33': 'vakantie', '34': 'vakantie', '35': 'vakantie', '41': 'vakantie', '42': 'vakantie', '43': 'vakantie', '44': 'vakantie', '45': 'vakantie',
  '51': null, '52': null, '53': null, '54': null, '55': null,
};
const los = (datum: string, rawDayType: unknown, extra: Partial<Parameters<typeof dekkingDagtypeVanDag>[0]> = {}) =>
  dekkingDagtypeVanDag({ datum, rawDayType, kalender: KALENDER, lijstNamen: LIJSTEN, koppeling: KOPPELING, ...extra });

describe('klasseVanCode', () => {
  it('leest de koppeling, anders de code zelf; juli-augustus is vakantie en een feestdag zondag', () => {
    expect(klasseVanCode('22', KOPPELING)).toBe('2');
    expect(klasseVanCode('41', KOPPELING)).toBe('3');
    expect(klasseVanCode('28', KOPPELING)).toBe('27');
    expect(klasseVanCode('51', KOPPELING)).toBe('5');
    expect(klasseVanCode('51', { '51': 'schooldag' })).toBe('2');
    expect(klasseVanCode('44')).toBe('3');
    expect(klasseVanCode('28')).toBe('27');
    expect(klasseVanCode('26')).toBe('26');
  });
});

describe('dekkingDagtypeVanDag', () => {
  it('een naam in kolom B wint, zoals vroeger', () => {
    expect(los('2026-10-13', 'vakantie')).toEqual({ dayType: 'vakantie', bron: { soort: 'excel' } });
  });

  it('zonder code en zonder naam beslist de dekkingskalender, zoals vroeger', () => {
    expect(los('2026-10-13', '')).toEqual({ dayType: 'schooldag dinsdag', bron: { soort: 'periode', vanaf: '2026-09-01' } });
    expect(los('2026-07-21', '')).toEqual({ dayType: 'zondag', bron: { soort: 'uitzondering', from: '2026-07-21', to: '2026-07-21' } });
    expect(los('2026-08-03', '')).toEqual({ dayType: 'vakantieperiode ma/di/wo', bron: { soort: 'basis' } });
  });

  it('een schooldagcode in het schooljaar houdt de lijst per weekdag van de dekking, met de code als bevestiging', () => {
    expect(los('2026-10-13', '22')).toEqual({ dayType: 'schooldag dinsdag', bron: { soort: 'periode', vanaf: '2026-09-01', code: '22' } });
    expect(los('2026-10-14', '23')).toEqual({ dayType: 'woensdag', bron: { soort: 'periode', vanaf: '2026-09-01', code: '23' } });
    expect(los('2026-10-17', '26')).toEqual({ dayType: 'zaterdag', bron: { soort: 'periode', vanaf: '2026-09-01', code: '26' } });
  });

  it('de herfstvakantie als 41 in het schooljaar: de vakantielijst van die weekdag uit het zomerregime', () => {
    // 02-11-2026 is een maandag; de dekking zegt "schooldag", de code zegt vakantie.
    expect(los('2026-11-02', '41')).toEqual({ dayType: 'vakantieperiode ma/di/wo', bron: { soort: 'dagtype', code: '41', label: 'Maandag juli-augustus', naam: 'vakantieperiode ma/di/wo' } });
    expect(los('2026-11-05', '44')).toEqual({ dayType: 'vakantieperiode donderdag', bron: { soort: 'dagtype', code: '44', label: 'Donderdag juli-augustus', naam: 'vakantieperiode donderdag' } });
    expect(los('2026-11-06', '35')).toEqual({ dayType: 'vakantieperiode vrijdag', bron: { soort: 'dagtype', code: '35', label: 'Vrijdag schoolvakantie', naam: 'vakantieperiode vrijdag' } });
  });

  it('een feestdag midden in de week rijdt de zondaglijst', () => {
    // 11-11-2026 is een woensdag.
    expect(los('2026-11-11', '28')).toEqual({ dayType: 'zondag', bron: { soort: 'dagtype', code: '28', label: 'Feestdag', naam: 'zondag' } });
  });

  it('de code uit de dagtypekalender telt zoals een code in kolom B', () => {
    const kalender: DagtypeKalender = { ...KALENDER, perDag: { '2026-11-02': { typedag: '31', maxVerlof: 7 } } };
    expect(los('2026-11-02', '', { kalender })).toEqual({ dayType: 'vakantieperiode ma/di/wo', bron: { soort: 'dagtype', code: '31', label: 'Maandag schoolvakantie', naam: 'vakantieperiode ma/di/wo' } });
    // Kolom B gaat voor op de kalender (regel Jarno 11-10).
    expect(los('2026-11-02', '21', { kalender })).toEqual({ dayType: 'schooldag', bron: { soort: 'periode', vanaf: '2026-09-01', code: '21' } });
  });

  it('een klasse zonder lijst (examen, niet gekoppeld) valt terug op de dekkingskalender; de bron zegt dat de code geen lijst heeft', () => {
    expect(los('2026-12-15', '52')).toEqual({ dayType: 'schooldag dinsdag', bron: { soort: 'periode', vanaf: '2026-09-01', zonderLijst: { code: '52', label: 'Dinsdag examen' } } });
    // Ook zonder koppeling (leesfout van dagtype_codes): zelfde uitkomst.
    expect(los('2026-12-15', '52', { koppeling: {} })).toEqual({ dayType: 'schooldag dinsdag', bron: { soort: 'periode', vanaf: '2026-09-01', zonderLijst: { code: '52', label: 'Dinsdag examen' } } });
    // Koppelt Jarno examen aan schooldag in Dienstopbouw › Dagtypes, dan is het een gewone schooldag.
    expect(los('2026-12-15', '52', { koppeling: { ...KOPPELING, '52': 'schooldag' } })).toEqual({ dayType: 'schooldag dinsdag', bron: { soort: 'periode', vanaf: '2026-09-01', code: '52' } });
  });

  it('zonder weekdaglijst van die klasse: een lijst die de weekdag noemt, anders de kortste', () => {
    const lijsten = ['schooldag', 'vakantie', 'vakantie donderdag', 'zondag'];
    const kalender: DagtypeKalender = { weekdays: ['zondag', 'schooldag', 'schooldag', 'schooldag', 'schooldag', 'schooldag', 'schooldag'], perioden: [], overrides: [] };
    expect(los('2026-11-05', '34', { kalender, lijstNamen: lijsten })).toMatchObject({ dayType: 'vakantie donderdag', bron: { soort: 'dagtype', code: '34' } });
    expect(los('2026-11-02', '31', { kalender, lijstNamen: lijsten })).toMatchObject({ dayType: 'vakantie', bron: { soort: 'dagtype', code: '31' } });
    // Een zaterdagcode zonder zaterdaglijst: de dekkingskalender ("schooldag") zoals vroeger, zonder bevestiging.
    expect(los('2026-11-07', '26', { kalender, lijstNamen: lijsten })).toEqual({ dayType: 'schooldag', bron: { soort: 'basis', zonderLijst: { code: '26', label: 'Zaterdag' } } });
  });

  it('een naam die alleen als weekdag bestaat maar niet als lijst telt niet mee', () => {
    const kalender: DagtypeKalender = { weekdays: ['zondag', 'vakantie ma', 'schooldag', 'schooldag', 'schooldag', 'schooldag', 'zaterdag'], perioden: [], overrides: [] };
    // "vakantie ma" staat in de weekdagtoewijzing maar heeft geen lijst: de lijst "vakantie" wint.
    expect(los('2026-11-02', '31', { kalender, lijstNamen: ['schooldag', 'vakantie', 'zondag', 'zaterdag'] })).toMatchObject({ dayType: 'vakantie' });
  });
});

describe('dekkingDagtypeVanDag, tegenlezing 11-10', () => {
  it('een lijst van exact dezelfde periode gaat vóór een lijst van dezelfde klasse', () => {
    // Met een eigen lijst "feestdag" kiest code 28 die, en niet de zondaglijst.
    expect(los('2026-11-11', '28', { lijstNamen: [...LIJSTEN, 'feestdag'] })).toMatchObject({ dayType: 'feestdag', bron: { soort: 'dagtype', code: '28', naam: 'feestdag' } });
    // Zonder zo'n lijst blijft het de zondaglijst.
    expect(los('2026-11-11', '28')).toMatchObject({ dayType: 'zondag' });
  });

  it('zonder echte datum kiest de code geen willekeurige lijst: de dekkingskalender zoals vroeger', () => {
    expect(los('', '21')).toEqual({ dayType: '', bron: { soort: 'geen' } });
    // 30 februari schuift niet door naar 2 maart.
    expect(los('2026-02-30', '21').bron.soort).not.toBe('dagtype');
  });

  it('een lijst zonder weekdag gaat vóór een lijst met een andere weekdag', () => {
    const kalender: DagtypeKalender = { weekdays: ['zondag', 'schooldag', 'schooldag', 'schooldag', 'schooldag', 'schooldag', 'zaterdag'], perioden: [], overrides: [] };
    const lijsten = ['schooldag', 'vakantie donderdag', 'vakantie algemeen', 'zaterdag', 'zondag'];
    expect(los('2026-11-02', '31', { kalender, lijstNamen: lijsten })).toMatchObject({ dayType: 'vakantie algemeen' });
    expect(los('2026-11-05', '34', { kalender, lijstNamen: lijsten })).toMatchObject({ dayType: 'vakantie donderdag' });
  });
});
