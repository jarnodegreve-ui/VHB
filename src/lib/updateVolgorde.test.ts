import { describe, expect, it } from 'vitest';
import { nieuwsteUpdateEerst, updateDatumSleutel } from './updateVolgorde';

describe('updateDatumSleutel en nieuwsteUpdateEerst', () => {
  it('leest de nl-BE-datum van de UI en de ISO-dag van oudere rijen', () => {
    expect(updateDatumSleutel('3/9/2026')).toBe('2026-09-03');
    expect(updateDatumSleutel('14/10/2026')).toBe('2026-10-14');
    expect(updateDatumSleutel('2026-09-21')).toBe('2026-09-21');
    expect(updateDatumSleutel('2026-09-21T08:00:00Z')).toBe('2026-09-21');
    expect(updateDatumSleutel('gisteren')).toBe('');
    expect(updateDatumSleutel(undefined)).toBe('');
  });

  it('zet de nieuwste update eerst, ook over de maandgrens en tussen beide vormen', () => {
    const updates = [
      { id: '1759400000000', date: '2/10/2026' },
      { id: '1760400000000', date: '14/10/2026' },
      { id: 'oud', date: '2026-09-21' },
      { id: '1760400000500', date: '14/10/2026' },
    ];
    expect([...updates].sort(nieuwsteUpdateEerst).map((u) => u.id)).toEqual(['1760400000500', '1760400000000', '1759400000000', 'oud']);
  });
});
