import { describe, it, expect } from 'vitest';
import { legRuilenOverMaandbeeld, type OverlayCellen, type OverlayRuil } from '../api/_lib/ruilOverlay.js';
import { HANDMATIGE_WISSEL_PREFIX } from '../api/helpers.js';

/**
 * Ruil-overlay op het maandbeeld. De kern (bevinding Jarno 12-09): een ruil
 * die de planner ook al in de Excel verwerkte, verloor bij de eerstvolgende
 * import zijn aanduiding "geruild met X", omdat de overlay alleen wisselde
 * als de gever de dienst nog toonde. Nu wordt zo'n cel alleen gemarkeerd.
 */
const cel = (code: string) => ({ code, kind: 'service', label: `Dienst ${code}`, segments: ['06:00-14:00'] });
/** Een vrije dag zoals de matrix hem levert: soort 'absence', geen segmenten.
 *  (Stond eerder als `vrij()` in de fixtures, dus met soort 'service' —
 *  dat maakte "heeft deze chauffeur die dag een dienst?" onmeetbaar.) */
const vrij = (code = 'vrij') => ({ code, kind: 'absence', label: 'Geen dienst', segments: [] as string[] });
const namen: Record<string, string> = { A: 'An', B: 'Bert', C: 'Cis' };
const opties = (dates: string[]) => ({
  dates,
  chauffeurIds: new Set(Object.keys(namen)),
  naamVanId: (id: string) => namen[id] ?? '',
});
const ruil = (extra: Partial<OverlayRuil>): OverlayRuil => ({
  id: 'sw1', requesterId: 'A', targetDriverId: 'B', status: 'approved', decidedAt: '2026-09-01T10:00:00Z',
  shiftDate: '2026-09-15', shiftLine: '2101', swapType: 'overname', ...extra,
});

