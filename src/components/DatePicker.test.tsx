import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { DatePicker } from './DatePicker';
import { Field, DateInput } from './Field';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Na sluiten blijft de dialoog nog even staan voor de exit-animatie
// (AnimatePresence): wachten tot hij echt weg is.
const wachtTotDicht = () => vi.waitFor(() => expect(dialoog()).toBeNull());
afterEach(() => { document.body.innerHTML = ''; });

const klik = (el: Element | null | undefined) => {
  if (!el) throw new Error('element ontbreekt');
  el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
};
const toets = (el: Element, key: string) => el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
const dialoog = () => document.querySelector<HTMLElement>('[role="dialog"]');
const cel = (iso: string) => document.querySelector<HTMLButtonElement>(`[data-iso="${iso}"]`);

function Harnas({ onChange, start = '2026-09-08', min, max }: { onChange: (v: string) => void; start?: string; min?: string; max?: string }) {
  const [v, setV] = useState(start);
  return <DatePicker id="d" value={v} min={min} max={max} onChange={(n) => { setV(n); onChange(n); }} aria-label="Datum" />;
}

async function monteer(ui: React.ReactElement): Promise<{ root: Root; container: HTMLElement }> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(ui); });
  return { root, container };
}

describe('DatePicker', () => {
  it('toont de datum in huisstijl, opent de dialoog, kiest een dag en geeft ISO terug', async () => {
    const onChange = vi.fn();
    const { root, container } = await monteer(<Harnas onChange={onChange} />);
    const trigger = container.querySelector<HTMLButtonElement>('button#d')!;
    expect(trigger.textContent).toContain('di 8 sep 2026');
    expect(trigger.getAttribute('aria-haspopup')).toBe('dialog');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(dialoog()).toBeNull();

    await act(async () => { klik(trigger); });
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(dialoog()).not.toBeNull();
    // Maandkop + geselecteerde dag + raster van 42 cellen dat op maandag begint.
    expect(dialoog()!.textContent).toContain('September 2026');
    expect(cel('2026-09-08')!.getAttribute('aria-selected')).toBe('true');
    expect(document.querySelectorAll('[data-iso]')).toHaveLength(42);
    expect(document.querySelector('[data-iso]')!.getAttribute('data-iso')).toBe('2026-08-31');
    expect(document.activeElement).toBe(cel('2026-09-08'));

    await act(async () => { klik(cel('2026-09-15')); });
    expect(onChange).toHaveBeenCalledWith('2026-09-15');
    expect(trigger.textContent).toContain('di 15 sep 2026');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(trigger);
    await wachtTotDicht();

    await act(async () => { root.unmount(); });
  });

  it('toetsenbord: pijlen verplaatsen, PageDown springt een maand, Enter kiest, Esc sluit met focus terug', async () => {
    const onChange = vi.fn();
    const { root, container } = await monteer(<Harnas onChange={onChange} />);
    const trigger = container.querySelector<HTMLButtonElement>('button#d')!;
    await act(async () => { klik(trigger); });
    const d = dialoog()!;
    await act(async () => { toets(d, 'ArrowRight'); });
    expect(document.activeElement).toBe(cel('2026-09-09'));
    await act(async () => { toets(d, 'ArrowDown'); });
    expect(document.activeElement).toBe(cel('2026-09-16'));
    await act(async () => { toets(d, 'PageDown'); });
    expect(d.textContent).toContain('Oktober 2026');
    expect(document.activeElement).toBe(cel('2026-10-16'));
    await act(async () => { toets(d, 'Escape'); });
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(trigger);
    await wachtTotDicht();
    expect(onChange).not.toHaveBeenCalled();

    await act(async () => { klik(trigger); });
    await act(async () => { toets(dialoog()!, 'ArrowLeft'); });
    await act(async () => { klik(document.activeElement); });
    expect(onChange).toHaveBeenCalledWith('2026-09-07');
    await act(async () => { root.unmount(); });
  });

  it('min/max: dagen buiten het bereik zijn uitgeschakeld, Wissen maakt leeg', async () => {
    const onChange = vi.fn();
    const { root, container } = await monteer(<Harnas onChange={onChange} min="2026-09-05" max="2026-09-20" />);
    const trigger = container.querySelector<HTMLButtonElement>('button#d')!;
    await act(async () => { klik(trigger); });
    expect(cel('2026-09-04')!.disabled).toBe(true);
    expect(cel('2026-09-05')!.disabled).toBe(false);
    expect(cel('2026-09-21')!.disabled).toBe(true);
    await act(async () => { klik(cel('2026-09-04')); });
    expect(onChange).not.toHaveBeenCalled();
    const wissen = [...document.querySelectorAll('button')].find((b) => b.textContent === 'Wissen')!;
    await act(async () => { klik(wissen); });
    expect(onChange).toHaveBeenCalledWith('');
    expect(trigger.textContent).toContain('Kies een datum');
    await act(async () => { root.unmount(); });
  });

  it('DateInput in een Field: label, hint en fout hangen aan de trigger', async () => {
    const { root, container } = await monteer(
      <Field label="Van" error="Kies een datum." htmlFor="van">
        {({ id, describedBy, invalid }) => <DateInput id={id} aria-describedby={describedBy} invalid={invalid} value="" onChange={() => {}} />}
      </Field>,
    );
    const trigger = container.querySelector<HTMLButtonElement>('button#van')!;
    expect(container.querySelector('label')!.getAttribute('for')).toBe('van');
    expect(trigger.getAttribute('aria-invalid')).toBe('true');
    expect(trigger.getAttribute('aria-describedby')).toBe('van-fout');
    expect(container.querySelector('#van-fout')!.textContent).toBe('Kies een datum.');
    await act(async () => { root.unmount(); });
  });
});
