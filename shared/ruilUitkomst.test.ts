import { describe, expect, it } from 'vitest';
import { persoonsVerloop, type RuilVerloopStap, type RuilVoorVerloop } from './ruilVerloop';
import { COLLEGA_STATUS_NAAR_ANTWOORD, collegaAntwoord, isOoitDoorgevoerd, ruilBeslissing, ruilStand } from './ruilUitkomst';

const basis: RuilVoorVerloop = { status: 'pending', requesterId: '10', targetDriverId: '11', createdAt: '2026-09-10T08:00:00.000Z', swapType: 'ruil', shiftDate: '2026-09-20', shiftLine: '2109' };
const stap = (soort: RuilVerloopStap['soort'], op: string, door: RuilVerloopStap['door'], extra: Partial<RuilVerloopStap> = {}): RuilVerloopStap => ({ soort, op, door, ...extra });

describe('waar een ruil vandaag staat', () => {
  it('de vier open en doorgevoerde statussen', () => {
    expect(ruilStand(basis)).toBe('bij-collega');
    expect(ruilStand({ ...basis, status: 'accepted' })).toBe('bij-planning');
    expect(ruilStand({ ...basis, status: 'approved' })).toBe('goedgekeurd');
    expect(ruilStand({ ...basis, status: 'completed' })).toBe('afgehandeld');
  });

  it('geweigerd, ingetrokken door de aanvrager, geannuleerd door de planning', () => {
    expect(ruilStand({ ...basis, status: 'rejected', verloop: [stap('geweigerd', '2026-09-11T08:00:00Z', 'collega')] })).toBe('geweigerd');
    expect(ruilStand({ ...basis, status: 'cancelled', verloop: [stap('geannuleerd', '2026-09-11T08:00:00Z', 'aanvrager')] })).toBe('ingetrokken');
    expect(ruilStand({ ...basis, status: 'cancelled', verloop: [stap('geannuleerd', '2026-09-11T08:00:00Z', 'planner')] })).toBe('geannuleerd');
    // Zonder log weten we niet wie annuleerde: dan geen gok richting de aanvrager.
    expect(ruilStand({ ...basis, status: 'cancelled' })).toBe('geannuleerd');
  });

  it('teruggedraaid = ooit doorgevoerd en daarna afgewezen of geannuleerd', () => {
    const verloop = [stap('goedgekeurd', '2026-09-11T08:00:00Z', 'planner', { van: 'accepted' }), stap('geannuleerd', '2026-09-12T08:00:00Z', 'planner', { van: 'approved' })];
    expect(ruilStand({ ...basis, status: 'cancelled', verloop })).toBe('teruggedraaid');
    expect(ruilStand({ ...basis, status: 'rejected', verloop })).toBe('teruggedraaid');
    // Een handmatige wissel bestaat alleen doordat hij doorgevoerd is, ook als het log ontbreekt.
    expect(isOoitDoorgevoerd({ ...basis, status: 'cancelled', reason: 'Handmatige wissel door Petra, mondeling' })).toBe(true);
    expect(isOoitDoorgevoerd({ ...basis, status: 'cancelled' })).toBe(false);
  });
});

