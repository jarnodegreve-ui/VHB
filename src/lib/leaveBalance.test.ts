import { describe, it, expect } from 'vitest';
import type { LeaveRequest } from '../types';
import { BETAALD_VERLOF_BUDGET, verlofBalans } from './leaveBalance';

const leave = (
  id: string,
  userId: string,
  startDate: string,
  endDate: string,
  status: LeaveRequest['status'] = 'approved',
  type: LeaveRequest['type'] = 'betaald_verlof',
): LeaveRequest => ({
  id,
  userId,
  startDate,
  endDate,
  type,
  status,
  createdAt: new Date('2026-01-01').toISOString(),
});

describe('verlofBalans — basis', () => {
  it('standaard budget = 24 dagen VHB', () => {
    expect(BETAALD_VERLOF_BUDGET).toBe(24);
  });

  it('zonder verlof: gebruikt=0, resterend=budget', () => {
    const balance = verlofBalans([], 'driver-1', 2026);
    expect(balance.betaaldGebruikt).toBe(0);
    expect(balance.betaaldResterend).toBe(24);
    expect(balance.betaaldBudget).toBe(24);
    expect(balance.kleinVerletDagen).toBe(0);
  });

  it('één goedgekeurde verlofperiode telt elke dag inclusief', () => {
    const leaves = [leave('l1', 'driver-1', '2026-07-01', '2026-07-05')];
    const balance = verlofBalans(leaves, 'driver-1', 2026);
    // 1, 2, 3, 4, 5 = 5 dagen
    expect(balance.betaaldGebruikt).toBe(5);
    expect(balance.betaaldResterend).toBe(19);
  });

  it('één-daagse verlof telt als 1 dag', () => {
    const leaves = [leave('l1', 'driver-1', '2026-07-01', '2026-07-01')];
    const balance = verlofBalans(leaves, 'driver-1', 2026);
    expect(balance.betaaldGebruikt).toBe(1);
  });

  it('meerdere verlofperiodes worden opgeteld', () => {
    const leaves = [
      leave('l1', 'driver-1', '2026-04-01', '2026-04-02'), // 2
      leave('l2', 'driver-1', '2026-07-15', '2026-07-20'), // 6
      leave('l3', 'driver-1', '2026-12-23', '2026-12-30'), // 8
    ];
    const balance = verlofBalans(leaves, 'driver-1', 2026);
    expect(balance.betaaldGebruikt).toBe(16);
    expect(balance.betaaldResterend).toBe(8);
  });
});

describe('verlofBalans — filtering', () => {
  it('telt alleen verlof van die userId', () => {
    const leaves = [
      leave('l1', 'driver-1', '2026-07-01', '2026-07-05'),
      leave('l2', 'driver-2', '2026-07-01', '2026-07-10'),
    ];
    expect(verlofBalans(leaves, 'driver-1', 2026).betaaldGebruikt).toBe(5);
    expect(verlofBalans(leaves, 'driver-2', 2026).betaaldGebruikt).toBe(10);
  });

  it('telt alleen approved (geen pending/rejected/cancelled)', () => {
    const leaves = [
      leave('l1', 'driver-1', '2026-07-01', '2026-07-05', 'approved'), // 5
      leave('l2', 'driver-1', '2026-07-10', '2026-07-12', 'pending'),
      leave('l3', 'driver-1', '2026-07-15', '2026-07-20', 'rejected'),
      leave('l4', 'driver-1', '2026-07-25', '2026-07-27', 'cancelled'),
    ];
    expect(verlofBalans(leaves, 'driver-1', 2026).betaaldGebruikt).toBe(5);
  });

  it('telt verlof per type apart (betaald_verlof vs klein_verlet)', () => {
    const leaves = [
      leave('l1', 'driver-1', '2026-07-01', '2026-07-03', 'approved', 'betaald_verlof'), // 3
      leave('l2', 'driver-1', '2026-08-01', '2026-08-01', 'approved', 'klein_verlet'), // 1
    ];
    const balance = verlofBalans(leaves, 'driver-1', 2026);
    expect(balance.betaaldGebruikt).toBe(3);
    expect(balance.kleinVerletDagen).toBe(1);
  });
});

