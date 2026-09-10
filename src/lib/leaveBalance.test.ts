import { describe, it, expect } from 'vitest';
import type { LeaveRequest } from '../types';
import { BETAALD_VERLOF_BUDGET, daysBetween, stelExtraFeestdagenIn, verlofBalans, verlofDagen } from './leaveBalance';

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

describe('verlofBalans, basis', () => {
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

  it('een verlofperiode telt elke dag inclusief, behalve zondag', () => {
    // wo 1 t/m zo 5 juli 2026 = 5 kalenderdagen, maar zondag telt niet mee.
    const leaves = [leave('l1', 'driver-1', '2026-07-01', '2026-07-05')];
    const balance = verlofBalans(leaves, 'driver-1', 2026);
    expect(balance.betaaldGebruikt).toBe(4);
    expect(balance.betaaldResterend).toBe(20);
  });

  it('één-daagse verlof telt als 1 dag', () => {
    const leaves = [leave('l1', 'driver-1', '2026-07-01', '2026-07-01')];
    const balance = verlofBalans(leaves, 'driver-1', 2026);
    expect(balance.betaaldGebruikt).toBe(1);
  });

  it('meerdere verlofperiodes worden opgeteld', () => {
    const leaves = [
      leave('l1', 'driver-1', '2026-04-01', '2026-04-02'), // wo-do = 2
      leave('l2', 'driver-1', '2026-07-15', '2026-07-20'), // wo-ma, 1 zondag = 5
      leave('l3', 'driver-1', '2026-12-23', '2026-12-30'), // wo-wo, 1 zondag + Kerstmis = 6
    ];
    const balance = verlofBalans(leaves, 'driver-1', 2026);
    expect(balance.betaaldGebruikt).toBe(13);
    expect(balance.betaaldResterend).toBe(11);
  });
});

