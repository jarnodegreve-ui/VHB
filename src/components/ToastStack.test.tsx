import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ONGEDAAN_DUUR_MS, ToastStack, toastUitgang, type Toast } from './ToastStack';
import { DUR, EASE } from '../lib/motion';

// jsdom kent geen matchMedia (reduced-motion-check in ToastStack).
beforeEach(() => {
  window.matchMedia = window.matchMedia ?? (((query: string) => ({
    matches: false, media: query, onchange: null,
    addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia);
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame', 'performance'] });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const ongedaanToast = (run = vi.fn()): Toast => ({
  id: 1, message: 'Omleiding ‘Lijn 12’ verwijderd.', tone: 'success', ongedaan: true,
  action: { label: 'Ongedaan maken', run },
});

describe('ToastStack, ongedaan-variant', () => {
  it('toont de knop en voert bij klik de herstelactie uit + sluit', () => {
    const run = vi.fn();
    const onDismiss = vi.fn();
    render(<ToastStack toasts={[ongedaanToast(run)]} onDismiss={onDismiss} />);

    expect(screen.getByRole('status').textContent).toContain('Omleiding ‘Lijn 12’ verwijderd.');
    fireEvent.click(screen.getByRole('button', { name: 'Ongedaan maken' }));
    expect(run).toHaveBeenCalledTimes(1);
    expect(onDismiss).toHaveBeenCalledWith(1);
  });

  it('telt zelf af (6 s) en sluit dan', () => {
    const onDismiss = vi.fn();
    render(<ToastStack toasts={[ongedaanToast()]} onDismiss={onDismiss} />);

    act(() => { vi.advanceTimersByTime(50); }); // rAF → klok start
    act(() => { vi.advanceTimersByTime(ONGEDAAN_DUUR_MS - 100); });
    expect(onDismiss).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(200); });
    expect(onDismiss).toHaveBeenCalledWith(1);
  });

  it('pauzeert zolang de muis erop staat', () => {
    const onDismiss = vi.fn();
    render(<ToastStack toasts={[ongedaanToast()]} onDismiss={onDismiss} />);
    act(() => { vi.advanceTimersByTime(50); });

    const knop = screen.getByRole('button', { name: 'Ongedaan maken' });
    const kaart = knop.closest('.relative') as HTMLElement;
    fireEvent.mouseEnter(kaart);
    act(() => { vi.advanceTimersByTime(ONGEDAAN_DUUR_MS * 2); });
    expect(onDismiss).not.toHaveBeenCalled();

    fireEvent.mouseLeave(kaart);
    act(() => { vi.advanceTimersByTime(ONGEDAAN_DUUR_MS + 100); });
    expect(onDismiss).toHaveBeenCalledWith(1);
  });

  // Controle 05-09, nr. 12: een verdrongen ongedaan-toast (MAX_VISIBLE = 2)
  // bleef hangen en kwam later met een verse klok van 6 s terug.
  it('telt buiten beeld (verdrongen) gewoon door en sluit dan', () => {
    const onDismiss = vi.fn();
    render(
      <ToastStack
        toasts={[ongedaanToast(), { id: 2, message: 'Opgeslagen.', tone: 'success' }, { id: 3, message: 'Verstuurd.', tone: 'success' }]}
        onDismiss={onDismiss}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Ongedaan maken' })).toBeNull();
    act(() => { vi.advanceTimersByTime(50); });
    act(() => { vi.advanceTimersByTime(ONGEDAAN_DUUR_MS - 100); });
    expect(onDismiss).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(200); });
    expect(onDismiss).toHaveBeenCalledWith(1);
  });

  it('neemt de resterende tijd mee als de toast uit beeld valt en terugkomt', () => {
    const onDismiss = vi.fn();
    const undo = ongedaanToast();
    const n2: Toast = { id: 2, message: 'Opgeslagen.', tone: 'success' };
    const n3: Toast = { id: 3, message: 'Verstuurd.', tone: 'success' };
    const { rerender } = render(<ToastStack toasts={[undo]} onDismiss={onDismiss} />);
    act(() => { vi.advanceTimersByTime(50); });
    act(() => { vi.advanceTimersByTime(3000); }); // 3 s zichtbaar geweest

    // Verdrongen (AnimatePresence houdt de kaart nog even in de DOM voor de
    // exit-animatie — daarom hier geen DOM-assert, alleen de klok telt).
    rerender(<ToastStack toasts={[undo, n2, n3]} onDismiss={onDismiss} />);
    act(() => { vi.advanceTimersByTime(2000); }); // 2 s buiten beeld

    rerender(<ToastStack toasts={[undo, n2]} onDismiss={onDismiss} />); // terug in beeld
    expect(screen.getByRole('button', { name: 'Ongedaan maken' })).toBeTruthy();
    act(() => { vi.advanceTimersByTime(500); });
    expect(onDismiss).not.toHaveBeenCalled();
    // Nog ±1 s over — geen verse 6 s.
    act(() => { vi.advanceTimersByTime(700); });
    expect(onDismiss).toHaveBeenCalledWith(1);
  });

  it('gewone toasts blijven zonder ongedaan-knop en zonder eigen klok', () => {
    const onDismiss = vi.fn();
    render(<ToastStack toasts={[{ id: 2, message: 'Opgeslagen.', tone: 'success' }]} onDismiss={onDismiss} />);
    expect(screen.queryByRole('button', { name: 'Ongedaan maken' })).toBeNull();
    act(() => { vi.advanceTimersByTime(ONGEDAAN_DUUR_MS * 2); });
    expect(onDismiss).not.toHaveBeenCalled();
  });
});

