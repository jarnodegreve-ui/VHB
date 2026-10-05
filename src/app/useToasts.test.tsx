import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const reportHandledError = vi.hoisted(() => vi.fn());
vi.mock('../lib/monitoring', () => ({ reportHandledError }));

import { TOESTEL_GEBLOKKEERD } from '../lib/api';
import { useToasts } from './useToasts';

/**
 * De toasts en de gebundelde laadfout, zoals ze tot 06-10 in App.tsx stonden.
 * Deze tests leggen het gedrag vast dat bij de verplaatsing gelijk moest
 * blijven: wat er getoond wordt, wat er onderdrukt wordt en wanneer iets
 * vanzelf verdwijnt.
 */
const opzet = () => {
  const sessieBeeindigdRef = { current: false };
  const toestelGeblokkeerdRef = { current: false };
  const opnieuwLaden = vi.fn();
  const hook = renderHook(() => useToasts({ sessieBeeindigdRef, toestelGeblokkeerdRef, opnieuwLaden }));
  return { hook, sessieBeeindigdRef, toestelGeblokkeerdRef, opnieuwLaden, nu: () => hook.result.current };
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-06T10:00:00Z'));
  reportHandledError.mockClear();
});
afterEach(() => { vi.useRealTimers(); });

describe('showToast', () => {
  it('toont een melding en haalt ze na 4,2 s weer weg; een fout blijft 10 s', () => {
    const { nu } = opzet();
    act(() => { nu().showToast('Opgeslagen.', 'success'); nu().showToast('Opslaan mislukt.', 'error'); });
    expect(nu().toasts.map((t) => t.message)).toEqual(['Opgeslagen.', 'Opslaan mislukt.']);
    act(() => { vi.advanceTimersByTime(4200); });
    expect(nu().toasts.map((t) => t.message)).toEqual(['Opslaan mislukt.']);
    act(() => { vi.advanceTimersByTime(5800); });
    expect(nu().toasts).toEqual([]);
  });

  it('stapelt dezelfde melding niet, een ongedaan-toast wel', () => {
    const { nu } = opzet();
    act(() => {
      nu().showToast('Planning bijgewerkt.', 'info');
      nu().showToast('Planning bijgewerkt.', 'info');
      nu().showToast('Verwijderd.', 'info', undefined, { ongedaan: true });
      nu().showToast('Verwijderd.', 'info', undefined, { ongedaan: true });
    });
    expect(nu().toasts.map((t) => t.message)).toEqual(['Planning bijgewerkt.', 'Verwijderd.', 'Verwijderd.']);
    // Een ongedaan-toast telt zelf af in ToastStack: de hook ruimt hem niet op.
    act(() => { vi.advanceTimersByTime(60_000); });
    expect(nu().toasts.map((t) => t.message)).toEqual(['Verwijderd.', 'Verwijderd.']);
  });

  it('elke toast krijgt een eigen id, en wegklikken haalt alleen die weg', () => {
    const { nu } = opzet();
    act(() => { nu().showToast('Een', 'info'); nu().showToast('Twee', 'info'); });
    const [een, twee] = nu().toasts;
    expect(een.id).not.toBe(twee.id);
    act(() => { nu().dismissToast(een.id); });
    expect(nu().toasts.map((t) => t.message)).toEqual(['Twee']);
  });

  it('een fout-toast gaat ook naar de monitoring, een info-toast niet', () => {
    const { nu } = opzet();
    act(() => { nu().showToast('Ter info.', 'info'); nu().showToast('Kon niet opslaan.', 'error'); });
    expect(reportHandledError).toHaveBeenCalledTimes(1);
    expect(reportHandledError).toHaveBeenCalledWith('Kon niet opslaan.');
  });

  it('sessie op uitloggen of toestel geblokkeerd: geen fout-toast en geen foutrapport, info wel', () => {
    for (const vlag of ['sessieBeeindigdRef', 'toestelGeblokkeerdRef'] as const) {
      const o = opzet();
      o[vlag].current = true;
      act(() => { o.nu().showToast('Kon de dienstruilen niet laden.', 'error'); o.nu().showToast('Tot ziens.', 'info'); });
      expect(o.nu().toasts.map((t) => t.message)).toEqual(['Tot ziens.']);
    }
    expect(reportHandledError).not.toHaveBeenCalled();
  });

  it('onderhoudsmodus: de info-toast is de melding, de rode toast binnen 3 s erna valt weg', () => {
    const { nu } = opzet();
    act(() => { nu().meldOnderhoud('Het portaal is even in onderhoud.'); nu().showToast('Opslaan mislukt.', 'error'); });
    expect(nu().toasts.map((t) => t.message)).toEqual(['Het portaal is even in onderhoud.']);
    expect(reportHandledError).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(3000); });
    act(() => { nu().showToast('Opslaan mislukt.', 'error'); });
    expect(nu().toasts.map((t) => t.message)).toContain('Opslaan mislukt.');
  });
});

