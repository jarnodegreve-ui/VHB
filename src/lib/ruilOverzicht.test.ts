import { describe, expect, it } from 'vitest';
import { MAX_PERIODE_DAGEN } from '../../shared/rapporten/periode';
import { MAX_RUIL_PERIODE_DAGEN, ruilOverzichtQuery, ruilPeriodeFout, ruilPeriodeUitUrl, standaardRuilPeriode } from './ruilOverzicht';

describe('ruiloverzicht: vrije periode op dienstdatum (16-10)', () => {
  it('standaard de lopende week, maandag t/m zondag', () => {
    expect(standaardRuilPeriode('2026-10-16')).toEqual({ van: '2026-10-12', tot: '2026-10-18' });
    expect(standaardRuilPeriode('2026-10-12')).toEqual({ van: '2026-10-12', tot: '2026-10-18' });
  });

  it('controleert de periode zoals de server (366 dagen)', () => {
    expect(MAX_RUIL_PERIODE_DAGEN).toBe(MAX_PERIODE_DAGEN);
    expect(ruilPeriodeFout({ van: '2028-01-01', tot: '2028-12-31' })).toBeNull();
    expect(ruilPeriodeFout({ van: '2026-11-01', tot: '2026-11-30' })).toBeNull();
    expect(ruilPeriodeFout({ van: '2026-11-01', tot: '2026-11-01' })).toBeNull();
    expect(ruilPeriodeFout({ van: '2026-01-01', tot: '2026-12-31' })).toBeNull();
    expect(ruilPeriodeFout({ van: '2026-01-01', tot: '2027-01-02' })).toMatch(/366 dagen/);
    expect(ruilPeriodeFout({ van: '2026-11-30', tot: '2026-11-01' })).toMatch(/vóór de begindatum/);
    expect(ruilPeriodeFout({ van: '', tot: '2026-11-01' })).toMatch(/begin- en een einddatum/);
  });

  it('URL heen en terug', () => {
    const q = ruilOverzichtQuery({ van: '2026-11-01', tot: '2026-11-30' });
    expect(q.toString()).toBe('ruiloverzicht-van=2026-11-01&ruiloverzicht-tot=2026-11-30');
    expect(ruilPeriodeUitUrl(q)).toEqual({ van: '2026-11-01', tot: '2026-11-30' });
  });

  it('een oude weeklink geeft de week van die dag; een ongeldige periode geeft niets', () => {
    expect(ruilPeriodeUitUrl(new URLSearchParams('ruiloverzicht-week=2026-10-16'))).toEqual({ van: '2026-10-12', tot: '2026-10-18' });
    expect(ruilPeriodeUitUrl(new URLSearchParams('ruiloverzicht-van=2026-11-30&ruiloverzicht-tot=2026-11-01'))).toBeNull();
    expect(ruilPeriodeUitUrl(new URLSearchParams('ruiloverzicht-van=2026-11-01'))).toBeNull();
    expect(ruilPeriodeUitUrl(new URLSearchParams('ruiloverzicht-week=morgen'))).toBeNull();
    expect(ruilPeriodeUitUrl(new URLSearchParams(''))).toBeNull();
  });
});
