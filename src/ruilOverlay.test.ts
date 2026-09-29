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

/**
 * Doorschuiven (controle 29-09). De overlay geeft de gever de oude cel van de
 * ontvanger zodra die een dienst is, zonder te kijken of de ruil een overname
 * of een 1-op-1 is. Voor een 1-op-1 op dezelfde dag is dat nodig: het tweede
 * been vindt de terugdienst dan al bij de gever en merkt haar alleen. Bij een
 * overname naar iemand die al een dienst had (een dubbele inplanning, die de
 * server sinds 29-09 weigert) verschijnt de dienst van de ontvanger daardoor
 * bij de gever. De overlay is bewust NIET aangepast: de andere keuze (de gever
 * vrij zetten) haalt die dienst helemaal van het bord, en een schoolrit die
 * nergens meer staat is erger dan een schoolrit op de verkeerde naam. Deze
 * toetsen leggen het gedrag vast zoals het is.
 */
describe('legRuilenOverMaandbeeld, doorschuiven bij een ontvanger met een dienst', () => {
  const DAG = '2026-09-15';
  const schoolrit = (code: string) => ({ code, kind: 'service', label: 'Schoolrit', segments: [] as string[] });

  it('overname naar wie al een schoolrit had: de ontvanger toont de nieuwe dienst, de schoolrit schuift naar de gever', () => {
    const cells: OverlayCellen = { A: { [DAG]: cel('14') }, B: { [DAG]: schoolrit('EEK6') } };
    const uit = legRuilenOverMaandbeeld(cells, [ruil({ shiftLine: '14' })], opties([DAG]));
    expect(uit).toEqual({ gewisseld: 1, gemarkeerd: 0, overgeslagen: 0 });
    expect(cells.B[DAG]).toMatchObject({ code: '14', swapId: 'sw1', swapFrom: 'An' });
    // De schoolrit blijft op het bord, op naam van de gever en zonder merk.
    expect(cells.A[DAG]).toEqual(schoolrit('EEK6'));
  });

  it('de situatie uit de controle: A gaf EEK6 aan B, daarna kreeg B de 14 van C', () => {
    const cells: OverlayCellen = { A: { [DAG]: schoolrit('EEK6') }, B: { [DAG]: vrij() }, C: { [DAG]: cel('14') } };
    legRuilenOverMaandbeeld(cells, [
      ruil({ id: 'sw1', requesterId: 'A', targetDriverId: 'B', shiftLine: 'EEK6', decidedAt: '2026-09-01T10:00:00Z' }),
      ruil({ id: 'sw2', requesterId: 'C', targetDriverId: 'B', shiftLine: '14', decidedAt: '2026-09-02T10:00:00Z' }),
    ], opties([DAG]));
    expect(cells.A[DAG]).toMatchObject({ code: 'vrij', swapAway: true, swapTo: 'Bert' });
    expect(cells.B[DAG]).toMatchObject({ code: '14', swapId: 'sw2', swapFrom: 'Cis' });
    // De schoolrit draagt nog het merk van de eerste wissel (van An).
    expect(cells.C[DAG]).toMatchObject({ code: 'EEK6', swapId: 'sw1', swapFrom: 'An' });
  });

  it('1-op-1 op dezelfde dag: beide diensten wisselen, elk met zijn merk', () => {
    const cells: OverlayCellen = { A: { [DAG]: cel('14') }, B: { [DAG]: schoolrit('EEK6') } };
    const uit = legRuilenOverMaandbeeld(cells, [
      ruil({ shiftLine: '14', swapType: 'ruil', returnDate: DAG, returnCode: 'EEK6' }),
    ], opties([DAG]));
    expect(uit).toEqual({ gewisseld: 1, gemarkeerd: 1, overgeslagen: 0 });
    expect(cells.B[DAG]).toMatchObject({ code: '14', swapFrom: 'An' });
    expect(cells.A[DAG]).toMatchObject({ code: 'EEK6', swapFrom: 'Bert' });
  });

  it('teruggedraaid (geannuleerd of afgewezen): de cellen blijven zoals de matrix ze geeft', () => {
    for (const status of ['cancelled', 'rejected'] as const) {
      const cells: OverlayCellen = { A: { [DAG]: cel('14') }, B: { [DAG]: schoolrit('EEK6') } };
      const kopie = structuredClone(cells);
      const uit = legRuilenOverMaandbeeld(cells, [ruil({ shiftLine: '14', status })], opties([DAG]));
      expect(uit).toEqual({ gewisseld: 0, gemarkeerd: 0, overgeslagen: 0 });
      expect(cells).toEqual(kopie);
    }
  });

  it('gemengd: een overname en een 1-op-1 op dezelfde dag, in beslisvolgorde', () => {
    // Eerst geeft A zijn schoolrit aan de vrije B; daarna ruilt B die rit
    // 1-op-1 tegen de 14 van C.
    const cells: OverlayCellen = { A: { [DAG]: schoolrit('EEK6') }, B: { [DAG]: vrij() }, C: { [DAG]: cel('14') } };
    legRuilenOverMaandbeeld(cells, [
      ruil({ id: 'sw2', requesterId: 'C', targetDriverId: 'B', shiftLine: '14', swapType: 'ruil', returnDate: DAG, returnCode: 'EEK6', decidedAt: '2026-09-02T10:00:00Z' }),
      ruil({ id: 'sw1', requesterId: 'A', targetDriverId: 'B', shiftLine: 'EEK6', decidedAt: '2026-09-01T10:00:00Z' }),
    ], opties([DAG]));
    expect(cells.A[DAG]).toMatchObject({ code: 'vrij', swapAway: true });
    expect(cells.B[DAG]).toMatchObject({ code: '14', swapId: 'sw2', swapFrom: 'Cis' });
    expect(cells.C[DAG]).toMatchObject({ code: 'EEK6', swapId: 'sw2', swapFrom: 'Bert' });
  });

  it('een afwezigheidscode van de ontvanger schuift nooit door: de gever wordt vrij', () => {
    const ziek = { code: 'ziek', kind: 'absence', label: 'Ziek', segments: [] as string[] };
    const cells: OverlayCellen = { A: { [DAG]: cel('14') }, B: { [DAG]: ziek } };
    legRuilenOverMaandbeeld(cells, [ruil({ shiftLine: '14' })], opties([DAG]));
    expect(cells.A[DAG]).toMatchObject({ code: 'vrij', swapAway: true, swapTo: 'Bert' });
  });
});

