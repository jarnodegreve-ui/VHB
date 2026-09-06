import { describe, expect, it } from 'vitest';
import type { Melding } from '../types';
import { dagLabel, dagVan, filterMeldingen, groepeerPerDag, soortenIn, tijdVan } from './meldingen';

const m = (id: string, createdAt: string, extra: Partial<Melding> = {}): Melding => ({
  id, titel: `Melding ${id}`, soort: 'planning', createdAt, ...extra,
});

describe('meldingen, helpers', () => {
  it('dagVan geeft de lokale dag; ongeldig = leeg', () => {
    expect(dagVan('2026-09-06T10:00:00.000Z')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(dagVan('nonsens')).toBe('');
  });

  it('dagLabel: vandaag, gisteren, anders een leesbare datum', () => {
    expect(dagLabel('2026-09-06', '2026-09-06')).toBe('Vandaag');
    expect(dagLabel('2026-09-05', '2026-09-06')).toBe('Gisteren');
    expect(dagLabel('2026-09-01', '2026-09-06')).toMatch(/1 september/);
    expect(dagLabel('', '2026-09-06')).toBe('Onbekend');
  });

  it('filterMeldingen: alles, ongelezen of één soort', () => {
    const lijst = [
      m('a', '2026-09-06T08:00:00Z'),
      m('b', '2026-09-06T07:00:00Z', { gelezenOp: '2026-09-06T07:30:00Z', soort: 'verlof' }),
      m('c', '2026-09-05T07:00:00Z', { soort: 'verlof' }),
    ];
    expect(filterMeldingen(lijst, 'alles')).toHaveLength(3);
    expect(filterMeldingen(lijst, 'ongelezen').map((x) => x.id)).toEqual(['a', 'c']);
    expect(filterMeldingen(lijst, 'verlof').map((x) => x.id)).toEqual(['b', 'c']);
    expect(filterMeldingen(lijst, 'ruil')).toEqual([]);
  });

  it('soortenIn: alleen aanwezige soorten, in contractvolgorde', () => {
    const lijst = [m('a', '2026-09-06T08:00:00Z', { soort: 'update' }), m('b', '2026-09-06T08:00:00Z', { soort: 'planning' }), m('c', '2026-09-06T08:00:00Z', { soort: 'update' })];
    expect(soortenIn(lijst)).toEqual(['planning', 'update']);
  });

  it('groepeerPerDag: nieuwste eerst, per dag gebundeld', () => {
    const lijst = [
      m('oud', '2026-09-04T10:00:00Z'),
      m('nieuw', '2026-09-06T10:00:00Z'),
      m('ook-nieuw', '2026-09-06T06:00:00Z'),
    ];
    const groepen = groepeerPerDag(lijst, '2026-09-06');
    expect(groepen.map((g) => g.items.map((i) => i.id))).toEqual([['nieuw', 'ook-nieuw'], ['oud']]);
    expect(groepen[0].label).toBe('Vandaag');
    expect(groepen.every((g) => g.items.every((i) => dagVan(i.createdAt) === g.dag))).toBe(true);
  });

  it('tijdVan: HH:MM in Belgische tijd', () => {
    expect(tijdVan('2026-07-06T10:05:00Z')).toBe('12:05');
    expect(tijdVan('kapot')).toBe('');
  });
});
