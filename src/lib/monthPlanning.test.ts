import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiLijst = vi.hoisted(() => vi.fn());
vi.mock('./api', () => ({ apiLijst }));

import { fetchMonthPlanning, type Herkomst } from './monthPlanning';

/**
 * De herkomst van het maandbord (ronde 6, punt 22, deel 3): een antwoord uit
 * de cache van de service worker draagt `X-VHB-Bron: cache` en wordt door de
 * Maandplanning wel getoond maar niet onthouden. Het verzoek zelf en de fout
 * bij een niet-ok antwoord (apiLijst → foutUitAntwoord) blijven zoals ze waren.
 */
const bord = { month: '2026-11', dates: ['2026-11-02'], drivers: [], cells: {} };
const antwoord = (headers: Record<string, string> = {}) => ({ response: new Response('{}', { headers }), data: bord });

beforeEach(() => { apiLijst.mockReset(); });

describe('fetchMonthPlanning', () => {
  it('vraagt het bord van de maand en geeft het antwoord terug, met of zonder herkomst', async () => {
    apiLijst.mockResolvedValue(antwoord());
    await expect(fetchMonthPlanning('2026-11')).resolves.toBe(bord);
    expect(apiLijst).toHaveBeenCalledWith('/api/month-planning?month=2026-11');
  });

  it('meldt in de herkomst of het antwoord uit de cache van de service worker kwam', async () => {
    const herkomst: Herkomst = {};
    apiLijst.mockResolvedValueOnce(antwoord({ 'x-vhb-bron': 'cache' }));
    await fetchMonthPlanning('2026-11', herkomst);
    expect(herkomst.uitCache).toBe(true);
    apiLijst.mockResolvedValueOnce(antwoord());
    await fetchMonthPlanning('2026-11', herkomst);
    expect(herkomst.uitCache).toBe(false);
    apiLijst.mockResolvedValueOnce(antwoord({ 'X-VHB-Bron': 'net' }));
    await fetchMonthPlanning('2026-11', herkomst);
    expect(herkomst.uitCache).toBe(false);
  });

  it('bij een antwoord uit de cache ook het tijdstip van het oorspronkelijke antwoord (Date-kop), anders null', async () => {
    const herkomst: Herkomst = {};
    apiLijst.mockResolvedValueOnce(antwoord({ 'x-vhb-bron': 'cache', date: 'Wed, 28 Oct 2026 06:12:00 GMT' }));
    await fetchMonthPlanning('2026-11', herkomst);
    expect(herkomst.datum).toBe(Date.parse('2026-10-28T06:12:00Z'));
    apiLijst.mockResolvedValueOnce(antwoord({ 'x-vhb-bron': 'cache' }));
    await fetchMonthPlanning('2026-11', herkomst);
    expect(herkomst.datum).toBeNull();
    // Een vers antwoord: de server bevestigde het nu, de kop doet er niet toe.
    apiLijst.mockResolvedValueOnce(antwoord({ date: 'Wed, 28 Oct 2026 06:12:00 GMT' }));
    await fetchMonthPlanning('2026-11', herkomst);
    expect(herkomst.datum).toBeNull();
  });

  it('een niet-ok antwoord blijft een fout, en de herkomst blijft dan onaangeroerd', async () => {
    const herkomst: Herkomst = {};
    apiLijst.mockRejectedValueOnce(Object.assign(new Error('Serverfout'), { status: 500 }));
    await expect(fetchMonthPlanning('2026-11', herkomst)).rejects.toThrow('Serverfout');
    expect(herkomst.uitCache).toBeUndefined();
  });
});
