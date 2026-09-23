import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MaandInput } from './MaandInput';
import { Formulier } from './Formulier';

/** Het typbare maandveld (datumtranche PR 4): mm/jjjj in beeld, 'YYYY-MM' naar buiten. */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => { document.body.innerHTML = ''; });

const klik = (el: Element | null | undefined) => {
  if (!el) throw new Error('element ontbreekt');
  el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
};
const toets = (el: Element, key: string) => {
  const e = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  el.dispatchEvent(e);
  return e;
};
const typ = (el: HTMLInputElement, tekst: string) => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, tekst);
  el.dispatchEvent(new Event('input', { bubbles: true }));
};
const dialoog = () => document.querySelector<HTMLElement>('[role="dialog"]');
const cel = (m: string) => document.querySelector<HTMLButtonElement>(`[data-maand="${m}"][role="gridcell"]`);
const veld = (c: HTMLElement) => c.querySelector<HTMLInputElement>('input#m')!;
const knop = (c: HTMLElement) => c.querySelector<HTMLButtonElement>('button[aria-label="Maand kiezen"]')!;
const fout = (c: HTMLElement) => c.querySelector('[role="alert"]')?.textContent ?? null;

function Harnas({ onChange, start = '2026-09', min, max, wisbaar }: { onChange: (v: string) => void; start?: string; min?: string; max?: string; wisbaar?: boolean }) {
  const [v, setV] = useState(start);
  return <MaandInput id="m" value={v} min={min} max={max} wisbaar={wisbaar} onChange={(n) => { setV(n); onChange(n); }} aria-label="Maand" />;
}

async function monteer(ui: React.ReactElement): Promise<{ root: Root; container: HTMLElement }> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(ui); });
  return { root, container };
}

describe('MaandInput', () => {
  it('toont mm/jjjj, geeft een getypte maand als YYYY-MM door bij blur', async () => {
    const onChange = vi.fn();
    const { root, container } = await monteer(<Harnas onChange={onChange} />);
    const el = veld(container);
    expect(el.value).toBe('09/2026');
    expect(el.getAttribute('placeholder')).toBe('mm/jjjj');
    el.focus();
    await act(async () => { typ(el, '112026'); });
    expect(onChange).not.toHaveBeenCalled();
    await act(async () => { el.blur(); });
    expect(onChange).toHaveBeenCalledWith('2026-11');
    expect(el.value).toBe('11/2026');
    await act(async () => { root.unmount(); });
  });

  it('ongeldig of buiten het bereik: fout pas bij blur, niets doorgegeven; Enter dient dan niet in', async () => {
    const onChange = vi.fn();
    const { root, container } = await monteer(<Harnas onChange={onChange} max="2026-12" />);
    const el = veld(container);
    el.focus();
    await act(async () => { typ(el, '13/2026'); });
    expect(fout(container)).toBeNull();
    let e!: KeyboardEvent;
    await act(async () => { e = toets(el, 'Enter'); });
    expect(e.defaultPrevented).toBe(true);
    expect(fout(container)).toBe('Die maand bestaat niet.');
    el.focus();
    await act(async () => { typ(el, '01/2027'); });
    await act(async () => { el.blur(); });
    expect(fout(container)).toBe('Uiterlijk 12/2026.');
    expect(onChange).not.toHaveBeenCalled();
    await act(async () => { root.unmount(); });
  });

  it('raster: opent op de waarde, pijlen en PageDown verplaatsen, Enter kiest, focus terug in het veld', async () => {
    const onChange = vi.fn();
    const { root, container } = await monteer(<Harnas onChange={onChange} />);
    await act(async () => { klik(knop(container)); });
    expect(knop(container).getAttribute('aria-expanded')).toBe('true');
    expect(document.querySelectorAll('[role="gridcell"]')).toHaveLength(12);
    expect(document.activeElement).toBe(cel('2026-09'));
    expect(cel('2026-09')!.getAttribute('aria-label')).toBe('September 2026');
    expect(cel('2026-03')!.textContent).toBe('mrt');
    const d = dialoog()!;
    await act(async () => { toets(d, 'ArrowRight'); });
    expect(document.activeElement).toBe(cel('2026-10'));
    await act(async () => { toets(d, 'ArrowDown'); });
    expect(document.activeElement).toBe(cel('2027-01'));
    await act(async () => { toets(d, 'PageUp'); });
    expect(document.activeElement).toBe(cel('2026-01'));
    await act(async () => { klik(document.activeElement); });
    expect(onChange).toHaveBeenCalledWith('2026-01');
    expect(veld(container).value).toBe('01/2026');
    expect(document.activeElement).toBe(veld(container));
    await act(async () => { root.unmount(); });
  });

  it('min/max schakelen maanden in het raster uit', async () => {
    const { root, container } = await monteer(<Harnas onChange={() => {}} min="2026-03" max="2026-10" />);
    await act(async () => { klik(knop(container)); });
    expect(cel('2026-02')!.disabled).toBe(true);
    expect(cel('2026-03')!.disabled).toBe(false);
    expect(cel('2026-11')!.disabled).toBe(true);
    await act(async () => { root.unmount(); });
  });

  it('wisbaar={false}: leeg of ongeldig zet de laatst gekozen maand terug, nooit deze maand', async () => {
    const onChange = vi.fn();
    const { root, container } = await monteer(<Harnas onChange={onChange} start="2020-02" wisbaar={false} />);
    const el = veld(container);
    el.focus();
    await act(async () => { typ(el, ''); });
    await act(async () => { el.blur(); });
    expect(el.value).toBe('02/2020');
    el.focus();
    await act(async () => { typ(el, '14/2020'); });
    await act(async () => { el.blur(); });
    expect(el.value).toBe('02/2020');
    expect(container.querySelector('[role="status"]')!.textContent).toBe('Die maand bestaat niet. De vorige maand blijft staan.');
    expect(onChange).not.toHaveBeenCalled();
    await act(async () => { root.unmount(); });
  });

  it('Formulier dient niet in met een ongeldige maand', async () => {
    const onVerstuur = vi.fn();
    function Form() {
      const [v, setV] = useState('2026-09');
      return <Formulier noValidate onVerstuur={() => onVerstuur(v)}><MaandInput id="m" value={v} onChange={setV} aria-label="Maand" /></Formulier>;
    }
    const { root, container } = await monteer(<Form />);
    const el = veld(container);
    el.focus();
    await act(async () => { typ(el, '00/2026'); });
    await act(async () => { el.blur(); });
    await act(async () => { container.querySelector('form')!.requestSubmit(); });
    expect(onVerstuur).not.toHaveBeenCalled();
    await act(async () => { root.unmount(); });
  });
});
