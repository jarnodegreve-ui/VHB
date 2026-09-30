import { describe, expect, it } from 'vitest';
import { beschrijfOvergeslagen, leesUitnodigingCode, maakUitnodigingCode, uitnodigingBeletsel } from './uitnodiging';

describe('uitnodigingBeletsel', () => {
  const basis = { name: 'Jan Peeters', email: 'jan@vhb.be', isActive: true, lastLogin: null };

  it('wie actief is, een adres heeft en nog nooit inlogde, kan uitgenodigd worden', () => {
    expect(uitnodigingBeletsel(basis)).toBeNull();
    // isActive ontbreekt = actief, zoals overal in het portaal.
    expect(uitnodigingBeletsel({ name: 'Jan', email: 'jan@vhb.be' })).toBeNull();
  });

  it('wie al eens inlogde, gepauzeerd is of geen adres heeft, niet', () => {
    expect(uitnodigingBeletsel({ ...basis, lastLogin: '2026-09-20T07:00:00.000Z' })).toBe('al-ingelogd');
    expect(uitnodigingBeletsel({ ...basis, isActive: false })).toBe('gepauzeerd');
    expect(uitnodigingBeletsel({ ...basis, email: '  ' })).toBe('geen-email');
    expect(uitnodigingBeletsel({ ...basis, email: undefined })).toBe('geen-email');
  });

  it('het technische account "beheerder" nooit', () => {
    expect(uitnodigingBeletsel({ ...basis, name: 'Beheerder' })).toBe('technisch');
  });
});

describe('beschrijfOvergeslagen', () => {
  it('noemt tot vijf mensen bij naam, daarboven per reden geteld', () => {
    expect(beschrijfOvergeslagen([{ naam: 'Jan', reden: 'al-ingelogd' }, { naam: 'Els', reden: 'gepauzeerd' }])).toBe('Jan (al eens ingelogd), Els (gepauzeerd)');
    const zes = [...Array(4).fill({ naam: 'x', reden: 'al-ingelogd' }), ...Array(2).fill({ naam: 'y', reden: 'geen-email' })];
    expect(beschrijfOvergeslagen(zes)).toBe('4 al eens ingelogd, 2 geen e-mailadres');
  });
});

describe('uitnodigingscode', () => {
  const geheim = 'A'.repeat(32);

  it('heen en terug, ook met een id dat gecodeerd moet worden', () => {
    expect(leesUitnodigingCode(maakUitnodigingCode('1779822443829', geheim))).toEqual({ userId: '1779822443829', geheim });
    expect(leesUitnodigingCode(maakUitnodigingCode('a.b c', geheim))).toEqual({ userId: 'a.b c', geheim });
  });

  it('weigert alles wat geen uitnodiging is', () => {
    for (const code of [undefined, 42, '', 'zonderpunt', '.alleengeheim-maar-lang-genoeg-xx', `12.${'kort'}`, `12.${'ongeldig!'.repeat(4)}`, `%E0%A4%A.${geheim}`, `12.${'A'.repeat(200)}`]) {
      expect(leesUitnodigingCode(code), String(code)).toBeNull();
    }
  });
});
