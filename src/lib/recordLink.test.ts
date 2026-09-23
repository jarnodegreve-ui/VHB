import { describe, expect, it } from 'vitest';
import { bepaalRecordLink } from './recordLink';

/** Deeplinks V1 (tranche 3C): één record uit de URL, zonder te verraden of het bestaat. */
describe('bepaalRecordLink', () => {
  const records = [{ id: 'l1' }, { id: 42 }];

  it('geen id = geen link', () => {
    expect(bepaalRecordLink(null, records, true)).toEqual({ staat: 'geen' });
    expect(bepaalRecordLink('', records, true)).toEqual({ staat: 'geen' });
  });

  it('zolang de collectie laadt: wachten, nooit "onbekend"', () => {
    expect(bepaalRecordLink('l1', [], false)).toEqual({ staat: 'wacht', id: 'l1' });
  });

  it('gevonden, ook bij een numeriek id', () => {
    expect(bepaalRecordLink('l1', records, true)).toEqual({ staat: 'gevonden', id: 'l1', record: { id: 'l1' } });
    expect(bepaalRecordLink('42', records, true)).toMatchObject({ staat: 'gevonden', record: { id: 42 } });
  });

  it('weg, van een ander of verzonnen: allemaal dezelfde toestand', () => {
    expect(bepaalRecordLink('van-een-collega', records, true)).toEqual({ staat: 'onbekend', id: 'van-een-collega' });
    expect(bepaalRecordLink('<script>', records, true)).toEqual({ staat: 'onbekend', id: '<script>' });
  });
});
