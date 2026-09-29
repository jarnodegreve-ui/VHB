import { describe, it, expect } from 'vitest';
import type { Shift } from '../types';
import { kandidaatLabel, nietBeschikbaarUitMatrix, rangschikKandidaten, vrijOpDatum, werkdagenUitShifts, type BordCellen } from './vervangers';

/**
 * Vervangerlijsten (Ziekte, dashboard, Openstaande diensten). Sinds de
 * controle van 29-09 beslist het bord wie vrij is: de matrixcel met de
 * doorgevoerde ruilen erover, dezelfde cellen als de Maandplanning. De rauwe
 * matrix toont niet dat een schoolrit van eigenaar veranderde.
 */
const DAG = '2026-07-24';
const A = { id: '3', name: 'Chauffeur A' };
const B = { id: '4', name: 'Chauffeur B' };
const C = { id: '5', name: 'Chauffeur C' };
const users = [A, B, C];
const dienst = (driverId: string, line: string, date = DAG): Shift =>
  ({ id: `${driverId}-${date}-${line}`, driverId, date, line, startTime: '10:00', endTime: '18:00', busNumber: '', loopnr: '' }) as Shift;
// A had de schoolrit, B was vrij, C rijdt de gewone dienst 14.
const matrix = [{ source_date: DAG, assignments: { 'Chauffeur A': 'EEK6', 'Chauffeur B': 'vrij', 'Chauffeur C': '14' } }];
const shifts = [dienst(C.id, '14')];
// Het bord ná de wissel van EEK6 van A naar B, zoals /api/month-planning het geeft.
const bordNaWissel: BordCellen = {
  [A.id]: { [DAG]: { code: 'vrij', kind: 'absence' } },
  [B.id]: { [DAG]: { code: 'EEK6', kind: 'service' } },
  [C.id]: { [DAG]: { code: '14', kind: 'service' } },
};
const vrijen = (isVrij: (u: { id: string; name: string }) => boolean) => users.filter(isVrij).map((u) => u.name);

describe('nietBeschikbaarUitMatrix', () => {
  it('een code die geen overname-code is maakt iemand niet beschikbaar, ook een schoolrit', () => {
    expect([...nietBeschikbaarUitMatrix(matrix, users, DAG)].sort()).toEqual([A.id, C.id]);
  });

  it('kijkt alleen naar de gevraagde dag en matcht namen in omgekeerde volgorde', () => {
    const rows: Array<{ source_date: string; assignments: Record<string, string> }> = [
      { source_date: '2026-07-23', assignments: { 'Chauffeur B': 'ziek' } },
      { source_date: DAG, assignments: { 'B Chauffeur': 'opl', 'Chauffeur C': 'bv' } },
    ];
    expect([...nietBeschikbaarUitMatrix(rows, users, DAG)]).toEqual([B.id]);
  });
});

describe('vrijOpDatum', () => {
  it('zonder bord geldt de matrixregel: wie rijdt of op een code staat is niet vrij', () => {
    const isVrij = vrijOpDatum(shifts, DAG, nietBeschikbaarUitMatrix(matrix, users, DAG));
    expect(vrijen(isVrij)).toEqual(['Chauffeur B']);
  });

  it('zonder bord en zonder matrix telt alleen de planning', () => {
    expect(vrijen(vrijOpDatum(shifts, DAG))).toEqual(['Chauffeur A', 'Chauffeur B']);
  });

  it('met het bord: wie via een wissel een schoolrit kreeg is niet vrij, wie ze afgaf wel', () => {
    // De matrix is niet gewijzigd en zegt nog altijd het omgekeerde.
    const isVrij = vrijOpDatum(shifts, DAG, nietBeschikbaarUitMatrix(matrix, users, DAG), bordNaWissel);
    expect(vrijen(isVrij)).toEqual(['Chauffeur A']);
  });

  it('met het bord: een dienst onder een afwezigheid staat nog op naam, dus niet vrij', () => {
    const bord: BordCellen = { [B.id]: { [DAG]: { code: 'bv', kind: 'leave', hiddenService: 'EEK6' } } };
    expect(vrijen(vrijOpDatum([], DAG, undefined, bord))).toEqual(['Chauffeur A', 'Chauffeur C']);
  });

  it('met het bord: ziek of in opleiding is niet vrij, een overname-code wel', () => {
    const bord: BordCellen = {
      [A.id]: { [DAG]: { code: 'ziek', kind: 'absence' } },
      [B.id]: { [DAG]: { code: 'TA', kind: 'absence' } },
      [C.id]: { [DAG]: { code: 'opl', kind: 'training' } },
    };
    expect(vrijen(vrijOpDatum([], DAG, undefined, bord))).toEqual(['Chauffeur B']);
  });

  it('met het bord blijft de planning meetellen: wie rijen heeft is niet vrij', () => {
    // Het bord kent de dienst van C niet (bv. een wissel naar iemand buiten het bord).
    const bord: BordCellen = { [C.id]: { [DAG]: { code: 'vrij', kind: 'absence' } } };
    expect(vrijen(vrijOpDatum(shifts, DAG, undefined, bord))).toEqual(['Chauffeur A', 'Chauffeur B']);
  });

  it('het bord van een andere dag zegt niets over deze dag', () => {
    const bord: BordCellen = { [B.id]: { '2026-07-25': { code: 'EEK6', kind: 'service' } } };
    expect(vrijen(vrijOpDatum(shifts, DAG, undefined, bord))).toEqual(['Chauffeur A', 'Chauffeur B']);
  });
});

describe('rangschikKandidaten met het bord', () => {
  it('zet wie volgens het bord vrij is bovenaan, met het label vrij', () => {
    const lijst = rangschikKandidaten(
      users,
      vrijOpDatum(shifts, DAG, nietBeschikbaarUitMatrix(matrix, users, DAG), bordNaWissel),
      werkdagenUitShifts(shifts),
      DAG,
    );
    expect(lijst.map((k) => [k.user.name, k.vrij])).toEqual([
      ['Chauffeur A', true],
      ['Chauffeur B', false],
      ['Chauffeur C', false],
    ]);
    expect(kandidaatLabel(lijst[0])).toBe('Chauffeur A · vrij');
    expect(kandidaatLabel(lijst[1])).toBe('Chauffeur B');
  });
});
