import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { Staafgrafiek, StapCurve, type Slot, type Staaf } from './grafieken';

/**
 * Laadplein, ronde 6 punt 10: de grafieken tonen hun uitlezing ook bij
 * wijzen met de muis. Wijzen zet nooit iets vast (dat blijft de klik), de
 * uitlezing is dezelfde `samenvatting(…)` als na een klik, en touch en pen
 * werken zoals voorheen: de veeg-selectie uit `useScrub` is ongewijzigd, de
 * toetsen onder "touch en pen" slagen ook op de basis van deze wijziging.
 */

afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

const STAVEN: Staaf[] = [
  { key: 'ma', waarde: 10, asLabel: 'ma' },
  { key: 'di', waarde: 40, asLabel: 'di', isPiek: true },
  { key: 'wo', waarde: 20, asLabel: 'wo' },
  { key: 'do', waarde: 0, asLabel: 'do', ontbreekt: true },
  { key: 'vr', waarde: 15, asLabel: 'vr', gedempt: true },
];

function StaafHarnas({ begin = null, onKies }: { begin?: string | null; onKies?: (k: string | null) => void }) {
  const [gekozen, setGekozen] = useState<string | null>(begin);
  return (
    <Staafgrafiek
      staven={STAVEN}
      eenheid="kWh"
      ariaLabel="Verbruik per dag"
      gekozen={gekozen}
      onKies={(k) => { onKies?.(k); setGekozen(k); }}
      samenvatting={(s) => (s ? `staaf ${s.key}` : 'de hele reeks')}
    />
  );
}

const SLOTS: Slot[] = [
  { key: 't0', ts: '2026-11-14T00:00:00.000Z', kw: 10, charging: 1 },
  { key: 't1', ts: '2026-11-14T00:15:00.000Z', kw: 50, charging: 3 },
  { key: 't2', ts: '2026-11-14T00:30:00.000Z', kw: 20, charging: 2 },
  { key: 't3', ts: '2026-11-14T00:45:00.000Z', kw: 5, charging: 1 },
];

function CurveHarnas({ begin = null, onKies }: { begin?: string | null; onKies?: (k: string | null) => void }) {
  const [gekozen, setGekozen] = useState<string | null>(begin);
  return (
    <StapCurve
      slots={SLOTS}
      ariaLabel="Vermogen laatste 24 uur"
      gekozen={gekozen}
      onKies={(k) => { onKies?.(k); setGekozen(k); }}
      asLinks="00:00"
      asRechts="nu"
      samenvatting={(s) => (s ? `kwartier ${s.key}` : 'piek 50 kW')}
    />
  );
}

const grafiek = (naam = 'Verbruik per dag') => screen.getByRole('img', { name: naam });
const vakken = (naam?: string) => [...grafiek(naam).querySelectorAll('button')];
const staaf = (i: number) => vakken()[i].firstElementChild as HTMLElement;
const regel = (naam?: string) => grafiek(naam).parentElement!.querySelector('p')!;
/** Staven die een wijsmarkering dragen. */
const gemarkeerd = () => vakken().filter((b) => /\bbg-(?:slate|oker)-600\b/.test(b.firstElementChild?.className ?? '')).length;

/** jsdom kent geen opmaak: de veeg rekent met de breedte van de grafiek. */
const meet = (el: HTMLElement, breedte: number) => vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
  left: 0, top: 0, right: breedte, bottom: 100, width: breedte, height: 100, x: 0, y: 0, toJSON: () => ({}),
} as DOMRect);
/** Midden van vak i bij 5 vakken van 100 px. */
const x = (i: number) => i * 100 + 50;

