import { describe, expect, it } from 'vitest';
import type { LeaveRequest } from '../types';
import { ookAangevraagd, volgendeWachtende } from './verlofWachtrij';

describe('volgendeWachtende', () => {
  it('geeft de aanvraag die in de lijst na de besliste komt', () => {
    expect(volgendeWachtende(['a', 'b', 'c'], 'a', ['a', 'b', 'c'])).toBe('b');
    expect(volgendeWachtende(['a', 'b', 'c'], 'b', ['a', 'b', 'c'])).toBe('c');
  });

  it('werkt ook als de besliste aanvraag al uit de wachtenden is (het scherm is al bijgewerkt)', () => {
    expect(volgendeWachtende(['a', 'b', 'c'], 'a', ['b', 'c'])).toBe('b');
  });

  it('de laatste van de lijst heeft geen volgende: het paneel sluit', () => {
    expect(volgendeWachtende(['a', 'b', 'c'], 'c', ['a', 'b'])).toBeNull();
    expect(volgendeWachtende(['a'], 'a', [])).toBeNull();
  });

  it('loopt niet terug naar het begin: wat erboven staat sloeg de beslisser zelf over', () => {
    expect(volgendeWachtende(['a', 'b', 'c'], 'c', ['a', 'b', 'c'])).toBeNull();
    expect(volgendeWachtende(['a', 'b', 'c'], 'b', ['a'])).toBeNull();
  });

  it('slaat over wat intussen door iemand anders beslist is', () => {
    // b wacht niet meer (een collega besliste mee): door naar c.
    expect(volgendeWachtende(['a', 'b', 'c'], 'a', ['c'])).toBe('c');
    // Alles erna is intussen behandeld: sluiten.
    expect(volgendeWachtende(['a', 'b', 'c'], 'a', [])).toBeNull();
  });

  it('opent nooit een aanvraag die bij de klik nog niet in de lijst stond', () => {
    // d kwam binnen terwijl de beslissing onderweg was.
    expect(volgendeWachtende(['a', 'b'], 'b', ['a', 'd'])).toBeNull();
    expect(volgendeWachtende(['a', 'b'], 'a', ['d', 'b'])).toBe('b');
  });

  it('houdt de volgorde van de klik aan, ook als de lijst intussen anders gesorteerd terugkwam', () => {
    expect(volgendeWachtende(['a', 'b', 'c'], 'a', ['c', 'b'])).toBe('b');
  });

  it('een aanvraag die niet in de lijst staat heeft geen volgende', () => {
    expect(volgendeWachtende(['a', 'b'], 'x', ['a', 'b'])).toBeNull();
    expect(volgendeWachtende([], 'a', ['b'])).toBeNull();
  });

  it('geeft nooit de besliste aanvraag zelf terug, ook niet bij een dubbel id', () => {
    expect(volgendeWachtende(['a', 'a', 'b'], 'a', ['a', 'b'])).toBe('b');
  });
});

describe('ookAangevraagd', () => {
  const aanvraag = (id: string, van: string, tot: string, extra: Partial<LeaveRequest> = {}): LeaveRequest => ({
    id, userId: `u-${id}`, startDate: van, endDate: tot, type: 'betaald_verlof', status: 'pending', createdAt: '2026-11-01T08:00:00.000Z', ...extra,
  });
  const DEZE = aanvraag('deze', '2026-11-16', '2026-11-20');

  it('geeft de andere wachtende aanvragen die de periode raken, nooit de aanvraag zelf', () => {
    const lijst = [DEZE, aanvraag('binnen', '2026-11-17', '2026-11-18'), aanvraag('ervoor', '2026-11-10', '2026-11-15'), aanvraag('erna', '2026-11-21', '2026-11-22')];
    expect(ookAangevraagd(lijst, DEZE).map((r) => r.id)).toEqual(['binnen']);
  });

  it('één gedeelde dag aan de rand telt als overlap', () => {
    const lijst = [aanvraag('eindigt-op-start', '2026-11-12', '2026-11-16'), aanvraag('begint-op-einde', '2026-11-20', '2026-11-25'), aanvraag('omvat', '2026-11-01', '2026-11-30')];
    expect(ookAangevraagd(lijst, DEZE).map((r) => r.id).sort()).toEqual(['begint-op-einde', 'eindigt-op-start', 'omvat']);
  });

  it('zet de oudste aanvraag eerst, bij een gelijk moment de vroegste periode', () => {
    const lijst = [
      aanvraag('jong', '2026-11-16', '2026-11-16', { createdAt: '2026-11-05T09:00:00.000Z' }),
      aanvraag('oud', '2026-11-19', '2026-11-20', { createdAt: '2026-10-20T09:00:00.000Z' }),
      aanvraag('gelijk-later', '2026-11-18', '2026-11-18', { createdAt: '2026-11-02T09:00:00.000Z' }),
      aanvraag('gelijk-vroeger', '2026-11-17', '2026-11-17', { createdAt: '2026-11-02T09:00:00.000Z' }),
    ];
    expect(ookAangevraagd(lijst, DEZE).map((r) => r.id)).toEqual(['oud', 'gelijk-vroeger', 'gelijk-later', 'jong']);
  });

  it('een rij zonder aanvraagmoment (oude data) crasht niet en komt achteraan', () => {
    const zonder = { ...aanvraag('zonder', '2026-11-16', '2026-11-16'), createdAt: undefined } as unknown as LeaveRequest;
    const lijst = [zonder, aanvraag('met', '2026-11-18', '2026-11-18'), { ...zonder, id: 'ook-zonder', startDate: '2026-11-17', endDate: '2026-11-17' }];
    expect(ookAangevraagd(lijst, DEZE).map((r) => r.id)).toEqual(['met', 'zonder', 'ook-zonder']);
  });

  it('laat weg wat niet meer wacht en wijzigt de lijst van het scherm niet', () => {
    const lijst = [aanvraag('b', '2026-11-17', '2026-11-17', { createdAt: '2026-11-03T09:00:00.000Z' }), aanvraag('goedgekeurd', '2026-11-17', '2026-11-17', { status: 'approved' }), aanvraag('a', '2026-11-18', '2026-11-18', { createdAt: '2026-11-02T09:00:00.000Z' })];
    const kopie = [...lijst];
    expect(ookAangevraagd(lijst, DEZE).map((r) => r.id)).toEqual(['a', 'b']);
    expect(lijst).toEqual(kopie);
  });

  it('een tweede aanvraag van dezelfde chauffeur voor dezelfde periode staat er ook in', () => {
    const lijst = [aanvraag('tweede', '2026-11-18', '2026-11-19', { userId: DEZE.userId })];
    expect(ookAangevraagd(lijst, DEZE).map((r) => r.id)).toEqual(['tweede']);
  });

  it('geen andere aanvragen: een lege lijst (dan staat het blok er niet)', () => {
    expect(ookAangevraagd([DEZE], DEZE)).toEqual([]);
    expect(ookAangevraagd([], DEZE)).toEqual([]);
  });
});
