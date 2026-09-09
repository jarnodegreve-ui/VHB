import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./supabase', () => ({ supabase: null }));

import { downloadBlob, type ToastEventDetail } from './ui';

/**
 * Controle-ronde 09-09, nr. 3: een export die eerst het bestand bij de server
 * ophaalt is in een geïnstalleerde PWA op iOS zijn user-gesture kwijt.
 * navigator.share gooit dan NotAllowedError; vroeger viel de code door naar
 * a.download (doet daar niets zichtbaars) en meldde toch "gedownload".
 */
const zetStandalone = (aan: boolean) => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn().mockImplementation((q: string) => ({ matches: aan && q.includes('standalone'), media: q })),
  });
};
const zetShare = (share?: (data: unknown) => Promise<void>) => {
  Object.defineProperty(navigator, 'share', { configurable: true, value: share });
  Object.defineProperty(navigator, 'canShare', { configurable: true, value: share ? () => true : undefined });
};
const fout = (name: string) => Object.assign(new Error(name), { name });

describe('downloadBlob', () => {
  let toasts: ToastEventDetail[] = [];
  const luister = (e: Event) => { toasts.push((e as CustomEvent<ToastEventDetail>).detail); };
  let klik: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    toasts = [];
    window.addEventListener('vhb-toast', luister);
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:test') });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
    klik = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
  });
  afterEach(() => {
    window.removeEventListener('vhb-toast', luister);
    klik.mockRestore();
    zetShare(undefined);
    zetStandalone(false);
  });

  const blob = new Blob(['x'], { type: 'text/plain' });

  it('browser-tab of desktop: klassieke download met bevestiging', async () => {
    zetStandalone(false);
    expect(await downloadBlob('export.xlsx', blob)).toBe('gedownload');
    expect(klik).toHaveBeenCalledTimes(1);
    expect(toasts.map((t) => t.tone)).toEqual(['success']);
  });

  it('standalone met geldige gesture: deelblad, geen download en geen eigen toast', async () => {
    zetStandalone(true);
    const share = vi.fn(async () => undefined);
    zetShare(share);
    expect(await downloadBlob('export.xlsx', blob)).toBe('gedeeld');
    expect(share).toHaveBeenCalledTimes(1);
    expect(klik).not.toHaveBeenCalled();
    expect(toasts).toEqual([]);
  });

  it('standalone, deelblad zelf gesloten: geen download, geen succes', async () => {
    zetStandalone(true);
    zetShare(vi.fn(async () => { throw fout('AbortError'); }));
    expect(await downloadBlob('export.xlsx', blob)).toBe('geannuleerd');
    expect(klik).not.toHaveBeenCalled();
    expect(toasts).toEqual([]);
  });

  it('standalone met verlopen gesture: geen valse succes-toast maar een Bewaren-knop die het deelblad alsnog opent', async () => {
    zetStandalone(true);
    const share = vi.fn<(data: unknown) => Promise<void>>()
      .mockRejectedValueOnce(fout('NotAllowedError'))
      .mockResolvedValueOnce(undefined);
    zetShare(share);
    expect(await downloadBlob('export.xlsx', blob)).toBe('wacht-op-tik');
    expect(klik).not.toHaveBeenCalled();
    expect(toasts).toHaveLength(1);
    expect(toasts[0].tone).toBe('info');
    expect(toasts[0].action?.label).toBe('Bewaren');
    // De tik op de knop is een verse gesture: het deelblad opent nu wel.
    toasts[0].action!.run();
    await Promise.resolve();
    expect(share).toHaveBeenCalledTimes(2);
  });

  it('Bewaren-knop: weigert het deelblad opnieuw, dan alsnog de klassieke download', async () => {
    zetStandalone(true);
    zetShare(vi.fn(async () => { throw fout('NotAllowedError'); }));
    await downloadBlob('export.xlsx', blob);
    toasts[0].action!.run();
    await new Promise((r) => setTimeout(r, 0));
    expect(klik).toHaveBeenCalledTimes(1);
  });
});