describe('Staafgrafiek: wijzen met de muis', () => {
  it('toont meteen de uitlezing van de staaf onder de muis en markeert ze, zonder iets vast te zetten', () => {
    const onKies = vi.fn();
    render(<StaafHarnas onKies={onKies} />);
    expect(regel().textContent).toBe('de hele reeks');
    expect(regel().className).toContain('font-medium');

    fireEvent.pointerMove(vakken()[2], { pointerType: 'mouse' });
    expect(regel().textContent).toBe('staaf wo');
    expect(regel().className).toContain('font-semibold');
    expect(regel().className).toContain('text-slate-700');
    expect(staaf(2).className).toContain('bg-slate-600');
    expect(staaf(2).className).not.toContain('bg-slate-500');

    // De piek ook één trede donkerder; de vorige staaf is terug in rust.
    fireEvent.pointerMove(vakken()[1], { pointerType: 'mouse' });
    expect(regel().textContent).toBe('staaf di');
    expect(staaf(1).className).toContain('bg-oker-600');
    expect(staaf(2).className).toContain('bg-slate-500');

    // Gedempt en ontbrekend: wel de uitlezing, geen markering.
    fireEvent.pointerMove(vakken()[4], { pointerType: 'mouse' });
    expect(regel().textContent).toBe('staaf vr');
    expect(staaf(4).className).toContain('bg-slate-400');
    expect(gemarkeerd()).toBe(0);
    fireEvent.pointerMove(vakken()[3], { pointerType: 'mouse' });
    expect(regel().textContent).toBe('staaf do');
    expect(staaf(3).className).toContain('border-dashed');
    expect(staaf(3).className).not.toMatch(/\bbg-/);
    expect(gemarkeerd()).toBe(0);

    // Van de grafiek af: de samenvatting van de reeks.
    fireEvent.pointerLeave(grafiek(), { pointerType: 'mouse' });
    expect(regel().textContent).toBe('de hele reeks');
    expect(regel().className).toContain('font-medium');
    expect(gemarkeerd()).toBe(0);
    expect(onKies).not.toHaveBeenCalled();
  });

  it('laat de vastgezette staaf staan; van de grafiek af staat haar uitlezing er weer', () => {
    const onKies = vi.fn();
    render(<StaafHarnas begin="ma" onKies={onKies} />);
    expect(regel().textContent).toBe('staaf ma');
    expect(staaf(0).className).toContain('bg-keuze');

    fireEvent.pointerMove(vakken()[2], { pointerType: 'mouse' });
    expect(regel().textContent).toBe('staaf wo');
    expect(staaf(0).className).toContain('bg-keuze');
    expect(staaf(2).className).toContain('bg-slate-600');

    // Wijzen op de vastgezette staaf: zij houdt bg-keuze, geen wijskleur.
    fireEvent.pointerMove(vakken()[0], { pointerType: 'mouse' });
    expect(regel().textContent).toBe('staaf ma');
    expect(staaf(0).className).toContain('bg-keuze');
    expect(gemarkeerd()).toBe(0);

    fireEvent.pointerMove(vakken()[1], { pointerType: 'mouse' });
    fireEvent.pointerLeave(grafiek(), { pointerType: 'mouse' });
    expect(regel().textContent).toBe('staaf ma');
    expect(regel().className).toContain('font-semibold');
    expect(onKies).not.toHaveBeenCalled();
  });

  it('een klik zet vast en een tweede klik maakt los, zoals voorheen', () => {
    const onKies = vi.fn();
    render(<StaafHarnas onKies={onKies} />);
    fireEvent.pointerMove(vakken()[2], { pointerType: 'mouse' });
    fireEvent.click(vakken()[2]);
    expect(onKies).toHaveBeenLastCalledWith('wo');
    expect(staaf(2).className).toContain('bg-keuze');

    fireEvent.click(vakken()[2]);
    expect(onKies).toHaveBeenLastCalledWith(null);
    // De muis staat er nog: wijzen, niet vastgezet.
    expect(staaf(2).className).toContain('bg-slate-600');
    fireEvent.pointerLeave(grafiek(), { pointerType: 'mouse' });
    expect(regel().textContent).toBe('de hele reeks');
    expect(onKies).toHaveBeenCalledTimes(2);
  });

  it('de staven dragen geen title meer: de uitlezing zegt het', () => {
    render(<StaafHarnas />);
    expect(vakken()).toHaveLength(5);
    for (const b of vakken()) expect(b.hasAttribute('title')).toBe(false);
  });

  it('een sleutel die niet meer in de reeks staat, toont niets', () => {
    function Wissel() {
      const [staven, setStaven] = useState(STAVEN);
      return (
        <>
          {/* rauw: testknop */}
          <button type="button" onClick={() => setStaven(STAVEN.slice(0, 2))}>korter</button>
          <Staafgrafiek staven={staven} eenheid="kWh" ariaLabel="Verbruik per dag" gekozen={null} onKies={() => {}} samenvatting={(s) => (s ? `staaf ${s.key}` : 'de hele reeks')} />
        </>
      );
    }
    render(<Wissel />);
    fireEvent.pointerMove(vakken()[4], { pointerType: 'mouse' });
    expect(regel().textContent).toBe('staaf vr');
    fireEvent.click(screen.getByRole('button', { name: 'korter' }));
    expect(regel().textContent).toBe('de hele reeks');
  });
});

