import { describe, it, expect } from 'vitest';
import { dubbeleInplanningen, onbekendeCodeFout, type DagStand, type Ontvangst } from '../api/_lib/dubbeleInplanning.js';
import { bordVanDag } from '../api/_lib/codeDienst.js';
import { ontvangstenVanRuil } from '../api/_lib/ruilRegels.js';

/**
 * DE regel tegen dubbele inplanning (Jarno 29-09), puur: na de bewerking
 * heeft geen enkele chauffeur op één dag meer dan één dienst, behalve wat hij
 * in dezelfde beweging afgeeft. Elk schrijfpad roept deze ene functie aan.
 */
const DAG = '2026-07-24';
const DAG2 = '2026-07-25';
const users = [
  { id: 'a', name: 'An', role: 'chauffeur', isActive: true },
  { id: 'b', name: 'Bert', role: 'chauffeur', isActive: true },
  { id: 'c', name: 'Cis', role: 'chauffeur', isActive: true },
];
const services = [{ serviceNumber: '12' }, { serviceNumber: '14' }];
const codes = [{ code: 'eek6', category: 'service' }, { code: 'vrij', category: 'absence' }, { code: 'xx', category: 'unknown' }];
const stand = (assignments: Record<string, string>, rijen: DagStand['rijen'] = [], date = DAG): DagStand => ({
  rijen,
  bord: bordVanDag(date, { rows: [{ source_date: date, assignments }], users, services, codes, leave: [], swaps: [] }),
});
const toets = (s: DagStand, ontvangsten: Ontvangst[]) => dubbeleInplanningen((d) => (d === DAG ? s : undefined), ontvangsten);
const krijgt14 = (extra: Partial<Ontvangst> = {}): Ontvangst => ({ driverId: 'b', date: DAG, krijgt: '14', ...extra });

describe('dubbeleInplanningen', () => {
  it('wie vrij is, of niet in de matrix staat, kan een dienst krijgen', () => {
    expect(toets(stand({ Bert: 'vrij' }), [krijgt14()])).toEqual([]);
    expect(toets(stand({ An: '12' }), [krijgt14()])).toEqual([]);
  });

  it('een dienst in de planning-rijen is een conflict', () => {
    expect(toets(stand({}, [{ driverId: 'b', line: '12' }]), [krijgt14()]))
      .toEqual([{ driverId: 'b', date: DAG, dienst: '12', bron: 'rijen' }]);
  });

  it('een code-dienst op het bord is een conflict, een gewone dienst zonder rijen niet', () => {
    expect(toets(stand({ Bert: 'EEK6' }), [krijgt14()])).toEqual([{ driverId: 'b', date: DAG, dienst: 'EEK6', bron: 'bord' }]);
    // Voor een dienst uit het dienstoverzicht zijn de rijen de waarheid.
    expect(toets(stand({ Bert: '12' }), [krijgt14()])).toEqual([]);
  });

  it('de dienst die hij krijgt en wat hij in dezelfde beweging afgeeft tellen niet', () => {
    expect(toets(stand({}, [{ driverId: 'b', line: '14' }]), [krijgt14()])).toEqual([]);
    expect(toets(stand({}, [{ driverId: 'b', line: '12' }]), [krijgt14({ geeftAf: ['12'] })])).toEqual([]);
    expect(toets(stand({ Bert: 'EEK6' }), [krijgt14({ geeftAf: ['eek6'] })])).toEqual([]);
    expect(toets(stand({ Bert: 'EEK6' }), [krijgt14({ krijgt: 'eek6' })])).toEqual([]);
  });

  it('een andere dienst dan de afgegeven blijft een conflict', () => {
    const s = stand({}, [{ driverId: 'b', line: '12' }, { driverId: 'b', line: '15' }]);
    expect(toets(s, [krijgt14({ geeftAf: ['12'] })])).toEqual([{ driverId: 'b', date: DAG, dienst: '15', bron: 'rijen' }]);
  });

  it('geldt voor elke ontvangst, op elke dag; rijen gaan vóór het bord', () => {
    const dag1 = stand({ Bert: 'EEK6' });
    const dag2 = stand({ Cis: 'vrij' }, [{ driverId: 'c', line: '13' }], DAG2);
    const uit = dubbeleInplanningen((d) => (d === DAG ? dag1 : d === DAG2 ? dag2 : undefined), [
      krijgt14(),
      { driverId: 'c', date: DAG2, krijgt: '12' },
    ]);
    expect(uit).toEqual([
      { driverId: 'c', date: DAG2, dienst: '13', bron: 'rijen' },
      { driverId: 'b', date: DAG, dienst: 'EEK6', bron: 'bord' },
    ]);
  });

  it('een ontvangst zonder dag, chauffeur of dienst, of een dag zonder stand, zegt niets', () => {
    const s = stand({ Bert: 'EEK6' }, [{ driverId: 'b', line: '12' }]);
    expect(toets(s, [krijgt14({ date: '' }), krijgt14({ driverId: '' }), krijgt14({ krijgt: '' }), krijgt14({ date: DAG2 })])).toEqual([]);
  });
});

describe('ontvangstenVanRuil', () => {
  const ruil = { requesterId: 'c', targetDriverId: 'b', shiftDate: DAG, shiftLine: '14', returnDate: DAG2, returnCode: '12', swapType: 'ruil' };

  it('1-op-1 over twee dagen: de collega op de dienstdag, de aanvrager op de terugdag', () => {
    expect(ontvangstenVanRuil(ruil)).toEqual([
      { driverId: 'b', date: DAG, krijgt: '14', geeftAf: [] },
      { driverId: 'c', date: DAG2, krijgt: '12', geeftAf: [] },
    ]);
  });

  it('1-op-1 op dezelfde dag: elk geeft af wat de ander krijgt', () => {
    expect(ontvangstenVanRuil({ ...ruil, returnDate: DAG })).toEqual([
      { driverId: 'b', date: DAG, krijgt: '14', geeftAf: ['12'] },
      { driverId: 'c', date: DAG, krijgt: '12', geeftAf: ['14'] },
    ]);
  });

  it('een overname of een tegenprestatie "vrij": alleen de collega', () => {
    expect(ontvangstenVanRuil({ ...ruil, swapType: 'overname' })).toEqual([{ driverId: 'b', date: DAG, krijgt: '14', geeftAf: [] }]);
    expect(ontvangstenVanRuil({ ...ruil, returnCode: 'VRIJ' })).toEqual([{ driverId: 'b', date: DAG, krijgt: '14', geeftAf: [] }]);
  });

  it('een oude ruil zonder dienst-info geeft niets te toetsen', () => {
    expect(ontvangstenVanRuil({ requesterId: 'c', targetDriverId: 'b', returnDate: DAG2, returnCode: '12' })).toEqual([]);
  });
});

describe('onbekendeCodeFout', () => {
  it('noemt de chauffeur, de dag en de code, en zegt wat de planner kan doen', () => {
    expect(onbekendeCodeFout('Bert', DAG, 'FD')).toBe(
      "Bert staat op 24/07/2026 op 'FD', en die code staat niet in het dienstoverzicht of de planningscodes. Voeg ze eerst toe in Planningscodes, dan weet het portaal of Bert die dag een dienst rijdt.",
    );
  });
});
