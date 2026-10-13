import { describe, expect, it } from 'vitest';
import { bundelsPerVersie, kiesRitblad } from '../api/_lib/ritbladKeuze';

/**
 * Welke ritbladbundel hoort bij een dag (13-10, keuzes Jarno): de bundel van
 * de versie die op die dag geldt; zonder eigen bundel wijst `vorige` naar de
 * jongste eerdere versie mét bundel.
 */
const sep = { id: 'v-sep', geldigVanaf: '2026-09-01' };
const nov = { id: 'v-nov', geldigVanaf: '2026-11-09' };
const jan = { id: 'v-jan', geldigVanaf: '2027-01-01' };
const bSep = { id: 'current', dienstregelingId: null };
const bJan = { id: 'v-jan', dienstregelingId: 'v-jan' };

describe('kiesRitblad', () => {
  it('neemt de bundel van de versie van die dag; de rij zonder versie telt als de oudste', () => {
    expect(kiesRitblad([sep, nov, jan], [bSep, bJan], '2026-10-01')).toEqual({ versie: sep, bundel: bSep, vorige: null });
    expect(kiesRitblad([sep, nov, jan], [bSep, bJan], '2027-01-01')).toEqual({ versie: jan, bundel: bJan, vorige: null });
    expect(kiesRitblad([sep, nov, jan], [bSep, bJan], '2026-03-01')).toEqual({ versie: sep, bundel: bSep, vorige: null });
  });

  it('zonder eigen bundel: geen bundel, wel de vorige versie die er een heeft', () => {
    expect(kiesRitblad([sep, nov, jan], [bSep, bJan], '2026-12-01')).toEqual({ versie: nov, bundel: null, vorige: { versie: sep, bundel: bSep } });
    expect(kiesRitblad([sep, nov, jan], [bJan], '2026-12-01')).toEqual({ versie: nov, bundel: null, vorige: null });
    expect(kiesRitblad([sep, nov, jan], [], '2026-10-01')).toEqual({ versie: sep, bundel: null, vorige: null });
  });

  it('zonder versies is er één bundel, de rij zonder versie', () => {
    expect(kiesRitblad([], [bSep], '2026-10-01')).toEqual({ versie: null, bundel: bSep, vorige: null });
    expect(kiesRitblad([], [], '2026-10-01')).toEqual({ versie: null, bundel: null, vorige: null });
  });

  it('bundelsPerVersie: oudste eerst, elke versie met haar bundel of null', () => {
    expect(bundelsPerVersie([jan, sep, nov], [bJan, bSep])).toEqual([{ versie: sep, bundel: bSep }, { versie: nov, bundel: null }, { versie: jan, bundel: bJan }]);
    expect(bundelsPerVersie([], [bSep])).toEqual([{ versie: null, bundel: bSep }]);
  });
});