describe('Staafgrafiek: touch en pen zoals voorheen', () => {
  it('een tik kiest de staaf onder de vinger, een tweede tik maakt los, zonder wijsmarkering', () => {
    vi.useFakeTimers();
    const onKies = vi.fn();
    render(<StaafHarnas onKies={onKies} />);
    meet(grafiek(), 500);
    const vak = vakken()[2];
    fireEvent.pointerDown(vak, { pointerType: 'touch', clientX: x(2) });
    fireEvent.pointerUp(vak, { pointerType: 'touch', clientX: x(2) });
    // Neer en los kiezen allebei het vak onder de vinger; de klik na een tik
    // telt niet nog eens (scrubActief).
    fireEvent.click(vak);
    expect(onKies.mock.calls).toEqual([['wo'], ['wo']]);
    expect(regel().textContent).toBe('staaf wo');
    expect(staaf(2).className).toContain('bg-keuze');
    expect(gemarkeerd()).toBe(0);
    act(() => { vi.advanceTimersByTime(60); });

    fireEvent.pointerDown(vak, { pointerType: 'touch', clientX: x(2) });
    fireEvent.pointerUp(vak, { pointerType: 'touch', clientX: x(2) });
    fireEvent.click(vak);
    expect(onKies.mock.calls).toEqual([['wo'], ['wo'], ['wo'], ['wo'], [null]]);
    expect(regel().textContent).toBe('de hele reeks');
    expect(gemarkeerd()).toBe(0);
  });

  it('vegen volgt de vinger en laat de laatste staaf gekozen', () => {
    vi.useFakeTimers();
    const onKies = vi.fn();
    render(<StaafHarnas onKies={onKies} />);
    meet(grafiek(), 500);
    // Bij touch blijven de gebeurtenissen op het vak waar de veeg begon.
    const vak = vakken()[0];
    fireEvent.pointerDown(vak, { pointerType: 'touch', clientX: x(0) });
    fireEvent.pointerMove(vak, { pointerType: 'touch', clientX: x(2) });
    fireEvent.pointerMove(vak, { pointerType: 'touch', clientX: x(4) });
    fireEvent.pointerUp(vak, { pointerType: 'touch', clientX: x(4) });
    fireEvent.click(vak);
    expect(onKies.mock.calls).toEqual([['ma'], ['wo'], ['vr']]);
    expect(regel().textContent).toBe('staaf vr');
    expect(gemarkeerd()).toBe(0);
  });

  it('een afgebroken veeg zet de vorige keuze terug', () => {
    vi.useFakeTimers();
    const onKies = vi.fn();
    render(<StaafHarnas begin="ma" onKies={onKies} />);
    meet(grafiek(), 500);
    const vak = vakken()[2];
    fireEvent.pointerDown(vak, { pointerType: 'touch', clientX: x(2) });
    fireEvent.pointerMove(vak, { pointerType: 'touch', clientX: x(3) });
    fireEvent.pointerCancel(vak, { pointerType: 'touch', clientX: x(3) });
    expect(onKies.mock.calls).toEqual([['wo'], ['do'], ['ma']]);
    expect(regel().textContent).toBe('staaf ma');
  });

  it('pen veegt niet en wijst niet; zijn klik zet vast zoals voorheen', () => {
    const onKies = vi.fn();
    render(<StaafHarnas onKies={onKies} />);
    meet(grafiek(), 500);
    const vak = vakken()[2];
    fireEvent.pointerMove(vak, { pointerType: 'pen', clientX: x(2) });
    fireEvent.pointerDown(vak, { pointerType: 'pen', clientX: x(2) });
    fireEvent.pointerMove(vak, { pointerType: 'pen', clientX: x(3) });
    expect(onKies).not.toHaveBeenCalled();
    expect(regel().textContent).toBe('de hele reeks');
    expect(gemarkeerd()).toBe(0);
    fireEvent.pointerUp(vak, { pointerType: 'pen', clientX: x(2) });
    fireEvent.click(vak);
    expect(onKies.mock.calls).toEqual([['wo']]);
  });

  it('een aanraking wist een wijsstand van de muis', () => {
    vi.useFakeTimers();
    const onKies = vi.fn();
    render(<StaafHarnas onKies={onKies} />);
    meet(grafiek(), 500);
    fireEvent.pointerMove(vakken()[2], { pointerType: 'mouse' });
    expect(gemarkeerd()).toBe(1);
    fireEvent.pointerDown(vakken()[0], { pointerType: 'touch', clientX: x(0) });
    fireEvent.pointerUp(vakken()[0], { pointerType: 'touch', clientX: x(0) });
    expect(gemarkeerd()).toBe(0);
    expect(regel().textContent).toBe('staaf ma');
    expect(onKies.mock.calls).toEqual([['ma'], ['ma']]);
  });
});