describe('verlofBalans, filtering', () => {
  it('telt alleen verlof van die userId', () => {
    const leaves = [
      leave('l1', 'driver-1', '2026-07-01', '2026-07-05'),
      leave('l2', 'driver-2', '2026-07-01', '2026-07-10'),
    ];
    expect(verlofBalans(leaves, 'driver-1', 2026).betaaldGebruikt).toBe(4); // wo-zo, 1 zondag
    expect(verlofBalans(leaves, 'driver-2', 2026).betaaldGebruikt).toBe(9); // wo-vr, 1 zondag
  });

  it('telt alleen approved (geen pending/rejected/cancelled)', () => {
    const leaves = [
      leave('l1', 'driver-1', '2026-07-01', '2026-07-05', 'approved'), // wo-zo = 4
      leave('l2', 'driver-1', '2026-07-10', '2026-07-12', 'pending'),
      leave('l3', 'driver-1', '2026-07-15', '2026-07-20', 'rejected'),
      leave('l4', 'driver-1', '2026-07-25', '2026-07-27', 'cancelled'),
    ];
    expect(verlofBalans(leaves, 'driver-1', 2026).betaaldGebruikt).toBe(4);
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

describe('verlofBalans, jaargrenzen (clipping)', () => {
  it('verlof dat in het vorige jaar start, telt alleen de dagen IN het opgegeven jaar', () => {
    const leaves = [leave('l1', 'driver-1', '2025-12-28', '2026-01-03')];
    // 2025: zo 28 telt niet, ma 29 t/m wo 31 → 3 dagen
    // 2026: do 1 = Nieuwjaar (telt niet), vr 2 t/m za 3 → 2 dagen
    expect(verlofBalans(leaves, 'driver-1', 2025).betaaldGebruikt).toBe(3);
    expect(verlofBalans(leaves, 'driver-1', 2026).betaaldGebruikt).toBe(2);
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

describe('verlofBalans, over budget', () => {
  it('gebruikt > budget → resterend = 0 (nooit negatief)', () => {
    // do 1 t/m za 31 januari 2026 = 31 kalenderdagen, 4 zondagen en
    // Nieuwjaar → 26 verlofdagen.
    const leaves = [leave('l1', 'driver-1', '2026-01-01', '2026-01-31')];
    const balance = verlofBalans(leaves, 'driver-1', 2026);
    expect(balance.betaaldGebruikt).toBe(26);
    expect(balance.betaaldResterend).toBe(0);
  });
});

describe('verlofBalans, zomertijd (DST)', () => {
  it('verlofperiode over de overgang naar zomertijd telt elke dag inclusief', () => {
    // 2026: zomertijd begint zondag 29 maart (die lokale dag is maar 23u).
    // za 28 + ma 30 = 2 verlofdagen; zondag 29 telt niet mee. De DST-val zat
    // in de kalenderberekening zelf, die blijft hier bewaakt.
    const leaves = [leave('l1', 'driver-1', '2026-03-28', '2026-03-30')];
    expect(verlofBalans(leaves, 'driver-1', 2026).betaaldGebruikt).toBe(2);
  });

  it('volledige week rond de zomertijd-overgang telt correct', () => {
    const leaves = [leave('l1', 'driver-1', '2026-03-23', '2026-03-31')]; // ma-di, 9 kalenderdagen
    expect(verlofBalans(leaves, 'driver-1', 2026).betaaldGebruikt).toBe(8);
  });
});

describe('verlofBalans, custom budget per gebruiker', () => {
  it('respecteert verlofBudget veld op user (bv. anciënniteit/deeltijds)', () => {
    const leaves = [leave('l1', 'driver-1', '2026-07-01', '2026-07-05')]; // wo-zo = 4
    const balance = verlofBalans(leaves, 'driver-1', 2026, 30);
    expect(balance.betaaldBudget).toBe(30);
    expect(balance.betaaldResterend).toBe(26);
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

describe('verlofBalans, aangevraagd (pending)', () => {
  const aanvraag = (id: string, start: string, end: string, status: LeaveRequest['status'], type: LeaveRequest['type'] = 'betaald_verlof'): LeaveRequest => ({
    id, userId: 'driver-1', startDate: start, endDate: end, type, status, createdAt: '2026-01-01T00:00:00Z',
  });

  it('telt openstaande aanvragen apart en trekt ze af van wat nog vrij is', () => {
    const balance = verlofBalans([
      aanvraag('a', '2026-07-01', '2026-07-05', 'approved'),
      aanvraag('p', '2026-08-10', '2026-08-12', 'pending'),
    ], 'driver-1', 2026);
    expect(balance.betaaldGebruikt).toBe(4); // wo-zo, 1 zondag
    expect(balance.betaaldAangevraagd).toBe(3); // ma-wo
    expect(balance.betaaldResterend).toBe(20);
    expect(balance.betaaldVrij).toBe(17);
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
    // do 1 jan t/m zo 15 feb = 46 kalenderdagen, 7 zondagen en Nieuwjaar → 38.
    const balance = verlofBalans([aanvraag('p', '2026-01-01', '2026-02-15', 'pending')], 'driver-1', 2026);
    expect(balance.betaaldAangevraagd).toBe(38);
    expect(balance.betaaldVrij).toBe(0);
  });
});

describe('verlofDagen: maandag t/m zaterdag telt, zondag nooit (Jarno 09-09)', () => {
  it('telt een volledige week als 6 dagen, ongeacht waar ze begint', () => {
    expect(verlofDagen('2026-09-07', '2026-09-13')).toBe(6); // ma t/m zo
    expect(verlofDagen('2026-09-13', '2026-09-19')).toBe(6); // zo t/m za
    expect(verlofDagen('2026-09-10', '2026-09-16')).toBe(6); // do t/m wo
  });

  it('maandag t/m zaterdag telt volledig mee', () => {
    expect(verlofDagen('2026-09-07', '2026-09-12')).toBe(6);
  });

  it('een losse zondag is 0 verlofdagen', () => {
    expect(verlofDagen('2026-09-13', '2026-09-13')).toBe(0);
  });

  it('losse werkdagen tellen als 1', () => {
    expect(verlofDagen('2026-09-07', '2026-09-07')).toBe(1); // maandag
    expect(verlofDagen('2026-09-12', '2026-09-12')).toBe(1); // zaterdag
  });

  it('twee weken = 12, drie weken = 18', () => {
    expect(verlofDagen('2026-09-07', '2026-09-20')).toBe(12);
    expect(verlofDagen('2026-09-07', '2026-09-27')).toBe(18);
  });

  it('laat kalenderdagen ongemoeid (ziekte en aftelteksten rekenen zo)', () => {
    expect(daysBetween('2026-09-07', '2026-09-13')).toBe(7);
    expect(daysBetween('2026-09-13', '2026-09-13')).toBe(1);
  });

  it('geeft 0 bij een omgekeerde of lege periode', () => {
    expect(verlofDagen('2026-09-13', '2026-09-07')).toBe(0);
    expect(verlofDagen('', '')).toBe(0);
  });

  it('telt correct over de zomertijdovergang (laatste zondag van maart)', () => {
    // za 28 t/m ma 30 maart 2026: zondag 29 valt weg, dus 2 dagen.
    expect(daysBetween('2026-03-28', '2026-03-30')).toBe(3);
    expect(verlofDagen('2026-03-28', '2026-03-30')).toBe(2);
  });
});

describe('verlofbalans met de zondagregel', () => {
  it('klein verlet telt ook zonder zondag', () => {
    const leaves = [leave('l1', 'driver-1', '2026-09-11', '2026-09-14', 'approved', 'klein_verlet')]; // vr-ma
    expect(verlofBalans(leaves, 'driver-1', 2026).kleinVerletDagen).toBe(3);
  });

  it('een aanvraag over de jaargrens telt alleen de dagen in dat jaar, zonder zondag', () => {
    const leaves = [leave('l1', 'driver-1', '2026-12-28', '2027-01-03')]; // ma t/m zo
    // 2026: ma 28 t/m do 31 = 4 · 2027: vr 1 = Nieuwjaar, za 2 telt, zo 3 niet = 1
    expect(verlofBalans(leaves, 'driver-1', 2026).betaaldGebruikt).toBe(4);
    expect(verlofBalans(leaves, 'driver-1', 2027).betaaldGebruikt).toBe(1);
  });
});

describe('feestdagen tellen niet als verlofdag (Jarno 10-09)', () => {
  it('een wettelijke feestdag op een weekdag valt weg', () => {
    // vr 25 dec 2026 = Kerstmis; ma 21 t/m za 26 dec = 6 dagen min Kerstmis.
    expect(verlofDagen('2026-12-21', '2026-12-26')).toBe(5);
    // wo 1 jan 2026 = Nieuwjaar.
    expect(verlofDagen('2026-01-01', '2026-01-01')).toBe(0);
  });

  it('een feestdag op zondag telt niet dubbel weg', () => {
    // zo 1 nov 2026 = Allerheiligen: was al 0 door de zondagregel.
    expect(verlofDagen('2026-10-31', '2026-11-02')).toBe(2); // za + ma
  });

  it('extra vrije dagen van de beheerder tellen ook niet mee', () => {
    const extra = new Set(['2026-09-08']); // di, brugdag
    expect(verlofDagen('2026-09-07', '2026-09-12')).toBe(6);
    expect(verlofDagen('2026-09-07', '2026-09-12', extra)).toBe(5);
    const leaves = [leave('l1', 'driver-1', '2026-09-07', '2026-09-12')];
    expect(verlofBalans(leaves, 'driver-1', 2026, undefined, extra).betaaldGebruikt).toBe(5);
  });

  it('de standaardset uit de datalaag werkt door zonder argument', () => {
    stelExtraFeestdagenIn(['2026-09-09']);
    try {
      expect(verlofDagen('2026-09-07', '2026-09-12')).toBe(5);
    } finally {
      stelExtraFeestdagenIn([]);
    }
    expect(verlofDagen('2026-09-07', '2026-09-12')).toBe(6);
  });
});