describe('legRuilenOverMaandbeeld', () => {
  it('wisselt de cellen als de Excel de ruil nog niet kent (bestaand gedrag)', () => {
    const cells: OverlayCellen = { A: { '2026-09-15': cel('2101') }, B: { '2026-09-15': vrij() } };
    const uit = legRuilenOverMaandbeeld(cells, [ruil({})], opties(['2026-09-15']));
    expect(uit).toEqual({ gewisseld: 1, gemarkeerd: 0, overgeslagen: 0 });
    expect(cells.B['2026-09-15']).toMatchObject({ code: '2101', swapId: 'sw1', swapFrom: 'An', swapManual: false });
    expect(cells.A['2026-09-15']).toMatchObject({ code: 'vrij' });
  });

  it('markeert alleen als de planner de ruil al in de Excel verwerkte: de aanduiding blijft', () => {
    // De Excel zet 2101 al op Bert; An staat op vrij.
    const cells: OverlayCellen = { A: { '2026-09-15': vrij() }, B: { '2026-09-15': cel('2101') } };
    const uit = legRuilenOverMaandbeeld(cells, [ruil({})], opties(['2026-09-15']));
    expect(uit).toEqual({ gewisseld: 0, gemarkeerd: 1, overgeslagen: 0 });
    expect(cells.B['2026-09-15']).toMatchObject({ code: '2101', swapId: 'sw1', swapFrom: 'An' });
    // De dienst blijft staan waar hij staat (geen dubbel doorvoeren), maar de
    // vrije dag van de gever draagt nu wél het weg-merk (Jarno 17-09).
    expect(cells.A['2026-09-15']).toMatchObject({ code: 'vrij', swapId: 'sw1', swapAway: true, swapTo: 'Bert' });
  });

  it('doet niets als niemand de dienst (meer) heeft', () => {
    const cells: OverlayCellen = { A: { '2026-09-15': vrij() }, B: { '2026-09-15': vrij() } };
    const kopie = structuredClone(cells);
    const uit = legRuilenOverMaandbeeld(cells, [ruil({})], opties(['2026-09-15']));
    expect(uit).toEqual({ gewisseld: 0, gemarkeerd: 0, overgeslagen: 1 });
    expect(cells).toEqual(kopie);
  });

  it('een gever wiens collega op TA stond wordt vrij, niet TA (Jarno 14-09)', () => {
    const ta = { code: 'TA', kind: 'absence', label: 'Toegestane afwezigheid', segments: [] };
    const cells: OverlayCellen = { A: { '2026-09-15': cel('2101') }, B: { '2026-09-15': ta } };
    const uit = legRuilenOverMaandbeeld(cells, [ruil({})], opties(['2026-09-15']));
    expect(uit).toEqual({ gewisseld: 1, gemarkeerd: 0, overgeslagen: 0 });
    expect(cells.B['2026-09-15']).toMatchObject({ code: '2101', swapFrom: 'An' });
    expect(cells.A['2026-09-15']).toMatchObject({ code: 'vrij', kind: 'absence', label: 'Geen dienst', swapAway: true, swapTo: 'Bert' });
  });

  it('gebruikt de meegegeven vrij-cel (label uit de planningscodes)', () => {
    const cells: OverlayCellen = { A: { '2026-09-15': cel('2101') }, B: { '2026-09-15': { code: 'bv', kind: 'leave', label: 'Betaald verlof', segments: [] } } };
    const vrijCel = { code: 'vrij', kind: 'absence', label: 'Vrije dag', segments: [] };
    legRuilenOverMaandbeeld(cells, [ruil({})], { ...opties(['2026-09-15']), vrijCel });
    expect(cells.A['2026-09-15']).toMatchObject({ ...vrijCel, swapAway: true });
    // De ontvanger draagt zijn code niet mee: geen 'bv' bij An.
    expect(cells.B['2026-09-15'].code).toBe('2101');
  });

  it('een gever zonder cel bij de ontvanger komt vrij te staan, gemerkt (Jarno 17-09)', () => {
    // Stond hier eerder leeg; aan een lege cel was niet te zien dat deze
    // chauffeur die dag een dienst wegruilde.
    const cells: OverlayCellen = { A: { '2026-09-15': cel('2101') }, B: {} };
    legRuilenOverMaandbeeld(cells, [ruil({})], opties(['2026-09-15']));
    expect(cells.A['2026-09-15']).toMatchObject({ code: 'vrij', swapAway: true, swapTo: 'Bert' });
    expect(cells.B['2026-09-15']).toMatchObject({ code: '2101' });
  });

  it('merkt bij een 1-op-1-ruil op verschillende dagen beide vrije kanten', () => {
    // An geeft 2101 op 15-09, Bert geeft 2202 op 18-09; de Excel kent geen van
    // beide benen, dus beide gevers komen gemerkt vrij te staan.
    const cells: OverlayCellen = {
      A: { '2026-09-15': cel('2101'), '2026-09-18': vrij() },
      B: { '2026-09-15': vrij(), '2026-09-18': cel('2202') },
    };
    legRuilenOverMaandbeeld(
      cells,
      [ruil({ swapType: 'ruil', returnDate: '2026-09-18', returnCode: '2202' })],
      opties(['2026-09-15', '2026-09-18']),
    );
    expect(cells.A['2026-09-15']).toMatchObject({ code: 'vrij', swapAway: true, swapTo: 'Bert' });
    expect(cells.B['2026-09-18']).toMatchObject({ code: 'vrij', swapAway: true, swapTo: 'An' });
    expect(cells.B['2026-09-15']).toMatchObject({ code: '2101', swapFrom: 'An' });
    expect(cells.A['2026-09-18']).toMatchObject({ code: '2202', swapFrom: 'Bert' });
  });

  it('een dienst van de gever op de terugdag wordt nooit overschreven door het weg-merk', () => {
    // De Excel verwerkte de ruil al (Bert heeft 2101), maar An rijdt die dag
    // intussen zelf een andere dienst: die blijft staan, zonder weg-merk.
    const cells: OverlayCellen = { A: { '2026-09-15': cel('3303') }, B: { '2026-09-15': cel('2101') } };
    legRuilenOverMaandbeeld(cells, [ruil({})], opties(['2026-09-15']));
    expect(cells.A['2026-09-15']).toEqual(cel('3303'));
  });

  it('1-op-1 op dezelfde dag (handmatige wissel tussen twee ingeplande chauffeurs): beide diensten wisselen van naam', () => {
    const cells: OverlayCellen = { A: { '2026-09-15': cel('2101') }, B: { '2026-09-15': cel('2202') } };
    const uit = legRuilenOverMaandbeeld(
      cells,
      [ruil({ swapType: 'ruil', returnDate: '2026-09-15', returnCode: '2202', reason: `${HANDMATIGE_WISSEL_PREFIX}Jarno, mondelinge ruil` })],
      opties(['2026-09-15']),
    );
    // Eerste been wisselt beide cellen, het tweede vindt 2202 al bij An en markeert alleen.
    expect(uit).toEqual({ gewisseld: 1, gemarkeerd: 1, overgeslagen: 0 });
    expect(cells.B['2026-09-15']).toMatchObject({ code: '2101', swapFrom: 'An', swapManual: true });
    expect(cells.A['2026-09-15']).toMatchObject({ code: '2202', swapFrom: 'Bert', swapManual: true });
  });

  it('markeert bij een 1-op-1-ruil beide benen, elk met de juiste gever', () => {
    const cells: OverlayCellen = {
      A: { '2026-09-15': vrij(), '2026-09-18': cel('2202') },
      B: { '2026-09-15': cel('2101'), '2026-09-18': vrij() },
    };
    const uit = legRuilenOverMaandbeeld(cells, [ruil({ swapType: 'ruil', returnDate: '2026-09-18', returnCode: '2202' })], opties(['2026-09-15', '2026-09-18']));
    expect(uit).toEqual({ gewisseld: 0, gemarkeerd: 2, overgeslagen: 0 });
    expect(cells.B['2026-09-15']).toMatchObject({ code: '2101', swapFrom: 'An' });
    expect(cells.A['2026-09-18']).toMatchObject({ code: '2202', swapFrom: 'Bert' });
  });

  it("een 'vrij'-tegenprestatie markeert alleen de aangeboden dienst", () => {
    const cells: OverlayCellen = { A: { '2026-09-15': vrij() }, B: { '2026-09-15': cel('2101') } };
    const uit = legRuilenOverMaandbeeld(cells, [ruil({ swapType: 'ruil', returnDate: '2026-09-18', returnCode: 'vrij' })], opties(['2026-09-15', '2026-09-18']));
    expect(uit).toEqual({ gewisseld: 0, gemarkeerd: 1, overgeslagen: 0 });
  });

  it('ketting: eerste ruil al in de Excel, tweede nog niet: de laatste ontvanger draagt de dienst met de juiste gever', () => {
    // A→B zit al in de Excel (Bert heeft 2101), B→C nog niet.
    const cells: OverlayCellen = { A: { '2026-09-15': vrij() }, B: { '2026-09-15': cel('2101') }, C: { '2026-09-15': vrij() } };
    const uit = legRuilenOverMaandbeeld(cells, [
      ruil({ id: 'sw2', requesterId: 'B', targetDriverId: 'C', decidedAt: '2026-09-02T10:00:00Z' }),
      ruil({ id: 'sw1', decidedAt: '2026-09-01T10:00:00Z' }),
    ], opties(['2026-09-15']));
    expect(uit).toEqual({ gewisseld: 1, gemarkeerd: 1, overgeslagen: 0 });
    expect(cells.C['2026-09-15']).toMatchObject({ code: '2101', swapId: 'sw2', swapFrom: 'Bert' });
    expect(cells.B['2026-09-15']).toMatchObject({ code: 'vrij' });
  });

  it('negeert ruilen die niet doorgevoerd zijn en onbekende chauffeurs', () => {
    const cells: OverlayCellen = { A: { '2026-09-15': vrij() }, B: { '2026-09-15': cel('2101') } };
    const uit = legRuilenOverMaandbeeld(cells, [
      ruil({ status: 'pending' }),
      ruil({ status: 'rejected' }),
      ruil({ status: 'cancelled' }),
      ruil({ requesterId: 'X' }),
    ], opties(['2026-09-15']));
    expect(uit).toEqual({ gewisseld: 0, gemarkeerd: 0, overgeslagen: 0 });
    expect(cells.B['2026-09-15'].swapId).toBeUndefined();
  });

  it("telt 'completed' mee en herkent een handmatige admin-wissel", () => {
    const cells: OverlayCellen = { A: { '2026-09-15': vrij() }, B: { '2026-09-15': cel('2101') } };
    legRuilenOverMaandbeeld(cells, [ruil({ status: 'completed', reason: `${HANDMATIGE_WISSEL_PREFIX} ziek` })], opties(['2026-09-15']));
    expect(cells.B['2026-09-15']).toMatchObject({ swapId: 'sw1', swapManual: true });
  });

  it('matcht de dienstcode ongeacht hoofdletters en spaties, zoals de import', () => {
    const cells: OverlayCellen = { A: { '2026-09-15': vrij() }, B: { '2026-09-15': cel(' 2101 ') } };
    const uit = legRuilenOverMaandbeeld(cells, [ruil({ shiftLine: '2101' })], opties(['2026-09-15']));
    expect(uit.gemarkeerd).toBe(1);
  });
});
