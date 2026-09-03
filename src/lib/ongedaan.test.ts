import { describe, expect, it, vi } from 'vitest';
import { metOngedaan, ONGEDAAN_FOUT, ONGEDAAN_LABEL, type OngedaanToast } from './ongedaan';

const laatsteActie = (toast: ReturnType<typeof vi.fn>) => {
  const [, , action] = toast.mock.calls[0] as Parameters<OngedaanToast>;
  return action!;
};

describe('metOngedaan', () => {
  it('voert uit en toont één ongedaan-toast met de knop', async () => {
    const toast = vi.fn();
    const uitvoeren = vi.fn(async () => true);
    const herstellen = vi.fn();

    const ok = await metOngedaan({ boodschap: 'Omleiding verwijderd.', uitvoeren, herstellen, toast });

    expect(ok).toBe(true);
    expect(uitvoeren).toHaveBeenCalledTimes(1);
    expect(toast).toHaveBeenCalledTimes(1);
    expect(toast).toHaveBeenCalledWith(
      'Omleiding verwijderd.',
      'success',
      expect.objectContaining({ label: ONGEDAAN_LABEL }),
      { ongedaan: true },
    );
    expect(herstellen).not.toHaveBeenCalled();
  });

  it('toont niets als uitvoeren mislukt (false)', async () => {
    const toast = vi.fn();
    const ok = await metOngedaan({ boodschap: 'x', uitvoeren: () => false, herstellen: vi.fn(), toast });
    expect(ok).toBe(false);
    expect(toast).not.toHaveBeenCalled();
  });

  it('synchroon uitvoeren zonder resultaat telt als gelukt', async () => {
    const toast = vi.fn();
    const ok = await metOngedaan({ boodschap: 'x', uitvoeren: () => { /* draft-mutatie */ }, herstellen: vi.fn(), toast });
    expect(ok).toBe(true);
    expect(toast).toHaveBeenCalledTimes(1);
  });

  it('klik op de knop herstelt; bij succes geen extra toast', async () => {
    const toast = vi.fn();
    const herstellen = vi.fn(async () => true);
    await metOngedaan({ boodschap: 'x', uitvoeren: () => true, herstellen, toast });

    laatsteActie(toast).run();
    await vi.waitFor(() => expect(herstellen).toHaveBeenCalledTimes(1));
    expect(toast).toHaveBeenCalledTimes(1);
  });

  it('herstellen geeft false → fout-toast', async () => {
    const toast = vi.fn();
    await metOngedaan({ boodschap: 'x', uitvoeren: () => true, herstellen: async () => false, toast });

    laatsteActie(toast).run();
    await vi.waitFor(() => expect(toast).toHaveBeenCalledTimes(2));
    expect(toast).toHaveBeenLastCalledWith(ONGEDAAN_FOUT, 'error');
  });

  it('herstellen gooit → fout-toast met eigen tekst, geen unhandled rejection', async () => {
    const stil = vi.spyOn(console, 'error').mockImplementation(() => {});
    const toast = vi.fn();
    await metOngedaan({
      boodschap: 'x',
      uitvoeren: () => true,
      herstellen: async () => { throw new Error('netwerk'); },
      toast,
      herstelFout: 'Kon de omleiding niet terugzetten.',
    });

    laatsteActie(toast).run();
    await vi.waitFor(() => expect(toast).toHaveBeenCalledTimes(2));
    expect(toast).toHaveBeenLastCalledWith('Kon de omleiding niet terugzetten.', 'error');
    stil.mockRestore();
  });

  it('herstellen die zelf meldt (void) krijgt geen extra toast', async () => {
    const toast = vi.fn();
    await metOngedaan({ boodschap: 'x', uitvoeren: () => true, herstellen: async () => { /* perRecord meldt zelf */ }, toast });
    laatsteActie(toast).run();
    await new Promise((r) => setTimeout(r, 0));
    expect(toast).toHaveBeenCalledTimes(1);
  });
});
