import { describe, expect, it } from 'vitest';
import { begrensMaandbord, eersteZichtbareDag } from './maandplanningTerugblik';

/**
 * De terugblikgrens van de Maandplanning (Jarno 02-10): wie geen staf is
 * ziet het bord vanaf de maandag van de lopende week, in Brusselse tijd.
 * De tijdstippen staan in UTC (Z), zoals de klok van de server loopt; de
 * Brusselse wandklok staat er telkens bij.
 */
const op = (utc: string) => eersteZichtbareDag(new Date(utc));

describe('eersteZichtbareDag', () => {
  it('elke dag van de week geeft de maandag van die week, de maandag zichzelf', () => {
    // Week van maandag 28/09/2026 tot zondag 04/10/2026, telkens 's middags.
    for (const dag of ['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04']) {
      expect(op(`${dag}T10:00:00Z`), dag).toBe('2026-09-28');
    }
    expect(op('2026-10-05T10:00:00Z')).toBe('2026-10-05');
  });

  it('de week loopt over een maand- en een jaargrens', () => {
    expect(op('2026-10-02T10:00:00Z')).toBe('2026-09-28');
    // Donderdag 01/01/2026: de maandag ligt in het vorige jaar.
    expect(op('2026-01-01T10:00:00Z')).toBe('2025-12-29');
    // Zondag 01/03/2026: zes dagen terug, over februari heen.
    expect(op('2026-03-01T10:00:00Z')).toBe('2026-02-23');
  });

  it('de week wisselt om middernacht in Brussel, niet om middernacht UTC (zomertijd, UTC+2)', () => {
    // Zondag 14/06 23:59:59 in Brussel: nog de week van 08/06.
    expect(op('2026-06-14T21:59:59Z')).toBe('2026-06-08');
    // Maandag 15/06 00:00:00 in Brussel, in UTC nog zondag 22:00.
    expect(op('2026-06-14T22:00:00Z')).toBe('2026-06-15');
    // Maandag 15/06 01:30 in Brussel, in UTC nog altijd zondag.
    expect(op('2026-06-14T23:30:00Z')).toBe('2026-06-15');
  });

  it('idem in de winter (UTC+1)', () => {
    // Zondag 11/01 23:59:59 in Brussel.
    expect(op('2026-01-11T22:59:59Z')).toBe('2026-01-05');
    // Maandag 12/01 00:00:00 in Brussel, in UTC nog zondag 23:00.
    expect(op('2026-01-11T23:00:00Z')).toBe('2026-01-12');
  });

  it('zondag is de laatste dag van de week, tot de laatste seconde', () => {
    // Zondag 04/10 00:00:00 en 23:59:59 in Brussel.
    expect(op('2026-10-03T22:00:00Z')).toBe('2026-09-28');
    expect(op('2026-10-04T21:59:59Z')).toBe('2026-09-28');
    // Zaterdag 03/10 23:59:59 in Brussel.
    expect(op('2026-10-03T21:59:59Z')).toBe('2026-09-28');
  });

  it('de nacht waarin het zomeruur ingaat (zondag 29/03/2026, 02:00 wordt 03:00)', () => {
    // Zondag 00:30 (nog UTC+1), 03:30 (al UTC+2) en 23:59:59: de week van 23/03.
    expect(op('2026-03-28T23:30:00Z')).toBe('2026-03-23');
    expect(op('2026-03-29T01:30:00Z')).toBe('2026-03-23');
    expect(op('2026-03-29T21:59:59Z')).toBe('2026-03-23');
    // Maandag 30/03 00:00:00: de wissel valt nu op 22:00 UTC, een uur vroeger dan de week ervoor.
    expect(op('2026-03-29T22:00:00Z')).toBe('2026-03-30');
    // De zondag ervoor (22/03, nog wintertijd) was 22:00 UTC pas 23:00 in Brussel.
    expect(op('2026-03-22T22:00:00Z')).toBe('2026-03-16');
  });

  it('de nacht waarin het winteruur ingaat (zondag 25/10/2026, 03:00 wordt 02:00)', () => {
    // Zondag 00:30 (nog UTC+2), het dubbele uur 02:30 (twee keer) en 23:59:59: de week van 19/10.
    expect(op('2026-10-24T22:30:00Z')).toBe('2026-10-19');
    expect(op('2026-10-25T00:30:00Z')).toBe('2026-10-19');
    expect(op('2026-10-25T01:30:00Z')).toBe('2026-10-19');
    expect(op('2026-10-25T22:59:59Z')).toBe('2026-10-19');
    // Zondag 23:00 in Brussel is na de wissel 22:00 UTC: nog altijd zondag.
    expect(op('2026-10-25T22:00:00Z')).toBe('2026-10-19');
    // Maandag 26/10 00:00:00 in Brussel.
    expect(op('2026-10-25T23:00:00Z')).toBe('2026-10-26');
  });

  it('zonder argument rekent ze op nu', () => {
    expect(eersteZichtbareDag()).toBe(eersteZichtbareDag(new Date()));
  });
});

