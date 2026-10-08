import { describe, expect, it } from 'vitest';
import { bouwPlanningUitMatrix } from '../api/storage';

/**
 * Dienstregelingversies in de planning-opbouw (08-10): per matrixdag telt de
 * versie die op die dag geldt, zodat een nieuwe dienstregeling alleen de
 * dagen vanaf haar datum raakt en het verleden zijn toenmalige tijden houdt.
 */
const users = [{ id: '3', name: 'Chauffeur A', role: 'chauffeur', isActive: true }] as any[];
const rij = (datum: string, code: string) => ({ id: `m-${datum}`, source_date: datum, day_type: 'week', assignments: { 'Chauffeur A': code }, raw_row: '' }) as any;
const sep = [{ id: 'd-sep', serviceNumber: '2101', startTime: '04:36', endTime: '07:52', loopnr: '4500', startTime2: '13:39', endTime2: '17:29', loopnr2: '4611' }] as any[];
const nov = [{ id: 'd-nov', serviceNumber: '2101', startTime: '04:40', endTime: '07:55', loopnr: '4500', startTime2: '13:30', endTime2: '17:20', loopnr2: '4612' }] as any[];
const versies = [
  { id: 'v-sep', geldigVanaf: '2026-09-01', services: sep },
  { id: 'v-nov', geldigVanaf: '2026-11-14', services: nov },
];

describe('bouwPlanningUitMatrix met dienstregelingversies', () => {
  it('neemt per dag de versie die op die dag geldt', () => {
    const { shifts } = bouwPlanningUitMatrix({ rows: [rij('2026-11-13', '2101'), rij('2026-11-14', '2101')], users, services: sep, versies, planningCodes: [] });
    const per = (datum: string) => shifts.filter((s) => s.date === datum).map((s) => `${s.startTime}-${s.endTime}/${s.loopnr}`);
    expect(per('2026-11-13')).toEqual(['04:36-07:52/4500', '13:39-17:29/4611']);
    expect(per('2026-11-14')).toEqual(['04:40-07:55/4500', '13:30-17:20/4612']);
  });

  it('vóór de eerste versie geldt de eerste; zonder versies de meegegeven lijst', () => {
    const vroeg = bouwPlanningUitMatrix({ rows: [rij('2026-03-01', '2101')], users, services: nov, versies, planningCodes: [] });
    expect(vroeg.shifts.map((s) => s.startTime)).toEqual(['04:36', '13:39']);
    const zonder = bouwPlanningUitMatrix({ rows: [rij('2026-12-01', '2101')], users, services: nov, versies: [], planningCodes: [] });
    expect(zonder.shifts.map((s) => s.startTime)).toEqual(['04:40', '13:30']);
  });

  it('een dienst die alleen in de nieuwe versie bestaat is vóór haar datum een onbekende code', () => {
    const metExtra = [{ id: 'v-sep', geldigVanaf: '2026-09-01', services: sep }, { id: 'v-jan', geldigVanaf: '2027-01-01', services: [...nov, { id: 'd-x', serviceNumber: '2199', startTime: '06:00', endTime: '14:00' }] }];
    const uit = bouwPlanningUitMatrix({ rows: [rij('2026-12-31', '2199'), rij('2027-01-01', '2199')], users, services: sep, versies: metExtra, planningCodes: [] });
    expect(uit.summary.unknownCodes).toEqual(['2199']);
    expect(uit.shifts.map((s) => s.date)).toEqual(['2027-01-01']);
  });
});
