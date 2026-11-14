import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { within } from '@testing-library/dom';
import { Verwissel } from './Verwissel';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * Verwissel (ronde 6, punt 3): een cross-fade van skelet naar inhoud. De
 * minimale weergave van 180 ms blijft, maar zodra ze voorbij is staat de
 * inhoud er meteen, met het vervagende skelet erboven, tot zijn animationend
 * of het vangnet (DUR.fast + 80 ms = 230 ms).
 */

let root: Root | null = null;
let container: HTMLElement;
let mounts = 0;

function Inhoud() {
  useEffect(() => { mounts += 1; }, []);
  return (
    <section>
      <h1>Mijn dag</h1>
      <button type="button">Opslaan</button>
    </section>
  );
}

const SKELET = (
  <div role="status" aria-busy="true" aria-label="Scherm wordt geladen" data-skelet="">
    <h1>Mijn dag</h1>
  </div>
);

async function toon(laden: boolean) {
  await act(async () => {
    root!.render(<Verwissel laden={laden} skelet={SKELET}><Inhoud /></Verwissel>);
  });
}

async function wacht(ms: number) {
  await act(async () => { vi.advanceTimersByTime(ms); });
}

const wrapper = () => container.firstElementChild as HTMLElement;
const skelet = () => container.querySelector<HTMLElement>('[data-skelet]');
const laag = () => skelet()?.parentElement ?? null;
const inhoud = () => container.querySelector('section');

/** jsdom kent geen AnimationEvent; React luistert dan naar de webkit-naam
 *  als de stijl die kent, anders naar `animationend`. Beide sturen: er
 *  luistert er maar één. */
function animatieKlaar(el: Element, naam = 'vhb-fade-uit') {
  for (const type of ['animationend', 'webkitAnimationEnd']) {
    const e = new Event(type, { bubbles: true });
    Object.defineProperty(e, 'animationName', { value: naam });
    el.dispatchEvent(e);
  }
}

function zetMinderBeweging(aan: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string) => ({ matches: aan && query.includes('reduce'), media: query, addEventListener() {}, removeEventListener() {} }),
  });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance', 'Date'] });
  // De nep-klok start op 0; een echte pagina staat al even open.
  vi.advanceTimersByTime(1000);
  mounts = 0;
  zetMinderBeweging(false);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => { root?.unmount(); });
  root = null;
  container.remove();
  vi.useRealTimers();
  delete (window as { matchMedia?: unknown }).matchMedia;
  vi.restoreAllMocks();
});

