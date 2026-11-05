import { describe, expect, it } from 'vitest';
import { minutenTussenBrussel, tijdstipBrussel } from './uurwissel';

const utc = (s: string) => Date.parse(s);

describe('tijdstipBrussel (controle-ronde 04-11, punt 35)', () => {
  it('leest een klokminuut op de Brusselse klok, winter en zomer', () => {
    expect(tijdstipBrussel('2027-01-15', 10 * 60)).toBe(utc('2027-01-15T09:00:00Z'));
    expect(tijdstipBrussel('2027-07-15', 10 * 60)).toBe(utc('2027-07-15T08:00:00Z'));
    expect(tijdstipBrussel('2027-01-15', 0)).toBe(utc('2027-01-14T23:00:00Z'));
  });

  it('busvak-minuten boven 24:00 zijn de klok van de nacht erna', () => {
    expect(tijdstipBrussel('2026-09-24', 26 * 60 + 16)).toBe(utc('2026-09-25T00:16:00Z'));
    // 27:00 op zaterdag 27-03-2027 = 03:00 zondag, zomertijd (01:00Z), ook al is dat de wisselnacht.
    expect(tijdstipBrussel('2027-03-27', 27 * 60)).toBe(utc('2027-03-28T01:00:00Z'));
  });

  it('de wisselnacht naar de zomertijd: vóór 02:00 wintertijd, erna zomertijd, het gat schuift een uur op', () => {
    expect(tijdstipBrussel('2027-03-28', 90)).toBe(utc('2027-03-28T00:30:00Z')); // 01:30 CET
    expect(tijdstipBrussel('2027-03-28', 6 * 60)).toBe(utc('2027-03-28T04:00:00Z')); // 06:00 CEST
    // 02:30 bestaat die nacht niet: wordt 03:30 zomertijd.
    expect(tijdstipBrussel('2027-03-28', 150)).toBe(utc('2027-03-28T01:30:00Z'));
    expect(tijdstipBrussel('2027-03-27', 26 * 60 + 30)).toBe(utc('2027-03-28T01:30:00Z'));
  });

  it('de wisselnacht naar de wintertijd: een dubbele kloktijd is de eerste keer', () => {
    expect(tijdstipBrussel('2027-10-31', 90)).toBe(utc('2027-10-30T23:30:00Z')); // 01:30 CEST
    expect(tijdstipBrussel('2027-10-31', 150)).toBe(utc('2027-10-31T00:30:00Z')); // 02:30, eerste keer (CEST)
    expect(tijdstipBrussel('2027-10-31', 210)).toBe(utc('2027-10-31T02:30:00Z')); // 03:30 CET
    expect(tijdstipBrussel('2027-10-31', 6 * 60)).toBe(utc('2027-10-31T05:00:00Z')); // 06:00 CET
  });

  it('geeft null voor wat geen dag of geen getal is', () => {
    expect(tijdstipBrussel('', 60)).toBeNull();
    expect(tijdstipBrussel('27/03/2027', 60)).toBeNull();
    expect(tijdstipBrussel('2027-03-27', Number.NaN)).toBeNull();
  });
});

describe('minutenTussenBrussel', () => {
  it('nacht 27 op 28 maart 2027: 22:00 tot 06:00 is zeven uur; 30 op 31 oktober negen', () => {
    expect(minutenTussenBrussel('2027-03-27', 22 * 60, '2027-03-28', 6 * 60)).toBe(420);
    expect(minutenTussenBrussel('2027-10-30', 22 * 60, '2027-10-31', 6 * 60)).toBe(540);
    expect(minutenTussenBrussel('2026-10-06', 22 * 60, '2026-10-07', 6 * 60)).toBe(480);
  });

  it('een einde na de wissel of een start ervoor telt met de echte klok', () => {
    // 27:00 zaterdag (03:00 CEST) tot 06:00 zondag: drie uur.
    expect(minutenTussenBrussel('2027-03-27', 27 * 60, '2027-03-28', 6 * 60)).toBe(180);
    // 17:00 zaterdag tot 01:30 zondag (nog wintertijd): 8u30.
    expect(minutenTussenBrussel('2027-03-27', 17 * 60, '2027-03-28', 90)).toBe(510);
    // 17:30 zaterdag 30-10 tot 01:00 zondag (nog zomertijd): 7u30.
    expect(minutenTussenBrussel('2027-10-30', 17 * 60 + 30, '2027-10-31', 60)).toBe(450);
  });

  it('negatief als tot vóór van ligt, null zonder geldige dag', () => {
    expect(minutenTussenBrussel('2027-01-15', 10 * 60, '2027-01-15', 9 * 60)).toBe(-60);
    expect(minutenTussenBrussel('x', 0, '2027-01-15', 0)).toBeNull();
  });
});
