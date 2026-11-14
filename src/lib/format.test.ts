import { describe, it, expect } from 'vitest';
import {
  formatDagMaand, formatDateHuman, formatDateTimeHuman, formatDatumDMJ, formatDayLong, formatGetal, formatMaand, formatMomentDMJ, formatMomentKort,
  formatPeriodeDMJ, formatPeriodeKort, formatRelatief, formatShortDay, formatTijdstip, formatUpdateDate, formatUur, formatWeekdag, metEenheid,
} from './format';

describe('formatGetal (komma als decimaalteken, smalle spatie als duizendtal, max. 2 decimalen)', () => {
  it('kapt ChargEye-decimalen af op twee cijfers na de komma', () => {
    expect(formatGetal(123.45678)).toBe('123,46');
    expect(formatGetal(47.6)).toBe('47,6');
    expect(formatGetal(0.5)).toBe('0,5');
  });
  it('laat hele getallen heel en zet een smalle vaste spatie als duizendtal (geen punt: die leest als decimaal)', () => {
    expect(formatGetal(48)).toBe('48');
    expect(formatGetal(6559)).toBe('6\u202F559');
    expect(formatGetal(57529.6)).toBe('57\u202F529,6');
    expect(formatGetal(1234567)).toBe('1\u202F234\u202F567');
    expect(formatGetal(6559)).not.toContain('.');
  });
  it('respecteert een ander maximum en vangt onbruikbare waarden', () => {
    expect(formatGetal(1234.5, 0)).toBe('1\u202F235');
    expect(formatGetal(Number.NaN)).toBe('—');
    expect(formatGetal(Number.POSITIVE_INFINITY)).toBe('—');
  });
});

describe('formatRelatief', () => {
  const nu = Date.parse('2026-09-06T12:00:00Z');
  it('kiest de leesbare eenheid', () => {
    expect(formatRelatief('2026-09-06T11:59:40Z', nu)).toBe('zojuist');
    expect(formatRelatief('2026-09-06T11:55:00Z', nu)).toBe('5 min geleden');
    expect(formatRelatief('2026-09-06T09:00:00Z', nu)).toBe('3 u geleden');
    expect(formatRelatief('2026-09-05T11:00:00Z', nu)).toBe('gisteren');
    expect(formatRelatief('2026-09-02T12:00:00Z', nu)).toBe('4 d geleden');
    expect(formatRelatief('2026-08-01T12:00:00Z', nu)).toMatch(/augustus/);
    expect(formatRelatief(null, nu)).toBe('');
  });
});

describe('metEenheid (smalle vaste spatie tussen getal en eenheid)', () => {
  it('zet U+202F tussen getal en eenheid, voor ruwe én geformatteerde waarden', () => {
    expect(metEenheid(12, 'kW')).toBe('12\u202FkW');
    expect(metEenheid('6\u202F559', 'kWh')).toBe('6\u202F559\u202FkWh');
    expect(metEenheid(3, 'u')).toBe('3\u202Fu');
    expect(metEenheid(12, 'kW')).not.toContain(' ');
  });
  it('laat een streepje (onbekend) zonder eenheid', () => {
    expect(metEenheid(Number.NaN, 'kW')).toBe('—');
    expect(metEenheid('—', 'kWh')).toBe('—');
  });
});


describe('formatDatumDMJ / formatPeriodeDMJ (dag/maand/jaar, Jarno 17-09)', () => {
  it('draait een ISO-dag om naar 17/09/2026', () => {
    expect(formatDatumDMJ('2026-09-17')).toBe('17/09/2026');
    // Een timestamp mag ook: alleen de dag telt.
    expect(formatDatumDMJ('2026-01-02T08:30:00Z')).toBe('02/01/2026');
  });
  it('laat leegte leeg en een onherkenbare waarde ongemoeid', () => {
    expect(formatDatumDMJ('')).toBe('');
    expect(formatDatumDMJ(null)).toBe('');
    expect(formatDatumDMJ('geen datum')).toBe('geen datum');
  });
  it('schrijft een periode van één dag als één datum', () => {
    expect(formatPeriodeDMJ('2026-09-17', '2026-09-17')).toBe('17/09/2026');
    expect(formatPeriodeDMJ('2026-09-17', '2026-09-20')).toBe('17/09/2026 t/m 20/09/2026');
    expect(formatPeriodeDMJ('2026-09-17')).toBe('17/09/2026');
  });
});

