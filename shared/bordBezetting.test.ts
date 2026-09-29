import { describe, it, expect } from 'vitest';
import { OVERNAME_CODES, dienstOpBord, vrijOpBord } from './bordBezetting';
import { TAKEOVER_CODES, isTakeoverCode, toLookupToken } from '../api/helpers.js';

/**
 * De ene lezing van een bordcel, voor server én client (controle 29-09):
 * rijdt de chauffeur die dag een dienst, en is hij vrij om er een te krijgen?
 */
const dienst = (code: string) => ({ code, kind: 'service' });
const afwezig = (code: string, hiddenService?: string) => ({ code, kind: 'absence', ...(hiddenService ? { hiddenService } : {}) });

describe('dienstOpBord', () => {
  it('geeft de dienst die de cel draagt, schoolrit inbegrepen', () => {
    expect(dienstOpBord(dienst('2101'))).toBe('2101');
    expect(dienstOpBord(dienst('EEK6'))).toBe('EEK6');
  });

  it('vindt de dienst onder een afwezigheid: hij staat nog op naam', () => {
    expect(dienstOpBord(afwezig('ziek', 'EEK6'))).toBe('EEK6');
  });

  it('een vrije dag, een afwezigheid of een lege cel draagt geen dienst', () => {
    expect(dienstOpBord(afwezig('vrij'))).toBeNull();
    expect(dienstOpBord(afwezig('ziek'))).toBeNull();
    expect(dienstOpBord({ code: 'opl', kind: 'training' })).toBeNull();
    expect(dienstOpBord(undefined)).toBeNull();
    expect(dienstOpBord(null)).toBeNull();
  });
});

describe('vrijOpBord', () => {
  it('een lege cel en elke overname-code zijn vrij, in elke schrijfwijze', () => {
    expect(vrijOpBord(undefined)).toBe(true);
    for (const code of ['vrij', 'BV', ' tk ', 'Ta']) expect(vrijOpBord(afwezig(code))).toBe(true);
  });

  it('wie zijn dienst wegruilde staat op vrij en is dus vrij', () => {
    expect(vrijOpBord({ code: 'vrij', kind: 'absence', swapAway: true } as never)).toBe(true);
  });

  it('een dienst, ook een schoolrit, is niet vrij', () => {
    expect(vrijOpBord(dienst('2101'))).toBe(false);
    expect(vrijOpBord(dienst('EEK6'))).toBe(false);
  });

  it('ziek, opleiding, klein verlet of een onbekende code is niet vrij', () => {
    for (const code of ['ziek', 'opl', 'kv', 'gar', 'xyz']) expect(vrijOpBord(afwezig(code))).toBe(false);
  });

  it('een overname-code met een dienst eronder is niet vrij', () => {
    expect(vrijOpBord(afwezig('bv', 'EEK6'))).toBe(false);
  });
});

describe('drift met de server', () => {
  it('dezelfde overname-codes als TAKEOVER_CODES in api/helpers.ts', () => {
    expect([...OVERNAME_CODES]).toEqual([...TAKEOVER_CODES]);
  });

  it('dezelfde regel als isTakeoverCode, ook voor accenten en interpunctie', () => {
    for (const code of ['vrij', 'VRIJ', ' bv', 'T.K', 'tá', 'ziek', 'eek6', '4101', 'v r ij']) {
      // Een lege token is op het bord een lege cel (vrij); de server kent die
      // vorm niet als code, daar is een lege cel gewoon geen cel.
      if (!toLookupToken(code)) continue;
      expect(vrijOpBord(afwezig(code)), code).toBe(isTakeoverCode(code));
    }
  });
});
