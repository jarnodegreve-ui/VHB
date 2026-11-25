import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { AFSTAND, CONTROLE_MS, MARGE, WACHT_MS, geschikt, plaatsTip, startTipLaag, stopTipLaag } from './tipLaag';
import { useLaag } from './lagen';

/**
 * Tip-laag (ronde 6, punt 10): de title-wissel en het gedrag op een jsdom-DOM,
 * en de plaatsing als pure functie. Wat een echte browser vraagt (focus met
 * :focus-visible, de plaats in het venster, de chunk die op touch niet laadt)
 * staat in e2e/tooltip.spec.ts.
 */

const VENSTER = { width: 1440, height: 900 };

describe('plaatsTip', () => {
  const knop = { left: 700, top: 400, width: 32, height: 32 };
  const tip = { width: 80, height: 24 };

  it('gecentreerd boven de knop', () => {
    expect(plaatsTip(knop, tip, VENSTER)).toEqual({ left: 700 + 16 - 40, top: 400 - AFSTAND - 24, kant: 'boven' });
  });

  it('eronder als er boven geen plaats is (de topbar)', () => {
    const r = plaatsTip({ ...knop, top: 10 }, tip, VENSTER);
    expect(r).toEqual({ left: 676, top: 10 + 32 + AFSTAND, kant: 'onder' });
  });

  it('precies genoeg plaats boven: boven', () => {
    const top = MARGE + AFSTAND + tip.height;
    expect(plaatsTip({ ...knop, top }, tip, VENSTER).kant).toBe('boven');
    expect(plaatsTip({ ...knop, top: top - 1 }, tip, VENSTER).kant).toBe('onder');
  });

  it('past nergens: aan de ruimste kant', () => {
    const laag = { width: 400, height: 60 };
    expect(plaatsTip({ left: 100, top: 10, width: 32, height: 32 }, { width: 80, height: 40 }, laag).kant).toBe('onder');
    expect(plaatsTip({ left: 100, top: 20, width: 32, height: 32 }, { width: 80, height: 40 }, laag).kant).toBe('boven');
  });

  it('links geklemd op de marge', () => {
    expect(plaatsTip({ ...knop, left: 0 }, tip, VENSTER).left).toBe(MARGE);
  });

  it('rechts geklemd op de marge (knop aan de rechterrand)', () => {
    const r = plaatsTip({ ...knop, left: VENSTER.width - 34 }, tip, VENSTER);
    expect(r.left).toBe(VENSTER.width - MARGE - tip.width);
  });

  it('een venster smaller dan de tip: de tip begint op de marge', () => {
    expect(plaatsTip({ left: 100, top: 400, width: 32, height: 32 }, { width: 400, height: 24 }, { width: 300, height: 900 }).left).toBe(MARGE);
  });
});

describe('geschikt', () => {
  const knop = (attrs: Record<string, string>, disabled = false) => {
    const b = document.createElement('button');
    for (const [k, v] of Object.entries(attrs)) b.setAttribute(k, v);
    b.disabled = disabled;
    return b;
  };
  it('alleen een knop met title gelijk aan aria-label, niet uitgeschakeld', () => {
    expect(geschikt(knop({ 'aria-label': 'Bewerken', title: 'Bewerken' }))).toBe(true);
    expect(geschikt(knop({ 'aria-label': 'Vorige 2 weken', title: 'Je ziet de planning vanaf deze week' }))).toBe(false);
    expect(geschikt(knop({ 'aria-label': 'Bewerken', title: 'Bewerken' }, true))).toBe(false);
    expect(geschikt(knop({ 'aria-label': 'Bewerken' }))).toBe(false);
    expect(geschikt(knop({ title: 'Bewerken' }))).toBe(false);
    expect(geschikt(document.createElement('div'))).toBe(false);
    expect(geschikt(null)).toBe(false);
  });
});

