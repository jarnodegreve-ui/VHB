import { describe, it, expect } from 'vitest';
import { bepaalTweeStapsStap, beslisTweeStaps } from './lib/tweeStaps';

// Verbeterronde 07-09, nr. 8: welk tussenscherm hoort bij welke status.
describe('bepaalTweeStapsStap', () => {
  it('onbekende status (mock-Supabase, oude sessie) = geen tussenscherm, de server vangt het', () => {
    expect(bepaalTweeStapsStap(null, true)).toBe('geen');
    expect(bepaalTweeStapsStap(null, false)).toBe('geen');
  });

  it('ingeschreven maar nog aal1 = code vragen, ook als de server het niet verplicht', () => {
    expect(bepaalTweeStapsStap({ factorId: 'f1', huidig: 'aal1' }, false)).toBe('code');
    expect(bepaalTweeStapsStap({ factorId: 'f1', huidig: 'aal1' }, true)).toBe('code');
  });

  it('ingeschreven en al aal2 = niets', () => {
    expect(bepaalTweeStapsStap({ factorId: 'f1', huidig: 'aal2' }, true)).toBe('geen');
  });

  it('geen authenticator: alleen inschrijven als de server het verplicht', () => {
    expect(bepaalTweeStapsStap({ factorId: null, huidig: 'aal1' }, true)).toBe('inschrijven');
    expect(bepaalTweeStapsStap({ factorId: null, huidig: 'aal1' }, false)).toBe('geen');
  });
});

// 07-10, "niets laden vóór aal2": client- en serverinformatie samen.
describe('beslisTweeStaps', () => {
  it('een leesbare status beslist zoals altijd, met de factor erbij', () => {
    expect(beslisTweeStaps({ factorId: 'f1', huidig: 'aal1' }, { mfaVerplicht: true, aal: 'aal1' })).toEqual({ stap: 'code', factorId: 'f1', onzeker: false });
    expect(beslisTweeStaps({ factorId: 'f1', huidig: 'aal2' }, { mfaVerplicht: true, aal: 'aal2' })).toEqual({ stap: 'geen', factorId: 'f1', onzeker: false });
    expect(beslisTweeStaps({ factorId: null, huidig: 'aal1' }, { mfaVerplicht: true, aal: 'aal1' })).toEqual({ stap: 'inschrijven', factorId: null, onzeker: false });
    expect(beslisTweeStaps({ factorId: null, huidig: 'aal1' }, { mfaVerplicht: false, aal: 'aal1' })).toEqual({ stap: 'geen', factorId: null, onzeker: false });
  });

  it('status onleesbaar terwijl de server de code eist op aal1 = de stap is zeker, de factor onbekend', () => {
    expect(beslisTweeStaps(null, { mfaVerplicht: true, aal: 'aal1' })).toEqual({ stap: 'code', factorId: null, onzeker: true });
  });

  it('status onleesbaar zonder eis van de server, al op aal2 of zonder serverinformatie = fail-open zoals vroeger', () => {
    expect(beslisTweeStaps(null, { mfaVerplicht: false, aal: 'aal1' })).toEqual({ stap: 'geen', factorId: null, onzeker: false });
    expect(beslisTweeStaps(null, { mfaVerplicht: true, aal: 'aal2' })).toEqual({ stap: 'geen', factorId: null, onzeker: false });
    expect(beslisTweeStaps(null, null)).toEqual({ stap: 'geen', factorId: null, onzeker: false });
    expect(beslisTweeStaps(null, {})).toEqual({ stap: 'geen', factorId: null, onzeker: false });
  });
});