describe('antwoord van de collega', () => {
  it('geaccepteerd, geweigerd, niet afgewacht, wacht, niet nodig en geen collega', () => {
    expect(collegaAntwoord({ ...basis, status: 'accepted', verloop: [stap('geaccepteerd', '2026-09-11T08:00:00Z', 'collega')] })).toBe('geaccepteerd');
    expect(collegaAntwoord({ ...basis, status: 'rejected', verloop: [stap('geweigerd', '2026-09-11T08:00:00Z', 'collega')] })).toBe('geweigerd');
    expect(collegaAntwoord({ ...basis, status: 'approved', verloop: [stap('goedgekeurd', '2026-09-11T08:00:00Z', 'planner', { van: 'pending' })] })).toBe('niet-afgewacht');
    expect(collegaAntwoord(basis)).toBe('wacht');
    expect(collegaAntwoord({ ...basis, verloop: [stap('bekeken', '2026-09-10T09:00:00Z', 'collega')] })).toBe('wacht');
    expect(collegaAntwoord({ ...basis, status: 'approved', reason: 'Handmatige wissel door Petra, mondeling' })).toBe('niet-nodig');
    expect(collegaAntwoord({ ...basis, targetDriverId: null })).toBeNull();
  });

  it('de planner weigerde een ruil die de collega nooit beantwoordde: geen antwoord, en de planner besliste', () => {
    const swap = { ...basis, status: 'rejected', verloop: [stap('geweigerd', '2026-09-11T08:00:00Z', 'planner', { naam: 'Petra Planner' })] };
    expect(collegaAntwoord(swap)).toBe('geen');
    expect(ruilBeslissing(swap)).toEqual({ op: '2026-09-11T08:00:00Z', door: 'planner', naam: 'Petra Planner' });
  });

  it('elke statustekst die persoonsVerloop voor de collega kan geven heeft een antwoord (drift)', () => {
    const statussen = ['pending', 'accepted', 'approved', 'completed', 'rejected', 'cancelled'];
    const logs: RuilVerloopStap[][] = [
      [],
      [stap('bekeken', '2026-09-10T09:00:00Z', 'collega')],
      [stap('geaccepteerd', '2026-09-10T10:00:00Z', 'collega')],
      [stap('goedgekeurd', '2026-09-10T11:00:00Z', 'planner', { van: 'pending' })],
      [stap('geweigerd', '2026-09-10T11:00:00Z', 'collega')],
      [stap('geweigerd', '2026-09-10T11:00:00Z', null)],
      [stap('geannuleerd', '2026-09-10T11:00:00Z', 'aanvrager')],
    ];
    const gezien = new Set<string>();
    for (const status of statussen) {
      for (const verloop of [undefined, ...logs]) {
        for (const reason of [undefined, 'Handmatige wissel door Petra, mondeling']) {
          for (const createdAt of ['2026-09-10T08:00:00.000Z', '2026-10-10T08:00:00.000Z']) {
            for (const targetSeenAt of [undefined, '2026-09-12T08:00:00Z']) {
              const regel = persoonsVerloop({ ...basis, status, verloop, reason, createdAt, targetSeenAt }).find((r) => r.rol === 'collega');
              if (regel) gezien.add(regel.status);
            }
          }
        }
      }
    }
    expect(gezien.size).toBeGreaterThan(8);
    for (const status of gezien) expect(COLLEGA_STATUS_NAAR_ANTWOORD[status], status).toBeTruthy();
  });
});

describe('wie besliste, en wanneer', () => {
  it('open = nog niet beslist', () => {
    expect(ruilBeslissing(basis)).toBeNull();
    expect(ruilBeslissing({ ...basis, status: 'accepted' })).toBeNull();
  });

  it('een afgehandelde ruil is beslist op de goedkeuring, niet op het afhandelen (decidedAt)', () => {
    const swap = {
      ...basis, status: 'completed', decidedAt: '2026-09-20T08:00:00Z',
      verloop: [stap('goedgekeurd', '2026-09-11T08:00:00Z', 'planner', { van: 'accepted', naam: 'Petra Planner' }), stap('afgehandeld', '2026-09-20T08:00:00Z', 'planner')],
    };
    expect(ruilBeslissing(swap)).toEqual({ op: '2026-09-11T08:00:00Z', door: 'planner', naam: 'Petra Planner' });
  });

  it('de collega weigerde, of de aanvrager trok in', () => {
    expect(ruilBeslissing({ ...basis, status: 'rejected', verloop: [stap('geweigerd', '2026-09-11T08:00:00Z', 'collega')] })).toEqual({ op: '2026-09-11T08:00:00Z', door: 'collega', userId: '11' });
    expect(ruilBeslissing({ ...basis, status: 'cancelled', verloop: [stap('geannuleerd', '2026-09-11T09:00:00Z', 'aanvrager')] })).toEqual({ op: '2026-09-11T09:00:00Z', door: 'aanvrager', userId: '10' });
  });

  it('zonder log: het moment uit decidedAt, en niemand aangewezen', () => {
    expect(ruilBeslissing({ ...basis, status: 'rejected', decidedAt: '2026-09-11T08:00:00Z' })).toEqual({ op: '2026-09-11T08:00:00Z', door: 'onbekend' });
  });
});
