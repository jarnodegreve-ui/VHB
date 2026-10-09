/**
 * Afwijkende diensttijden per dagtype (10-10): de kolom services.varianten
 * (jsonb) gaat heen en terug door de echte opslaglaag, en een versiekopie
 * neemt ze mee. Met een nagebootste opslag is een jsonb-kolom niet te
 * bewijzen; hier wel.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { createDienstregeling, getServicesData, saveServicesData } from '../api/storage';
import { leegDatabase } from './hulp';

beforeEach(leegDatabase);

const wo = { dagtypes: ['23'], startTime: '07:10', endTime: '08:40', startTime2: '11:50', endTime2: '13:20' };
const eek6 = { id: 'eek6', serviceNumber: 'EEK6', startTime: '07:10', endTime: '08:40', startTime2: '15:20', endTime2: '16:50', varianten: [wo] };
const lijn = { id: 'l2101', serviceNumber: '2101', startTime: '04:36', endTime: '07:52', loopnr: '4500' };

describe('services.varianten', () => {
  it('schrijft de afwijkingen en leest ze genormaliseerd terug; een dienst zonder heeft er geen', async () => {
    await saveServicesData([eek6, lijn]);
    const terug = (await getServicesData()).sort((a, b) => a.id.localeCompare(b.id));
    expect(terug.map((s) => s.id)).toEqual(['eek6', 'l2101']);
    expect(terug[0].varianten).toEqual([wo]);
    expect(terug[1].varianten).toBeUndefined();
  });

  it('onbekende codes en lege afwijkingen vallen weg bij het schrijven; een afwijking wissen maakt de kolom leeg', async () => {
    await saveServicesData([{ ...eek6, varianten: [{ dagtypes: ['99'], startTime: '01:00', endTime: '02:00' }, { ...wo, dagtypes: ['23', '23'] }] }]);
    expect((await getServicesData())[0].varianten).toEqual([wo]);
    await saveServicesData([{ ...eek6, varianten: [] }]);
    expect((await getServicesData())[0].varianten).toBeUndefined();
  });

  it('een versiekopie neemt de afwijkingen mee', async () => {
    const eerste = await createDienstregeling({ naam: 'september', geldigVanaf: '2026-09-01', opmerking: null, createdBy: null, kopieVanId: null });
    await saveServicesData([eek6], { versieId: eerste.id });
    const tweede = await createDienstregeling({ naam: 'november', geldigVanaf: '2026-11-14', opmerking: null, createdBy: null, kopieVanId: eerste.id });
    const kopie = await getServicesData({ versieId: tweede.id });
    expect(kopie).toHaveLength(1);
    expect(kopie[0].serviceNumber).toBe('EEK6');
    expect(kopie[0].varianten).toEqual([wo]);
    expect(kopie[0].id).not.toBe('eek6');
  });
});
