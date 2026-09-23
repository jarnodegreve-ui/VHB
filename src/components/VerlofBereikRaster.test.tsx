import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { VerlofBereikRaster } from './VerlofBereikRaster';

/** Het bereikraster van de verlofaanvraag (datumtranche PR 5): rastersemantiek, één tab-stop, toetsen. */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => { document.body.innerHTML = ''; });

const toets = (el: Element, key: string) => el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
const cel = (iso: string) => document.querySelector<HTMLButtonElement>(`[data-iso="${iso}"]`);
const tabStops = () => [...document.querySelectorAll<HTMLButtonElement>('[role="gridcell"][tabindex="0"]')];

function Harnas({ start = '', eind = '', min, onKies = () => {} }: { start?: string; eind?: string; min?: string; onKies?: (iso: string) => void }) {
  const [maand, setMaand] = useState('2026-09');
  return (
    <>
      <span id="maand">{maand}</span>
      <VerlofBereikRaster maand={maand} start={start} eind={eind} min={min} vandaag="2026-09-23" onKies={onKies} onNaarMaand={setMaand} verledenTitel="Verleden" />
    </>
  );
}

async function monteer(ui: React.ReactElement): Promise<{ root: Root; container: HTMLElement }> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(ui); });
  return { root, container };
}

describe('VerlofBereikRaster', () => {
  it('is een raster met rijen, kolomkoppen en volledige datumlabels; één tab-stop i.p.v. één per dag', async () => {
    const { root, container } = await monteer(<Harnas start="2026-09-10" eind="2026-09-12" />);
    const grid = container.querySelector('[role="grid"]')!;
    expect(grid.getAttribute('aria-label')).toBe('September 2026');
    expect(grid.querySelectorAll('[role="row"]').length).toBeGreaterThanOrEqual(5);
    expect(grid.querySelectorAll('[role="columnheader"]')).toHaveLength(7);
    expect(cel('2026-09-10')!.getAttribute('aria-label')).toBe('do 10 sep 2026, begin van de periode');
    expect(cel('2026-09-11')!.getAttribute('aria-selected')).toBe('true');
    expect(cel('2026-09-12')!.getAttribute('aria-label')).toBe('za 12 sep 2026, einde van de periode');
    expect(cel('2026-09-23')!.getAttribute('aria-current')).toBe('date');
    expect(tabStops()).toHaveLength(1);
    expect(tabStops()[0]).toBe(cel('2026-09-10'));
    await act(async () => { root.unmount(); });
  });

  it('toetsen: pijlen per dag en week, Home/End, PageDown bladert naar de volgende maand', async () => {
    const { root, container } = await monteer(<Harnas start="2026-09-10" />);
    const grid = container.querySelector('[role="grid"]')!;
    cel('2026-09-10')!.focus();
    await act(async () => { toets(grid, 'ArrowRight'); });
    expect(document.activeElement).toBe(cel('2026-09-11'));
    await act(async () => { toets(grid, 'ArrowDown'); });
    expect(document.activeElement).toBe(cel('2026-09-18'));
    await act(async () => { toets(grid, 'Home'); });
    expect(document.activeElement).toBe(cel('2026-09-14'));
    await act(async () => { toets(grid, 'End'); });
    expect(document.activeElement).toBe(cel('2026-09-20'));
    await act(async () => { toets(grid, 'PageDown'); });
    expect(container.querySelector('#maand')!.textContent).toBe('2026-10');
    expect(document.activeElement).toBe(cel('2026-10-20'));
    expect(tabStops()).toHaveLength(1);
    await act(async () => { root.unmount(); });
  });

  it('dagen vóór min zijn uitgeschakeld en de cursor komt er niet', async () => {
    const onKies = vi.fn();
    const { root, container } = await monteer(<Harnas min="2026-09-23" onKies={onKies} />);
    expect(cel('2026-09-22')!.disabled).toBe(true);
    expect(cel('2026-09-22')!.getAttribute('title')).toBe('Verleden');
    expect(tabStops()[0]).toBe(cel('2026-09-23'));
    const grid = container.querySelector('[role="grid"]')!;
    cel('2026-09-23')!.focus();
    await act(async () => { toets(grid, 'ArrowLeft'); });
    expect(document.activeElement).toBe(cel('2026-09-23'));
    await act(async () => { cel('2026-09-22')!.click(); });
    expect(onKies).not.toHaveBeenCalled();
    await act(async () => { root.unmount(); });
  });

  it('klik en Enter kiezen via dezelfde onKies', async () => {
    const onKies = vi.fn();
    const { root } = await monteer(<Harnas onKies={onKies} />);
    await act(async () => { cel('2026-09-25')!.click(); });
    expect(onKies).toHaveBeenCalledWith('2026-09-25');
    await act(async () => { root.unmount(); });
  });

  it('schrikkeljaar: februari 2028 heeft 29 dagen, 2027 niet', async () => {
    function Feb({ jaar }: { jaar: string }) {
      return <VerlofBereikRaster maand={`${jaar}-02`} start="" eind="" vandaag="2026-09-23" onKies={() => {}} onNaarMaand={() => {}} />;
    }
    const a = await monteer(<Feb jaar="2028" />);
    expect(cel('2028-02-29')).not.toBeNull();
    await act(async () => { a.root.unmount(); });
    const b = await monteer(<Feb jaar="2027" />);
    expect(cel('2027-02-29')).toBeNull();
    expect(cel('2027-02-28')).not.toBeNull();
    await act(async () => { b.root.unmount(); });
  });
});
