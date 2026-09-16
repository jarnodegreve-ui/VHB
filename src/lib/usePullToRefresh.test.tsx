import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { useRef } from 'react';
import { kaaptVoorouder, usePullToRefresh } from './usePullToRefresh';

vi.mock('./tik', () => ({ tik: vi.fn() }));

/**
 * Pull-to-refresh mag een geneste scroller die zelf nog omhoog kan niet
 * kapen (controle 16-09, nr. 5): de pagina staat bovenaan, maar de lijst
 * erin (overflow-y-auto) is naar beneden gescrold.
 */

const raak = (el: Element, type: string, x: number, y: number) => {
  const e = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(e, 'touches', { value: [{ clientX: x, clientY: y }] });
  el.dispatchEvent(e);
  return e;
};

const maakScroller = (el: HTMLElement, scrollTop: number) => {
  el.style.overflowY = 'auto';
  Object.defineProperty(el, 'scrollTop', { value: scrollTop, configurable: true });
  Object.defineProperty(el, 'scrollHeight', { value: 1000, configurable: true });
  Object.defineProperty(el, 'clientHeight', { value: 300, configurable: true });
};

function Proef({ onRefresh }: { onRefresh: () => void }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const indicatorRef = useRef<HTMLDivElement>(null);
  usePullToRefresh(scrollRef, indicatorRef, onRefresh);
  return (
    <div ref={scrollRef} data-testid="root">
      <div ref={indicatorRef} />
      <div data-testid="lijst">
        <p data-testid="rij">rij</p>
      </div>
    </div>
  );
}

beforeEach(() => {
  // De hook bindt alleen op een touch-toestel.
  (window as unknown as { ontouchstart: null }).ontouchstart = null;
});

afterEach(() => {
  cleanup();
  delete (window as unknown as { ontouchstart?: null }).ontouchstart;
});

describe('kaaptVoorouder', () => {
  it('herkent een gescrolde scroller, een fixed laag, en laat de rest door', () => {
    const root = document.createElement('div');
    const lijst = document.createElement('div');
    const rij = document.createElement('p');
    root.append(lijst);
    lijst.append(rij);
    document.body.append(root);
    expect(kaaptVoorouder(rij, root)).toBe(false);
    maakScroller(lijst, 0);
    expect(kaaptVoorouder(rij, root)).toBe(false);
    maakScroller(lijst, 40);
    expect(kaaptVoorouder(rij, root)).toBe(true);
    // Zelfde scroller, maar alles past in beeld: geen echte scroller.
    Object.defineProperty(lijst, 'scrollHeight', { value: 300, configurable: true });
    expect(kaaptVoorouder(rij, root)).toBe(false);
    lijst.style.overflowY = 'visible';
    lijst.style.position = 'sticky';
    expect(kaaptVoorouder(rij, root)).toBe(true);
    root.remove();
  });
});

describe('usePullToRefresh', () => {
  it('kaapt de sleep in een lijst die bovenaan staat, maar niet in een naar beneden gescrolde lijst', () => {
    const onRefresh = vi.fn();
    const { getByTestId } = render(<Proef onRefresh={onRefresh} />);
    const rij = getByTestId('rij');
    const lijst = getByTestId('lijst');

    maakScroller(lijst, 0);
    raak(rij, 'touchstart', 100, 100);
    const trek = raak(rij, 'touchmove', 100, 160);
    expect(trek.defaultPrevented).toBe(true);
    raak(rij, 'touchcancel', 100, 160);

    maakScroller(lijst, 120);
    raak(rij, 'touchstart', 100, 100);
    const trek2 = raak(rij, 'touchmove', 100, 160);
    expect(trek2.defaultPrevented).toBe(false);
    expect(getByTestId('root').style.transform).toBe('');
  });
});
