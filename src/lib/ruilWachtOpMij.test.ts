import { describe, expect, it } from 'vitest';
import type { SwapRequest } from '../types';
import { ruilenDieOpMijWachten, telRuilenDieOpMijWachten } from './ruilWachtOpMij';
import { ruilWachtRegels } from './ruilWachtRegels';

const MIJ = 'u-ik';
const COLLEGA = 'u-collega';
const users = [{ id: MIJ, name: 'Ik Zelf' }, { id: COLLEGA, name: 'An Peeters' }];

const ruil = (over: Partial<SwapRequest>): SwapRequest => ({
  id: over.id ?? `s-${Math.random().toString(36).slice(2, 8)}`,
  shiftId: 'sh-1',
  requesterId: COLLEGA,
  targetDriverId: MIJ,
  status: 'pending',
  createdAt: '2026-10-01T08:00:00.000Z',
  shiftDate: '2026-10-10',
  shiftLine: '4101',
  ...over,
});

describe('ruilenDieOpMijWachten', () => {
  it('een aan mij gerichte pending ruil vraagt een antwoord', () => {
    const uit = ruilenDieOpMijWachten([ruil({ id: 'a' })], MIJ);
    expect(uit.map((x) => [x.ruil.id, x.soort])).toEqual([['a', 'antwoord']]);
  });

  it('een goedgekeurde ruil die ik nog niet bevestigde vraagt een bevestiging, een bevestigde niet', () => {
    const uit = ruilenDieOpMijWachten([
      ruil({ id: 'open', status: 'approved' }),
      ruil({ id: 'gezien', status: 'approved', targetSeenAt: '2026-10-02T10:00:00.000Z' }),
    ], MIJ);
    expect(uit.map((x) => [x.ruil.id, x.soort])).toEqual([['open', 'bevestiging']]);
  });

  it('eigen aanvragen, ruilen voor een ander, open overnames en afgehandelde ruilen tellen niet', () => {
    const uit = ruilenDieOpMijWachten([
      ruil({ id: 'eigen', requesterId: MIJ, targetDriverId: COLLEGA }),
      ruil({ id: 'ander', targetDriverId: 'u-derde' }),
      ruil({ id: 'open-overname', targetDriverId: undefined, swapType: 'overname' }),
      ruil({ id: 'aanvaard', status: 'accepted' }),
      ruil({ id: 'geweigerd', status: 'rejected' }),
      ruil({ id: 'klaar', status: 'completed' }),
      ruil({ id: 'geannuleerd', status: 'cancelled' }),
    ], MIJ);
    expect(uit).toEqual([]);
    expect(telRuilenDieOpMijWachten([], MIJ)).toBe(0);
  });

  it('antwoorden eerst, daarbinnen de vroegste dienst bovenaan; zonder dienstdatum als laatste', () => {
    const uit = ruilenDieOpMijWachten([
      ruil({ id: 'bevestig', status: 'approved', shiftDate: '2026-10-03' }),
      ruil({ id: 'laat', shiftDate: '2026-10-20' }),
      ruil({ id: 'zonder', shiftDate: undefined }),
      ruil({ id: 'vroeg', shiftDate: '2026-10-05' }),
    ], MIJ);
    expect(uit.map((x) => x.ruil.id)).toEqual(['vroeg', 'laat', 'zonder', 'bevestig']);
  });
});

describe('ruilWachtRegels', () => {
  it('overname: wie vraagt en welke dienst', () => {
    const r = ruilWachtRegels({ ruil: ruil({ swapType: 'overname' }), soort: 'antwoord' }, users);
    expect(r.primary).toBe('An Peeters vraagt een overname');
    expect(r.secondary).toBe('za 10 okt · dienst 4101');
  });

  it('1-op-1-ruil noemt de tegenprestatie, een vrije dag als vrij', () => {
    const dienst = ruilWachtRegels({ ruil: ruil({ swapType: 'ruil', returnDate: '2026-10-12', returnCode: '4205' }), soort: 'antwoord' }, users);
    expect(dienst.primary).toBe('An Peeters wil ruilen');
    expect(dienst.secondary).toBe('za 10 okt · dienst 4101 · in ruil voor jouw dienst 4205 (ma 12 okt)');
    const vrij = ruilWachtRegels({ ruil: ruil({ swapType: 'ruil', returnDate: '2026-10-12', returnCode: 'vrij' }), soort: 'antwoord' }, users);
    expect(vrij.secondary).toBe('za 10 okt · dienst 4101 · in ruil voor jouw vrije ma 12 okt');
  });

  it('bevestiging: je rijdt de dienst van de collega', () => {
    const r = ruilWachtRegels({ ruil: ruil({ status: 'approved' }), soort: 'bevestiging' }, users);
    expect(r.primary).toBe('Je rijdt de dienst van An Peeters');
    expect(r.secondary).toBe('za 10 okt · dienst 4101 · goedgekeurd, bevestig dat je het zag');
  });

  it('onbekende aanvrager heet "Een collega", zonder dienstgegevens blijft er een regel', () => {
    const r = ruilWachtRegels({ ruil: ruil({ requesterId: 'u-weg', shiftDate: undefined, shiftLine: undefined, swapType: 'overname' }), soort: 'antwoord' }, users);
    expect(r.primary).toBe('Een collega vraagt een overname');
    expect(r.secondary).toBe('Wacht op jouw antwoord');
  });
});