describe('meldLaadfout: één melding voor alles wat tegelijk misging', () => {
  it('bundelt de bronnen van 400 ms tot één fout-toast met "Opnieuw proberen"', () => {
    const { nu, opnieuwLaden } = opzet();
    act(() => { nu().meldLaadfout('de planning'); nu().meldLaadfout('de dienstruilen'); nu().meldLaadfout('het verlof'); });
    expect(nu().toasts).toEqual([]);
    act(() => { vi.advanceTimersByTime(400); });
    expect(nu().toasts).toHaveLength(1);
    expect(nu().toasts[0]).toMatchObject({ message: 'Kon de planning, de dienstruilen en het verlof niet laden. Controleer je verbinding.', tone: 'error' });
    expect(nu().toasts[0].action?.label).toBe('Opnieuw proberen');
    nu().toasts[0].action?.run();
    expect(opnieuwLaden).toHaveBeenCalledTimes(1);
  });

  it('één bron: zonder opsomming, en dezelfde bron telt één keer', () => {
    const { nu } = opzet();
    act(() => { nu().meldLaadfout('de gebruikerslijst'); nu().meldLaadfout('de gebruikerslijst'); });
    act(() => { vi.advanceTimersByTime(400); });
    expect(nu().toasts.map((t) => t.message)).toEqual(['Kon de gebruikerslijst niet laden. Controleer je verbinding.']);
  });

  it('een toestel-fout geeft geen laadfout, een gewone fout ernaast wel', () => {
    const { nu } = opzet();
    act(() => { nu().meldLaadfout('de planning', { code: TOESTEL_GEBLOKKEERD }); });
    act(() => { vi.advanceTimersByTime(400); });
    expect(nu().toasts).toEqual([]);
    act(() => { nu().meldLaadfout('de planning', { code: TOESTEL_GEBLOKKEERD }); nu().meldLaadfout('het verlof', new Error('netwerk')); });
    act(() => { vi.advanceTimersByTime(400); });
    expect(nu().toasts.map((t) => t.message)).toEqual(['Kon het verlof niet laden. Controleer je verbinding.']);
  });

  it('na een beëindigde sessie komt er geen laadfout meer', () => {
    const o = opzet();
    o.sessieBeeindigdRef.current = true;
    act(() => { o.nu().meldLaadfout('het verlof'); });
    act(() => { vi.advanceTimersByTime(400); });
    expect(o.nu().toasts).toEqual([]);
  });

  it('de sessie eindigt terwijl de bundel wacht: de melding komt niet meer', () => {
    const o = opzet();
    act(() => { o.nu().meldLaadfout('de planning'); });
    o.sessieBeeindigdRef.current = true;
    act(() => { vi.advanceTimersByTime(400); });
    expect(o.nu().toasts).toEqual([]);
  });
});

describe('wissen', () => {
  it('wisFouten (toestel geblokkeerd): wachtende laadfouten en fout-toasts weg, de rest blijft', () => {
    const { nu } = opzet();
    act(() => { nu().showToast('Opgeslagen.', 'success'); nu().showToast('Opslaan mislukt.', 'error'); nu().meldLaadfout('de planning'); });
    act(() => { nu().wisFouten(); });
    act(() => { vi.advanceTimersByTime(400); });
    expect(nu().toasts.map((t) => t.message)).toEqual(['Opgeslagen.']);
  });

  it('wisToasts (afmelden): alles weg', () => {
    const { nu } = opzet();
    act(() => { nu().showToast('Opgeslagen.', 'success'); nu().showToast('Verwijderd.', 'info', undefined, { ongedaan: true }); });
    act(() => { nu().wisToasts(); });
    expect(nu().toasts).toEqual([]);
  });
});
