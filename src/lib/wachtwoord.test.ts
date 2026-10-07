import { describe, expect, it } from 'vitest';
import { WACHTWOORD_MIN, WACHTWOORD_REGEL, wachtwoordVoortgang } from './wachtwoord';
import { wachtwoordZwakFout } from './wachtwoordFout';

describe('wachtwoordVoortgang', () => {
  it('leeg veld: de volledige regel, met de lengte en dat de rest niet hoeft', () => {
    expect(wachtwoordVoortgang('')).toEqual({ tekst: WACHTWOORD_REGEL, klaar: false });
    expect(WACHTWOORD_REGEL).toContain(`Minstens ${WACHTWOORD_MIN} tekens`);
    expect(WACHTWOORD_REGEL).toMatch(/hoeven niet/);
  });

  it('tijdens het typen: hoeveel tekens er nog bij moeten', () => {
    expect(wachtwoordVoortgang('a'.repeat(WACHTWOORD_MIN - 3))).toEqual({ tekst: 'Nog 3 tekens.', klaar: false });
    expect(wachtwoordVoortgang('a'.repeat(WACHTWOORD_MIN - 1))).toEqual({ tekst: 'Nog 1 teken.', klaar: false });
  });

  it('lang genoeg: klaar, ook zonder hoofdletter of cijfer', () => {
    expect(wachtwoordVoortgang('a'.repeat(WACHTWOORD_MIN))).toEqual({ tekst: `Lang genoeg: ${WACHTWOORD_MIN} tekens.`, klaar: true });
    expect(wachtwoordVoortgang('een-goed-wachtwoord').klaar).toBe(true);
  });
});

describe('wachtwoordZwakFout', () => {
  it('vertaalt de redenen van Supabase', () => {
    expect(wachtwoordZwakFout({ code: 'weak_password', reasons: ['length'] })).toMatch(/minstens \d+ tekens/);
    expect(wachtwoordZwakFout({ code: 'weak_password', reasons: ['characters'] })).toMatch(/letters en cijfers/);
    expect(wachtwoordZwakFout({ code: 'weak_password', reasons: ['length', 'pwned'] })).toMatch(/datalek/);
    expect(wachtwoordZwakFout({ code: 'weak_password' })).toMatch(/te zwak/);
  });

  it('geeft null voor elke andere fout', () => {
    expect(wachtwoordZwakFout({ code: 'same_password' })).toBeNull();
    expect(wachtwoordZwakFout(null)).toBeNull();
    expect(wachtwoordZwakFout(new Error('netwerk'))).toBeNull();
  });
});
