import { describe, expect, it } from 'vitest';
import type { LeaveRequest, Shift } from '../types';
import { beschikbareZiekteJaren, berekenZiekteInzicht, openZiekteDiensten } from './ziekteInzicht';

const ziek = (id: string, userId: string, startDate: string, endDate: string, extra: Partial<LeaveRequest> = {}): LeaveRequest => ({
  id, userId, startDate, endDate, type: 'ziekte', status: 'approved', createdAt: '2026-01-01T12:00:00Z', ...extra,
});
const dienst = (id: string, date: string, line: string, startTime = '08:00', driverId = 'a'): Shift => ({
  id, date, line, startTime, endTime: '18:00', driverId, busNumber: '', loopnr: '',
});

describe('berekenZiekteInzicht', () => {
  it('telt overlappende dagen per chauffeur eenmaal en houdt registraties afzonderlijk', () => {
    const uit = berekenZiekteInzicht([
      ziek('1', 'a', '2026-01-01', '2026-01-05'),
      ziek('2', 'a', '2026-01-04', '2026-01-08'),
      ziek('3', 'a', '2026-01-09', '2026-01-09'),
      ziek('4', 'b', '2026-01-05', '2026-01-05'),
    ], 2026, '2026-09-16');
    expect(uit.totaalKalenderdagen).toBe(10);
    expect(uit.aantalMeldingen).toBe(4);
    expect(uit.chauffeurs).toEqual([
      { userId: 'a', kalenderdagen: 9, meldingen: 3 },
      { userId: 'b', kalenderdagen: 1, meldingen: 1 },
    ]);
    expect(uit.maanden[0]).toEqual({ maand: 1, kalenderdagen: 10, meldingen: 4 });
  });

  it('telt vandaag inclusief maar geen toekomstige dagen, intrekkingen of andere afwezigheid', () => {
    const uit = berekenZiekteInzicht([
      ziek('1', 'a', '2026-09-15', '2026-09-20'),
      ziek('2', 'b', '2026-09-17', '2026-09-30'),
      ziek('3', 'c', '2026-09-01', '2026-09-16', { status: 'cancelled' }),
      ziek('4', 'd', '2026-09-01', '2026-09-16', { status: 'pending' }),
      ziek('5', 'e', '2026-09-01', '2026-09-16', { status: 'rejected' }),
      ziek('6', 'f', '2026-09-01', '2026-09-16', { type: 'betaald_verlof' }),
    ], 2026, '2026-09-16');
    expect(uit.totEnMet).toBe('2026-09-16');
    expect(uit.totaalKalenderdagen).toBe(2);
    expect(uit.aantalMeldingen).toBe(1);
    expect(uit.chauffeurs).toEqual([{ userId: 'a', kalenderdagen: 2, meldingen: 1 }]);
    expect(uit.maanden.slice(9).every((maand) => maand.kalenderdagen === 0 && maand.meldingen === 0)).toBe(true);
  });

  it('verdeelt unieke dagen op de maandgrens en telt een doorlopende registratie in beide maanden', () => {
    const uit = berekenZiekteInzicht([
      ziek('1', 'a', '2026-01-30', '2026-02-02'),
      ziek('2', 'a', '2026-02-02', '2026-02-03'),
    ], 2026, '2026-09-16');
    expect(uit.maanden).toHaveLength(12);
    expect(uit.maanden.slice(0, 2)).toEqual([
      { maand: 1, kalenderdagen: 2, meldingen: 1 },
      { maand: 2, kalenderdagen: 3, meldingen: 2 },
    ]);
    expect(uit.totaalKalenderdagen).toBe(5);
    expect(uit.aantalMeldingen).toBe(2);
    expect(uit.maanden.reduce((som, maand) => som + maand.kalenderdagen, 0)).toBe(uit.totaalKalenderdagen);
  });

  it('kapt een periode af op het gekozen jaar en maakt een toekomstjaar volledig leeg', () => {
    const meldingen = [ziek('1', 'a', '2025-12-30', '2026-01-03')];
    const vorig = berekenZiekteInzicht(meldingen, 2025, '2026-09-16');
    expect(vorig).toMatchObject({ totEnMet: '2025-12-31', totaalKalenderdagen: 2, aantalMeldingen: 1 });
    expect(vorig.maanden[11]).toEqual({ maand: 12, kalenderdagen: 2, meldingen: 1 });
    expect(berekenZiekteInzicht(meldingen, 2026, '2026-09-16').totaalKalenderdagen).toBe(3);
    const toekomst = berekenZiekteInzicht([ziek('2', 'a', '2027-01-01', '2027-01-10')], 2027, '2026-09-16');
    expect(toekomst).toMatchObject({ totEnMet: null, totaalKalenderdagen: 0, aantalMeldingen: 0, chauffeurs: [] });
    expect(toekomst.maanden.every((maand) => maand.kalenderdagen === 0 && maand.meldingen === 0)).toBe(true);
  });

  it.each([
    ['2024-02-28', '2024-03-01', 2024],
    ['2026-03-28', '2026-03-30', 2026],
    ['2026-10-24', '2026-10-26', 2026],
  ])('telt drie kalenderdagen over schrikkeldag of klokwissel: %s t/m %s', (start, eind, jaar) => {
    expect(berekenZiekteInzicht([ziek('1', 'a', start, eind)], jaar, `${jaar}-12-31`).totaalKalenderdagen).toBe(3);
  });

  it('negeert ongeldige periodes en telt een dubbel aangeleverd record eenmaal', () => {
    const melding = ziek('1', 'a', '2026-01-01', '2026-01-02');
    const uit = berekenZiekteInzicht([
      melding, melding,
      ziek('2', 'a', '2026-02-30', '2026-03-05'),
      ziek('3', 'a', '2026-06-03', '2026-06-01'),
      ziek('4', 'a', '', '2026-06-01'),
    ], 2026, '2026-09-16');
    expect(uit).toMatchObject({ totaalKalenderdagen: 2, aantalMeldingen: 1 });
  });

  it('verandert de aangeleverde registraties niet', () => {
    const meldingen = Object.freeze([
      Object.freeze(ziek('2', 'b', '2026-03-03', '2026-03-04')),
      Object.freeze(ziek('1', 'a', '2026-01-01', '2026-01-02')),
    ]);
    expect(berekenZiekteInzicht(meldingen, 2026, '2026-09-16').totaalKalenderdagen).toBe(4);
    expect(meldingen.map((melding) => melding.id)).toEqual(['2', '1']);
  });
});