describe('tip-laag op een DOM', () => {
  const VAK = { left: 600, top: 400, width: 32, height: 32 };
  let vak = { ...VAK };

  function maakKnop(label: string, attrs: Record<string, string> = {}) {
    const b = document.createElement('button');
    b.setAttribute('aria-label', label);
    b.setAttribute('title', attrs.title ?? label);
    b.innerHTML = '<svg><path d="M0 0"/></svg>';
    b.getBoundingClientRect = () => new DOMRect(vak.left, vak.top, vak.width, vak.height);
    document.body.appendChild(b);
    return b;
  }
  const tip = () => document.querySelector<HTMLElement>('[data-tip-laag]');
  const tipZichtbaar = () => !!tip() && !tip()!.hidden;

  function wijzer(type: string, doel: Element, opties: { naar?: Element | null; soort?: string } = {}) {
    const e = new MouseEvent(type, { bubbles: true, cancelable: true, relatedTarget: opties.naar ?? null });
    Object.defineProperty(e, 'pointerType', { value: opties.soort ?? 'mouse' });
    doel.dispatchEvent(e);
  }
  const wijs = (knop: Element, soort?: string) => wijzer('pointerover', knop, { soort });
  const verlaat = (knop: Element, naar: Element | null = document.body) => wijzer('pointerout', knop, { naar });

  beforeEach(() => {
    vi.useFakeTimers();
    vak = { ...VAK };
    document.body.innerHTML = '';
    startTipLaag();
  });
  afterEach(() => {
    stopTipLaag();
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('wijzen haalt de title weg, de tip komt na 300 ms, verlaten zet title = aria-label terug', () => {
    const knop = maakKnop('Bewerken');
    wijs(knop);
    expect(knop.hasAttribute('title')).toBe(false);
    vi.advanceTimersByTime(WACHT_MS - 1);
    expect(tipZichtbaar()).toBe(false);
    vi.advanceTimersByTime(1);
    expect(tipZichtbaar()).toBe(true);
    expect(tip()!.textContent).toBe('Bewerken');
    expect(tip()!.getAttribute('aria-hidden')).toBe('true');
    expect(tip()!.parentElement).toBe(document.body);
    expect(tip()!.className).toContain('z-tip');
    verlaat(knop);
    expect(tipZichtbaar()).toBe(false);
    expect(knop.getAttribute('title')).toBe('Bewerken');
  });

  it('verlaten vóór de 300 ms: geen tip, en de title staat er weer', () => {
    const knop = maakKnop('Bewerken');
    wijs(knop);
    vi.advanceTimersByTime(100);
    verlaat(knop);
    vi.advanceTimersByTime(WACHT_MS);
    expect(tipZichtbaar()).toBe(false);
    expect(knop.getAttribute('title')).toBe('Bewerken');
  });

  it('van de knop naar het icoon erin is geen verlaten', () => {
    const knop = maakKnop('Bewerken');
    const icoon = knop.querySelector('svg')!;
    wijs(knop);
    vi.advanceTimersByTime(WACHT_MS);
    verlaat(knop, icoon);
    wijs(icoon);
    vi.advanceTimersByTime(CONTROLE_MS);
    expect(tipZichtbaar()).toBe(true);
    expect(knop.hasAttribute('title')).toBe(false);
    verlaat(icoon, document.body);
    expect(tipZichtbaar()).toBe(false);
    expect(knop.getAttribute('title')).toBe('Bewerken');
  });

  it('een knop met een eigen title en een uitgeschakelde knop: geen tip, de title blijft', () => {
    const eigen = maakKnop('Vorige 2 weken', { title: 'Je ziet de planning vanaf deze week' });
    const uit = maakKnop('Verwijderen');
    uit.disabled = true;
    for (const knop of [eigen, uit]) {
      wijs(knop);
      vi.advanceTimersByTime(WACHT_MS * 2);
      expect(tipZichtbaar()).toBe(false);
      verlaat(knop);
    }
    expect(eigen.getAttribute('title')).toBe('Je ziet de planning vanaf deze week');
    expect(uit.getAttribute('title')).toBe('Verwijderen');
  });

  it('touch en pen: niets', () => {
    const knop = maakKnop('Bewerken');
    wijs(knop, 'touch');
    wijs(knop, 'pen');
    vi.advanceTimersByTime(WACHT_MS * 2);
    expect(tipZichtbaar()).toBe(false);
    expect(knop.getAttribute('title')).toBe('Bewerken');
  });

  it('wordt de knop tijdens de tip uitgeschakeld met een eigen title (Vorige 2 weken), dan is de tip weg en blijft die title', () => {
    const knop = maakKnop('Vorige 2 weken');
    wijs(knop);
    vi.advanceTimersByTime(WACHT_MS);
    expect(tipZichtbaar()).toBe(true);
    // Zoals React: `disabled` en `title={kanTerug ? 'Vorige 2 weken' : beginUitleg}`.
    knop.disabled = true;
    knop.setAttribute('title', 'Je ziet de planning vanaf deze week (28/09/2026)');
    vi.advanceTimersByTime(CONTROLE_MS);
    expect(tipZichtbaar()).toBe(false);
    verlaat(knop);
    expect(knop.getAttribute('title')).toBe('Je ziet de planning vanaf deze week (28/09/2026)');
  });

  it('uitgeschakeld zonder eigen title: de tip is weg en title = aria-label komt terug', () => {
    const knop = maakKnop('Opslaan');
    wijs(knop);
    vi.advanceTimersByTime(WACHT_MS);
    knop.disabled = true;
    vi.advanceTimersByTime(CONTROLE_MS);
    expect(tipZichtbaar()).toBe(false);
    expect(knop.getAttribute('title')).toBe('Opslaan');
  });

  it('een nieuw label tijdens de tip (Referentie gekopieerd): de tip volgt, React zet de title terug en de laag haalt ze weer weg', () => {
    const knop = maakKnop('Referentie kopiëren');
    wijs(knop);
    vi.advanceTimersByTime(WACHT_MS);
    // React: label en title wisselen samen.
    knop.setAttribute('aria-label', 'Referentie gekopieerd');
    knop.setAttribute('title', 'Referentie gekopieerd');
    vi.advanceTimersByTime(CONTROLE_MS);
    expect(tipZichtbaar()).toBe(true);
    expect(tip()!.textContent).toBe('Referentie gekopieerd');
    expect(knop.hasAttribute('title')).toBe(false);
    verlaat(knop);
    expect(knop.getAttribute('title')).toBe('Referentie gekopieerd');
  });

  // De MutationObserver levert zijn verslag in een microtaak, de klok van de test staat stil.
  const naWaarneming = async () => { await Promise.resolve(); await Promise.resolve(); };

  it('React zet label en title terug terwijl de tip staat: de title is meteen weer weg en de tip volgt, zonder op de controle te wachten', async () => {
    const knop = maakKnop('Referentie gekopieerd');
    wijs(knop);
    vi.advanceTimersByTime(WACHT_MS);
    knop.setAttribute('aria-label', 'Referentie kopiëren');
    knop.setAttribute('title', 'Referentie kopiëren');
    await naWaarneming();
    expect(knop.hasAttribute('title')).toBe(false);
    expect(tipZichtbaar()).toBe(true);
    expect(tip()!.textContent).toBe('Referentie kopiëren');
    verlaat(knop);
    expect(knop.getAttribute('title')).toBe('Referentie kopiëren');
  });

  it('React zet de title terug terwijl de tip nog wacht: meteen weer weg; een eigen title of uitschakelen tijdens het wachten: geen tip', async () => {
    const knop = maakKnop('Bewerken');
    wijs(knop);
    vi.advanceTimersByTime(100);
    knop.setAttribute('title', 'Bewerken');
    await naWaarneming();
    expect(knop.hasAttribute('title')).toBe(false);
    vi.advanceTimersByTime(WACHT_MS);
    expect(tipZichtbaar()).toBe(true);
    verlaat(knop);

    const eigen = maakKnop('Vorige 2 weken');
    wijs(eigen);
    vi.advanceTimersByTime(100);
    eigen.disabled = true;
    eigen.setAttribute('title', 'Je ziet de planning vanaf deze week');
    await naWaarneming();
    vi.advanceTimersByTime(WACHT_MS);
    expect(tipZichtbaar()).toBe(false);
    verlaat(eigen);
    expect(eigen.getAttribute('title')).toBe('Je ziet de planning vanaf deze week');
  });

  it('wisselt alleen het label (een vaste eigen title), dan past de knop niet meer: tip weg, de oude title terug', () => {
    const knop = maakKnop('Meldingen');
    wijs(knop);
    vi.advanceTimersByTime(WACHT_MS);
    // React raakt een ongewijzigde title-prop niet aan; alleen het label wisselt.
    knop.setAttribute('aria-label', 'Meldingen (2 ongelezen)');
    vi.advanceTimersByTime(CONTROLE_MS);
    expect(tipZichtbaar()).toBe(false);
    expect(knop.getAttribute('title')).toBe('Meldingen');
  });

  it('de knop verdwijnt terwijl de tip staat: weg binnen 250 ms', () => {
    const knop = maakKnop('Bewerken');
    wijs(knop);
    vi.advanceTimersByTime(WACHT_MS);
    knop.remove();
    vi.advanceTimersByTime(CONTROLE_MS);
    expect(tipZichtbaar()).toBe(false);
    expect(knop.hasAttribute('title')).toBe(false);
  });

  it('de knop verschuift: de tip gaat weg', () => {
    const knop = maakKnop('Bewerken');
    wijs(knop);
    vi.advanceTimersByTime(WACHT_MS);
    vak = { ...vak, top: vak.top + 40 };
    vi.advanceTimersByTime(CONTROLE_MS);
    expect(tipZichtbaar()).toBe(false);
    expect(knop.getAttribute('title')).toBe('Bewerken');
  });

  it('een halve pixel (afronding, een uitlopende veer) is geen verschuiving', () => {
    const knop = maakKnop('Bewerken');
    wijs(knop);
    vi.advanceTimersByTime(WACHT_MS);
    vak = { ...vak, top: vak.top + 0.9, left: vak.left - 1.5 };
    vi.advanceTimersByTime(CONTROLE_MS * 3);
    expect(tipZichtbaar()).toBe(true);
    expect(knop.hasAttribute('title')).toBe(false);
  });

  it('klik (pointerdown), scroll en wiel: weg, met de title terug', () => {
    for (const gebeurtenis of ['pointerdown', 'scroll', 'wheel']) {
      const knop = maakKnop(`Knop ${gebeurtenis}`);
      wijs(knop);
      vi.advanceTimersByTime(WACHT_MS);
      expect(tipZichtbaar()).toBe(true);
      if (gebeurtenis === 'pointerdown') wijzer('pointerdown', knop);
      else document.dispatchEvent(new Event(gebeurtenis));
      expect(tipZichtbaar(), gebeurtenis).toBe(false);
      expect(knop.getAttribute('title')).toBe(`Knop ${gebeurtenis}`);
      verlaat(knop);
    }
  });

  it('van tip naar tip binnen 300 ms: zonder wachttijd; daarna weer met', () => {
    const a = maakKnop('Vorige');
    const b = maakKnop('Volgende');
    wijs(a);
    vi.advanceTimersByTime(WACHT_MS);
    verlaat(a, b);
    wijs(b);
    expect(tipZichtbaar()).toBe(true);
    expect(tip()!.textContent).toBe('Volgende');
    expect(a.getAttribute('title')).toBe('Vorige');
    verlaat(b);
    vi.setSystemTime(Date.now() + WACHT_MS + 1);
    vi.advanceTimersByTime(WACHT_MS + 1);
    wijs(a);
    expect(tipZichtbaar()).toBe(false);
  });

  it('Escape met een zichtbare tip: alleen de tip, de laag eronder hoort niets; een tweede Escape gaat door', () => {
    const knop = maakKnop('Bewerken');
    const lagen = vi.fn((e: KeyboardEvent) => e.defaultPrevented);
    window.addEventListener('keydown', lagen);
    try {
      wijs(knop);
      vi.advanceTimersByTime(WACHT_MS);
      const eerste = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
      knop.dispatchEvent(eerste);
      expect(eerste.defaultPrevented).toBe(true);
      expect(lagen).not.toHaveBeenCalled();
      expect(tipZichtbaar()).toBe(false);
      expect(knop.getAttribute('title')).toBe('Bewerken');
      const tweede = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
      knop.dispatchEvent(tweede);
      expect(tweede.defaultPrevented).toBe(false);
      expect(lagen).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener('keydown', lagen);
    }
  });

  it('Escape terwijl de tip nog wacht: gaat gewoon door', () => {
    const knop = maakKnop('Bewerken');
    wijs(knop);
    const e = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    knop.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(false);
  });

  it('50 keer heen en weer over een rij knoppen: elke knop heeft daarna zijn title', () => {
    const rij = Array.from({ length: 6 }, (_, i) => maakKnop(`Knop ${i}`));
    for (let ronde = 0; ronde < 50; ronde++) {
      const volgorde = ronde % 2 === 0 ? rij : [...rij].reverse();
      for (let i = 0; i < volgorde.length; i++) {
        wijs(volgorde[i]);
        vi.advanceTimersByTime((ronde * 37 + i * 53) % 400);
        verlaat(volgorde[i], volgorde[i + 1] ?? document.body);
      }
    }
    expect(rij.map((k) => k.getAttribute('title'))).toEqual(rij.map((_, i) => `Knop ${i}`));
    expect(tipZichtbaar()).toBe(false);
  });

  it('start met de muis al op een knop: die knop doet meteen mee', () => {
    stopTipLaag();
    const knop = maakKnop('Bewerken');
    const echt = document.querySelectorAll.bind(document);
    const spion = vi.spyOn(document, 'querySelectorAll').mockImplementation(((s: string) => (s === ':hover' ? [document.documentElement, document.body, knop] : echt(s))) as typeof document.querySelectorAll);
    try {
      startTipLaag();
    } finally {
      spion.mockRestore();
    }
    expect(knop.hasAttribute('title')).toBe(false);
    vi.advanceTimersByTime(WACHT_MS);
    expect(tipZichtbaar()).toBe(true);
  });
});

describe('tip-laag bij focus', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = '';
    startTipLaag();
  });
  afterEach(() => {
    stopTipLaag();
    vi.useRealTimers();
    document.body.innerHTML = '';
  });
  const knop = (label: string) => {
    const b = document.createElement('button');
    b.setAttribute('aria-label', label);
    b.setAttribute('title', label);
    b.getBoundingClientRect = () => new DOMRect(600, 400, 32, 32);
    document.body.appendChild(b);
    return b;
  };
  const tip = () => document.querySelector<HTMLElement>('[data-tip-laag]');
  const toets = (type: 'keydown' | 'keyup', key: string) => document.activeElement!.dispatchEvent(new KeyboardEvent(type, { key, bubbles: true, cancelable: true }));

  it('Tab naar een knop: de tip staat er meteen en de title blijft; weg bij blur', () => {
    const a = knop('Bewerken');
    toets('keydown', 'Tab');
    a.focus();
    toets('keyup', 'Tab');
    expect(tip()?.hidden).toBe(false);
    expect(tip()!.textContent).toBe('Bewerken');
    expect(a.getAttribute('title')).toBe('Bewerken');
    a.blur();
    expect(tip()!.hidden).toBe(true);
    expect(a.getAttribute('title')).toBe('Bewerken');
  });

  it('focus die na Escape terugkomt (of vanuit code): geen tip', () => {
    const a = knop('Kalender openen');
    toets('keydown', 'Escape');
    a.focus();
    toets('keyup', 'Escape');
    expect(tip()?.hidden ?? true).toBe(true);
    a.blur();
    a.focus();
    expect(tip()?.hidden ?? true).toBe(true);
  });
});

