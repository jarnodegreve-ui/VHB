/**
 * Dagtypekalender (11-10): de tabel dagtype_kalender door de echte opslaglaag,
 * met de upsert op datum (een tweede import overschrijft alleen haar dagen).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { getDagtypeKalender, schrijfDagtypeKalender } from '../api/storage';
import { leegDatabase } from './hulp';

beforeEach(leegDatabase);

describe('dagtype_kalender', () => {
  it('schrijft, leest terug (oplopend, met venster) en overschrijft per datum', async () => {
    expect(await schrijfDagtypeKalender([
      { datum: '2027-01-04', typedag: '21', maxVerlof: 2 },
      { datum: '2027-01-01', typedag: '28', maxVerlof: 0 },
      { datum: '2027-01-06', typedag: '23', maxVerlof: null },
    ], 'csv')).toBe(3);
    const alle = await getDagtypeKalender();
    expect(alle.map((d) => `${d.datum} ${d.typedag} ${d.maxVerlof} ${d.bron}`)).toEqual(['2027-01-01 28 0 csv', '2027-01-04 21 2 csv', '2027-01-06 23 null csv']);
    expect((await getDagtypeKalender({ van: '2027-01-02', tot: '2027-01-05' })).map((d) => d.datum)).toEqual(['2027-01-04']);

    await schrijfDagtypeKalender([{ datum: '2027-01-04', typedag: '31', maxVerlof: 7 }], 'hand');
    const na = await getDagtypeKalender();
    expect(na).toHaveLength(3);
    expect(na.find((d) => d.datum === '2027-01-04')).toMatchObject({ typedag: '31', maxVerlof: 7, bron: 'hand' });
  });

  it('de databank weigert een onbekende code en een verlofmaximum buiten 0 tot 200', async () => {
    await expect(schrijfDagtypeKalender([{ datum: '2027-01-04', typedag: '99', maxVerlof: 2 }], 'csv')).rejects.toBeTruthy();
    await expect(schrijfDagtypeKalender([{ datum: '2027-01-04', typedag: '21', maxVerlof: 500 }], 'csv')).rejects.toBeTruthy();
    expect(await getDagtypeKalender()).toEqual([]);
  });
});
