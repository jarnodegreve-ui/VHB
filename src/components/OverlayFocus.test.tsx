import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Modal } from './Modal';
import { SlideOver } from './SlideOver';

// Historiek heeft eigen tests (src/lib/useHistoryDismiss.test.tsx); hier gaat
// het om de focus die beide portals verplaatsen terwijl de app-scroll-root
// op slot staat. De lagenstapel (src/lib/lagen.ts) draait dus echt mee: een
// mock op het oude pad ../lib/useHistoryDismiss raakte Modal en SlideOver
// al niet meer, die lezen useLaag rechtstreeks uit lagen.ts.

afterEach(async () => {
  cleanup();
  vi.restoreAllMocks();
  // jsdom voert history.back() van de gesloten laag asynchroon uit: wachten
  // tot de historiek schoon is, anders lekt een popstate in het volgende geval.
  await vi.waitFor(() => expect(window.history.state?.vhbOverlay).toBeUndefined());
});

function Harnas({ soort, open }: { soort: 'modal' | 'paneel'; open: boolean }) {
  const inhoud = (
    <>
      {/* rauw: focusbare testinhoud */}
      <button type="button">Eerste actie</button>
      <button type="button">Laatste actie</button>
    </>
  );
  return (
    <>
      <div data-scroll-root style={{ overflow: 'auto' }}>
        {/* rauw: de tegel die de overlay opent */}
        <button type="button">Dashboardtegel</button>
      </div>
      {soort === 'modal'
        ? <Modal open={open} onClose={() => {}} ariaLabel="Details">{inhoud}</Modal>
        : <SlideOver open={open} onClose={() => {}} title="Details">{inhoud}</SlideOver>}
    </>
  );
}