describe('StapCurve: wijzen, klikken en de piekstip', () => {
  const NAAM = 'Vermogen laatste 24 uur';
  const banden = () => [...grafiek(NAAM).querySelectorAll('rect')].map((r) => `${r.getAttribute('class')}@${r.getAttribute('x')}`);

  it('wijzen toont de uitlezing van het kwartier met een lichte band; op het gekozen kwartier alleen de keuze', () => {
    const onKies = vi.fn();
    render(<CurveHarnas onKies={onKies} />);
    const tik = vakken(NAAM);
    expect(regel(NAAM).textContent).toBe('piek 50 kW');
    expect(banden()).toEqual([]);

    fireEvent.pointerMove(tik[2], { pointerType: 'mouse' });
    expect(regel(NAAM).textContent).toBe('kwartier t2');
    expect(regel(NAAM).className).toContain('font-semibold');
    expect(banden()).toEqual(['fill-slate-900/5@50']);
    expect(onKies).not.toHaveBeenCalled();

    fireEvent.click(tik[2]);
    expect(onKies).toHaveBeenLastCalledWith('t2');
    expect(banden()).toEqual(['fill-slate-900/10@50']);

    fireEvent.pointerMove(tik[0], { pointerType: 'mouse' });
    expect(regel(NAAM).textContent).toBe('kwartier t0');
    expect(banden()).toEqual(['fill-slate-900/5@0', 'fill-slate-900/10@50']);

    fireEvent.pointerLeave(grafiek(NAAM), { pointerType: 'mouse' });
    expect(regel(NAAM).textContent).toBe('kwartier t2');
    expect(banden()).toEqual(['fill-slate-900/10@50']);
    expect(onKies).toHaveBeenCalledTimes(1);
  });

  it('een tik kiest het kwartier zonder wijsband', () => {
    vi.useFakeTimers();
    const onKies = vi.fn();
    render(<CurveHarnas onKies={onKies} />);
    meet(grafiek(NAAM), 400);
    const vak = vakken(NAAM)[1];
    fireEvent.pointerDown(vak, { pointerType: 'touch', clientX: 150 });
    fireEvent.pointerUp(vak, { pointerType: 'touch', clientX: 150 });
    fireEvent.click(vak);
    expect(onKies.mock.calls).toEqual([['t1'], ['t1']]);
    expect(regel(NAAM).textContent).toBe('kwartier t1');
    expect(banden()).toEqual(['fill-slate-900/10@25']);
  });

  it('de kwartieren dragen geen title meer', () => {
    render(<CurveHarnas />);
    expect(vakken(NAAM)).toHaveLength(4);
    for (const b of vakken(NAAM)) expect(b.hasAttribute('title')).toBe(false);
  });

  it('de piekstip heeft geen witte rand meer maar de kleur van de tegel', () => {
    render(<CurveHarnas />);
    const stip = grafiek(NAAM).querySelector('circle')!;
    expect(stip.getAttribute('class')).toBe('fill-oker-500');
    expect(stip.getAttribute('class')).not.toContain('stroke-white');
    expect(stip.style.stroke).toBe('var(--tile-bg)');
    // Op het piekkwartier (t1) in het midden van zijn vak.
    expect(stip.getAttribute('cx')).toBe('37.5');
  });
});