describe('verlofBalans — jaargrenzen (clipping)', () => {
  it('verlof dat in het vorige jaar start, telt alleen de dagen IN het opgegeven jaar', () => {
    const leaves = [leave('l1', 'driver-1', '2025-12-28', '2026-01-03')];
    // 2025: 28, 29, 30, 31 → 4 dagen
    // 2026: 1, 2, 3 → 3 dagen
    expect(verlofBalans(leaves, 'driver-1', 2025).betaaldGebruikt).toBe(4);
    expect(verlofBalans(leaves, 'driver-1', 2026).betaaldGebruikt).toBe(3);
  });

  it('verlof dat in het volgende jaar eindigt, telt alleen tot 31/12', () => {
    const leaves = [leave('l1', 'driver-1', '2026-12-29', '2027-01-05')];
    // 2026: 29, 30, 31 → 3 dagen
    expect(verlofBalans(leaves, 'driver-1', 2026).betaaldGebruikt).toBe(3);
  });

  it('verlof geheel in een ander jaar telt niet mee', () => {
    const leaves = [leave('l1', 'driver-1', '2025-07-01', '2025-07-05')];
    expect(verlofBalans(leaves, 'driver-1', 2026).betaaldGebruikt).toBe(0);
  });
});

describe('verlofBalans — over budget', () => {
  it('gebruikt > budget → resterend = 0 (nooit negatief)', () => {
    const leaves = [leave('l1', 'driver-1', '2026-01-01', '2026-01-31')]; // 31 dagen
    const balance = verlofBalans(leaves, 'driver-1', 2026);
    expect(balance.betaaldGebruikt).toBe(31);
    expect(balance.betaaldResterend).toBe(0);
  });
});

describe('verlofBalans — zomertijd (DST)', () => {
  it('verlofperiode over de overgang naar zomertijd telt elke dag inclusief', () => {
    // 2026: zomertijd begint zondag 29 maart (die lokale dag is maar 23u).
    // 28, 29, 30 maart = 3 dagen — vroeger telde floor() er maar 2.
    const leaves = [leave('l1', 'driver-1', '2026-03-28', '2026-03-30')];
    expect(verlofBalans(leaves, 'driver-1', 2026).betaaldGebruikt).toBe(3);
  });

  it('volledige week rond de zomertijd-overgang telt correct', () => {
    const leaves = [leave('l1', 'driver-1', '2026-03-23', '2026-03-31')]; // 9 dagen
    expect(verlofBalans(leaves, 'driver-1', 2026).betaaldGebruikt).toBe(9);
  });
});

describe('verlofBalans — custom budget per gebruiker', () => {
  it('respecteert verlofBudget veld op user (bv. anciënniteit/deeltijds)', () => {
    const leaves = [leave('l1', 'driver-1', '2026-07-01', '2026-07-05')]; // 5 dagen
    const balance = verlofBalans(leaves, 'driver-1', 2026, 30);
    expect(balance.betaaldBudget).toBe(30);
    expect(balance.betaaldResterend).toBe(25);
  });

  it('budget=0 is geldig (geen recht op verlof)', () => {
    const leaves = [leave('l1', 'driver-1', '2026-07-01', '2026-07-05')];
    const balance = verlofBalans(leaves, 'driver-1', 2026, 0);
    expect(balance.betaaldBudget).toBe(0);
    expect(balance.betaaldResterend).toBe(0);
  });

  it('negatief budget wordt genegeerd, valt terug op default 24', () => {
    const balance = verlofBalans([], 'driver-1', 2026, -5);
    expect(balance.betaaldBudget).toBe(24);
  });
});

describe('verlofBalans — aangevraagd (pending)', () => {
  const aanvraag = (id: string, start: string, end: string, status: LeaveRequest['status'], type: LeaveRequest['type'] = 'betaald_verlof'): LeaveRequest => ({
    id, userId: 'driver-1', startDate: start, endDate: end, type, status, createdAt: '2026-01-01T00:00:00Z',
  });

  it('telt openstaande aanvragen apart en trekt ze af van wat nog vrij is', () => {
    const balance = verlofBalans([
      aanvraag('a', '2026-07-01', '2026-07-05', 'approved'),
      aanvraag('p', '2026-08-10', '2026-08-12', 'pending'),
    ], 'driver-1', 2026);
    expect(balance.betaaldGebruikt).toBe(5);
    expect(balance.betaaldAangevraagd).toBe(3);
    expect(balance.betaaldResterend).toBe(19);
    expect(balance.betaaldVrij).toBe(16);
  });

  it('afgewezen, ingetrokken en klein-verlet-aanvragen tellen niet als aangevraagd', () => {
    const balance = verlofBalans([
      aanvraag('r', '2026-08-10', '2026-08-12', 'rejected'),
      aanvraag('c', '2026-08-13', '2026-08-14', 'cancelled'),
      aanvraag('k', '2026-08-15', '2026-08-15', 'pending', 'klein_verlet'),
    ], 'driver-1', 2026);
    expect(balance.betaaldAangevraagd).toBe(0);
    expect(balance.betaaldVrij).toBe(24);
  });

  it('vrij wordt nooit negatief', () => {
    const balance = verlofBalans([aanvraag('p', '2026-01-01', '2026-02-15', 'pending')], 'driver-1', 2026);
    expect(balance.betaaldAangevraagd).toBe(46);
    expect(balance.betaaldVrij).toBe(0);
  });
});