/**
 * Wie niet op het bord staat (Jarno 29-09). Een been naar iemand buiten het
 * bord wordt overgeslagen, zoals altijd. Wat iemand buiten het bord WEGGAF
 * blijft bij de ontvanger, als de aanroeper zijn cel meegeeft (`buitenBord`).
 */
describe('legRuilenOverMaandbeeld, gever of ontvanger buiten het bord', () => {
  const DAG = '2026-09-15';
  const opBord = (ids: string[], buitenBord?: string[]) => ({
    dates: [DAG, '2026-09-16'],
    chauffeurIds: new Set(ids),
    naamVanId: (id: string) => namen[id] ?? '',
    ...(buitenBord ? { buitenBord: new Set(buitenBord) } : {}),
  });

  it('zonder buitenBord: een ruil met iemand buiten het bord doet niets (bestaand gedrag)', () => {
    const cells: OverlayCellen = { A: { [DAG]: cel('2101') }, B: { [DAG]: vrij() } };
    const kopie = structuredClone(cells);
    expect(legRuilenOverMaandbeeld(cells, [ruil({})], opBord(['B']))).toEqual({ gewisseld: 0, gemarkeerd: 0, overgeslagen: 0 });
    expect(legRuilenOverMaandbeeld(cells, [ruil({})], opBord(['A']))).toEqual({ gewisseld: 0, gemarkeerd: 0, overgeslagen: 0 });
    expect(cells).toEqual(kopie);
  });

  it('gever buiten het bord, cel meegegeven: de ontvanger krijgt de dienst', () => {
    const cells: OverlayCellen = { A: { [DAG]: cel('2101') }, B: { [DAG]: vrij() } };
    const uit = legRuilenOverMaandbeeld(cells, [ruil({})], opBord(['B'], ['A']));
    expect(uit).toEqual({ gewisseld: 1, gemarkeerd: 0, overgeslagen: 0 });
    expect(cells.B[DAG]).toMatchObject({ code: '2101', swapId: 'sw1', swapFrom: 'An' });
  });

  it('gever buiten het bord en de Excel had de ruil al verwerkt: alleen het merk', () => {
    const cells: OverlayCellen = { B: { [DAG]: cel('2101') } };
    const uit = legRuilenOverMaandbeeld(cells, [ruil({})], opBord(['B'], ['A']));
    expect(uit).toEqual({ gewisseld: 0, gemarkeerd: 1, overgeslagen: 0 });
    expect(cells.B[DAG]).toMatchObject({ code: '2101', swapId: 'sw1', swapFrom: 'An' });
    expect(cells.A).toBeUndefined();
  });

  it('ontvanger buiten het bord: het been wordt overgeslagen, ook met buitenBord', () => {
    const cells: OverlayCellen = { A: { [DAG]: cel('2101') }, B: { [DAG]: vrij() } };
    const kopie = structuredClone(cells);
    expect(legRuilenOverMaandbeeld(cells, [ruil({})], opBord(['A'], ['B']))).toEqual({ gewisseld: 0, gemarkeerd: 0, overgeslagen: 0 });
    expect(cells).toEqual(kopie);
  });

  it('1-op-1 over twee dagen: elk been apart, alleen het been naar wie op het bord staat', () => {
    // A (op het bord) gaf 2101 aan B en kreeg 2607 terug; B staat niet meer op het bord.
    const cells: OverlayCellen = {
      A: { [DAG]: cel('2101'), '2026-09-16': vrij() },
      B: { [DAG]: vrij(), '2026-09-16': cel('2607') },
    };
    const uit = legRuilenOverMaandbeeld(cells, [ruil({ swapType: 'ruil', returnDate: '2026-09-16', returnCode: '2607' })], opBord(['A'], ['B']));
    expect(uit).toEqual({ gewisseld: 1, gemarkeerd: 0, overgeslagen: 0 });
    expect(cells.A['2026-09-16']).toMatchObject({ code: '2607', swapFrom: 'Bert' });
    expect(cells.A[DAG]).toEqual(cel('2101'));
  });
});

