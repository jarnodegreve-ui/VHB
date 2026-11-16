import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BESLIST_MS, KLIK_WACHT_MS, VAK_MARGE, binnenVak, plaatsVastgehouden, startStand, toonBeslist, type Vak } from './beslisteRijen';

// De vasthoudstand na een beslissing (ronde 6, punt 1): de rekenkern (welke
// rij staat waar) en de regel wanneer de stand loslaat. De DOM-tijdlijn in
// Verlof staat in e2e/deeplinks-verlof-beslissen.spec.ts.

const ids = (rijen: Array<{ id: string; vast: boolean }>) => rijen.map((r) => (r.vast ? `[${r.id}]` : r.id));

describe('plaatsVastgehouden: welke rij staat waar', () => {
  it('zonder vastgehouden rijen is het precies de huidige lijst (zoals vroeger)', () => {
    expect(ids(plaatsVastgehouden(['a', 'b', 'c'], ['x', 'a', 'c', 'b'], []))).toEqual(['a', 'b', 'c']);
    expect(ids(plaatsVastgehouden([], ['a'], []))).toEqual([]);
  });

  it('een rij die uit de lijst verdwijnt, blijft op haar plaats staan', () => {
    expect(ids(plaatsVastgehouden(['a', 'c'], ['a', 'b', 'c'], ['b']))).toEqual(['a', '[b]', 'c']);
    // Bovenaan en onderaan.
    expect(ids(plaatsVastgehouden(['b', 'c'], ['a', 'b', 'c'], ['a']))).toEqual(['[a]', 'b', 'c']);
    expect(ids(plaatsVastgehouden(['a', 'b'], ['a', 'b', 'c'], ['c']))).toEqual(['a', 'b', '[c]']);
    // De laatste rij van de lijst.
    expect(ids(plaatsVastgehouden([], ['a'], ['a']))).toEqual(['[a]']);
  });

  it('een rij die verschuift, staat tijdens de stand op haar oude plaats en maar één keer', () => {
    // b hoort nu achteraan (andere sortering na de beslissing).
    expect(ids(plaatsVastgehouden(['a', 'c', 'b'], ['a', 'b', 'c'], ['b']))).toEqual(['a', '[b]', 'c']);
    // Na de stand: waar de huidige lijst haar zet.
    expect(ids(plaatsVastgehouden(['a', 'c', 'b'], ['a', 'b', 'c'], []))).toEqual(['a', 'c', 'b']);
  });

  it('twee tegelijk (bulk): elk op zijn eigen plaats, ook als de eerste al eerder vastgehouden werd', () => {
    expect(ids(plaatsVastgehouden(['b'], ['a', 'b', 'c'], ['a', 'c']))).toEqual(['[a]', 'b', '[c]']);
    expect(ids(plaatsVastgehouden([], ['a', 'b'], ['b', 'a']))).toEqual(['[a]', '[b]']);
    // De eerste is voorbij, de tweede nog niet: de tweede blijft na zijn voorganger die er nog staat.
    expect(ids(plaatsVastgehouden(['b'], ['a', 'b', 'c'], ['c']))).toEqual(['b', '[c]']);
  });

  it('een rij die via een verversing intussen terugkwam, staat er nooit dubbel', () => {
    // b kwam elders terug in de lijst: één keer, op haar plaats van vóór de beslissing.
    const rijen = plaatsVastgehouden(['b', 'a', 'c'], ['a', 'b', 'c'], ['b']);
    expect(ids(rijen)).toEqual(['a', '[b]', 'c']);
    expect(new Set(rijen.map((r) => r.id)).size).toBe(rijen.length);
    // Een dubbel id in de bron zelf geeft ook maar één rij.
    expect(ids(plaatsVastgehouden(['a', 'a', 'b'], ['a', 'b'], []))).toEqual(['a', 'b']);
  });

  it('een nieuwe rij naast een vastgehouden rij: de vastgehouden blijft na haar voorganger', () => {
    expect(ids(plaatsVastgehouden(['a', 'n', 'c'], ['a', 'b', 'c'], ['b']))).toEqual(['a', '[b]', 'n', 'c']);
    // Haar voorganger verdween ook: dan na de voorganger daarvoor, of vooraan.
    expect(ids(plaatsVastgehouden(['c'], ['a', 'b', 'c'], ['b']))).toEqual(['[b]', 'c']);
  });

  it('wat de vorige keer niet getoond werd, heeft geen plaats om te houden', () => {
    expect(ids(plaatsVastgehouden(['a', 'b'], ['a'], ['b']))).toEqual(['a', 'b']);
    expect(ids(plaatsVastgehouden(['a'], ['a'], ['z']))).toEqual(['a']);
  });
});

