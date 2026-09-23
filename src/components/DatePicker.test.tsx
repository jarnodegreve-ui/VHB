import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { DatePicker } from './DatePicker';
import { Field, DateInput } from './Field';
import { Formulier } from './Formulier';

/**
 * Het typbare datumveld (datumtranche PR 1, 23-09): de gebruiker ziet en typt
 * dd/mm/jjjj, het veld geeft ISO door, pas bij blur, Enter of een keuze in de
 * kalender. De parser zelf staat in src/lib/kalender.test.ts.
 */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Na sluiten blijft de dialoog nog even staan voor de exit-animatie
// (AnimatePresence): wachten tot hij echt weg is.
const wachtTotDicht = () => vi.waitFor(() => expect(dialoog()).toBeNull());
afterEach(() => { document.body.innerHTML = ''; });

const klik = (el: Element | null | undefined) => {
  if (!el) throw new Error('element ontbreekt');
  el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
};
const toets = (el: Element, key: string, extra: KeyboardEventInit = {}) => {
  const e = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...extra });
  el.dispatchEvent(e);
  return e;
};
/** Typen zoals React het ziet: waarde zetten via de native setter + input-event (ook voor plakken). */
const typ = (el: HTMLInputElement, tekst: string) => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, tekst);
  el.dispatchEvent(new Event('input', { bubbles: true }));
};
const dialoog = () => document.querySelector<HTMLElement>('[role="dialog"]');
const cel = (iso: string) => document.querySelector<HTMLButtonElement>(`[data-iso="${iso}"]`);
const veld = (c: HTMLElement, id = 'd') => c.querySelector<HTMLInputElement>(`input#${id}`)!;
const kalenderKnop = (c: HTMLElement) => c.querySelector<HTMLButtonElement>('button[aria-label="Kalender openen"]')!;
const fout = (c: HTMLElement) => c.querySelector('[role="alert"]')?.textContent ?? null;

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

