import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { kiesRecord, metOvergang, recordNaam } from './overgang';

/**
 * View-transition-helpers: zonder browserondersteuning of met reduced motion
 * gebeurt de update meteen; mét ondersteuning loopt de update in de
 * callback, staat de soort-klasse op <html> zolang de overgang duurt en
 * krijgen rij en paneel tijdelijk dezelfde view-transition-name.
 */
type Start = (cb: () => void) => { finished: Promise<void> };
const doc = document as Document & { startViewTransition?: Start };

let reduced = false;
let inline = true;
beforeEach(() => {
  reduced = false;
  inline = true;
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('reduced-motion') ? reduced : inline,
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
  // jsdom kent CSS.escape niet.
  vi.stubGlobal('CSS', { escape: (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, (c) => `\\${c}`) });
});
afterEach(() => {
  delete doc.startViewTransition;
  document.documentElement.className = '';
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

/** Nep-startViewTransition: de callback loopt in een microtask (`bijgewerkt`),
 *  `finished` pas een macrotask later — zoals de browser eerst de nieuwe
 *  staat vastlegt en daarna animeert. */
function nepOvergang() {
  const aanroepen: Array<() => void> = [];
  let klaar!: () => void;
  let bijgewerktKlaar!: () => void;
  const finished = new Promise<void>((r) => { klaar = r; });
  const bijgewerkt = new Promise<void>((r) => { bijgewerktKlaar = r; });
  doc.startViewTransition = (cb) => {
    aanroepen.push(cb);
    queueMicrotask(() => { cb(); bijgewerktKlaar(); setTimeout(klaar, 0); });
    return { finished };
  };
  return { aanroepen, finished, bijgewerkt };
}

describe('metOvergang', () => {
  it('voert de update direct uit zonder startViewTransition', () => {
    const update = vi.fn();
    metOvergang(update);
    expect(update).toHaveBeenCalledOnce();
    expect(document.documentElement.classList.contains('vt-route')).toBe(false);
  });

  it('voert de update direct uit bij prefers-reduced-motion', () => {
    reduced = true;
    nepOvergang();
    const update = vi.fn();
    metOvergang(update);
    expect(update).toHaveBeenCalledOnce();
  });

  it('laat de update in de overgang lopen en markeert <html> zolang die duurt', async () => {
    const { aanroepen, finished } = nepOvergang();
    const update = vi.fn();
    metOvergang(update);
    expect(aanroepen).toHaveLength(1);
    expect(update).not.toHaveBeenCalled();
    expect(document.documentElement.classList.contains('vt-route')).toBe(true);
    await finished;
    await Promise.resolve();
    expect(update).toHaveBeenCalledOnce();
    expect(document.documentElement.classList.contains('vt-route')).toBe(false);
  });
});

describe('kiesRecord', () => {
  const rij = (id: string) => {
    const el = document.createElement('p');
    el.setAttribute('data-vt-record', id);
    document.body.appendChild(el);
    return el;
  };

  it('maakt een geldige CSS-ident van een record-id', () => {
    expect(recordNaam('abc-1')).toBe('vt-record-abc-1');
    expect(recordNaam('a b.c')).toBe('vt-record-a_b_c');
  });

  it('kiest direct op mobiel (lijst en paneel staan niet naast elkaar)', () => {
    inline = false;
    nepOvergang();
    rij('x');
    const update = vi.fn();
    kiesRecord('x', null, update);
    expect(update).toHaveBeenCalledOnce();
  });

  it('geeft de rij tijdelijk de naam van het paneel en ruimt daarna op', async () => {
    const { finished, bijgewerkt } = nepOvergang();
    const naar = rij('x');
    const van = rij('y');
    const update = vi.fn();
    kiesRecord('x', 'y', update);
    // Oude staat: de gekozen rij draagt de naam.
    expect(naar.style.getPropertyValue('view-transition-name')).toBe('vt-record-x');
    expect(document.documentElement.classList.contains('vt-record')).toBe(true);
    await bijgewerkt;
    // Na de update: de rij laat los (het paneel draagt de naam nu), de vorige
    // rij neemt hem over voor de weg terug.
    expect(update).toHaveBeenCalledOnce();
    expect(naar.style.getPropertyValue('view-transition-name')).toBe('');
    expect(van.style.getPropertyValue('view-transition-name')).toBe('vt-record-y');
    await finished;
    await Promise.resolve();
    expect(van.style.getPropertyValue('view-transition-name')).toBe('');
    expect(document.documentElement.classList.contains('vt-record')).toBe(false);
  });

  it('doet niets bijzonders als dezelfde rij opnieuw gekozen wordt', () => {
    const { aanroepen } = nepOvergang();
    rij('x');
    const update = vi.fn();
    kiesRecord('x', 'x', update);
    expect(update).toHaveBeenCalledOnce();
    expect(aanroepen).toHaveLength(0);
  });
});