describe('toonBeslist: met de records', () => {
  type R = { id: string; status: string };
  const collectie: R[] = [{ id: 'a', status: 'pending' }, { id: 'b', status: 'approved' }, { id: 'c', status: 'pending' }];
  const zoek = (id: string) => collectie.find((r) => r.id === id);
  const wachtend = () => collectie.filter((r) => r.status === 'pending');

  it('een vastgehouden rij draagt het record zoals het nu in de collectie staat (de status van de server)', () => {
    const rijen = toonBeslist({ huidig: wachtend(), sleutel: (r) => r.id, vorige: ['a', 'b', 'c'], vast: ['b'], zoek });
    expect(rijen).toEqual([
      { record: { id: 'a', status: 'pending' }, vast: false },
      { record: { id: 'b', status: 'approved' }, vast: true },
      { record: { id: 'c', status: 'pending' }, vast: false },
    ]);
  });

  it('staat het record niet meer in de collectie, dan valt de rij weg', () => {
    const rijen = toonBeslist({ huidig: wachtend(), sleutel: (r) => r.id, vorige: ['a', 'x', 'c'], vast: ['x'], zoek });
    expect(rijen.map((r) => r.record.id)).toEqual(['a', 'c']);
  });

  it('zonder stand: de huidige lijst, record voor record', () => {
    const huidig = wachtend();
    const rijen = toonBeslist({ huidig, sleutel: (r) => r.id, vorige: [], vast: [], zoek });
    expect(rijen.map((r) => r.record)).toEqual(huidig);
    expect(rijen.every((r) => !r.vast)).toBe(true);
  });
});

describe('binnenVak', () => {
  const vak: Vak = { left: 100, top: 200, right: 300, bottom: 250 };
  it('telt de marge van 8 px mee, net erbuiten niet', () => {
    expect(VAK_MARGE).toBe(8);
    expect(binnenVak(vak, 150, 225)).toBe(true);
    expect(binnenVak(vak, 100 - 8, 200 - 8)).toBe(true);
    expect(binnenVak(vak, 300 + 8, 250 + 8)).toBe(true);
    expect(binnenVak(vak, 100 - 9, 225)).toBe(false);
    expect(binnenVak(vak, 150, 250 + 9)).toBe(false);
  });
});