// Ronde 6, punt 8: één tijdstip in beeld, "do 8 okt, 14:02". De drie oude
// namen geven sinds dan dezelfde vorm (dunne doorgevers).
describe('formatTijdstip (korte dag, komma, uur; 24-uurs, nooit een rauwe ISO)', () => {
  // Zone-loos "nu", zodat het jaartal niet van de tijdzone van de runner afhangt.
  const nu = new Date('2026-09-20T12:00:00');
  it('een tijdstempel met zone wordt de Brusselse dag en het Brusselse uur, winter en zomer', () => {
    // 23u30 UTC op 4 november is bij ons al 5 november, 00u30.
    expect(formatTijdstip('2026-11-04T23:30:00Z', nu)).toBe('do 5 nov, 00:30');
    expect(formatTijdstip('2026-07-06T10:05:00Z', nu)).toBe('ma 6 jul, 12:05');
  });
  it('de twee wisselnachten: de klok springt in maart van 02:00 naar 03:00 en valt in oktober van 03:00 terug naar 02:00', () => {
    // Zomertijd 29-03-2026 om 01:00 UTC: vlak ervoor 01:30 wintertijd, vlak erna 03:30 zomertijd.
    expect(formatTijdstip('2026-03-29T00:30:00Z', nu)).toBe('zo 29 mrt, 01:30');
    expect(formatTijdstip('2026-03-29T01:30:00Z', nu)).toBe('zo 29 mrt, 03:30');
    // Wintertijd 25-10-2026 om 01:00 UTC: 02:30 komt twee keer voor, telkens op dezelfde dag.
    expect(formatTijdstip('2026-10-25T00:30:00Z', nu)).toBe('zo 25 okt, 02:30');
    expect(formatTijdstip('2026-10-25T01:30:00Z', nu)).toBe('zo 25 okt, 02:30');
    // De avond ervoor (nog zomertijd) is na 22:00 UTC al de volgende dag.
    expect(formatTijdstip('2026-10-24T22:30:00Z', nu)).toBe('zo 25 okt, 00:30');
  });
  it('leest de vorm van PostgREST (microseconden, +00:00) en die van toISOString', () => {
    expect(formatTijdstip('2026-10-08T12:02:00.123456+00:00', nu)).toBe('do 8 okt, 14:02');
    expect(formatTijdstip('2026-10-08T12:02:00.000Z', nu)).toBe('do 8 okt, 14:02');
  });
  it('een dag van één cijfer krijgt geen voorloopnul', () => {
    expect(formatTijdstip('2026-10-05T07:40:00.000Z', nu)).toBe('ma 5 okt, 09:40');
  });
  it('zonder zone is het de wandklok zoals het er staat; het jaar staat er alleen buiten dit jaar', () => {
    expect(formatTijdstip('2025-12-31T09:15:00', nu)).toBe('wo 31 dec 2025, 09:15');
    expect(formatTijdstip('2026-01-05T00:07:30.123', nu)).toBe('ma 5 jan, 00:07');
  });
  it('alleen een datum geeft de korte dag, met het jaar erbij buiten dit jaar', () => {
    expect(formatTijdstip('2026-09-19', nu)).toBe('za 19 sep');
    expect(formatTijdstip('2025-09-19', nu)).toBe('vr 19 sep 2025');
  });
  it('leeg geeft niets; wat niet als datum te lezen is komt ongewijzigd terug', () => {
    expect(formatTijdstip(null, nu)).toBe('');
    expect(formatTijdstip(undefined, nu)).toBe('');
    expect(formatTijdstip('', nu)).toBe('');
    expect(formatTijdstip('8/10/2026 14:02:00', nu)).toBe('8/10/2026 14:02:00');
    expect(formatTijdstip('gisteren', nu)).toBe('gisteren');
  });
});