describe('beschikbareZiekteJaren', () => {
  it('neemt alle geraakte historische jaren mee, plus huidig jaar, zonder toekomstige of ingetrokken ziekte', () => {
    expect(beschikbareZiekteJaren([
      ziek('1', 'a', '2023-12-31', '2025-01-01'),
      ziek('2', 'b', '2026-12-31', '2027-01-10'),
      ziek('3', 'c', '2022-01-01', '2022-01-31', { status: 'cancelled' }),
      ziek('4', 'c', '2021-01-01', '2021-01-31', { type: 'klein_verlet' }),
    ], '2026-09-16')).toEqual([2026, 2025, 2024, 2023]);
    expect(beschikbareZiekteJaren([], '2026-09-16')).toEqual([2026]);
  });
});

describe('openZiekteDiensten', () => {
  it('houdt alleen eigen diensten vanaf vandaag binnen de melding, met één vroegste segment per datum en code', () => {
    const melding = ziek('1', 'a', '2026-09-14', '2026-09-18');
    const shifts = Object.freeze([
      dienst('later', '2026-09-17', '4407'),
      dienst('tweede-segment', '2026-09-16', ' 2112 ', '13:00'),
      dienst('eerste-segment', '2026-09-16', '2112', '06:00'),
      dienst('andere-dienst', '2026-09-16', '2113'),
      dienst('gisteren', '2026-09-15', '2112'),
      dienst('na-ziekte', '2026-09-19', '2112'),
      dienst('andere-chauffeur', '2026-09-16', '2112', '08:00', 'b'),
    ]);
    expect(openZiekteDiensten(melding, shifts, '2026-09-16').map((shift) => shift.id)).toEqual(['eerste-segment', 'andere-dienst', 'later']);
    expect(shifts[0].id).toBe('later');
  });

  it('begint bij een toekomstige startdatum en telt de einddag inclusief', () => {
    const melding = ziek('1', 'a', '2026-09-20', '2026-09-22');
    const shifts = [dienst('voor', '2026-09-19', '2112'), dienst('begin', '2026-09-20', '2112'), dienst('eind', '2026-09-22', '2112')];
    expect(openZiekteDiensten(melding, shifts, '2026-09-16').map((shift) => shift.id)).toEqual(['begin', 'eind']);
  });

  it('geeft geen open diensten voor ingetrokken, niet-goedgekeurde of afgelopen ziekte', () => {
    const shifts = [dienst('s1', '2026-09-16', '2112')];
    for (const status of ['pending', 'cancelled', 'rejected'] as const) {
      expect(openZiekteDiensten(ziek('1', 'a', '2026-09-16', '2026-09-17', { status }), shifts, '2026-09-16')).toEqual([]);
    }
    expect(openZiekteDiensten(ziek('1', 'a', '2026-09-10', '2026-09-15'), shifts, '2026-09-16')).toEqual([]);
  });
});