describe('DatePicker, typen', () => {
  it('toont de waarde als dd/mm/jjjj en geeft een getypte datum als ISO door bij blur', async () => {
    const onChange = vi.fn();
    const { root, container } = await monteer(<Harnas onChange={onChange} />);
    const el = veld(container);
    expect(el.value).toBe('08/09/2026');
    expect(el.getAttribute('placeholder')).toBe('dd/mm/jjjj');
    expect(el.getAttribute('inputmode')).toBe('numeric');
    el.focus();
    await act(async () => { typ(el, '23/09/2026'); });
    expect(onChange).not.toHaveBeenCalled();
    await act(async () => { el.blur(); });
    expect(onChange).toHaveBeenCalledWith('2026-09-23');
    expect(el.value).toBe('23/09/2026');
    expect(el.getAttribute('data-datum')).toBe('2026-09-23');
    await act(async () => { root.unmount(); });
  });

  it('Enter bevestigt; acht cijfers zonder scheiding (iPhone-klavier) worden netjes dd/mm/jjjj', async () => {
    const onChange = vi.fn();
    const { root, container } = await monteer(<Harnas onChange={onChange} />);
    const el = veld(container);
    el.focus();
    await act(async () => { typ(el, '01102026'); });
    let e!: KeyboardEvent;
    await act(async () => { e = toets(el, 'Enter'); });
    expect(e.defaultPrevented).toBe(false);
    expect(onChange).toHaveBeenCalledWith('2026-10-01');
    expect(el.value).toBe('01/10/2026');
    await act(async () => { root.unmount(); });
  });

  it('onvolledige invoer blijft staan zonder fout; pas bij blur verschijnt de fout en gaat er niets door', async () => {
    const onChange = vi.fn();
    const { root, container } = await monteer(<Harnas onChange={onChange} />);
    const el = veld(container);
    el.focus();
    await act(async () => { typ(el, '23/0'); });
    expect(el.value).toBe('23/0');
    expect(fout(container)).toBeNull();
    expect(el.getAttribute('aria-invalid')).toBeNull();
    await act(async () => { el.blur(); });
    expect(onChange).not.toHaveBeenCalled();
    expect(el.value).toBe('23/0');
    expect(fout(container)).toBe('Gebruik dd/mm/jjjj, bijvoorbeeld 23/09/2026.');
    expect(el.getAttribute('aria-invalid')).toBe('true');
    expect(el.getAttribute('aria-describedby')).toBe(container.querySelector('[role="alert"]')!.id);
    // Verder typen haalt de fout weg tot de volgende bevestiging.
    el.focus();
    await act(async () => { typ(el, '23/09/2026'); });
    expect(fout(container)).toBeNull();
    await act(async () => { root.unmount(); });
  });

  it('30/02 en 29/02 buiten een schrikkeljaar worden geweigerd, 29/02/2028 niet', async () => {
    const onChange = vi.fn();
    const { root, container } = await monteer(<Harnas onChange={onChange} />);
    const el = veld(container);
    for (const [tekst, verwacht] of [['30/02/2026', 'Die dag bestaat niet.'], ['29/02/2027', 'Die dag bestaat niet.'], ['12/13/2026', 'Die maand bestaat niet.']] as const) {
      el.focus();
      await act(async () => { typ(el, tekst); });
      await act(async () => { el.blur(); });
      expect(fout(container)).toBe(verwacht);
    }
    expect(onChange).not.toHaveBeenCalled();
    el.focus();
    await act(async () => { typ(el, '29/02/2028'); });
    await act(async () => { el.blur(); });
    expect(onChange).toHaveBeenCalledWith('2028-02-29');
    await act(async () => { root.unmount(); });
  });

  it('Enter op een ongeldige datum dient niet in', async () => {
    const { root, container } = await monteer(<Harnas onChange={() => {}} />);
    const el = veld(container);
    el.focus();
    await act(async () => { typ(el, '31/04/2026'); });
    let e!: KeyboardEvent;
    await act(async () => { e = toets(el, 'Enter'); });
    expect(e.defaultPrevented).toBe(true);
    expect(fout(container)).toBe('Die dag bestaat niet.');
    await act(async () => { root.unmount(); });
  });

  it('min/max gelden ook voor typen', async () => {
    const onChange = vi.fn();
    const { root, container } = await monteer(<Harnas onChange={onChange} min="2026-09-05" max="2026-09-20" />);
    const el = veld(container);
    el.focus();
    await act(async () => { typ(el, '04/09/2026'); });
    await act(async () => { el.blur(); });
    expect(fout(container)).toBe('Vroegst 05/09/2026.');
    el.focus();
    await act(async () => { typ(el, '21/09/2026'); });
    await act(async () => { el.blur(); });
    expect(fout(container)).toBe('Uiterlijk 20/09/2026.');
    expect(onChange).not.toHaveBeenCalled();
    el.focus();
    await act(async () => { typ(el, '20/09/2026'); });
    await act(async () => { el.blur(); });
    expect(onChange).toHaveBeenCalledWith('2026-09-20');
    await act(async () => { root.unmount(); });
  });

  it('leegmaken geeft een lege waarde door', async () => {
    const onChange = vi.fn();
    const { root, container } = await monteer(<Harnas onChange={onChange} />);
    const el = veld(container);
    el.focus();
    await act(async () => { typ(el, ''); });
    await act(async () => { el.blur(); });
    expect(onChange).toHaveBeenCalledWith('');
    await act(async () => { root.unmount(); });
  });

  it('een waarde van buiten (formulier gereset) komt in het veld', async () => {
    function Buiten() {
      const [v, setV] = useState('2026-09-08');
      return <><DatePicker id="d" value={v} onChange={setV} aria-label="Datum" /><button type="button" id="reset" onClick={() => setV('2026-12-24')}>reset</button></>;
    }
    const { root, container } = await monteer(<Buiten />);
    await act(async () => { klik(container.querySelector('#reset')); });
    expect(veld(container).value).toBe('24/12/2026');
    await act(async () => { root.unmount(); });
  });
});

