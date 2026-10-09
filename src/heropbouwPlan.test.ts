// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { bouwHeropbouwPlan, planSamenvatting } from '../shared/heropbouwPlan';

const rij = (driverId: string, date: string, line: string, startTime = '06:00', endTime = '14:00', loopnr = '') => ({ driverId, date, line, startTime, endTime, loopnr });
const namen = new Map([['3', 'Chauffeur A'], ['4', 'Chauffeur B']]);
const basis = { namen, dagenInMatrix: 2, periode: { van: '2026-10-14', tot: '2026-10-15' }, ruilen: { toegepast: 1, nietToepasbaar: 0 } };

/**
 * Droge run van "Planning opnieuw opbouwen" (09-10): per chauffeur de dagen
 * die veranderen, met wat hij nu heeft en wat het wordt.
 */
describe('bouwHeropbouwPlan', () => {
  it('niets gewijzigd = geen chauffeurs in het plan', () => {
    const rows = [rij('3', '2026-10-14', '12'), rij('4', '2026-10-14', '14')];
    const plan = bouwHeropbouwPlan({ ...basis, vorige: rows, nieuw: [...rows].reverse() });
    expect(plan.chauffeurs).toEqual([]);
    expect(plan.totaal).toEqual({ chauffeurs: 0, dagen: 0, erbij: 0, weg: 0, gewijzigd: 0 });
    expect(plan.diensten).toBe(2);
    expect(planSamenvatting(plan)).toBe('geen wijzigingen');
  });

  it('een andere tijd, een dag erbij en een dag weg, per chauffeur op naam gesorteerd', () => {
    const vorige = [rij('4', '2026-10-14', '14'), rij('3', '2026-10-14', '12'), rij('3', '2026-10-15', '12')];
    const nieuw = [rij('4', '2026-10-14', '14', '06:30'), rij('3', '2026-10-14', '12'), rij('4', '2026-10-15', '15')];
    const plan = bouwHeropbouwPlan({ ...basis, vorige, nieuw });
    expect(plan.chauffeurs.map((c) => c.naam)).toEqual(['Chauffeur A', 'Chauffeur B']);
    expect(plan.chauffeurs[0].dagen).toEqual([
      { dag: '2026-10-15', was: ['dienst 12, 06:00 tot 14:00'], wordt: [], soort: 'weg' },
    ]);
    expect(plan.chauffeurs[1].dagen).toEqual([
      { dag: '2026-10-14', was: ['dienst 14, 06:00 tot 14:00'], wordt: ['dienst 14, 06:30 tot 14:00'], soort: 'gewijzigd' },
      { dag: '2026-10-15', was: [], wordt: ['dienst 15, 06:00 tot 14:00'], soort: 'erbij' },
    ]);
    expect(plan.totaal).toEqual({ chauffeurs: 2, dagen: 3, erbij: 1, weg: 1, gewijzigd: 1 });
    expect(planSamenvatting(plan)).toBe('2 chauffeur(s), 3 dag(en) (1 erbij, 1 weg, 1 gewijzigd)');
  });

  it('een gesplitste dienst telt als één dag, het loopnummer staat in het label, een onbekende chauffeur krijgt zijn id', () => {
    const vorige = [rij('9', '2026-10-14', '12', '06:00', '10:00', '1'), rij('9', '2026-10-14', '12', '14:00', '18:00', '2')];
    const nieuw = [rij('9', '2026-10-14', '12', '06:00', '10:00', '1')];
    const plan = bouwHeropbouwPlan({ ...basis, vorige, nieuw });
    expect(plan.chauffeurs).toEqual([{
      id: '9', naam: 'Onbekend (9)',
      dagen: [{ dag: '2026-10-14', was: ['dienst 12, 06:00 tot 10:00 (loop 1)', 'dienst 12, 14:00 tot 18:00 (loop 2)'], wordt: ['dienst 12, 06:00 tot 10:00 (loop 1)'], soort: 'gewijzigd' }],
    }]);
  });

});
