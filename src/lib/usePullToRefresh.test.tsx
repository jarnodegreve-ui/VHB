import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { useRef } from 'react';
import { tik } from './tik';
import { kaaptVoorouder, MAX_PULL, rek, THRESHOLD, usePullToRefresh } from './usePullToRefresh';

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

function Proef({ onRefresh }: { onRefresh: () => Promise<unknown> | void }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const indicatorRef = useRef<HTMLDivElement>(null);
  usePullToRefresh(scrollRef, indicatorRef, onRefresh);
  return (
    <div ref={scrollRef} data-testid="root">
      <div ref={indicatorRef} data-testid="indicator" />
      <div data-testid="lijst">
        <p data-testid="rij">rij</p>
      </div>
    </div>
  );
}

beforeEach(() => {
  // De hook bindt alleen op een touch-toestel.
  (window as unknown as { ontouchstart: null }).ontouchstart = null;
  vi.mocked(tik).mockClear();
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

/**
 * De rek (ronde 6, punt 5): tot de drempel de helft van de vinger, zoals
 * altijd; daarboven dooft ze uit naar MAX_PULL in plaats van op een harde
 * stop te lopen. De drempel van 70 px geldt voor de rek, de vinger legt dus
 * 140 px af.
 */
describe('rek', () => {
  // Een vinger kan niet verder dan het scherm hoog is. 2000 px is ruim meer
  // dan elk toestel (iPhone ±930, een grote tablet ±1400). Voorbij ±3000 px
  // rondt een kommagetal de formule af op precies 110: dat is rekenwerk, geen
  // gedrag dat een vinger kan halen.
  const BEREIK = 2000;

  it('is tot de drempel de helft van de vinger, zoals voorheen', () => {
    for (let dy = 0; dy <= 140; dy++) expect(rek(dy)).toBe(dy * 0.5);
    expect(rek(120)).toBe(60);
    expect(rek(140)).toBe(THRESHOLD);
  });

  it('blijft stijgen en komt nooit op of boven MAX_PULL', () => {
    let vorige = rek(0);
    for (let dy = 1; dy <= BEREIK; dy++) {
      const nu = rek(dy);
      expect(nu, `stijgend op ${dy} px`).toBeGreaterThan(vorige);
      expect(nu, `onder de grens op ${dy} px`).toBeLessThan(MAX_PULL);
      vorige = nu;
    }
    // Waar de oude curve hard stopte (vinger 220 px = 110) geeft de nieuwe nog mee.
    expect(rek(220)).toBeLessThan(MAX_PULL - 10);
    expect(rek(180)).toBeCloseTo(85.74, 2);
  });

  it('heeft geen sprong en geen knik op de drempel', () => {
    const stap = 0.001;
    // Geen sprong: vlak onder en vlak boven liggen tegen elkaar aan.
    expect(rek(140 + stap) - rek(140 - stap)).toBeLessThan(2 * stap);
    // Geen knik: de helling links (een halve px per px vinger) is die rechts.
    const links = (rek(140) - rek(140 - stap)) / stap;
    const rechts = (rek(140 + stap) - rek(140)) / stap;
    expect(links).toBeCloseTo(0.5, 6);
    expect(rechts).toBeCloseTo(0.5, 4);
    // En vanaf daar neemt de helling alleen nog af (geen tweede versnelling).
    let helling = rechts;
    for (let dy = 141; dy <= 600; dy++) {
      const h = rek(dy + 1) - rek(dy);
      expect(h, `helling op ${dy} px`).toBeLessThan(helling);
      helling = h;
    }
  });
});

describe('drempelstaat en verversen', () => {
  const opDrempel = (el: HTMLElement) => el.hasAttribute('data-drempel');
  /** Vinger neer op y = 100 en omlaag tot `dy` px, eerst voorbij de richtingsmarge. */
  const trekTot = (el: Element, dy: number) => {
    raak(el, 'touchstart', 100, 100);
    raak(el, 'touchmove', 100, 110);
    return raak(el, 'touchmove', 100, 100 + dy);
  };
  const laatLos = async (el: Element) => { await act(async () => { raak(el, 'touchend', 100, 100); }); };

  it('staat aan vanaf 70 px rek (vinger 140), uit eronder, en volgt de vinger terug', () => {
    const { getByTestId } = render(<Proef onRefresh={vi.fn()} />);
    const rij = getByTestId('rij');
    const indicator = getByTestId('indicator');
    const root = getByTestId('root');

    trekTot(rij, 139);
    expect(root.style.transform).toBe('translateY(69.5px)');
    expect(opDrempel(indicator)).toBe(false);
    expect(tik).not.toHaveBeenCalled();

    raak(rij, 'touchmove', 100, 240);
    expect(root.style.transform).toBe('translateY(70px)');
    expect(opDrempel(indicator)).toBe(true);
    expect(tik).toHaveBeenCalledTimes(1);

    raak(rij, 'touchmove', 100, 239);
    expect(opDrempel(indicator)).toBe(false);

    // Nog eens over de drempel: de staat komt terug, de tik niet (één per sleep).
    raak(rij, 'touchmove', 100, 280);
    expect(opDrempel(indicator)).toBe(true);
    expect(tik).toHaveBeenCalledTimes(1);
    expect(tik).toHaveBeenCalledWith('drempel');
  });

  it('ververst niet bij loslaten onder de drempel, ook niet na een uitstap erboven', async () => {
    const onRefresh = vi.fn();
    const { getByTestId } = render(<Proef onRefresh={onRefresh} />);
    const rij = getByTestId('rij');
    const root = getByTestId('root');

    trekTot(rij, 120);
    expect(root.style.transform).toBe('translateY(60px)');
    await laatLos(rij);
    expect(onRefresh).not.toHaveBeenCalled();
    expect(root.style.transform).toBe('');

    trekTot(rij, 200);
    expect(opDrempel(getByTestId('indicator'))).toBe(true);
    raak(rij, 'touchmove', 100, 220);
    await laatLos(rij);
    expect(onRefresh).not.toHaveBeenCalled();
    expect(opDrempel(getByTestId('indicator'))).toBe(false);
    expect(root.style.transform).toBe('');
    // Terugveren op de ladder, niet op een los getal.
    expect(root.style.transition).toBe('transform var(--duration-fast) var(--ease-standard)');
  });

  it('ververst één keer bij loslaten boven de drempel en houdt de staat vast tot het klaar is', async () => {
    let klaar: () => void = () => undefined;
    const onRefresh = vi.fn(() => new Promise<void>((r) => { klaar = r; }));
    const { getByTestId } = render(<Proef onRefresh={onRefresh} />);
    const rij = getByTestId('rij');
    const root = getByTestId('root');
    const indicator = getByTestId('indicator');

    trekTot(rij, 180);
    expect(Number.parseFloat(root.style.transform.replace('translateY(', ''))).toBeCloseTo(85.74, 2);
    await laatLos(rij);
    expect(onRefresh).toHaveBeenCalledTimes(1);
    // Tijdens het verversen: op de drempel, op de ladder, de staat nog aan.
    expect(root.style.transform).toBe('translateY(70px)');
    expect(root.style.transition).toBe('transform var(--duration-fast) var(--ease-standard)');
    expect(opDrempel(indicator)).toBe(true);

    // Een tweede sleep terwijl het loopt start niets nieuws.
    trekTot(rij, 200);
    await laatLos(rij);
    expect(onRefresh).toHaveBeenCalledTimes(1);

    await act(async () => { klaar(); });
    expect(opDrempel(indicator)).toBe(false);
    expect(root.style.transform).toBe('');
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it('laat een horizontale veeg los: geen kaping, geen staat, geen verversing', async () => {
    const onRefresh = vi.fn();
    const { getByTestId } = render(<Proef onRefresh={onRefresh} />);
    const rij = getByTestId('rij');
    raak(rij, 'touchstart', 100, 100);
    const opzij = raak(rij, 'touchmove', 130, 104);
    // Eenmaal losgelaten blijft het los, ook als de vinger daarna ver zakt.
    const omlaag = raak(rij, 'touchmove', 130, 400);
    expect(opzij.defaultPrevented).toBe(false);
    expect(omlaag.defaultPrevented).toBe(false);
    expect(getByTestId('root').style.transform).toBe('');
    expect(opDrempel(getByTestId('indicator'))).toBe(false);
    await laatLos(rij);
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it('kaapt niets in een overlay (fixed laag in de container) en niet in een gescrolde lijst', async () => {
    const onRefresh = vi.fn();
    const { getByTestId } = render(<Proef onRefresh={onRefresh} />);
    const rij = getByTestId('rij');
    const lijst = getByTestId('lijst');

    lijst.style.position = 'fixed';
    const inOverlay = trekTot(rij, 200);
    expect(inOverlay.defaultPrevented).toBe(false);
    expect(opDrempel(getByTestId('indicator'))).toBe(false);
    await laatLos(rij);

    lijst.style.position = '';
    maakScroller(lijst, 120);
    const inLijst = trekTot(rij, 200);
    expect(inLijst.defaultPrevented).toBe(false);
    expect(opDrempel(getByTestId('indicator'))).toBe(false);
    await laatLos(rij);

    expect(getByTestId('root').style.transform).toBe('');
    expect(onRefresh).not.toHaveBeenCalled();
  });
});