describe('DatePicker, kalender', () => {
  it('de kalenderknop opent de dialoog, een keuze vult het veld en geeft ISO door, focus terug in het veld', async () => {
    const onChange = vi.fn();
    const { root, container } = await monteer(<Harnas onChange={onChange} />);
    const knop = kalenderKnop(container);
    expect(knop.getAttribute('aria-haspopup')).toBe('dialog');
    expect(knop.getAttribute('aria-expanded')).toBe('false');
    await act(async () => { klik(knop); });
    expect(knop.getAttribute('aria-expanded')).toBe('true');
    // Maandkop + geselecteerde dag + raster van 42 cellen dat op maandag begint.
    expect(dialoog()!.textContent).toContain('September 2026');
    expect(cel('2026-09-08')!.getAttribute('aria-selected')).toBe('true');
    expect(document.querySelectorAll('[data-iso]')).toHaveLength(42);
    expect(document.querySelector('[data-iso]')!.getAttribute('data-iso')).toBe('2026-08-31');
    expect(document.activeElement).toBe(cel('2026-09-08'));
    await act(async () => { klik(cel('2026-09-15')); });
    expect(onChange).toHaveBeenCalledWith('2026-09-15');
    expect(veld(container).value).toBe('15/09/2026');
    expect(document.activeElement).toBe(veld(container));
    await wachtTotDicht();
    await act(async () => { root.unmount(); });
  });

  it('opent op de getypte datum, niet op de oude waarde', async () => {
    const { root, container } = await monteer(<Harnas onChange={() => {}} />);
    const el = veld(container);
    el.focus();
    await act(async () => { typ(el, '02/03/2027'); });
    await act(async () => { toets(el, 'ArrowDown'); });
    expect(dialoog()!.textContent).toContain('Maart 2027');
    expect(document.activeElement).toBe(cel('2027-03-02'));
    await act(async () => { toets(dialoog()!, 'Escape'); });
    await wachtTotDicht();
    await act(async () => { root.unmount(); });
  });

  it('toetsenbord: pijlen, PageDown, Enter kiest, Esc sluit met de focus terug in het veld', async () => {
    const onChange = vi.fn();
    const { root, container } = await monteer(<Harnas onChange={onChange} />);
    const el = veld(container);
    el.focus();
    await act(async () => { toets(el, 'ArrowDown'); });
    const d = dialoog()!;
    await act(async () => { toets(d, 'ArrowRight'); });
    expect(document.activeElement).toBe(cel('2026-09-09'));
    await act(async () => { toets(d, 'ArrowDown'); });
    expect(document.activeElement).toBe(cel('2026-09-16'));
    await act(async () => { toets(d, 'PageDown'); });
    expect(d.textContent).toContain('Oktober 2026');
    expect(document.activeElement).toBe(cel('2026-10-16'));
    await act(async () => { toets(d, 'Home'); });
    expect(document.activeElement).toBe(cel('2026-10-12'));
    await act(async () => { toets(d, 'Escape'); });
    expect(document.activeElement).toBe(el);
    await wachtTotDicht();
    expect(onChange).not.toHaveBeenCalled();
    await act(async () => { toets(el, 'ArrowDown'); });
    await act(async () => { toets(dialoog()!, 'ArrowLeft'); });
    await act(async () => { klik(document.activeElement); });
    expect(onChange).toHaveBeenCalledWith('2026-09-07');
    await act(async () => { root.unmount(); });
  });

  it('min/max: dagen buiten het bereik zijn uitgeschakeld, Wissen maakt leeg', async () => {
    const onChange = vi.fn();
    const { root, container } = await monteer(<Harnas onChange={onChange} min="2026-09-05" max="2026-09-20" />);
    await act(async () => { klik(kalenderKnop(container)); });
    expect(cel('2026-09-04')!.disabled).toBe(true);
    expect(cel('2026-09-05')!.disabled).toBe(false);
    expect(cel('2026-09-21')!.disabled).toBe(true);
    await act(async () => { klik(cel('2026-09-04')); });
    expect(onChange).not.toHaveBeenCalled();
    const wissen = [...document.querySelectorAll('button')].find((b) => b.textContent === 'Wissen')!;
    await act(async () => { klik(wissen); });
    expect(onChange).toHaveBeenCalledWith('');
    expect(veld(container).value).toBe('');
    await act(async () => { root.unmount(); });
  });

  it('onder 640 px opent de kalender als sheet met cellen van 44 px', async () => {
    const breedte = window.innerWidth;
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
    try {
      const { root, container } = await monteer(<Harnas onChange={() => {}} />);
      await act(async () => { klik(kalenderKnop(container)); });
      const sheet = dialoog()!;
      expect(sheet.className).toContain('inset-x-0');
      expect(sheet.getAttribute('aria-modal')).toBe('true');
      const klassen = cel('2026-09-08')!.className.split(' ');
      expect(klassen).toEqual(expect.arrayContaining(['h-11', 'w-11', 'sm:pointer-fine:h-9', 'sm:pointer-fine:w-9']));
      await act(async () => { root.unmount(); });
    } finally {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: breedte });
    }
  });
});

