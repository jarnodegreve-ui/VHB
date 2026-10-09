import { describe, expect, it } from 'vitest';
import { bouwPlanningUitMatrix, getServiceSegments } from '../api/storage';
import { kalenderUitDekking } from '../shared/dagtype';

/**
 * Afwijkende tijden per dagtype in de planning-opbouw (10-10): de schoolrit
 * EEK6 rijdt op een woensdag schooldag (dagtype 23) een korter namiddagdeel.
 * Het dagtype komt uit de matrixkolom day_type, anders uit de
 * dekkingskalender en de weekdag.
 */
const users = [{ id: '7', name: 'Jelle School', role: 'chauffeur', isActive: true }] as any[];
const rij = (datum: string, dagtype: string, code = 'EEK6') => ({ id: `m-${datum}`, source_date: datum, day_type: dagtype, assignments: { 'Jelle School': code }, raw_row: '' }) as any;
const eek6 = {
  id: 'd-eek6', serviceNumber: 'EEK6', startTime: '07:10', endTime: '08:40', startTime2: '15:20', endTime2: '16:50',
  varianten: [{ dagtypes: ['23'], startTime: '07:10', endTime: '08:40', startTime2: '11:50', endTime2: '13:20' }],
} as any;
const tijden = (shifts: Array<{ date: string; startTime: string; endTime: string }>, datum: string) =>
  shifts.filter((s) => s.date === datum).map((s) => `${s.startTime}-${s.endTime}`);

describe('bouwPlanningUitMatrix met afwijkingen per dagtype', () => {
  it('neemt op dagtype 23 de woensdagtijden, op de andere schooldagen de gewone', () => {
    const { shifts, summary } = bouwPlanningUitMatrix({
      rows: [rij('2026-10-13', '22'), rij('2026-10-14', '23'), rij('2026-10-15', '24')], users, services: [eek6], planningCodes: [],
    });
    expect(tijden(shifts, '2026-10-13')).toEqual(['07:10-08:40', '15:20-16:50']);
    expect(tijden(shifts, '2026-10-14')).toEqual(['07:10-08:40', '11:50-13:20']);
    expect(tijden(shifts, '2026-10-15')).toEqual(['07:10-08:40', '15:20-16:50']);
    expect(summary.matchedServices).toBe(3);
    expect(summary.unknownCodes).toEqual([]);
  });

  it('zonder dagtype in de matrix: de weekdag beslist (woensdag = 23), en de kalender kan er een vakantiedag van maken', () => {
    const zonder = bouwPlanningUitMatrix({ rows: [rij('2026-10-14', '')], users, services: [eek6], planningCodes: [] });
    expect(tijden(zonder.shifts, '2026-10-14')).toEqual(['07:10-08:40', '11:50-13:20']);
    // Herfstvakantie als uitzondering in de dekking: woensdag 28/10 wordt 33, en 33 heeft geen afwijking.
    const kalender = kalenderUitDekking({ __uitzonderingen__: ['2026-10-26..2026-10-30|vakantie'] });
    const vakantie = bouwPlanningUitMatrix({ rows: [rij('2026-10-28', ''), rij('2026-10-14', '')], users, services: [eek6], planningCodes: [], kalender });
    expect(tijden(vakantie.shifts, '2026-10-28')).toEqual(['07:10-08:40', '15:20-16:50']);
    expect(tijden(vakantie.shifts, '2026-10-14')).toEqual(['07:10-08:40', '11:50-13:20']);
  });

  it('de rij-id en het dienstnummer blijven die van de dienst, ook met een afwijking', () => {
    const { shifts } = bouwPlanningUitMatrix({ rows: [rij('2026-10-14', '23')], users, services: [eek6], planningCodes: [] });
    expect(shifts.map((s) => s.id)).toEqual(['2026-10-14-7-EEK6-1', '2026-10-14-7-EEK6-2']);
    expect(shifts.every((s) => s.line === 'EEK6')).toBe(true);
  });
});

describe('getServiceSegments met dagtype', () => {
  it('geeft de blokken van de afwijking, en zonder dagtype de gewone', () => {
    expect(getServiceSegments(eek6, '23').map((s) => `${s.startTime}-${s.endTime}`)).toEqual(['07:10-08:40', '11:50-13:20']);
    expect(getServiceSegments(eek6).map((s) => `${s.startTime}-${s.endTime}`)).toEqual(['07:10-08:40', '15:20-16:50']);
    expect(getServiceSegments(eek6, '31').map((s) => s.segment)).toEqual([1, 2]);
  });
});
