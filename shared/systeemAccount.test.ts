import { describe, expect, it } from 'vitest';
import { isSysteemAccount } from './toegang';

describe('isSysteemAccount', () => {
  it('herkent de naam ongeacht hoofdletters', () => {
    for (const naam of ['beheerder', 'Beheerder', 'BEHEERDER', 'bEhEeRdEr']) {
      expect(isSysteemAccount(naam), naam).toBe(true);
    }
  });

  it('herkent de naam met spaties, tabs of een regeleinde errond', () => {
    for (const naam of [' beheerder', 'beheerder ', '  Beheerder  ', '\tbeheerder\n', ' beheerder ']) {
      expect(isSysteemAccount(naam), JSON.stringify(naam)).toBe(true);
    }
  });

  it('een naam met een accent is een andere naam (geen enkele oude variant werkte accenten weg)', () => {
    for (const naam of ['behéérder', 'Behèèrder', 'beheërder']) {
      expect(isSysteemAccount(naam), naam).toBe(false);
    }
  });

  it('een naam die het woord alleen bevat is geen systeemaccount', () => {
    for (const naam of ['Beheerder VHB', 'De beheerder', 'beheerders', 'beheer der', 'Jan Beheerder']) {
      expect(isSysteemAccount(naam), naam).toBe(false);
    }
  });

  it('leeg, null en undefined zijn geen systeemaccount en gooien niet', () => {
    for (const naam of ['', '   ', null, undefined, 0, {}]) {
      expect(isSysteemAccount(naam)).toBe(false);
    }
  });

  it('geeft voor elke naam hetzelfde als de ruimste oude schrijfwijze (trim + kleine letters)', () => {
    const oudRuimst = (naam: string) => naam.trim().toLowerCase() === 'beheerder';
    const oudSmalst = (naam: string) => naam.toLowerCase() === 'beheerder';
    const namen = ['beheerder', 'Beheerder', ' beheerder ', 'BEHEERDER\n', 'behéérder', 'Jan Peeters', '', 'beheerder2'];
    for (const naam of namen) {
      expect(isSysteemAccount(naam), JSON.stringify(naam)).toBe(oudRuimst(naam));
      // Wat de smalste variant al verborg, blijft verborgen: er komt nergens een account bij.
      if (oudSmalst(naam)) expect(isSysteemAccount(naam)).toBe(true);
    }
  });
});