describe('DatePicker wisbaar={false} (navigatievelden, PR 3)', () => {
  it('leegmaken zet de huidige datum terug en geeft niets door; geen Wissen in de kalender', async () => {
    const onChange = vi.fn();
    function Nav() {
      const [v, setV] = useState('2026-09-08');
      return <DatePicker id="d" value={v} wisbaar={false} onChange={(n) => { setV(n); onChange(n); }} aria-label="Dag" />;
    }
    const { root, container } = await monteer(<Nav />);
    const el = veld(container);
    el.focus();
    await act(async () => { typ(el, ''); });
    await act(async () => { el.blur(); });
    expect(onChange).not.toHaveBeenCalled();
    expect(el.value).toBe('08/09/2026');
    expect(fout(container)).toBeNull();
    await act(async () => { klik(kalenderKnop(container)); });
    expect([...document.querySelectorAll('button')].some((b) => b.textContent === 'Wissen')).toBe(false);
    expect([...document.querySelectorAll('button')].some((b) => b.textContent === 'Vandaag')).toBe(true);
    await act(async () => { root.unmount(); });
  });

  it('een geldige datum gaat gewoon door', async () => {
    const onChange = vi.fn();
    const { root, container } = await monteer(<DatePicker id="d" value="2026-09-08" wisbaar={false} onChange={onChange} aria-label="Dag" />);
    const el = veld(container);
    el.focus();
    await act(async () => { typ(el, '10/09/2026'); });
    await act(async () => { el.blur(); });
    expect(onChange).toHaveBeenCalledWith('2026-09-10');
    await act(async () => { root.unmount(); });
  });
});

describe('DatePicker in formulieren', () => {
  it('required: een leeg veld blokkeert de native validatie; FormData draagt de ISO-waarde', async () => {
    const leeg = await monteer(<form><DatePicker id="d" name="datum" required value="" onChange={() => {}} aria-label="Datum" /></form>);
    expect(leeg.container.querySelector('form')!.checkValidity()).toBe(false);
    await act(async () => { leeg.root.unmount(); });

    const gevuld = await monteer(<form><DatePicker id="e" name="datum" required value="2026-09-08" onChange={() => {}} aria-label="Datum" /></form>);
    const form = gevuld.container.querySelector('form')!;
    expect(form.checkValidity()).toBe(true);
    expect(new FormData(form).get('datum')).toBe('2026-09-08');
    await act(async () => { gevuld.root.unmount(); });
  });

  it('Formulier dient niet in zolang de getypte datum ongeldig is (geen stille oude waarde)', async () => {
    const onVerstuur = vi.fn();
    function Form() {
      const [v, setV] = useState('2026-09-08');
      return (
        <Formulier noValidate onVerstuur={() => onVerstuur(v)}>
          <DatePicker id="d" value={v} onChange={setV} aria-label="Datum" />
          <button type="submit">Opslaan</button>
        </Formulier>
      );
    }
    const { root, container } = await monteer(<Form />);
    const el = veld(container);
    const form = container.querySelector('form')!;
    el.focus();
    await act(async () => { typ(el, '31/02/2026'); });
    await act(async () => { el.blur(); });
    await act(async () => { form.requestSubmit(); });
    expect(onVerstuur).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(el);
    el.focus();
    await act(async () => { typ(el, '28/02/2026'); });
    await act(async () => { el.blur(); });
    await act(async () => { form.requestSubmit(); });
    expect(onVerstuur).toHaveBeenCalledWith('2026-02-28');
    await act(async () => { root.unmount(); });
  });

  it('DateInput in een Field: label, hint en fout hangen aan het tekstveld', async () => {
    const { root, container } = await monteer(
      <Field label="Van" error="Kies een datum." htmlFor="van">
        {({ id, describedBy, invalid }) => <DateInput id={id} aria-describedby={describedBy} invalid={invalid} value="" onChange={() => {}} />}
      </Field>,
    );
    const el = veld(container, 'van');
    expect(container.querySelector('label')!.getAttribute('for')).toBe('van');
    expect(el.getAttribute('aria-invalid')).toBe('true');
    expect(el.getAttribute('aria-describedby')).toBe('van-fout');
    expect(container.querySelector('#van-fout')!.textContent).toBe('Kies een datum.');
    await act(async () => { root.unmount(); });
  });
});
