import { describe, expect, it } from 'vitest';
import { BINNENKORT_DAGEN, brusselseDag, dagenTussen, isoDagVan, jarenTussen, pastInTermijn, vervalStatus } from './peildatum';

/**
 * Alles rekent op zone-loze ISO-dagen in UTC: dezelfde invoer geeft in
 * Brussel en op de server (UTC) hetzelfde cijfer. Draai dit bestand met
 * TZ=Europe/Brussels en met TZ=UTC; de verwachtingen zijn dezelfde.
 */
const PEIL = '2026-09-21';

describe('jarenTussen (leeftijd en anciënniteit, één decimaal)', () => {
  it('volle jaren plus het deel van het lopende jaar', () => {
    // 23/01/2019 → 21/09/2026: 7 jaar en 241 van 365 dagen = 7,66.
    expect(jarenTussen('2019-01-23', PEIL)).toBe(7.7);
    expect(jarenTussen('2016-09-21', PEIL)).toBe(10);
    expect(jarenTussen('2026-07-09', PEIL)).toBe(0.2);
    expect(jarenTussen(PEIL, PEIL)).toBe(0);
  });

  it('de dag vóór de verjaardag telt het jaar nog niet vol', () => {
    // 22/09/2016: nog 1 dag te gaan, 9 jaar en 364/365 → afgerond 10,0 maar nooit meer.
    expect(jarenTussen('2016-09-22', PEIL)).toBe(10);
    expect(jarenTussen('2016-12-21', PEIL)).toBe(9.8);
  });

  it('schrikkeljaar: 29 februari verjaart in een gewoon jaar op 1 maart', () => {
    expect(jarenTussen('2024-02-29', '2025-02-28')).toBe(1); // 365 van 366 dagen, afgerond
    expect(jarenTussen('2024-02-29', '2025-03-01')).toBe(1);
    expect(jarenTussen('2024-02-29', '2028-02-29')).toBe(4);
    expect(jarenTussen('2024-02-29', '2026-09-01')).toBe(2.5);
  });

  it('zonder datum, met rommel of met een datum in de toekomst: geen leeftijd', () => {
    expect(jarenTussen(null, PEIL)).toBeNull();
    expect(jarenTussen(undefined, PEIL)).toBeNull();
    expect(jarenTussen('', PEIL)).toBeNull();
    expect(jarenTussen('2026-02-30', PEIL)).toBeNull();
    expect(jarenTussen('2026-09-22', PEIL)).toBeNull();
  });

  it('een tijdstip telt als zijn ISO-dag', () => {
    expect(jarenTussen('2016-09-21T00:00:00', PEIL)).toBe(10);
  });
});

describe('dagenTussen', () => {
  it('morgen = 1, gisteren = -1, vandaag = 0', () => {
    expect(dagenTussen(PEIL, '2026-09-22')).toBe(1);
    expect(dagenTussen(PEIL, '2026-09-20')).toBe(-1);
    expect(dagenTussen(PEIL, PEIL)).toBe(0);
    expect(dagenTussen(PEIL, '2026-09-24')).toBe(3);
  });

  it('de omschakeling naar winter- of zomertijd kost geen dag', () => {
    expect(dagenTussen('2026-10-24', '2026-10-26')).toBe(2);
    expect(dagenTussen('2026-03-28', '2026-03-30')).toBe(2);
    expect(dagenTussen('2024-02-28', '2024-03-01')).toBe(2);
  });

  it('null bij een ontbrekende of onmogelijke dag', () => {
    expect(dagenTussen(PEIL, null)).toBeNull();
    expect(dagenTussen(PEIL, '2026-13-01')).toBeNull();
  });
});

describe('vervalStatus en het termijnfilter', () => {
  it('grenzen: gisteren vervallen, vandaag tot en met 90 dagen binnenkort, daarna in orde', () => {
    expect(vervalStatus(-1)).toBe('vervallen');
    expect(vervalStatus(0)).toBe('binnenkort');
    expect(vervalStatus(BINNENKORT_DAGEN)).toBe('binnenkort');
    expect(vervalStatus(BINNENKORT_DAGEN + 1)).toBe('in_orde');
    expect(vervalStatus(null)).toBe('geen_datum');
  });

  it('binnen 30 dagen = uiterlijk over 30 dagen, dus ook wat al vervallen is', () => {
    expect(pastInTermijn(-12, '30')).toBe(true);
    expect(pastInTermijn(30, '30')).toBe(true);
    expect(pastInTermijn(31, '30')).toBe(false);
    expect(pastInTermijn(61, '60')).toBe(false);
    expect(pastInTermijn(90, '90')).toBe(true);
    expect(pastInTermijn(400, 'alles')).toBe(true);
    expect(pastInTermijn(400, undefined)).toBe(true);
  });

  it('zonder datum hoort een rij bij elke termijn', () => {
    expect(pastInTermijn(null, '30')).toBe(true);
    expect(pastInTermijn(null, 'alles')).toBe(true);
  });
});

describe('brusselseDag en isoDagVan', () => {
  it('een tijdstip wordt de kalenderdag in België, in elke tijdzone van de server', () => {
    expect(brusselseDag('2026-09-18T22:30:00+00:00')).toBe('2026-09-19'); // 00:30 in Brussel (zomertijd)
    expect(brusselseDag('2026-09-18T08:22:28.266153+00:00')).toBe('2026-09-18');
    expect(brusselseDag('2026-12-31T23:30:00Z')).toBe('2027-01-01'); // wintertijd: 00:30
  });

  it('een kale dag blijft wat hij is; rommel is null', () => {
    expect(brusselseDag('2026-09-18')).toBe('2026-09-18');
    expect(brusselseDag('geen datum')).toBeNull();
    expect(brusselseDag(null)).toBeNull();
    expect(isoDagVan('2026-02-30')).toBeNull();
    expect(isoDagVan('2026-02-28T10:00:00')).toBe('2026-02-28');
  });
});