describe('formatMomentKort / formatDateTimeHuman / formatMomentDMJ (doorgevers van formatTijdstip)', () => {
  const nu = new Date('2026-09-20T12:00:00');
  it('formatMomentKort geeft de tijdstipvorm (was "19/09 14:02")', () => {
    expect(formatMomentKort('2026-09-19T14:02:00', nu)).toBe('za 19 sep, 14:02');
    expect(formatMomentKort('2026-01-05T00:07:30.123', nu)).toBe('ma 5 jan, 00:07');
    expect(formatMomentKort('2026-09-19T12:02:06.771Z', nu)).toBe('za 19 sep, 14:02');
    expect(formatMomentKort('2026-01-05T23:30:00Z', nu)).toBe('di 6 jan, 00:30');
    expect(formatMomentKort('2026-09-19T12:02:06.771+00:00', nu)).toBe('za 19 sep, 14:02');
    expect(formatMomentKort('2025-12-31T09:15:00', nu)).toBe('wo 31 dec 2025, 09:15');
    expect(formatMomentKort('2026-09-19', nu)).toBe('za 19 sep');
    expect(formatMomentKort(null, nu)).toBe('');
    // Bewuste wijziging (ronde 6): onleesbaar komt ongewijzigd terug, zoals
    // formatDateTimeHuman al deed; vroeger gaf formatMomentKort hier ''.
    expect(formatMomentKort('gisteren', nu)).toBe('gisteren');
  });
  it('de drie namen geven precies wat formatTijdstip geeft', () => {
    for (const waarde of ['2026-09-19T12:02:06.771Z', '2026-10-08T12:02:00.123456+00:00', '2026-09-19T14:02:00', '2025-12-31T09:15:00', '2026-09-19', '8/10/2026 14:02:00', '', null, undefined]) {
      expect(formatMomentKort(waarde, nu)).toBe(formatTijdstip(waarde, nu));
      expect(formatDateTimeHuman(waarde)).toBe(formatTijdstip(waarde));
      expect(formatMomentDMJ(waarde)).toBe(formatTijdstip(waarde));
    }
  });
});

describe('formatShortDay (korte dag: nooit een voorloopnul, het jaar alleen op vraag)', () => {
  it('de 8e van elke maand in 2026: de twaalf korte maanden, met de juiste weekdag', () => {
    const dagen = Array.from({ length: 12 }, (_, i) => formatShortDay(`2026-${String(i + 1).padStart(2, '0')}-08`));
    expect(dagen).toEqual(['do 8 jan', 'zo 8 feb', 'zo 8 mrt', 'wo 8 apr', 'vr 8 mei', 'ma 8 jun', 'wo 8 jul', 'za 8 aug', 'di 8 sep', 'do 8 okt', 'zo 8 nov', 'di 8 dec']);
  });
  it('een tijdstempel telt als zijn Brusselse dag', () => {
    expect(formatShortDay('2026-11-04T23:30:00Z')).toBe('do 5 nov');
    expect(formatShortDay('2026-11-04T23:30:00')).toBe('wo 4 nov');
  });
  it('rond de twee wisselnachten blijft het de Brusselse dag', () => {
    expect(formatShortDay('2026-03-28T23:30:00Z')).toBe('zo 29 mrt');
    expect(formatShortDay('2026-03-28T22:30:00Z')).toBe('za 28 mrt');
    expect(formatShortDay('2026-10-24T22:30:00Z')).toBe('zo 25 okt');
    expect(formatShortDay('2026-10-25T22:30:00Z')).toBe('zo 25 okt');
    expect(formatShortDay('2026-10-25T23:30:00Z')).toBe('ma 26 okt');
  });
  it('het jaar alleen op vraag, ook buiten dit jaar', () => {
    expect(formatShortDay('2025-10-08')).toBe('wo 8 okt');
    expect(formatShortDay('2025-10-08', true)).toBe('wo 8 okt 2025');
  });
  it('leeg geeft niets; wat geen dag is komt ongewijzigd terug', () => {
    expect(formatShortDay('')).toBe('');
    expect(formatShortDay(null)).toBe('');
    expect(formatShortDay('gisteren')).toBe('gisteren');
    expect(formatShortDay('2026-13-08')).toBe('2026-13-08');
  });
  it('de weekdag apart (roosterkaart) komt uit dezelfde kalenderdag', () => {
    expect(formatWeekdag('2026-10-08')).toBe('do');
    expect(formatWeekdag('2026-11-04T23:30:00Z')).toBe('do');
    expect(formatWeekdag('')).toBe('');
  });
});

describe('formatDagMaand / formatUpdateDate (dag en korte maand)', () => {
  it('"8 okt", met jaar alleen op vraag', () => {
    expect(formatDagMaand('2026-10-08')).toBe('8 okt');
    expect(formatDagMaand('2026-10-08', true)).toBe('8 okt 2026');
    // Een tijdstempel: de Brusselse dag ("Uitgenodigd 30 sep", "bundel van 1 sep").
    expect(formatDagMaand('2026-09-30T14:00:00.000Z')).toBe('30 sep');
    expect(formatDagMaand('2026-08-31T22:30:00Z')).toBe('1 sep');
    expect(formatDagMaand(undefined)).toBe('');
  });
  it('formatUpdateDate geeft dezelfde vorm, altijd met jaar; vrije tekst blijft staan', () => {
    expect(formatUpdateDate('2026-03-04')).toBe('4 mrt 2026');
    expect(formatUpdateDate('8/10/2026')).toBe('8/10/2026');
    expect(formatUpdateDate('')).toBe('');
  });
});

