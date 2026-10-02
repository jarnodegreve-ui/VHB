// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { planningTijdFout } from '../api/_lib/planningTijden';
import { buildCalendar } from '../shared/ics';

/**
 * De tijden van een handmatige planning-save (beveiligingsscan 01-10): wat
 * POST /api/planning doorlaat, moet de agenda-feed ook kunnen schrijven.
 */
describe('planningTijdFout', () => {
  const rij = (over: Record<string, unknown> = {}) => ({ id: 'r1', date: '2026-10-05', line: '4103', driverId: '3', startTime: '05:11', endTime: '13:11', ...over });
  const FOUT = 'Ongeldige tijd in de planning bij dienst 4103: gebruik uu:mm, van 00:00 tot en met 47:59.';

  it.each(['00:00', '8:00', '08:00', '23:59', '24:00', '25:00', '26:16', '47:59'])('laat %s door, als start en als einde', (tijd) => {
    expect(planningTijdFout([rij({ startTime: tijd })], [])).toBeNull();
    expect(planningTijdFout([rij({ endTime: tijd })], [])).toBeNull();
  });

  it('een lege tijd blijft toegestaan: geen veld, null, lege tekst of alleen spaties', () => {
    expect(planningTijdFout([{ id: 'r1', date: '2026-10-05', line: '12', driverId: '3' }], [])).toBeNull();
    expect(planningTijdFout([rij({ startTime: '', endTime: '' })], [])).toBeNull();
    expect(planningTijdFout([rij({ startTime: null, endTime: undefined })], [])).toBeNull();
    expect(planningTijdFout([rij({ startTime: '  ', endTime: '' })], [])).toBeNull();
  });

  it.each(['Infinity:00', '1e300:00', '99999999:00', '48:00', '08:60', '08:75', '-1:00', 'abc', '8u00', '08:00:00', '1e1:00'])('weigert %s, als start en als einde', (tijd) => {
    expect(planningTijdFout([rij({ startTime: tijd })], [])).toBe(FOUT);
    expect(planningTijdFout([rij({ endTime: tijd })], [])).toBe(FOUT);
  });

  it('weigert een tijd die geen tekst is', () => {
    for (const tijd of [800, 8.5, true, ['08:00'], { uur: 8 }, Infinity]) {
      expect(planningTijdFout([rij({ startTime: tijd })], []), String(tijd)).toBe(FOUT);
    }
  });

  it('vindt de foute rij tussen de goede, en noemt de dienst (ingekort, zonder dienst geen naam)', () => {
    expect(planningTijdFout([rij(), rij({ id: 'r2', line: '2607', endTime: 'Infinity:00' }), rij({ id: 'r3' })], [])).toBe('Ongeldige tijd in de planning bij dienst 2607: gebruik uu:mm, van 00:00 tot en met 47:59.');
    expect(planningTijdFout([rij({ line: 'x'.repeat(500), startTime: '99:00' })], [])).toBe(`Ongeldige tijd in de planning bij dienst ${'x'.repeat(20)}: gebruik uu:mm, van 00:00 tot en met 47:59.`);
    expect(planningTijdFout([rij({ line: undefined, startTime: '99:00' })], [])).toBe('Ongeldige tijd in de planning: gebruik uu:mm, van 00:00 tot en met 47:59.');
  });

  it('een rij die al zo opgeslagen staat en ongewijzigd meekomt houdt de save niet tegen; een gewijzigde of nieuwe wel', () => {
    const oud = [rij({ id: 'oud', startTime: '08:00:00', endTime: '99:00' })];
    // De client stuurt altijd de hele lijst: de oude rij reist ongewijzigd mee.
    expect(planningTijdFout([...oud, rij({ id: 'nieuw' })], oud)).toBeNull();
    // Dezelfde rij met een andere (nog altijd foute) tijd is een wijziging.
    expect(planningTijdFout([rij({ id: 'oud', startTime: '08:00:00', endTime: '98:00' })], oud)).toBe(FOUT);
    // Een andere rij met dezelfde foute tijd is nieuw.
    expect(planningTijdFout([...oud, rij({ id: 'kopie', startTime: '08:00:00' })], oud)).toBe(FOUT);
    // De fout rechtzetten mag altijd.
    expect(planningTijdFout([rij({ id: 'oud', startTime: '08:00', endTime: '16:00' })], oud)).toBeNull();
  });

  it('rommel in de lijst (null, een tekst) breekt de controle niet', () => {
    expect(planningTijdFout([null, 'x', 5, rij()], [null])).toBeNull();
  });

  it('wat de controle doorlaat, schrijft de agenda-feed als een geldige gebeurtenis', () => {
    for (const [startTime, endTime] of [['08:00', '16:00'], ['23:59', '24:00'], ['25:00', '47:59'], ['8:00', '26:16'], [' 22:30 ', '06:15']]) {
      expect(planningTijdFout([rij({ startTime, endTime })], [])).toBeNull();
      const ics = buildCalendar([{ uid: 'u', date: '2026-10-05', startTime, endTime, summary: 'Dienst' }], { calName: 'VHB', dtstamp: '20261002T120000Z' });
      const tijden = ics.split('\r\n').filter((r) => /^DT(START|END):/.test(r));
      expect(tijden, `${startTime}-${endTime}`).toHaveLength(2);
      for (const regel of tijden) expect(regel).toMatch(/^DT(START|END):\d{8}T([01]\d|2[0-3])[0-5]\d00$/);
    }
  });
});
