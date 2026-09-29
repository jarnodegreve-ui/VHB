import { describe, it, expect } from 'vitest';
import { dubbeleInplanningen, onbekendeCodeFout, type DagStand, type Ontvangst } from '../api/_lib/dubbeleInplanning.js';
import { bordVanDag } from '../api/_lib/codeDienst.js';
import { ontvangstenVanRuil } from '../api/_lib/ruilRegels.js';
import { isVeiligeFouttekst, leesFout, schrijffout } from './lib/fouten';

/**
 * DE regel tegen dubbele inplanning (Jarno 29-09), puur: na de bewerking
 * heeft geen enkele chauffeur op één dag meer dan één dienst, behalve wat hij
 * in dezelfde beweging afgeeft. Elk schrijfpad roept deze ene functie aan.
 */
const DAG = '2026-07-24';
const DAG2 = '2026-07-25';
const users = [
  { id: 'a', name: 'An', role: 'chauffeur', isActive: true },
  { id: 'b', name: 'Bert', role: 'chauffeur', isActive: true },
  { id: 'c', name: 'Cis', role: 'chauffeur', isActive: true },
];
const services = [{ serviceNumber: '12' }, { serviceNumber: '14' }];
const codes = [{ code: 'eek6', category: 'service' }, { code: 'vrij', category: 'absence' }, { code: 'xx', category: 'unknown' }];
const stand = (assignments: Record<string, string>, rijen: DagStand['rijen'] = [], date = DAG): DagStand => ({
  rijen,
  bord: bordVanDag(date, { rows: [{ source_date: date, assignments }], users, services, codes, leave: [], swaps: [] }),
});
/** Een stand waarin het dienstoverzicht of de planningscodes anders zijn,
 *  bv. leeg teruggekomen. */
const standMet = (assignments: Record<string, string>, bron: { services?: any[]; codes?: any[] }): DagStand => ({
  rijen: [],
  bord: bordVanDag(DAG, { rows: [{ source_date: DAG, assignments }], users, services: bron.services ?? services, codes: bron.codes ?? codes, leave: [], swaps: [] }),
});
const toets = (s: DagStand, ontvangsten: Ontvangst[]) => dubbeleInplanningen((d) => (d === DAG ? s : undefined), ontvangsten);
const krijgt14 = (extra: Partial<Ontvangst> = {}): Ontvangst => ({ driverId: 'b', date: DAG, krijgt: '14', ...extra });

