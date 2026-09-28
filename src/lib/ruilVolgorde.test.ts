import { describe, expect, it } from 'vitest';
import type { SwapRequest } from '../types';
import { ruilGroep, sorteerRuilen } from './ruilVolgorde';

const ruil = (id: string, status: SwapRequest['status'], shiftDate: string | undefined, extra: Partial<SwapRequest> = {}): SwapRequest => ({
  id, status, shiftDate, shiftId: `p-${id}`, requesterId: '1', targetDriverId: '2', createdAt: '2026-09-20T08:00:00.000Z', ...extra,
});
const ids = (lijst: SwapRequest[]) => lijst.map((s) => s.id);
const opDienst = (s: SwapRequest) => s.shiftDate;

describe('sorteerRuilen', () => {
  it('beheerlijst: collega akkoord, dan wacht op collega, dan goedgekeurd (Jarno 28-09)', () => {
    const lijst = [
      ruil('goedgekeurd', 'approved', '2026-10-01'),
      ruil('wacht', 'pending', '2026-10-05'),
      ruil('akkoord', 'accepted', '2026-10-09'),
    ];
    expect(ids(sorteerRuilen(lijst, { dienstDatum: opDienst }))).toEqual(['akkoord', 'wacht', 'goedgekeurd']);
  });

  it('binnen een groep de vroegste dienst eerst, op dezelfde dag de oudste aanvraag', () => {
    const lijst = [
      ruil('later', 'approved', '2026-10-12'),
      ruil('zelfde-dag-nieuw', 'approved', '2026-10-03', { createdAt: '2026-09-27T10:00:00.000Z' }),
      ruil('vroeg', 'approved', '2026-10-02'),
      ruil('zelfde-dag-oud', 'approved', '2026-10-03', { createdAt: '2026-09-21T10:00:00.000Z' }),
    ];
    expect(ids(sorteerRuilen(lijst, { dienstDatum: opDienst }))).toEqual(['vroeg', 'zelfde-dag-oud', 'zelfde-dag-nieuw', 'later']);
  });

  it('een ruil zonder dienstdatum sluit zijn groep af, niet de lijst', () => {
    const lijst = [
      ruil('wacht', 'pending', '2026-10-05'),
      ruil('zonder', 'accepted', undefined),
      ruil('akkoord', 'accepted', '2026-10-20'),
    ];
    expect(ids(sorteerRuilen(lijst, { dienstDatum: opDienst }))).toEqual(['akkoord', 'zonder', 'wacht']);
  });

  it('afgeronde ruilen onderaan, de laatste dienst eerst', () => {
    const lijst = [
      ruil('oud', 'completed', '2026-08-10'),
      ruil('lopend', 'pending', '2026-10-05'),
      ruil('ingetrokken', 'cancelled', '2026-09-30'),
      ruil('afgewezen', 'rejected', '2026-09-12'),
    ];
    expect(ids(sorteerRuilen(lijst, { dienstDatum: opDienst }))).toEqual(['lopend', 'ingetrokken', 'afgewezen', 'oud']);
  });

  it('chauffeur: wat op zijn antwoord of bevestiging wacht staat boven wat bij de planner ligt', () => {
    const lijst = [
      ruil('bij-planner', 'accepted', '2026-10-01', { targetDriverId: '42' }),
      ruil('bevestigen', 'approved', '2026-10-09', { targetDriverId: '42' }),
      ruil('antwoorden', 'pending', '2026-10-06', { targetDriverId: '42' }),
      ruil('al-bevestigd', 'approved', '2026-10-02', { targetDriverId: '42', targetSeenAt: '2026-09-28T09:00:00.000Z' }),
    ];
    expect(ids(sorteerRuilen(lijst, { dienstDatum: opDienst, kijkerId: '42' }))).toEqual(['antwoorden', 'bevestigen', 'bij-planner', 'al-bevestigd']);
  });

  it('gebruikt de dienstdatum die de aanroeper geeft (oude ruilen zonder shiftDate) en vraagt ze één keer per ruil', () => {
    const lijst = [ruil('b', 'pending', undefined), ruil('a', 'pending', undefined)];
    const uitPlanning: Record<string, string> = { b: '2026-10-01', a: '2026-10-08' };
    let gevraagd = 0;
    const gesorteerd = sorteerRuilen(lijst, { dienstDatum: (s) => { gevraagd += 1; return uitPlanning[s.id]; } });
    expect(ids(gesorteerd)).toEqual(['b', 'a']);
    expect(gevraagd).toBe(2);
  });

  it('laat de invoer ongemoeid', () => {
    const lijst = [ruil('b', 'approved', '2026-10-02'), ruil('a', 'accepted', '2026-10-01')];
    sorteerRuilen(lijst, { dienstDatum: opDienst });
    expect(ids(lijst)).toEqual(['b', 'a']);
  });
});

describe('ruilGroep', () => {
  it('zonder kijker (beheerlijst) telt alleen de stand, ook voor een ruil aan iemand', () => {
    expect(ruilGroep(ruil('x', 'pending', '2026-10-01'))).toBe(2);
    expect(ruilGroep(ruil('x', 'approved', '2026-10-01'))).toBe(3);
  });

  it('een lege kijker-id maakt niemand aan zet', () => {
    expect(ruilGroep(ruil('x', 'pending', '2026-10-01', { targetDriverId: undefined }), '')).toBe(2);
  });

  it('de aanvrager is nooit aan zet voor zijn eigen ruil', () => {
    expect(ruilGroep(ruil('x', 'pending', '2026-10-01', { requesterId: '42', targetDriverId: '7' }), '42')).toBe(2);
  });
});