describe.each(['modal', 'paneel'] as const)('%s: focus en scrollpositie', (soort) => {
  it('houdt de pagina op haar plaats bij openen en focusherstel, met een werkende Tab-lus', () => {
    const { rerender } = render(<Harnas soort={soort} open={false} />);
    const scrollRoot = document.querySelector<HTMLElement>('[data-scroll-root]')!;
    const tegel = screen.getByRole('button', { name: 'Dashboardtegel' });
    tegel.focus();
    scrollRoot.scrollTop = 160;

    // jsdom berekent geen layout of focus-scroll. Modelleer de browser die
    // een gefocust paneel/tegel in beeld schuift, óók bij overflow:hidden.
    // De echte mobiele browserflow staat in mobiele-navigatie.spec.ts.
    const focus = HTMLElement.prototype.focus;
    vi.spyOn(HTMLElement.prototype, 'focus').mockImplementation(function (this: HTMLElement, opties?: FocusOptions) {
      if (!opties?.preventScroll && (this === tegel || this.getAttribute('role') === 'dialog')) {
        scrollRoot.scrollTop += 80;
      }
      focus.call(this, opties);
    });

    rerender(<Harnas soort={soort} open />);
    const dialoog = screen.getByRole('dialog', { name: 'Details' });
    expect(document.activeElement).toBe(dialoog);
    expect(scrollRoot.scrollTop).toBe(160);
    expect(scrollRoot.style.overflow).toBe('hidden');

    // Shift+Tab vanaf het paneel gaat naar het laatste veld; Tab daarna
    // blijft binnen de dialoog. Toetsenbordnavigatie blijft dus beschikbaar.
    const laatste = screen.getByRole('button', { name: 'Laatste actie' });
    const eerste = dialoog.querySelector('button');
    fireEvent.keyDown(dialoog, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(laatste);
    fireEvent.keyDown(laatste, { key: 'Tab' });
    expect(document.activeElement).toBe(eerste);

    rerender(<Harnas soort={soort} open={false} />);
    expect(document.activeElement).toBe(tegel);
    expect(scrollRoot.scrollTop).toBe(160);
    expect(scrollRoot.style.overflow).toBe('auto');
  });
});

// 20-11: een Modal die weer openging op het moment dat zijn uitgang net klaar
// was, kwam soms volledig in beeld terwijl `pointer-events: none` uit de exit
// van motion bleef staan (gemeten met een echte stap terug ±140 tot 180 ms na
// "Verder bewerken": het vraagvenster stond er, de knoppen namen geen klik aan). Wat
// het venster aanneemt hangt daarom aan `open` zelf, niet aan de animatie.
describe('modal: sluiten en meteen weer openen', () => {
  const scrimVan = () => document.querySelector<HTMLElement>('[role="dialog"][aria-label="Details"]')?.parentElement ?? null;

  it('is vanaf het sluiten inert, terwijl het nog wegfadet', () => {
    const { rerender } = render(<Harnas soort="modal" open />);
    const scrim = scrimVan()!;
    expect(scrim.hasAttribute('inert')).toBe(false);

    rerender(<Harnas soort="modal" open={false} />);
    // De uitgang loopt: het element staat er nog, maar neemt niets meer aan.
    expect(scrim.isConnected).toBe(true);
    expect(scrim.hasAttribute('inert')).toBe(true);
  });

  it('is na heropenen tijdens de uitgang meteen weer bedienbaar (zelfde element)', () => {
    const { rerender } = render(<Harnas soort="modal" open />);
    const scrim = scrimVan()!;
    rerender(<Harnas soort="modal" open={false} />);
    expect(scrim.hasAttribute('inert')).toBe(true);

    rerender(<Harnas soort="modal" open />);
    const opnieuw = scrimVan()!;
    expect(opnieuw).toBe(scrim);
    expect(opnieuw.hasAttribute('inert')).toBe(false);
    // De animatie zet zelf geen pointer-events meer: er valt niets te herstellen.
    expect(opnieuw.style.pointerEvents).toBe('');
  });

  // Het venster waarin het misliep: de uitgang is nét klaar (AnimatePresence
  // heeft het kind als "klaar" genoteerd) en `open` wordt waar vóór React het
  // element weghaalt. Dan blijft hetzelfde element staan. De oude Modal hield
  // daar `pointer-events: none` van zijn exit (6 op 6 in deze proef), midden
  // in de uitgang herstelde hij wel. AnimatePresence noteert "klaar" in een
  // Map met de key van het kind ('modal'); de haak hieronder heropent precies
  // op dat moment. Wijzigt motion dat detail, dan faalt de proef luid op de
  // tijdslimiet in plaats van stil te slagen.
  it('heropenen op het moment dat de uitgang net klaar is: zelfde element, meteen bedienbaar', async () => {
    const { rerender } = render(<Harnas soort="modal" open />);
    const scrim = scrimVan()!;
    const echteSet = Map.prototype.set;
    let haak = null as (() => void) | null;
    const heropend = new Promise<void>((klaar) => {
      haak = () => queueMicrotask(() => { rerender(<Harnas soort="modal" open />); klaar(); });
    });
    Map.prototype.set = function zet(this: Map<unknown, unknown>, sleutel: unknown, waarde: unknown) {
      const uit = echteSet.call(this, sleutel, waarde);
      if (sleutel === 'modal' && waarde === true && haak) { const nu = haak; haak = null; nu(); }
      return uit;
    } as typeof Map.prototype.set;
    try {
      rerender(<Harnas soort="modal" open={false} />);
      await Promise.race([
        heropend,
        new Promise<never>((_, faal) => setTimeout(() => faal(new Error('AnimatePresence meldde het einde van de uitgang niet zoals verwacht: kijk de haak na.')), 2000)),
      ]);
    } finally {
      Map.prototype.set = echteSet;
    }
    // Laat elke beweging uitlopen: het gaat om de eindtoestand.
    await new Promise((klaar) => setTimeout(klaar, 500));
    const na = scrimVan()!;
    expect(na).toBe(scrim);
    expect(na.hasAttribute('inert')).toBe(false);
    expect(na.style.pointerEvents).toBe('');
    expect(na.style.opacity).toBe('1');
  });

  it('een vers venster (na een volledige uitgang) is bedienbaar', async () => {
    const { rerender } = render(<Harnas soort="modal" open />);
    rerender(<Harnas soort="modal" open={false} />);
    await vi.waitFor(() => expect(scrimVan()).toBeNull(), { timeout: 2000 });

    rerender(<Harnas soort="modal" open />);
    const vers = scrimVan()!;
    expect(vers.hasAttribute('inert')).toBe(false);
    expect(vers.style.pointerEvents).toBe('');
  });
});
