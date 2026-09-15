import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Modal } from './Modal';
import { SlideOver } from './SlideOver';

// Historiek heeft eigen integratietests; hier gaat het om de focus die
// beide portals verplaatsen terwijl de app-scroll-root op slot staat.
vi.mock('../lib/useHistoryDismiss', () => ({ useHistoryDismiss: () => {} }));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
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