describe('dubbeleInplanningen', () => {
  it('wie vrij is, of niet in de matrix staat, kan een dienst krijgen', () => {
    expect(toets(stand({ Bert: 'vrij' }), [krijgt14()])).toEqual([]);
    expect(toets(stand({ An: '12' }), [krijgt14()])).toEqual([]);
  });

  it('een dienst in de planning-rijen is een conflict', () => {
    expect(toets(stand({}, [{ driverId: 'b', line: '12' }]), [krijgt14()]))
      .toEqual([{ driverId: 'b', date: DAG, dienst: '12', bron: 'rijen' }]);
  });

  it('een code-dienst op het bord is een conflict, een gewone dienst zonder rijen niet', () => {
    expect(toets(stand({ Bert: 'EEK6' }), [krijgt14()])).toEqual([{ driverId: 'b', date: DAG, dienst: 'EEK6', bron: 'bord' }]);
    // Voor een dienst uit het dienstoverzicht zijn de rijen de waarheid.
    expect(toets(stand({ Bert: '12' }), [krijgt14()])).toEqual([]);
  });

  it('de dienst die hij krijgt en wat hij in dezelfde beweging afgeeft tellen niet', () => {
    expect(toets(stand({}, [{ driverId: 'b', line: '14' }]), [krijgt14()])).toEqual([]);
    expect(toets(stand({}, [{ driverId: 'b', line: '12' }]), [krijgt14({ geeftAf: ['12'] })])).toEqual([]);
    expect(toets(stand({ Bert: 'EEK6' }), [krijgt14({ geeftAf: ['eek6'] })])).toEqual([]);
    expect(toets(stand({ Bert: 'EEK6' }), [krijgt14({ krijgt: 'eek6' })])).toEqual([]);
  });

  it('een aanvraag die nog niet is doorgevoerd: ook een dienst met hetzelfde nummer telt', () => {
    const s = stand({}, [{ driverId: 'b', line: '14' }]);
    expect(toets(s, [krijgt14()])).toEqual([]);
    expect(toets(s, [krijgt14({ aanvraag: true })])).toEqual([{ driverId: 'b', date: DAG, dienst: '14', bron: 'rijen' }]);
    expect(toets(stand({ Bert: 'EEK6' }), [krijgt14({ krijgt: 'EEK6', aanvraag: true })])).toEqual([{ driverId: 'b', date: DAG, dienst: 'EEK6', bron: 'bord' }]);
  });

  it('een andere dienst dan de afgegeven blijft een conflict', () => {
    const s = stand({}, [{ driverId: 'b', line: '12' }, { driverId: 'b', line: '15' }]);
    expect(toets(s, [krijgt14({ geeftAf: ['12'] })])).toEqual([{ driverId: 'b', date: DAG, dienst: '15', bron: 'rijen' }]);
  });

  it('een code die het portaal niet kent is een conflict; een bekende code en een overname-code niet', () => {
    expect(toets(stand({ Bert: 'FD' }), [krijgt14()])).toEqual([{ driverId: 'b', date: DAG, dienst: 'FD', bron: 'onbekend' }]);
    // 'xx' staat in de planningscodes (categorie onbekend): bekend.
    expect(toets(stand({ Bert: 'xx' }), [krijgt14()])).toEqual([]);
    // 'bv' en 'tk' staan er niet in, maar zijn overname-codes.
    expect(toets(stand({ Bert: 'bv' }), [krijgt14()])).toEqual([]);
    expect(toets(stand({ Bert: 'TK' }), [krijgt14()])).toEqual([]);
    expect(toets(stand({ Bert: '-' }), [krijgt14()])).toEqual([]);
  });

  it('kwam een lijst leeg terug, dan draagt een onbekende code dat mee (controle 29-09, 1c)', () => {
    expect(toets(standMet({ Bert: 'FD' }, { codes: [] }), [krijgt14()]))
      .toEqual([{ driverId: 'b', date: DAG, dienst: 'FD', bron: 'onbekend', bronLeeg: 'planningscodes' }]);
    expect(toets(standMet({ Bert: '13' }, { services: [] }), [krijgt14()]))
      .toEqual([{ driverId: 'b', date: DAG, dienst: '13', bron: 'onbekend', bronLeeg: 'dienstoverzicht' }]);
    expect(toets(standMet({ Bert: 'FD' }, { services: [], codes: [] }), [krijgt14()]))
      .toEqual([{ driverId: 'b', date: DAG, dienst: 'FD', bron: 'onbekend', bronLeeg: 'beide' }]);
    // Beide lijsten gevuld: zoals altijd, zonder bronLeeg.
    expect(toets(standMet({ Bert: 'FD' }, {}), [krijgt14()]))
      .toEqual([{ driverId: 'b', date: DAG, dienst: 'FD', bron: 'onbekend' }]);
  });

  it('een lege lijst verandert niets aan rijen, code-diensten, overname-codes en een lege cel', () => {
    expect(toets({ ...standMet({}, { services: [], codes: [] }), rijen: [{ driverId: 'b', line: '12' }] }, [krijgt14()]))
      .toEqual([{ driverId: 'b', date: DAG, dienst: '12', bron: 'rijen' }]);
    // Een schoolrit uit de planningscodes blijft een code-dienst, ook zonder dienstoverzicht.
    expect(toets(standMet({ Bert: 'EEK6' }, { services: [] }), [krijgt14()]))
      .toEqual([{ driverId: 'b', date: DAG, dienst: 'EEK6', bron: 'bord' }]);
    expect(toets(standMet({ Bert: 'vrij' }, { services: [], codes: [] }), [krijgt14()])).toEqual([]);
    expect(toets(standMet({ Bert: 'bv' }, { codes: [] }), [krijgt14()])).toEqual([]);
    expect(toets(standMet({}, { services: [], codes: [] }), [krijgt14()])).toEqual([]);
  });

  it('geldt voor elke ontvangst, op elke dag; rijen gaan vóór het bord', () => {
    const dag1 = stand({ Bert: 'EEK6' });
    const dag2 = stand({ Cis: 'vrij' }, [{ driverId: 'c', line: '13' }], DAG2);
    const uit = dubbeleInplanningen((d) => (d === DAG ? dag1 : d === DAG2 ? dag2 : undefined), [
      krijgt14(),
      { driverId: 'c', date: DAG2, krijgt: '12' },
    ]);
    expect(uit).toEqual([
      { driverId: 'c', date: DAG2, dienst: '13', bron: 'rijen' },
      { driverId: 'b', date: DAG, dienst: 'EEK6', bron: 'bord' },
    ]);
  });

  it('een ontvangst zonder dag, chauffeur of dienst, of een dag zonder stand, zegt niets', () => {
    const s = stand({ Bert: 'EEK6' }, [{ driverId: 'b', line: '12' }]);
    expect(toets(s, [krijgt14({ date: '' }), krijgt14({ driverId: '' }), krijgt14({ krijgt: '' }), krijgt14({ date: DAG2 })])).toEqual([]);
  });
});

