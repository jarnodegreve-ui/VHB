import { describe, expect, it } from 'vitest';
import {
  dagVoor, hoortBijVersie, oudsteVersie, vergelijkDiensten, versieGeldigTot, versieLabel, versieStatus, versieVoorDatum,
} from './dienstregeling';

const V = [
  { id: 'sep', geldigVanaf: '2026-09-01' },
  { id: 'nov', geldigVanaf: '2026-11-14' },
  { id: 'jan', geldigVanaf: '2027-01-01' },
];

describe('versieVoorDatum', () => {
  it('kiest de versie met de grootste geldig-vanaf die niet na de dag ligt', () => {
    expect(versieVoorDatum(V, '2026-11-13')?.id).toBe('sep');
    expect(versieVoorDatum(V, '2026-11-14')?.id).toBe('nov');
    expect(versieVoorDatum(V, '2026-12-31')?.id).toBe('nov');
    expect(versieVoorDatum(V, '2027-01-01')?.id).toBe('jan');
    expect(versieVoorDatum(V, '2030-01-01')?.id).toBe('jan');
  });

  it('valt vóór de eerste versie terug op de eerste (het verleden blijft aan de toenmalige lijst hangen)', () => {
    expect(versieVoorDatum(V, '2026-03-01')?.id).toBe('sep');
  });

  it('is onafhankelijk van de volgorde van de lijst en geeft null zonder versies', () => {
    expect(versieVoorDatum([V[2], V[0], V[1]], '2026-12-01')?.id).toBe('nov');
    expect(versieVoorDatum([], '2026-12-01')).toBeNull();
    expect(oudsteVersie([V[2], V[0]])?.id).toBe('sep');
  });
});

describe('versieStatus en geldig tot', () => {
  it('verlopen, huidig, toekomstig vanuit vandaag', () => {
    expect(versieStatus(V, V[0], '2026-12-01')).toBe('verlopen');
    expect(versieStatus(V, V[1], '2026-12-01')).toBe('huidig');
    expect(versieStatus(V, V[2], '2026-12-01')).toBe('toekomstig');
    // Eén versie is altijd de huidige, ook vóór haar datum (terugval).
    expect(versieStatus([V[0]], V[0], '2026-01-01')).toBe('huidig');
  });

  it('geldt tot de dag vóór de volgende versie', () => {
    expect(versieGeldigTot(V, V[0])).toBe('2026-11-13');
    expect(versieGeldigTot(V, V[1])).toBe('2026-12-31');
    expect(versieGeldigTot(V, V[2])).toBeNull();
    expect(dagVoor('2027-01-01')).toBe('2026-12-31');
    expect(dagVoor('2026-03-01')).toBe('2026-02-28');
  });

  it('label: naam, anders Vanaf dd/mm/jjjj', () => {
    expect(versieLabel({ naam: ' Dienstregeling januari 2027 ', geldigVanaf: '2027-01-01' })).toBe('Dienstregeling januari 2027');
    expect(versieLabel({ naam: null, geldigVanaf: '2026-11-14' })).toBe('Vanaf 14/11/2026');
    expect(versieLabel({ geldigVanaf: '2026-11-14' })).toBe('Vanaf 14/11/2026');
  });

  it('een dienst zonder versie hoort bij de oudste', () => {
    expect(hoortBijVersie({}, 'sep', 'sep')).toBe(true);
    expect(hoortBijVersie({ dienstregelingId: null }, 'nov', 'sep')).toBe(false);
    expect(hoortBijVersie({ dienstregelingId: 'nov' }, 'nov', 'sep')).toBe(true);
  });
});

describe('vergelijkDiensten', () => {
  const oud = [
    { serviceNumber: '2101', startTime: '04:36', endTime: '07:52', loopnr: '4500', startTime2: '13:39', endTime2: '17:29', loopnr2: '4611' },
    { serviceNumber: '2102', startTime: '05:06', endTime: '08:27', loopnr: '4600' },
    { serviceNumber: '2103', startTime: '05:08', endTime: '13:54', loopnr: '4501' },
  ];
  const nieuw = [
    { serviceNumber: '2101 ', startTime: '04:40', endTime: '07:52', loopnr: '4500', startTime2: '13:39', endTime2: '17:29', loopnr2: '4612' },
    { serviceNumber: '2102', startTime: '05:06', endTime: '08:27', loopnr: '4600', startTime2: '', loopnr2: null },
    { serviceNumber: '2104', startTime: '06:00', endTime: '14:00' },
  ];

  it('vindt gewijzigde velden, nieuwe en verdwenen diensten; leeg en null tellen als gelijk', () => {
    const v = vergelijkDiensten(oud, nieuw);
    expect(v.gewijzigd.map((d) => [d.nummer, d.velden])).toEqual([['2101', ['startTime', 'loopnr2']]]);
    expect(v.gewijzigd[0].oud?.loopnr2).toBe('4611');
    expect(v.gewijzigd[0].nieuw?.loopnr2).toBe('4612');
    expect(v.nieuw.map((d) => d.nummer)).toEqual(['2104']);
    expect(v.weg.map((d) => d.nummer)).toEqual(['2103']);
    expect(v.ongewijzigd).toBe(1);
  });

  it('sorteert op dienstnummer, numeriek', () => {
    const v = vergelijkDiensten([], [{ serviceNumber: '2110' }, { serviceNumber: '2103' }, { serviceNumber: '999' }]);
    expect(v.nieuw.map((d) => d.nummer)).toEqual(['999', '2103', '2110']);
  });
});
