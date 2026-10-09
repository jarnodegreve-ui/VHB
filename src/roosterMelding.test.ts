// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

const pushes: Array<{ ids: string[]; payload: any }> = [];
vi.mock('../api/push.js', () => ({ sendPushToUsers: async (ids: string[], payload: any) => { pushes.push({ ids, payload }); } }));

const {
  gewijzigdeDagen, gewijzigdeDagenPerChauffeur, importPushTekst, roosterAfdrukken, roosterDagAfdrukken, roosterPushTekst, verstuurRoosterPushes,
} = await import('../api/_lib/roosterMelding');

const rij = (driverId: string, date: string, line: string, startTime = '06:00', endTime = '14:00') => ({ driverId, date, line, startTime, endTime, loopnr: '1', busNumber: '' });

/**
 * Gerichte roostermeldingen (09-10): de melding noemt de gewijzigde dag of
 * dagen en gaat alleen naar wie echt iets ziet veranderen.
 */
describe('roosterDagAfdrukken en gewijzigdeDagen', () => {
  it('een andere tijd op één dag geeft alleen die dag, en alleen bij die chauffeur', () => {
    const oud = roosterDagAfdrukken([rij('3', '2026-10-14', '12'), rij('3', '2026-10-15', '12'), rij('4', '2026-10-14', '14')]);
    const nieuw = roosterDagAfdrukken([rij('3', '2026-10-14', '12', '06:30'), rij('3', '2026-10-15', '12'), rij('4', '2026-10-14', '14')]);
    expect(gewijzigdeDagenPerChauffeur(oud, nieuw)).toEqual(new Map([['3', ['2026-10-14']]]));
  });

  it('een dag erbij of weg telt als gewijzigd, ook bij een chauffeur die geen diensten meer heeft', () => {
    const oud = roosterDagAfdrukken([rij('3', '2026-10-14', '12'), rij('4', '2026-10-16', '14')]);
    const nieuw = roosterDagAfdrukken([rij('3', '2026-10-14', '12'), rij('3', '2026-10-17', '12')]);
    expect(gewijzigdeDagenPerChauffeur(oud, nieuw)).toEqual(new Map([['3', ['2026-10-17']], ['4', ['2026-10-16']]]));
    expect(gewijzigdeDagen(undefined, undefined)).toEqual([]);
  });

  it('de volgorde van de rijen en een gesplitste dienst maken geen verschil', () => {
    const a = roosterDagAfdrukken([rij('3', '2026-10-14', '12', '06:00', '10:00'), rij('3', '2026-10-14', '12', '14:00', '18:00')]);
    const b = roosterDagAfdrukken([rij('3', '2026-10-14', '12', '14:00', '18:00'), rij('3', '2026-10-14', '12', '06:00', '10:00')]);
    expect(a.get('3')).toEqual(b.get('3'));
    expect(gewijzigdeDagen(a.get('3'), b.get('3'))).toEqual([]);
  });

  it('de oude afdruk van het hele rooster blijft stabiel (wachtrij van vóór 09-10)', () => {
    const rows = [rij('3', '2026-10-14', '12'), rij('3', '2026-10-15', '12')];
    expect(roosterAfdrukken(rows).get('3')).toHaveLength(32);
    expect(roosterAfdrukken(rows).get('3')).toBe(roosterAfdrukken([...rows].reverse()).get('3'));
  });
});

describe('roosterPushTekst', () => {
  it('noemt tot drie dagen voluit, daarboven het aantal met de eerste en de laatste dag', () => {
    expect(roosterPushTekst([])).toBe('Je rooster is gewijzigd, bekijk je diensten.');
    expect(roosterPushTekst(['2026-10-14'])).toBe('Je rooster is gewijzigd op 14/10/2026. Bekijk je diensten.');
    expect(roosterPushTekst(['2026-10-15', '2026-10-14'])).toBe('Je rooster is gewijzigd op 14/10/2026 en 15/10/2026. Bekijk je diensten.');
    expect(roosterPushTekst(['2026-10-14', '2026-10-15', '2026-10-17'])).toBe('Je rooster is gewijzigd op 14/10/2026, 15/10/2026 en 17/10/2026. Bekijk je diensten.');
    expect(roosterPushTekst(['2026-10-14', '2026-10-15', '2026-10-17', '2026-10-31'])).toBe('Je rooster is gewijzigd op 4 dagen tussen 14/10/2026 en 31/10/2026. Bekijk je diensten.');
  });

  it('na een import: een verse periode zegt dat de planning klaarstaat, een bestaande noemt de dagen', () => {
    expect(importPushTekst({ hadDiensten: false, dagen: ['2026-11-02'], van: '2026-11-01', tot: '2026-11-30' })).toBe('Je planning van 01/11/2026 t/m 30/11/2026 staat klaar. Bekijk je rooster.');
    expect(importPushTekst({ hadDiensten: true, dagen: ['2026-11-02'], van: '2026-11-01', tot: '2026-11-30' })).toBe('Je rooster is gewijzigd op 02/11/2026. Bekijk je diensten.');
  });
});

describe('verstuurRoosterPushes', () => {
  it('bundelt chauffeurs met dezelfde tekst in één verzending en telt de chauffeurs', async () => {
    pushes.length = 0;
    const aantal = await verstuurRoosterPushes(new Map([['3', ['2026-10-14']], ['4', ['2026-10-14']], ['5', ['2026-10-15']]]));
    expect(aantal).toBe(3);
    expect(pushes.map((p) => [p.ids, p.payload.body])).toEqual([
      [['3', '4'], 'Je rooster is gewijzigd op 14/10/2026. Bekijk je diensten.'],
      [['5'], 'Je rooster is gewijzigd op 15/10/2026. Bekijk je diensten.'],
    ]);
    expect(pushes[0].payload).toMatchObject({ title: 'Rooster bijgewerkt', soort: 'planning', url: '/?view=rooster' });
  });

  it('niets te melden = geen verzending', async () => {
    pushes.length = 0;
    expect(await verstuurRoosterPushes(new Map())).toBe(0);
    expect(pushes).toEqual([]);
  });
});
