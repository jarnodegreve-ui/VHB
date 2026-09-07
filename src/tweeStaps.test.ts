import { describe, it, expect } from 'vitest';
import { bepaalTweeStapsStap } from './lib/tweeStaps';

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