// Ronde 6, punt 5: op de telefoon (onder md) staat de stapel onderaan boven
// het dock en komt een toast van onder; vanaf md rechtsboven en van boven.
// Weggeveegd gaat ze verder in de richting van de veeg, tot buiten de rand.
describe('ToastStack, beweging', () => {
  const metBreedte = (breed: boolean) => {
    window.matchMedia = ((query: string) => ({
      matches: query === '(min-width: 768px)' ? breed : false, media: query, onchange: null,
      addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
  };
  const vorige = window.matchMedia;
  afterEach(() => { window.matchMedia = vorige; });

  it('weggeveegd: verder in de richting van de veeg, een schermbreedte ver, vervagend op DUR.fast', () => {
    expect(toastUitgang(1, true, false, 390)).toEqual({ opacity: 0, x: 390, transition: { duration: DUR.fast, ease: EASE } });
    expect(toastUitgang(-1, true, false, 390)).toEqual({ opacity: 0, x: -390, transition: { duration: DUR.fast, ease: EASE } });
    // Vanaf md net zo: de veeg wint van de plaats van de stapel.
    expect(toastUitgang(1, false, false, 1280)).toMatchObject({ x: 1280 });
    expect(toastUitgang(-1, false, false, 1280)).toMatchObject({ x: -1280 });
  });

  it('niet weggeveegd: terug naar waar ze vandaan kwam (onder md naar onder, vanaf md naar boven)', () => {
    expect(toastUitgang(undefined, true, false, 390)).toEqual({ opacity: 0, y: 8, scale: 0.98 });
    expect(toastUitgang(undefined, false, false, 1280)).toEqual({ opacity: 0, y: -8, scale: 0.98 });
    expect(toastUitgang(0, true, false, 390)).toEqual({ opacity: 0, y: 8, scale: 0.98 });
  });

  it('minder beweging: alleen vervagen, ook na een veeg', () => {
    expect(toastUitgang(undefined, true, true, 390)).toEqual({ opacity: 0 });
    expect(toastUitgang(1, false, true, 1280)).toEqual({ opacity: 0 });
  });

  it('komt onder md van onder en vanaf md van boven binnen', () => {
    metBreedte(false);
    const { unmount } = render(<ToastStack toasts={[{ id: 7, message: 'Opgeslagen.', tone: 'success' }]} onDismiss={() => {}} />);
    expect(screen.getByRole('status').style.transform).toContain('translateY(8px)');
    unmount();
    metBreedte(true);
    render(<ToastStack toasts={[{ id: 8, message: 'Opgeslagen.', tone: 'success' }]} onDismiss={() => {}} />);
    expect(screen.getByRole('status').style.transform).toContain('translateY(-8px)');
  });
});