describe('startStand: wanneer de stand loslaat', () => {
  const VAK_RIJ: Vak = { left: 0, top: 100, right: 400, bottom: 164 };
  const BINNEN = { clientX: 200, clientY: 130 };
  const BUITEN = { clientX: 200, clientY: 400 };
  let doel: EventTarget;
  let frames: Array<() => void>;
  let klaar: ReturnType<typeof vi.fn<() => void>>;

  beforeEach(() => {
    vi.useFakeTimers();
    doel = new EventTarget();
    frames = [];
    klaar = vi.fn<() => void>();
  });
  afterEach(() => { vi.useRealTimers(); });

  const start = (aanwijzer: boolean, vak: () => Vak | null = () => VAK_RIJ) => startStand({
    aanwijzer, vak, klaar, doel: doel as unknown as Window, frame: (fn) => { frames.push(fn); },
  });
  const wijzer = (soort: string, punt: { clientX: number; clientY: number }, pointerType = 'mouse') => {
    doel.dispatchEvent(new PointerEvent(soort, { ...punt, pointerType, bubbles: true }));
  };
  const klik = (punt: { clientX: number; clientY: number }) => doel.dispatchEvent(new MouseEvent('click', { ...punt, detail: 1 }));
  /** Een volledige tik van een vinger op `punt`, zoals een telefoon hem geeft (ook pointerleave en pointerout). */
  const tik = (punt: { clientX: number; clientY: number }) => {
    wijzer('pointerdown', punt, 'touch');
    wijzer('pointerup', punt, 'touch');
    wijzer('pointerout', punt, 'touch');
    wijzer('pointerleave', punt, 'touch');
    klik(punt);
  };

  it('alleen de tijd (toetsenbord, of de klik viel in een paneel): precies BESLIST_MS, één keer', () => {
    expect(BESLIST_MS).toBe(450);
    start(false);
    vi.advanceTimersByTime(BESLIST_MS - 1);
    expect(klaar).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(klaar).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(5000);
    expect(klaar).toHaveBeenCalledTimes(1);
  });

  it('stop: geen klaar meer, geen klok en geen luisteraar die doorloopt', () => {
    const toe = vi.spyOn(doel, 'addEventListener');
    const af = vi.spyOn(doel, 'removeEventListener');
    const stop = start(true);
    expect(toe.mock.calls.map((c) => [c[0], (c[2] as AddEventListenerOptions).capture])).toEqual([
      ['pointermove', true], ['pointerdown', true], ['pointerup', true], ['pointercancel', true], ['click', true],
    ]);
    stop();
    expect(af.mock.calls.map((c) => c[0])).toEqual(['pointermove', 'pointerdown', 'pointerup', 'pointercancel', 'click']);
    expect(vi.getTimerCount()).toBe(0);
    wijzer('pointermove', BUITEN);
    vi.advanceTimersByTime(5000);
    expect(klaar).not.toHaveBeenCalled();
    // Nooit pointerleave, pointerout of mouseleave.
    expect(toe.mock.calls.map((c) => c[0])).not.toEqual(expect.arrayContaining(['pointerleave']));
  });

  describe('de aanwijzerregel (de klik viel in de rij zelf)', () => {
    it('de muis blijft staan: de stand blijft, ook ruim na de tijd', () => {
      start(true);
      vi.advanceTimersByTime(10_000);
      expect(klaar).not.toHaveBeenCalled();
    });

    it('de muis beweegt binnen het vak (en in de marge): de stand blijft', () => {
      start(true);
      vi.advanceTimersByTime(BESLIST_MS);
      wijzer('pointermove', BINNEN);
      wijzer('pointermove', { clientX: 404, clientY: 170 });
      vi.advanceTimersByTime(1000);
      expect(klaar).not.toHaveBeenCalled();
    });

    it('de muis verlaat het vak na de tijd: meteen los', () => {
      start(true);
      vi.advanceTimersByTime(BESLIST_MS + 200);
      wijzer('pointermove', BUITEN);
      expect(klaar).toHaveBeenCalledTimes(1);
    });

    it('de muis verlaat het vak vóór de tijd: los als de tijd om is, niet eerder', () => {
      start(true);
      vi.advanceTimersByTime(100);
      wijzer('pointermove', BUITEN);
      expect(klaar).not.toHaveBeenCalled();
      vi.advanceTimersByTime(BESLIST_MS - 100);
      expect(klaar).toHaveBeenCalledTimes(1);
    });

    it('een vinger die bewoog (pointermove van een aanraking) telt niet als weg', () => {
      start(true);
      vi.advanceTimersByTime(BESLIST_MS);
      wijzer('pointermove', BUITEN, 'touch');
      vi.advanceTimersByTime(1000);
      expect(klaar).not.toHaveBeenCalled();
    });

    it('een aanraking in het vak met pointerup gevolgd door pointerleave: de stand blijft', () => {
      start(true);
      tik(BINNEN);
      vi.advanceTimersByTime(BESLIST_MS + 2000);
      expect(klaar).not.toHaveBeenCalled();
    });

    it('een pointerdown buiten het vak lost de stand pas na de click van die tik', () => {
      start(true);
      vi.advanceTimersByTime(BESLIST_MS + 50);
      wijzer('pointerdown', BUITEN, 'touch');
      expect(klaar).not.toHaveBeenCalled();
      wijzer('pointerup', BUITEN, 'touch');
      vi.advanceTimersByTime(KLIK_WACHT_MS - 1);
      expect(klaar, 'de click van de tik is er nog niet').not.toHaveBeenCalled();
      klik(BUITEN);
      expect(klaar, 'tijdens de click zelf nog niet: eerst landt die op wat getikt werd').not.toHaveBeenCalled();
      vi.advanceTimersByTime(0);
      expect(klaar).toHaveBeenCalledTimes(1);
    });

    it('een tik buiten het vak vóór de tijd om is: los zodra de tijd om is', () => {
      start(true);
      vi.advanceTimersByTime(100);
      tik(BUITEN);
      vi.advanceTimersByTime(0);
      expect(klaar).not.toHaveBeenCalled();
      vi.advanceTimersByTime(BESLIST_MS - 100);
      expect(klaar).toHaveBeenCalledTimes(1);
    });

    it('een pointerup zonder click: los na KLIK_WACHT_MS; een afgebroken gebaar (scrollen): los na een beeld', () => {
      start(true);
      vi.advanceTimersByTime(BESLIST_MS);
      wijzer('pointerdown', BUITEN, 'touch');
      wijzer('pointerup', BUITEN, 'touch');
      vi.advanceTimersByTime(KLIK_WACHT_MS - 1);
      expect(klaar).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(klaar).toHaveBeenCalledTimes(1);

      klaar.mockClear();
      start(true);
      vi.advanceTimersByTime(BESLIST_MS);
      wijzer('pointerdown', BUITEN, 'touch');
      wijzer('pointercancel', BUITEN, 'touch');
      expect(klaar).not.toHaveBeenCalled();
      frames.splice(0).forEach((fn) => fn());
      expect(klaar).toHaveBeenCalledTimes(1);
    });

    it('het vak is er niet meer: elke aanwijzer telt als weg', () => {
      start(true, () => null);
      vi.advanceTimersByTime(BESLIST_MS);
      wijzer('pointermove', BINNEN);
      expect(klaar).toHaveBeenCalledTimes(1);
    });

    it('het vak wordt live gelezen: verschoof het, dan telt de nieuwe plaats', () => {
      let vak: Vak = VAK_RIJ;
      start(true, () => vak);
      vi.advanceTimersByTime(BESLIST_MS);
      vak = { left: 0, top: 380, right: 400, bottom: 444 };
      wijzer('pointermove', BUITEN);
      expect(klaar).not.toHaveBeenCalled();
      wijzer('pointermove', BINNEN);
      expect(klaar).toHaveBeenCalledTimes(1);
    });
  });

  describe('alleen de tijd, maar nooit midden in een tik', () => {
    it('de tijd loopt af terwijl een vinger neer is: los pas na de click van die tik', () => {
      start(false);
      vi.advanceTimersByTime(BESLIST_MS - 50);
      wijzer('pointerdown', BUITEN, 'touch');
      vi.advanceTimersByTime(200);
      expect(klaar, 'de vinger is nog neer').not.toHaveBeenCalled();
      wijzer('pointerup', BUITEN, 'touch');
      klik(BUITEN);
      expect(klaar).not.toHaveBeenCalled();
      vi.advanceTimersByTime(0);
      expect(klaar).toHaveBeenCalledTimes(1);
    });

    it('een tik die vóór het einde volledig geland is, verlengt niets', () => {
      start(false);
      vi.advanceTimersByTime(100);
      tik(BUITEN);
      vi.advanceTimersByTime(0);
      vi.advanceTimersByTime(BESLIST_MS - 100);
      expect(klaar).toHaveBeenCalledTimes(1);
    });

    it('een muis die beweegt of een toets: alleen de tijd', () => {
      start(false);
      wijzer('pointermove', BINNEN);
      doel.dispatchEvent(new MouseEvent('click', { detail: 0 }));
      vi.advanceTimersByTime(BESLIST_MS);
      expect(klaar).toHaveBeenCalledTimes(1);
    });

    it('een tweede tik tijdens het wachten op de click van de eerste: de stand wacht op de laatste', () => {
      start(false);
      vi.advanceTimersByTime(BESLIST_MS - 10);
      wijzer('pointerdown', BUITEN, 'touch');
      wijzer('pointerup', BUITEN, 'touch');
      wijzer('pointerdown', BINNEN, 'touch');
      vi.advanceTimersByTime(KLIK_WACHT_MS + 50);
      expect(klaar, 'het vangnet van de eerste tik geldt niet meer').not.toHaveBeenCalled();
      wijzer('pointerup', BINNEN, 'touch');
      klik(BINNEN);
      vi.advanceTimersByTime(0);
      expect(klaar).toHaveBeenCalledTimes(1);
    });
  });
});