describe('Verwissel', () => {
  it('begint zonder skelet: de inhoud staat er meteen, in een kale wrapper zonder inloop', async () => {
    await toon(false);
    expect(skelet()).toBeNull();
    expect(inhoud()).not.toBeNull();
    expect(wrapper().className).toBe('');
    expect(inhoud()!.parentElement).toBe(wrapper());
    expect(vi.getTimerCount()).toBe(0);
  });

  it('laden van 50 ms: het skelet blijft 180 ms staan, dan komt de inhoud op terwijl het skelet erboven vervaagt', async () => {
    await toon(true);
    await wacht(50);
    await toon(false);
    expect(skelet()).not.toBeNull();
    expect(inhoud()).toBeNull();
    await wacht(129);
    expect(inhoud(), 'nog binnen de 180 ms').toBeNull();
    await wacht(1);
    // De overlap: inhoud en skelet allebei in de DOM.
    expect(inhoud()).not.toBeNull();
    expect(skelet()).not.toBeNull();
    expect(inhoud()!.parentElement!.className).toBe('fade-in');
    expect(laag()!.className).toContain('fade-uit');
    expect(laag()!.className).toContain('absolute');
    expect(laag()!.className).toContain('pointer-events-none');
    expect(laag()!.className).toContain('overflow-clip');
    expect(laag()!.getAttribute('aria-hidden')).toBe('true');
    expect(wrapper().className).toBe('relative');
    // Inhoud eerst in de DOM, de laag erna (hij tekent erboven).
    expect(wrapper().firstElementChild).toBe(inhoud()!.parentElement);
    expect(wrapper().lastElementChild).toBe(laag());
  });

  it('laden van 400 ms: geen extra wachttijd, de overlap begint meteen', async () => {
    await toon(true);
    await wacht(400);
    await toon(false);
    expect(inhoud()).not.toBeNull();
    expect(laag()!.getAttribute('aria-hidden')).toBe('true');
  });

  it('na de animationend van het skelet is de laag weg en de wrapper weer kaal; de inhoud mount niet opnieuw', async () => {
    await toon(true);
    await wacht(400);
    await toon(false);
    const sectie = inhoud();
    // Een animationend van een kind (bubbelt) of van een andere animatie telt niet.
    await act(async () => { animatieKlaar(skelet()!); animatieKlaar(laag()!, 'vhb-fade-in'); });
    expect(skelet()).not.toBeNull();
    await act(async () => { animatieKlaar(laag()!); });
    expect(skelet()).toBeNull();
    expect(wrapper().className).toBe('');
    expect(wrapper().children).toHaveLength(1);
    expect(inhoud()).toBe(sectie);
    expect(inhoud()!.parentElement!.className).toBe('fade-in');
    expect(mounts).toBe(1);
    // Het vangnet dat daarna nog afloopt, verandert niets meer.
    await wacht(500);
    expect(inhoud()).toBe(sectie);
    expect(wrapper().children).toHaveLength(1);
    expect(mounts).toBe(1);
  });

  it('vangnet zonder animationend: na 230 ms is het skelet weg', async () => {
    await toon(true);
    await wacht(400);
    await toon(false);
    await wacht(229);
    expect(skelet()).not.toBeNull();
    await wacht(1);
    expect(skelet()).toBeNull();
    expect(inhoud()).not.toBeNull();
    expect(wrapper().className).toBe('');
    expect(mounts).toBe(1);
  });

  it('laden dat tijdens de overlap terugkomt: weer alleen het skelet, nooit twee keer de inhoud', async () => {
    await toon(true);
    await wacht(400);
    await toon(false);
    expect(inhoud()).not.toBeNull();
    await toon(true);
    expect(inhoud()).toBeNull();
    expect(skelet()).not.toBeNull();
    // Terug in de flow: geen laagklassen, wel weer de laadstatus.
    expect(laag()!.className).toBe('');
    expect(laag()!.hasAttribute('aria-hidden')).toBe(false);
    expect(wrapper().className).toBe('');
    expect(within(container).getByRole('status')).toBe(skelet());
    // Het oude vangnet doet niets meer.
    await wacht(500);
    expect(skelet()).not.toBeNull();
    expect(inhoud()).toBeNull();
    await toon(false);
    expect(container.querySelectorAll('section')).toHaveLength(1);
    await wacht(230);
    expect(skelet()).toBeNull();
    expect(container.querySelectorAll('section')).toHaveLength(1);
  });

  it('tijdens de overlap is alleen de inhoud bedienbaar en hoorbaar', async () => {
    await toon(true);
    await wacht(400);
    await toon(false);
    const scherm = within(container);
    expect(scherm.queryByRole('status')).toBeNull();
    expect(scherm.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(scherm.getByRole('heading', { level: 1 }).closest('section')).toBe(inhoud());
    expect(scherm.getByRole('button', { name: 'Opslaan' })).not.toBeNull();
  });

  /** Nep-layout: de wrapper staat op `wrapperTop` (skelet- of overlapfase),
   *  het eerste element van het skelet op `skeletTop` (in de flow of in de
   *  absolute laag, vóór die verschoven is). */
  function nepLayout(maat: { wrapper: [number, number]; skelet: [number, number] }) {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const overlap = wrapper().classList.contains('relative');
      const top = this === wrapper() ? maat.wrapper[overlap ? 1 : 0] : this.hasAttribute('data-skelet') ? maat.skelet[overlap ? 1 : 0] : 0;
      return { top, bottom: 0, left: 0, right: 0, width: 0, height: 0, x: 0, y: 0, toJSON() {} } as DOMRect;
    });
  }

  it('een bovenmarge die in de flow wegviel: de laag schuift het verschil terug, zodat het skelet niet verspringt', async () => {
    // In de flow viel de marge van 17 px door de wrapper heen (skelet en
    // wrapper delen hun bovenrand); in de absolute laag, een eigen
    // blokcontext, staat ze tussen laag en skelet.
    nepLayout({ wrapper: [116, 116], skelet: [116, 133] });
    await toon(true);
    await wacht(400);
    await toon(false);
    expect(laag()!.style.top).toBe('-17px');
  });

  it('wat erboven in dezelfde render van hoogte wisselt: het skelet volgt zijn wrapper, zoals de inhoud', async () => {
    nepLayout({ wrapper: [416, 336], skelet: [416, 336] });
    await toon(true);
    await wacht(400);
    await toon(false);
    expect(laag()!.style.top).toBe('0px');
  });

  it('reduced motion: meteen de inhoud, geen laag en geen timer die blijft hangen', async () => {
    zetMinderBeweging(true);
    await toon(true);
    await wacht(50);
    await toon(false);
    await wacht(130);
    expect(skelet()).toBeNull();
    expect(inhoud()).not.toBeNull();
    expect(wrapper().className).toBe('');
    expect(vi.getTimerCount()).toBe(0);
    expect(mounts).toBe(1);
  });
});
