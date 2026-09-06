import { describe, expect, it } from 'vitest';
import { vindOngeregistreerdeZiekte } from '../api/helpers';

/**
 * "ziek" in de planning-matrix zonder geregistreerde ziekteperiode (case
 * 20-08: een chauffeur stond een hele maand als ziek in de Excel terwijl het
 * Ziekte-blad, de digest en de advisor van niets wisten).
 */
const users = [
  { id: '3', name: 'Danny Van Ooteghem' },
  { id: '4', name: 'Bianca Taildeman' },
];
const rij = (date: string, assignments: Record<string, string>) => ({ source_date: date, assignments });

describe('vindOngeregistreerdeZiekte', () => {
  it('groepeert aaneengesloten ziek-dagen tot één reeks per chauffeur', () => {
    const rows = [
      // Matrix-namen in Excel-volgorde (Achternaam Voornaam) — de naam-match
      // is volgorde-onafhankelijk, net als de rest van de app.
      rij('2030-09-01', { 'Van Ooteghem Danny': 'ziek' }),
      rij('2030-09-02', { 'Van Ooteghem Danny': 'ziek' }),
      rij('2030-09-03', { 'Van Ooteghem Danny': 'vrij' }),
      rij('2030-09-04', { 'Van Ooteghem Danny': 'ziek' }),
    ];
    const uit = vindOngeregistreerdeZiekte(rows, users, []);
    expect(uit).toEqual([
      { userId: '3', naam: 'Danny Van Ooteghem', van: '2030-09-01', tot: '2030-09-02', dagen: 2, actief: true, ambigu: false },
      { userId: '3', naam: 'Danny Van Ooteghem', van: '2030-09-04', tot: '2030-09-04', dagen: 1, actief: true, ambigu: false },
    ]);
  });

  it('slaat dagen over die al door een goedgekeurde ziekteperiode gedekt zijn', () => {
    const rows = [
      rij('2030-09-01', { 'Taildeman Bianca': 'ziek' }),
      rij('2030-09-02', { 'Taildeman Bianca': 'ziek' }),
    ];
    const leave = [{ userId: '4', startDate: '2030-08-17', endDate: '2030-09-01', type: 'ziekte', status: 'approved' }];
    expect(vindOngeregistreerdeZiekte(rows, users, leave)).toEqual([
      { userId: '4', naam: 'Bianca Taildeman', van: '2030-09-02', tot: '2030-09-02', dagen: 1, actief: true, ambigu: false },
    ]);
  });

  it('respecteert de vanaf-datum (historiek is geen actiepunt)', () => {
    const rows = [
      rij('2030-08-30', { 'Van Ooteghem Danny': 'ziek' }),
      rij('2030-09-01', { 'Van Ooteghem Danny': 'ziek' }),
    ];
    expect(vindOngeregistreerdeZiekte(rows, users, [], '2030-09-01')).toEqual([
      { userId: '3', naam: 'Danny Van Ooteghem', van: '2030-09-01', tot: '2030-09-01', dagen: 1, actief: true, ambigu: false },
    ]);
  });

  it('houdt een niet te koppelen Excel-naam zichtbaar met userId null', () => {
    const rows = [rij('2030-09-01', { 'Onbekende Naam': 'ziek' })];
    expect(vindOngeregistreerdeZiekte(rows, users, [])).toEqual([
      { userId: null, naam: 'Onbekende Naam', van: '2030-09-01', tot: '2030-09-01', dagen: 1, actief: false, ambigu: false },
    ]);
  });

  it('negeert niet-ziek-codes en pending/cancelled ziekterecords tellen niet als dekking', () => {
    const rows = [rij('2030-09-01', { 'Van Ooteghem Danny': 'ziek', 'Taildeman Bianca': '2104' })];
    const leave = [{ userId: '3', startDate: '2030-09-01', endDate: '2030-09-01', type: 'ziekte', status: 'cancelled' }];
    expect(vindOngeregistreerdeZiekte(rows, users, leave)).toEqual([
      { userId: '3', naam: 'Danny Van Ooteghem', van: '2030-09-01', tot: '2030-09-01', dagen: 1, actief: true, ambigu: false },
    ]);
  });
});

describe('vindOngeregistreerdeZiekte, accountstatus (controle-ronde 20-08)', () => {
  it('markeert een gepauzeerd account als niet-actief (registreer-knop zou een dood einde zijn)', () => {
    const gepauzeerd = [{ id: '3', name: 'Danny Van Ooteghem', isActive: false }];
    const rows = [rij('2030-09-01', { 'Van Ooteghem Danny': 'ziek' })];
    expect(vindOngeregistreerdeZiekte(rows, gepauzeerd, [])).toEqual([
      { userId: '3', naam: 'Danny Van Ooteghem', van: '2030-09-01', tot: '2030-09-01', dagen: 1, actief: false, ambigu: false },
    ]);
  });

  it('onderscheidt een naam-botsing (ambigu) van "geen account", de remedie is tegengesteld', () => {
    // Twee accounts die op dezelfde naam-sleutel uitkomen: de match valt
    // bewust weg (nameIdIndex), maar de UI mag dan niet "maak een account
    // aan" adviseren.
    const dubbel = [
      { id: '7', name: 'Jan Peeters' },
      { id: '8', name: 'Peeters Jan' },
    ];
    const rows = [rij('2030-09-01', { 'Jan Peeters': 'ziek', 'Echt Onbekend': 'ziek' })];
    const uit = vindOngeregistreerdeZiekte(rows, dubbel, []);
    expect(uit).toEqual([
      { userId: null, naam: 'Echt Onbekend', van: '2030-09-01', tot: '2030-09-01', dagen: 1, actief: false, ambigu: false },
      { userId: null, naam: 'Jan Peeters', van: '2030-09-01', tot: '2030-09-01', dagen: 1, actief: false, ambigu: true },
    ]);
  });
});