describe('ontvangstenVanRuil', () => {
  const ruil = { requesterId: 'c', targetDriverId: 'b', shiftDate: DAG, shiftLine: '14', returnDate: DAG2, returnCode: '12', swapType: 'ruil' };

  it('1-op-1 over twee dagen: de collega op de dienstdag, de aanvrager op de terugdag', () => {
    expect(ontvangstenVanRuil(ruil)).toEqual([
      { driverId: 'b', date: DAG, krijgt: '14', geeftAf: [] },
      { driverId: 'c', date: DAG2, krijgt: '12', geeftAf: [] },
    ]);
  });

  it('1-op-1 op dezelfde dag: elk geeft af wat de ander krijgt', () => {
    expect(ontvangstenVanRuil({ ...ruil, returnDate: DAG })).toEqual([
      { driverId: 'b', date: DAG, krijgt: '14', geeftAf: ['12'] },
      { driverId: 'c', date: DAG, krijgt: '12', geeftAf: ['14'] },
    ]);
  });

  it('een overname of een tegenprestatie "vrij": alleen de collega', () => {
    expect(ontvangstenVanRuil({ ...ruil, swapType: 'overname' })).toEqual([{ driverId: 'b', date: DAG, krijgt: '14', geeftAf: [] }]);
    expect(ontvangstenVanRuil({ ...ruil, returnCode: 'VRIJ' })).toEqual([{ driverId: 'b', date: DAG, krijgt: '14', geeftAf: [] }]);
  });

  it('een oude ruil zonder dienst-info geeft niets te toetsen', () => {
    expect(ontvangstenVanRuil({ requesterId: 'c', targetDriverId: 'b', returnDate: DAG2, returnCode: '12' })).toEqual([]);
  });
});

describe('onbekendeCodeFout', () => {
  it('noemt de chauffeur, de dag en de code, en zegt wat de planner kan doen', () => {
    expect(onbekendeCodeFout('Bert', { date: DAG, dienst: 'FD' })).toBe(
      "Bert staat op 24/07/2026 op 'FD', en die code staat niet in het dienstoverzicht of de planningscodes. Voeg ze eerst toe in Planningscodes, dan weet het portaal of het een dienst is.",
    );
  });

  it('kwam een lijst leeg terug: niet "voeg de code toe", wel wat er echt aan de hand is (1c)', () => {
    expect(onbekendeCodeFout('Bert', { date: DAG, dienst: 'FD', bronLeeg: 'planningscodes' })).toBe(
      'De planningscodes kwamen leeg terug, dus het portaal kan niet nagaan of Bert op 24/07/2026 al een dienst rijdt. Er is niets gewijzigd. Kijk Planningscodes na en probeer opnieuw.',
    );
    expect(onbekendeCodeFout('Bert', { date: DAG, dienst: '13', bronLeeg: 'dienstoverzicht' })).toBe(
      'Het dienstoverzicht kwam leeg terug, dus het portaal kan niet nagaan of Bert op 24/07/2026 al een dienst rijdt. Er is niets gewijzigd. Kijk het Dienstoverzicht na en probeer opnieuw.',
    );
    expect(onbekendeCodeFout('Bert', { date: DAG, dienst: 'FD', bronLeeg: 'beide' })).toBe(
      'Het dienstoverzicht en de planningscodes kwamen leeg terug, dus het portaal kan niet nagaan of Bert op 24/07/2026 al een dienst rijdt. Er is niets gewijzigd. Kijk beide lijsten na en probeer opnieuw.',
    );
  });

  it('de app toont de melding zelf, ook bij een lange naam en een lange code', () => {
    // meldSchrijffout toont een servertekst alleen als die veilig en hoogstens
    // 240 tekens is; anders wordt het een algemene zin (src/lib/fouten.ts).
    const naam = 'Alexandra Vandenbroucke-Vanderstraeten';
    for (const bronLeeg of [undefined, 'dienstoverzicht', 'planningscodes', 'beide'] as const) {
      const tekst = onbekendeCodeFout(naam, { date: DAG, dienst: 'naar garage brengen', bronLeeg });
      expect(isVeiligeFouttekst(tekst), tekst).toBe(true);
      expect(leesFout({ status: 409, message: tekst }).tekst).toBe(tekst);
    }
    // Bij een lege lijst zegt de melding zelf wat te doen: er komt geen
    // "Iemand anders heeft dit intussen gewijzigd" achter.
    const leeg = onbekendeCodeFout(naam, { date: DAG, dienst: 'FD', bronLeeg: 'planningscodes' });
    expect(schrijffout('Dienstwissel', { status: 409, message: leeg })).toBe(`Dienstwissel is mislukt. ${leeg}`);
  });
});
