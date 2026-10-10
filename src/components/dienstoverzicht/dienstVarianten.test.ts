import { describe, expect, it } from 'vitest';
import { dagtypeInGebruik, nieuweVariant, tijdenUitFormulier, valideerVarianten, variantenNaarFormulier, variantVeld } from './dienstVarianten';

const wo = { sleutel: 'a', dagtypes: ['23'], startTime: '06:30', endTime: '08:30', loopnr: '', startTime2: '12:00', endTime2: '14:00', loopnr2: '', startTime3: '', endTime3: '', loopnr3: '' };

describe('dienstVarianten', () => {
  it('vult een nieuwe afwijking met de gewone tijden en zonder dagtypes', () => {
    const v = nieuweVariant(tijdenUitFormulier({ serviceNumber: 'EEK6', startTime: '06:30', endTime: '08:30', startTime2: '15:00', endTime2: '17:00', loopnr: '', loopnr2: '4612' }));
    expect(v.dagtypes).toEqual([]);
    expect(v.startTime2).toBe('15:00');
    expect(v.loopnr2).toBe('4612');
    expect(v.startTime3).toBe('');
    expect(v.sleutel).toBeTruthy();
  });

  it('zet opgeslagen varianten om naar het formulier en terug', () => {
    const f = variantenNaarFormulier([{ dagtypes: ['23'], startTime: '06:30', endTime: '08:30', startTime2: '12:00', endTime2: '14:00' }]);
    expect(f).toHaveLength(1);
    expect(f[0].dagtypes).toEqual(['23']);
    expect(f[0].loopnr3).toBe('');
    const uit = valideerVarianten(f);
    expect(uit).toEqual({ ok: true, varianten: [{ dagtypes: ['23'], startTime: '06:30', endTime: '08:30', startTime2: '12:00', endTime2: '14:00' }] });
    expect(variantenNaarFormulier(undefined)).toEqual([]);
  });

  it('normaliseert tijden en laat lege loopnummers weg; zonder varianten is het resultaat undefined', () => {
    const uit = valideerVarianten([{ ...wo, startTime: '6:30', loopnr2: ' 4612 ' }]);
    expect(uit).toEqual({ ok: true, varianten: [{ dagtypes: ['23'], startTime: '06:30', endTime: '08:30', startTime2: '12:00', endTime2: '14:00', loopnr2: '4612' }] });
    expect(valideerVarianten([])).toEqual({ ok: true, varianten: undefined });
  });

  it('elke fout hangt aan het veld waar ze over gaat', () => {
    const uit = valideerVarianten([
      { ...wo, sleutel: 'a', dagtypes: [] },
      { ...wo, sleutel: 'b', dagtypes: ['24'], endTime2: '', startTime: '99:00' },
      { ...wo, sleutel: 'c', dagtypes: ['25'], startTime: '', endTime: '', startTime2: '', endTime2: '' },
      { ...wo, sleutel: 'd', dagtypes: ['24', '21'] },
    ]);
    expect(uit.ok).toBe(false);
    if (uit.ok) return;
    expect(uit.fouten[variantVeld('a', 'dagtypes')]).toMatch(/minstens één dagtype/);
    expect(uit.fouten[variantVeld('b', 'startTime')]).toMatch(/Ongeldige tijd/);
    expect(uit.fouten[variantVeld('b', 'endTime2')]).toBe('Vul ook de eindtijd in.');
    expect(uit.fouten[variantVeld('c', 'startTime')]).toMatch(/Minstens één deel/);
    expect(uit.fouten[variantVeld('d', 'dagtypes')]).toMatch(/afwijking 2/);
    expect(Object.keys(uit.fouten)).toHaveLength(5);
  });

  it('dagtypeInGebruik: per code de eerste afwijking die hem draagt', () => {
    const m = dagtypeInGebruik([{ ...wo, sleutel: 'a', dagtypes: ['23', '24'] }, { ...wo, sleutel: 'b', dagtypes: ['24', '31'] }]);
    expect([...m.entries()]).toEqual([['23', 0], ['24', 0], ['31', 1]]);
  });
});
