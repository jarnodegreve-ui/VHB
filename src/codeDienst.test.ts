import { describe, it, expect } from 'vitest';
import { dienstOpCel, maakCodeDienstToets } from '../api/_lib/codeDienst.js';
import { describeSwapCarry } from '../api/_lib/ruilRegels.js';
import { replayTekst } from '../api/_lib/planningHeropbouw.js';

/**
 * Code-diensten: werk dat op het bord als dienst staat maar alleen als
 * planningscode bestaat. Deze toetsen beslissen of de handmatige wissel het
 * bord als waarheid mag nemen (melding Jarno 28-09, EEK6).
 */
describe('maakCodeDienstToets', () => {
  const services = [{ serviceNumber: '2105' }, { serviceNumber: 'R12' }];
  const codes = [
    { code: 'eek6', category: 'service' },
    { code: 'bur', category: 'service' },
    { code: 'r12', category: 'service' },
    { code: 'bv', category: 'leave' },
    { code: 'ziek', category: 'absence' },
  ];
  const isCodeDienst = maakCodeDienstToets(services, codes);

  it('herkent een planningscode van de categorie dienst, in elke schrijfwijze', () => {
    expect(isCodeDienst('EEK6')).toBe(true);
    expect(isCodeDienst(' eek6 ')).toBe(true);
    expect(isCodeDienst('BUR')).toBe(true);
  });

  it('een afwezigheid, een onbekende code of niets is geen dienst', () => {
    expect(isCodeDienst('bv')).toBe(false);
    expect(isCodeDienst('ziek')).toBe(false);
    expect(isCodeDienst('EEK99')).toBe(false);
    expect(isCodeDienst('')).toBe(false);
    expect(isCodeDienst(undefined)).toBe(false);
  });

  it('het dienstoverzicht wint: een nummer dat daar staat is een gewone dienst', () => {
    expect(isCodeDienst('2105')).toBe(false);
    expect(isCodeDienst('r12')).toBe(false);
  });
});

describe('dienstOpCel', () => {
  const dienst = { code: 'EEK6', kind: 'service', label: 'Schoolrit', segments: [] };

  it('geeft de schrijfwijze van het bord terug', () => {
    expect(dienstOpCel(dienst, 'eek6')).toBe('EEK6');
  });

  it('vindt de dienst onder een afwezigheid', () => {
    expect(dienstOpCel({ code: 'ziek', kind: 'absence', label: 'Ziek', segments: [], hiddenService: 'EEK6' }, 'EEK6')).toBe('EEK6');
  });

  it('een andere dienst, een afwezigheid met dezelfde code of een lege cel draagt hem niet', () => {
    expect(dienstOpCel(dienst, 'EEK5')).toBeNull();
    expect(dienstOpCel({ code: 'EEK6', kind: 'absence', label: '', segments: [] }, 'EEK6')).toBeNull();
    expect(dienstOpCel(undefined, 'EEK6')).toBeNull();
    expect(dienstOpCel(dienst, '')).toBeNull();
  });
});

describe('describeSwapCarry, benen op het bord', () => {
  const swap = { shiftLine: 'EEK6', shiftDate: '2026-09-28', returnCode: '2105', returnDate: '2026-09-28' };

  it('0 rijen bij een code-dienst is geen waarschuwing', () => {
    const tekst = describeSwapCarry(swap, { offeredMoved: 0, returnMoved: null }, 'doorgevoerd', { aangeboden: true, terug: false });
    expect(tekst).toBe('Planning doorgevoerd: dienst EEK6 op 28/09/2026: code-dienst zonder rijen in de planning, op het bord doorgevoerd.');
  });

  it('0 rijen bij een gewone dienst blijft een waarschuwing', () => {
    expect(describeSwapCarry(swap, { offeredMoved: 0, returnMoved: null }, 'doorgevoerd')).toContain('LET OP');
    expect(describeSwapCarry(swap, { offeredMoved: 0, returnMoved: 0 }, 'teruggedraaid', { aangeboden: true, terug: false })).toContain('LET OP: terugruil 2105');
  });
});

describe('replayTekst', () => {
  it('noemt code-diensten apart en alleen als ze er zijn', () => {
    expect(replayTekst({ applied: 2, skipped: 0, alVerwerkt: 0, opBord: 0 })).toBe('2 goedgekeurde ruil(en) opnieuw doorgevoerd');
    expect(replayTekst({ applied: 2, skipped: 1, alVerwerkt: 1, opBord: 3 })).toBe('2 goedgekeurde ruil(en) opnieuw doorgevoerd, 1 al in de Excel verwerkt, 3 van een code-dienst op het bord (1 niet toepasbaar)');
  });
});