describe('begrensMaandbord', () => {
  const cel = (code: string) => ({ code, kind: 'service', label: '', segments: [] });
  const bord = () => ({
    month: '2026-09',
    dates: ['2026-09-25', '2026-09-27', '2026-09-28', '2026-09-30'],
    drivers: [{ id: '3', name: 'A' }, { id: '4', name: 'B' }],
    cells: {
      '3': { '2026-09-25': cel('12'), '2026-09-28': cel('13') },
      '4': { '2026-09-27': cel('14') },
    } as Record<string, Record<string, unknown>>,
    geimporteerd: { eerste: '2026-07-01', laatste: '2026-11-08' } as { eerste: string | null; laatste: string | null },
  });

  it('houdt de dagen vanaf de grens over, de grensdag zelf inbegrepen', () => {
    const uit = begrensMaandbord(bord(), '2026-09-28');
    expect(uit.dates).toEqual(['2026-09-28', '2026-09-30']);
    expect(uit.cells).toEqual({ '3': { '2026-09-28': cel('13') } });
    // De zondag ervoor is weg, bij elke chauffeur; wie niets zichtbaars heeft staat er niet meer in.
    expect(JSON.stringify(uit)).not.toContain('2026-09-27');
    expect(JSON.stringify(uit)).not.toContain('2026-09-25');
    expect(uit.cells).not.toHaveProperty('4');
  });

  it('laat de rest van het antwoord staan en zegt waar de grens ligt', () => {
    const uit = begrensMaandbord(bord(), '2026-09-28');
    expect(uit.month).toBe('2026-09');
    expect(uit.drivers).toEqual(bord().drivers);
    expect(uit.zichtbaarVanaf).toBe('2026-09-28');
  });

  it('legt het begin van de import op de grens, het einde blijft', () => {
    expect(begrensMaandbord(bord(), '2026-09-28').geimporteerd).toEqual({ eerste: '2026-09-28', laatste: '2026-11-08' });
  });

  it('een import die later begint dan de grens houdt zijn eigen begin', () => {
    const laat = { ...bord(), geimporteerd: { eerste: '2026-10-05', laatste: '2026-11-08' } };
    expect(begrensMaandbord(laat, '2026-09-28').geimporteerd).toEqual({ eerste: '2026-10-05', laatste: '2026-11-08' });
  });

  it('zonder import blijven de grenzen leeg', () => {
    const leeg = { ...bord(), geimporteerd: { eerste: null, laatste: null } };
    expect(begrensMaandbord(leeg, '2026-09-28').geimporteerd).toEqual({ eerste: null, laatste: null });
  });

  it('een maand die helemaal vóór de grens ligt geeft dezelfde vorm, zonder dagen en zonder cellen', () => {
    const uit = begrensMaandbord(bord(), '2026-10-05');
    expect(uit.dates).toEqual([]);
    expect(uit.cells).toEqual({});
    expect(uit.drivers).toHaveLength(2);
  });

  it('een maand na de grens blijft ongewijzigd', () => {
    const uit = begrensMaandbord(bord(), '2026-09-01');
    expect(uit.dates).toEqual(bord().dates);
    expect(uit.cells).toEqual(bord().cells);
  });

  it('wijzigt het bord dat ze kreeg niet', () => {
    const origineel = bord();
    begrensMaandbord(origineel, '2026-09-28');
    expect(origineel).toEqual(bord());
  });
});
