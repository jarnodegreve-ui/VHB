import { describe, it, expect } from 'vitest';
import { bouwSolverVerzoek, dienstType, naarHHMM, normaliseerContracturen, segmentenVan, tekenVerzoek } from '../api/_lib/roosterSolver';

// Verbeterronde 07-09, nr. 13: het portaal bouwt het solve-verzoek zelf.
const services = [
  { id: 'd1', serviceNumber: '2101', startTime: '05:30', endTime: '13:30' },
  { id: 'd2', serviceNumber: '2607', startTime: '14:00', endTime: '22:30' },
  { id: 'd3', serviceNumber: '2900', startTime: '06:00', endTime: '09:30', startTime2: '15:00', endTime2: '18:30' },
  { id: 'd4', serviceNumber: '2999', startTime: '22:00', endTime: '02:05' },
] as any[];
const users = [
  { id: '1', name: 'Admin', role: 'admin', employeeId: 'VHB-1', isActive: true },
  { id: '42', name: 'Test Chauffeur', role: 'chauffeur', employeeId: 'VHB-42', isActive: true },
  { id: '43', name: 'Alex', role: 'chauffeur', employeeId: 'VHB-43', isActive: true, startDate: '2026-09-15' },
  { id: '44', name: 'Oud', role: 'chauffeur', employeeId: 'VHB-44', isActive: false },
] as any[];
const leave = [
  { id: 'l1', userId: '42', startDate: '2026-09-10', endDate: '2026-09-11', type: 'ziekte', status: 'approved', createdAt: '' },
  { id: 'l2', userId: '43', startDate: '2026-09-01', endDate: '2026-09-30', type: 'betaald_verlof', status: 'pending', createdAt: '' },
  { id: 'l3', userId: '44', startDate: '2026-09-10', endDate: '2026-09-10', type: 'betaald_verlof', status: 'approved', createdAt: '' },
] as any[];
const verwachtingen = {
  __weekdagen__: ['zondag', 'schooldag', 'schooldag', 'schooldag', 'schooldag', 'schooldag', 'zaterdag'],
  schooldag: ['2101', '2607', '2900', '0000'],
  zaterdag: ['2101'],
  zondag: [],
};

describe('roosterSolver: bouwstenen', () => {
  it('segmenten: tot drie blokken, over middernacht in 24+-notatie', () => {
    expect(segmentenVan(services[2])).toEqual([['06:00', '09:30'], ['15:00', '18:30']]);
    expect(segmentenVan(services[3])).toEqual([['22:00', '26:05']]);
  });
  it('dienstype uit de tijden', () => {
    expect(dienstType([['05:30', '13:30']])).toBe('V');
    expect(dienstType([['14:00', '22:30']])).toBe('L');
    expect(dienstType([['06:00', '09:30'], ['15:00', '18:30']])).toBe('G');
    expect(dienstType([['22:00', '26:05']])).toBe('N');
    expect(dienstType([['08:00', '16:00']])).toBe('D');
  });
  it('contracturen: 38, 38:00 en 38,5', () => {
    expect(normaliseerContracturen('38')).toBe('38:00');
    expect(normaliseerContracturen('38:00')).toBe('38:00');
    expect(normaliseerContracturen('38,5')).toBe('38:30');
    expect(normaliseerContracturen('abc')).toBeNull();
    expect(normaliseerContracturen('0')).toBeNull();
    expect(naarHHMM(1530)).toBe('25:30');
  });
});

describe('bouwSolverVerzoek', () => {
  const nu = new Date('2026-09-07T10:00:00Z');
  const { verzoek, waarschuwingen } = bouwSolverVerzoek({ van: '2026-09-07', tot: '2026-09-13', door: '1', contracturen: '38:00', rekentijdS: 45, users, services, leave, verwachtingen, nu });

  it('kalender en dagtypes volgen de weekdag-toewijzing', () => {
    expect(verzoek.kalender.map((k) => k.dagtype)).toEqual(['schooldag', 'schooldag', 'schooldag', 'schooldag', 'schooldag', 'zaterdag', 'zondag']);
    expect(verzoek.dagtypes.map((d) => [d.code, d.weekend])).toEqual([['schooldag', false], ['zaterdag', true], ['zondag', true]]);
  });
  it('diensten per dagtype uit het dienstoverzicht, onbekende nummers als waarschuwing', () => {
    expect(verzoek.diensten.map((d) => `${d.dagtype}:${d.code}`)).toEqual(['schooldag:2101', 'schooldag:2607', 'schooldag:2900', 'zaterdag:2101']);
    expect(verzoek.diensten[0]).toMatchObject({ type: 'V', segmenten: [['05:30', '13:30']], rijtijd: '06:45', voertuigtype: null });
    expect(waarschuwingen.some((w) => w.includes('0000'))).toBe(true);
    expect(waarschuwingen.some((w) => w.includes('zondag'))).toBe(true);
  });
  it('alleen actieve chauffeurs, code = personeelsnummer, actief_van uit startDate', () => {
    expect(verzoek.chauffeurs).toEqual([
      { code: 'VHB-42', naam: 'Test Chauffeur', contracturen: '38:00' },
      { code: 'VHB-43', naam: 'Alex', contracturen: '38:00', actief_van: '2026-09-15' },
    ]);
  });
  it('afwezigheden: alleen goedgekeurd, in de periode, van actieve chauffeurs, met de juiste reden', () => {
    expect(verzoek.afwezigheden).toEqual([{ chauffeur: 'VHB-42', van: '2026-09-10', tot: '2026-09-11', reden: 'ZIE' }]);
  });
  it('meta en config', () => {
    expect(verzoek.meta).toEqual({ uitgegeven: '2026-09-07T10:00:00.000Z', door: '1', van: '2026-09-07', tot: '2026-09-13', bron: 'vhb-portaal' });
    expect(verzoek.config).toEqual({ solver: { max_time_s: 45, workers: 4 } });
    expect(bouwSolverVerzoek({ van: '2026-09-07', tot: '2026-09-13', door: '1', contracturen: '38:00', rekentijdS: 999, users, services, leave, verwachtingen, nu }).verzoek.config.solver.max_time_s).toBe(120);
  });
  it('weigert een te lange of omgekeerde periode en een lege chauffeurslijst', () => {
    expect(() => bouwSolverVerzoek({ van: '2026-09-13', tot: '2026-09-07', door: '1', contracturen: '38:00', rekentijdS: 45, users, services, leave, verwachtingen, nu })).toThrow(/periode/i);
    expect(() => bouwSolverVerzoek({ van: '2026-01-01', tot: '2026-06-01', door: '1', contracturen: '38:00', rekentijdS: 45, users, services, leave, verwachtingen, nu })).toThrow(/negen weken/);
    expect(() => bouwSolverVerzoek({ van: '2026-09-07', tot: '2026-09-13', door: '1', contracturen: '38:00', rekentijdS: 45, users: [users[0]], services, leave, verwachtingen, nu })).toThrow(/chauffeurs/);
  });
  it('handtekening is HMAC-SHA256 over de exacte JSON', () => {
    const json = JSON.stringify(verzoek);
    expect(tekenVerzoek(json, 'geheim')).toMatch(/^sha256=[0-9a-f]{64}$/);
    expect(tekenVerzoek(json, 'geheim')).not.toBe(tekenVerzoek(`${json} `, 'geheim'));
  });
});