describe('formatDayLong (kop: het jaar alleen op vraag, nooit vanzelf)', () => {
  it('geen jaar, ook niet in een ander jaar; met jaar als de aanroeper het vraagt', () => {
    expect(formatDayLong('2027-01-01')).toBe('vrijdag 1 januari');
    expect(formatDayLong('2027-01-01', true)).toBe('vrijdag 1 januari 2027');
  });
  it('een tijdstempel telt als zijn Brusselse dag', () => {
    expect(formatDayLong('2026-11-04T23:30:00Z')).toBe('donderdag 5 november');
    expect(formatDayLong('')).toBe('');
  });
});

describe('formatMaand', () => {
  it('"oktober 2026" uit een maand of een dag', () => {
    expect(formatMaand('2026-10')).toBe('oktober 2026');
    expect(formatMaand('2026-01-01')).toBe('januari 2026');
    expect(formatMaand('')).toBe('');
  });
});

describe('formatUur (het uur van een tijdstempel, Brusselse tijd)', () => {
  it('zomer, winter, PostgREST en een zone-loze wandklok', () => {
    expect(formatUur('2026-07-06T10:05:00Z')).toBe('12:05');
    expect(formatUur('2026-11-04T23:30:00Z')).toBe('00:30');
    expect(formatUur('2026-10-08T12:02:00.123456+00:00')).toBe('14:02');
    expect(formatUur('2026-10-08T14:02:00')).toBe('14:02');
  });
  it('leeg, onleesbaar of alleen een datum geeft niets', () => {
    expect(formatUur('kapot')).toBe('');
    expect(formatUur('2026-10-08')).toBe('');
    expect(formatUur(null)).toBe('');
    expect(formatUur('')).toBe('');
  });
});

describe('formatPeriodeKort (lijstrijen op een telefoon)', () => {
  it('laat het jaar één keer staan binnen hetzelfde jaar', () => {
    expect(formatPeriodeKort('2026-08-10', '2026-08-12')).toBe('10/08 – 12/08/2026');
  });

  it('schrijft beide jaren voluit over een jaargrens', () => {
    expect(formatPeriodeKort('2026-12-28', '2027-01-03')).toBe('28/12/2026 – 03/01/2027');
  });

  it('één dag is één datum; een lege waarde valt terug op wat er is', () => {
    expect(formatPeriodeKort('2026-08-10', '2026-08-10')).toBe('10/08/2026');
    expect(formatPeriodeKort('2026-08-10')).toBe('10/08/2026');
    expect(formatPeriodeKort(null, '2026-08-10')).toBe('10/08/2026');
  });
});

// Een UTC-tijdstempel is bij ons soms al de volgende dag: de knip op tien
// tekens toonde tussen 00u en 01u (winter) of 02u (zomer) de dag ervoor.
describe('formatDateHuman / formatDatumDMJ met een tijdstempel (Brusselse dag)', () => {
  it('winter: 23u30 UTC op 4 november is bij ons 5 november', () => {
    expect(formatDatumDMJ('2026-11-04T23:30:00.000Z')).toBe('05/11/2026');
    expect(formatDateHuman('2026-11-04T23:30:00.000Z')).toMatch(/^do 5 november/);
  });
  it('zomer: 22u30 UTC op 4 juli is bij ons 5 juli', () => {
    expect(formatDatumDMJ('2026-07-04T22:30:00.000Z')).toBe('05/07/2026');
    expect(formatDateHuman('2026-07-04T22:30:00.000Z')).toMatch(/^zo 5 juli/);
  });
  it('een offset telt ook; een zuivere dag en een zone-loze waarde blijven ongewijzigd', () => {
    expect(formatDatumDMJ('2026-11-04T23:30:00+00:00')).toBe('05/11/2026');
    expect(formatDatumDMJ('2026-11-05')).toBe('05/11/2026');
    expect(formatDateHuman('2026-11-05')).toMatch(/^do 5 november/);
    // Zone-loos is al wandkloktijd (zelfde regel als formatMomentKort).
    expect(formatDatumDMJ('2026-11-04T23:30:00')).toBe('04/11/2026');
  });
  it('formatRelatief geeft het tijdstip door, dus ook daar de Brusselse dag', () => {
    const nu = new Date('2026-12-01T12:00:00.000Z').getTime();
    expect(formatRelatief('2026-11-04T23:30:00.000Z', nu)).toMatch(/^do 5 november/);
  });
});
