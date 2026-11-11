import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { apiFetchMock, notifyMock, openPdfMock } = vi.hoisted(() => ({
  apiFetchMock: vi.fn(),
  notifyMock: vi.fn(),
  openPdfMock: vi.fn(),
}));
vi.mock('./api', () => ({ apiFetch: apiFetchMock }));
vi.mock('./ui', () => ({ notify: notifyMock, openPdfInNewTab: openPdfMock }));

import { RITBLAD_BUNDEL_EVENT, openRitblad, type RitbladBundelDetail } from './ritblad';

/**
 * Het rooster vraagt het blad van één dienst (ronde 6, 11-11): de gebeurtenis
 * draagt de bruikbare dienstnummers mee en de app opent de viewer daarop.
 * Zonder bruikbaar nummer blijft het de hele bundel, zoals voorheen.
 */
describe('openRitblad: het dienstnummer gaat mee naar de viewer', () => {
  let details: RitbladBundelDetail[];
  const luisteraar = (e: Event) => {
    e.preventDefault(); // de app bevestigt dat ze de viewer opent
    details.push((e as CustomEvent<RitbladBundelDetail>).detail);
  };

  beforeEach(() => {
    details = [];
    apiFetchMock.mockReset();
    notifyMock.mockReset();
    openPdfMock.mockReset();
    window.addEventListener(RITBLAD_BUNDEL_EVENT, luisteraar);
  });
  afterEach(() => window.removeEventListener(RITBLAD_BUNDEL_EVENT, luisteraar));

  it('een dienstnummer van drie of vier cijfers gaat mee, met de dag', async () => {
    await openRitblad('2026-11-12', ['2101']);
    await openRitblad('2026-11-13', [' 990 ']);
    expect(details).toEqual([
      { datum: '2026-11-12', dienstnummer: ['2101'] },
      { datum: '2026-11-13', dienstnummer: ['990'] },
    ]);
    expect(apiFetchMock).not.toHaveBeenCalled();
  });

  it('meerdere diensten op één dag gaan allemaal mee, elk één keer', async () => {
    await openRitblad('2026-11-12', ['2101', '2304', '2101']);
    expect(details).toEqual([{ datum: '2026-11-12', dienstnummer: ['2101', '2304'] }]);
  });

  it('zonder bruikbaar nummer (code-dienst, onbekend, leeg) blijft het de hele bundel', async () => {
    await openRitblad('2026-11-12', ['EEK']);
    await openRitblad('2026-11-12', ['--']);
    await openRitblad('2026-11-12', ['']);
    await openRitblad('2026-11-12', ['21011']);
    await openRitblad('2026-11-12', ['2101A']);
    await openRitblad('2026-11-12', []);
    await openRitblad('2026-11-12');
    await openRitblad();
    expect(details.map((d) => d.dienstnummer)).toEqual(Array(8).fill(undefined));
    expect(details[0].datum).toBe('2026-11-12');
    expect(details[7].datum).toBeUndefined();
  });

  it('een code naast een echt dienstnummer: alleen het bruikbare nummer gaat mee', async () => {
    await openRitblad('2026-11-12', ['BUR', '2101']);
    expect(details).toEqual([{ datum: '2026-11-12', dienstnummer: ['2101'] }]);
  });

  it('zonder luisteraar (geen app-schil) blijft de oude weg: de bundel extern openen', async () => {
    window.removeEventListener(RITBLAD_BUNDEL_EVENT, luisteraar);
    apiFetchMock.mockResolvedValue({ ok: true, json: async () => ({ url: 'https://x.supabase.co/bundel.pdf' }) });
    await openRitblad('2026-11-12', ['2101']);
    expect(apiFetchMock).toHaveBeenCalledWith('/api/ritblaadje?datum=2026-11-12', { cache: 'no-store' });
    expect(openPdfMock).toHaveBeenCalledWith('https://x.supabase.co/bundel.pdf');
  });
});