describe('tip-laag naast een open laag (venster, kiezer, menu)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = '';
    startTipLaag();
  });
  afterEach(() => {
    cleanup();
    stopTipLaag();
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  const knop = (label: string, ouder: Element = document.body) => {
    const b = document.createElement('button');
    b.setAttribute('aria-label', label);
    b.setAttribute('title', label);
    b.innerHTML = '<svg><path d="M0 0"/></svg>';
    b.getBoundingClientRect = () => new DOMRect(600, 400, 32, 32);
    ouder.appendChild(b);
    return b;
  };
  /** Een laag zoals de kalender van DatePicker: `role="dialog"` in een portal in de body. */
  const laag = (rol = 'dialog') => {
    const d = document.createElement('div');
    d.setAttribute('role', rol);
    document.body.appendChild(d);
    return d;
  };
  /** Een dagcel (geen icoonknop): hier staat de focus, zoals na ArrowDown in het datumveld. */
  const cel = (ouder: Element) => {
    const c = document.createElement('button');
    c.textContent = '24';
    ouder.appendChild(c);
    c.focus();
    return c;
  };
  const tip = () => document.querySelector<HTMLElement>('[data-tip-laag]');
  const tipZichtbaar = () => !!tip() && !tip()!.hidden;
  const wijzer = (type: string, doel: Element, naar: Element | null = null) => {
    const e = new MouseEvent(type, { bubbles: true, cancelable: true, relatedTarget: naar });
    Object.defineProperty(e, 'pointerType', { value: 'mouse' });
    doel.dispatchEvent(e);
  };
  /** Escape op de focus; geeft het event en of de luisteraar van de lagen (window) hem hoorde. */
  const escape = () => {
    const lagen = vi.fn((e: KeyboardEvent) => e.defaultPrevented);
    window.addEventListener('keydown', lagen);
    try {
      const e = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
      (document.activeElement ?? document.body).dispatchEvent(e);
      return { e, gehoord: lagen.mock.calls.length > 0 };
    } finally {
      window.removeEventListener('keydown', lagen);
    }
  };

  it('de tip van een knop buiten de laag waar de focus staat: Escape verbergt de tip en gaat door naar de laag', () => {
    const kalenderknop = knop('Kalender openen');
    const kalender = laag();
    cel(kalender);
    wijzer('pointerover', kalenderknop);
    vi.advanceTimersByTime(WACHT_MS);
    expect(tipZichtbaar()).toBe(true);
    const { e, gehoord } = escape();
    expect(e.defaultPrevented, 'niet geslikt').toBe(false);
    expect(gehoord, 'de lagen horen de Escape').toBe(true);
    expect(tipZichtbaar()).toBe(false);
    expect(kalenderknop.getAttribute('title')).toBe('Kalender openen');
  });

  it('een kiezer boven een venster: de tip van de kalenderknop in het venster slikt de Escape van de kiezer niet', () => {
    const venster = laag();
    const kalenderknop = knop('Kalender openen', venster);
    const kalender = laag();
    cel(kalender);
    wijzer('pointerover', kalenderknop);
    vi.advanceTimersByTime(WACHT_MS);
    const { e, gehoord } = escape();
    expect(e.defaultPrevented).toBe(false);
    expect(gehoord).toBe(true);
    expect(tipZichtbaar()).toBe(false);
  });

  it('het inline DetailPaneel (`data-laag`, geen dialoog): focus in het paneel, de tip van een knop in de lijst ernaast slikt de Escape niet', () => {
    const lijstknop = knop('Meer acties voor Bart');
    const paneel = document.createElement('section');
    paneel.setAttribute('data-laag', '');
    document.body.appendChild(paneel);
    cel(paneel);
    wijzer('pointerover', lijstknop);
    vi.advanceTimersByTime(WACHT_MS);
    const { e, gehoord } = escape();
    expect(e.defaultPrevented).toBe(false);
    expect(gehoord).toBe(true);
    expect(tipZichtbaar()).toBe(false);
  });

  it('de tip van een knop in de laag waar de focus staat (menu of venster): Escape verbergt alleen de tip, een tweede Escape gaat door', () => {
    for (const rol of ['dialog', 'menu']) {
      const l = laag(rol);
      const vorige = knop('Vorige maand', l);
      cel(l);
      wijzer('pointerover', vorige);
      vi.advanceTimersByTime(WACHT_MS);
      expect(tipZichtbaar(), rol).toBe(true);
      const eerste = escape();
      expect(eerste.e.defaultPrevented, rol).toBe(true);
      expect(eerste.gehoord, rol).toBe(false);
      expect(tipZichtbaar()).toBe(false);
      const tweede = escape();
      expect(tweede.e.defaultPrevented).toBe(false);
      expect(tweede.gehoord).toBe(true);
      wijzer('pointerout', vorige, document.body);
      l.remove();
    }
  });

  it('een laag gaat open terwijl de tip staat of nog wacht: de tip is weg, de title terug', () => {
    const { rerender } = renderHook(({ open }) => useLaag({ open, sluit: () => {}, historie: false }), { initialProps: { open: false } });
    const a = knop('Kalender openen');
    wijzer('pointerover', a);
    vi.advanceTimersByTime(WACHT_MS);
    expect(tipZichtbaar()).toBe(true);
    act(() => rerender({ open: true }));
    expect(tipZichtbaar()).toBe(false);
    expect(a.getAttribute('title')).toBe('Kalender openen');
    act(() => rerender({ open: false }));
    wijzer('pointerout', a, document.body);

    // Nog aan het wachten (binnen de 300 ms): de tip komt niet meer.
    const b = knop('Bewerken');
    wijzer('pointerover', b);
    vi.advanceTimersByTime(100);
    act(() => rerender({ open: true }));
    vi.advanceTimersByTime(WACHT_MS);
    expect(tipZichtbaar()).toBe(false);
    expect(b.getAttribute('title')).toBe('Bewerken');
  });

  it('zolang de muis op de knop blijft, komt zijn tip niet terug; eraf en er weer op wel', () => {
    const { rerender } = renderHook(({ open }) => useLaag({ open, sluit: () => {}, historie: false }), { initialProps: { open: false } });
    const a = knop('Kalender openen');
    const icoon = a.querySelector('svg')!;
    wijzer('pointerover', a);
    vi.advanceTimersByTime(WACHT_MS);
    act(() => rerender({ open: true }));
    expect(tipZichtbaar()).toBe(false);
    // Binnen de knop van de rand naar het icoon en terug: nog altijd dezelfde knop.
    wijzer('pointerout', a, icoon);
    wijzer('pointerover', icoon);
    wijzer('pointerout', icoon, a);
    wijzer('pointerover', a);
    vi.advanceTimersByTime(WACHT_MS * 2);
    expect(tipZichtbaar()).toBe(false);
    expect(a.getAttribute('title')).toBe('Kalender openen');
    // Eraf en er weer op: de tip mag weer.
    wijzer('pointerout', a, document.body);
    wijzer('pointerover', a);
    vi.advanceTimersByTime(WACHT_MS);
    expect(tipZichtbaar()).toBe(true);
  });

  it('een tip na Tab gaat ook weg als er een laag opengaat', () => {
    const { rerender } = renderHook(({ open }) => useLaag({ open, sluit: () => {}, historie: false }), { initialProps: { open: false } });
    const a = knop('Kalender openen');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    a.focus();
    document.dispatchEvent(new KeyboardEvent('keyup', { key: 'Tab', bubbles: true }));
    expect(tipZichtbaar()).toBe(true);
    act(() => rerender({ open: true }));
    expect(tipZichtbaar()).toBe(false);
    expect(a.getAttribute('title')).toBe('Kalender openen');
  });

  it('een laag zonder Escape (de onzichtbare bewaking van een vuil formulier) laat de tip staan', () => {
    const { rerender } = renderHook(({ open }) => useLaag({ open, sluit: () => {}, historie: false, escape: false, soort: 'bewaking' }), { initialProps: { open: false } });
    const a = knop('Bewerken');
    wijzer('pointerover', a);
    vi.advanceTimersByTime(WACHT_MS);
    act(() => rerender({ open: true }));
    expect(tipZichtbaar()).toBe(true);
  });
});
