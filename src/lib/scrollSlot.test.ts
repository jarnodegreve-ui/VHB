import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { actieveScrollLocks, vergrendelScroll } from './scrollSlot';

/** Hotfix 24-09: één scroll-lock met eigenaarschap, in welke volgorde de lagen ook sluiten. */
describe('vergrendelScroll', () => {
  let root: HTMLElement;
  const staat = () => ({ body: document.body.style.overflow, root: root.style.overflow, locks: document.body.dataset.scrollLocks ?? '' });
  beforeEach(() => {
    root = document.createElement('main');
    root.setAttribute('data-scroll-root', '');
    document.body.appendChild(root);
  });
  afterEach(() => {
    root.remove();
    document.body.removeAttribute('style');
    expect(actieveScrollLocks()).toEqual([]);
  });

  it('één laag: op slot tijdens, alles terug erna', () => {
    const vrij = vergrendelScroll('modal');
    expect(staat()).toEqual({ body: 'hidden', root: 'hidden', locks: 'modal' });
    vrij();
    expect(staat()).toEqual({ body: '', root: '', locks: '' });
  });

  it('ouder sluit vóór kind (zelfde commit): pas de laatste vrijgave ontgrendelt, nooit een verouderde waarde', () => {
    const paneel = vergrendelScroll('slideover');
    const bevestiging = vergrendelScroll('modal');
    paneel();
    expect(staat()).toEqual({ body: 'hidden', root: 'hidden', locks: 'modal' });
    bevestiging();
    expect(staat()).toEqual({ body: '', root: '', locks: '' });
  });

  it('kind sluit eerst: de ouder houdt de pagina op slot', () => {
    const paneel = vergrendelScroll('slideover');
    const geschiedenis = vergrendelScroll('modal');
    geschiedenis();
    expect(staat().locks).toBe('slideover');
    expect(staat().root).toBe('hidden');
    paneel();
    expect(staat()).toEqual({ body: '', root: '', locks: '' });
  });

  it('Strict Mode (vergrendel, vrij, vergrendel) en een dubbele vrijgave tellen juist', () => {
    const a = vergrendelScroll('modal');
    a();
    const b = vergrendelScroll('modal');
    a();
    expect(staat().locks).toBe('modal');
    b();
    b();
    expect(staat()).toEqual({ body: '', root: '', locks: '' });
  });

  it('een oorspronkelijke inline waarde komt terug; een vervangen scroll-root blijft niet op slot', () => {
    document.body.style.overflow = 'clip';
    const vrij = vergrendelScroll('sheet');
    root.remove();
    const nieuw = document.createElement('main');
    nieuw.setAttribute('data-scroll-root', '');
    document.body.appendChild(nieuw);
    const tweede = vergrendelScroll('modal');
    expect(nieuw.style.overflow).toBe('hidden');
    vrij();
    tweede();
    expect(document.body.style.overflow).toBe('clip');
    expect(nieuw.style.overflow).toBe('');
    nieuw.remove();
    root = document.createElement('main');
    document.body.appendChild(root);
  });
});
