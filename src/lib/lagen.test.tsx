import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfirmationModal } from '../components/ui';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { Modal } from '../components/Modal';
import { SlideOver } from '../components/SlideOver';
import { useDropdown } from '../components/useDropdown';
import { openLagen } from './lagen';
import { actieveScrollLocks } from './scrollSlot';
import { useVuil } from './formulier';

/**
 * De lagenstapel (polish P2a, regels Jarno 24-09): één laag per sluitactie,
 * en geen dode terugstap als meerdere lagen samen sluiten.
 *
 * "Dode terugstap" = een history-entry van een gesloten laag die blijft
 * staan: één keer terug doet dan zichtbaar niets. Elke test controleert
 * daarom na het sluiten dat de bovenste entry weer de pagina is en dat één
 * keer terug naar de vorige pagina gaat.
 */

const pad = () => window.location.pathname;
const bovenste = () => (window.history.state as { vhbOverlay?: unknown } | null)?.vhbOverlay;
const historiekSchoon = () => waitFor(() => expect(bovenste()).toBeUndefined());
const vraag = () => screen.queryByRole('heading', { name: 'Wijzigingen niet bewaren?' });

beforeEach(() => {
  window.history.pushState(null, '', '/vorige');
  window.history.pushState(null, '', '/hier');
});

afterEach(async () => {
  cleanup();
  await historiekSchoon();
  vi.unstubAllGlobals();
});

/** Eén keer terug moet de vorige pagina geven (geen dode stap ertussen). */
async function eenKeerTerugIsVorigePagina() {
  await act(async () => { window.history.back(); });
  await waitFor(() => expect(pad()).toBe('/vorige'));
}

function PaneelMetFormulier() {
  const [open, setOpen] = useState(true);
  const [naam, setNaam] = useState('A');
  const { vuil } = useVuil({ naam }, open);
  return (
    <SlideOver open={open} onClose={() => setOpen(false)} vuil={vuil} title="Paneel">
      <input aria-label="Naam" value={naam} onChange={(e) => setNaam(e.target.value)} />
    </SlideOver>
  );
}

function PaneelMetBevestiging({ opVerwijderen }: { opVerwijderen: () => Promise<void> | void }) {
  const [open, setOpen] = useState(true);
  const [vraagOpen, setVraagOpen] = useState(false);
  return (
    <>
      <SlideOver open={open} onClose={() => setOpen(false)} title="Paneel">
        {/* rauw: testattrap */}
        <button type="button" onClick={() => setVraagOpen(true)}>Verwijderen</button>
      </SlideOver>
      <ConfirmationModal
        open={vraagOpen}
        onClose={() => setVraagOpen(false)}
        onConfirm={async () => { await opVerwijderen(); setOpen(false); }}
        title="Zeker verwijderen?"
        message="Weg is weg."
        confirmText="Ja, verwijderen"
      />
      <span data-testid="paneel">{String(open)}</span>
    </>
  );
}

describe('lagenstapel', () => {
  it('"Niet bewaren" sluit vraag én paneel zonder dode terugstap', async () => {
    render(<PaneelMetFormulier />);
    expect(openLagen()).toEqual(['dialoog']);
    fireEvent.change(screen.getByLabelText('Naam'), { target: { value: 'B' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sluiten' }));
    expect(vraag()).toBeTruthy();
    expect(openLagen()).toEqual(['dialoog', 'dialoog']);
    fireEvent.click(screen.getByRole('button', { name: 'Niet bewaren' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Paneel' })).toBeNull());
    await historiekSchoon();
    expect(openLagen()).toEqual([]);
    expect(actieveScrollLocks()).toEqual([]);
    expect(pad()).toBe('/hier');
    await eenKeerTerugIsVorigePagina();
  });

  it('terugknop op een vuil paneel: de vraag, de entry komt terug; "Niet bewaren" laat geen wees achter', async () => {
    render(<PaneelMetFormulier />);
    fireEvent.change(screen.getByLabelText('Naam'), { target: { value: 'B' } });
    await act(async () => { window.history.back(); });
    await waitFor(() => expect(vraag()).toBeTruthy());
    // Paneel blijft open op dezelfde plek, met zijn entry terug bovenaan.
    expect(pad()).toBe('/hier');
    expect(typeof bovenste()).toBe('string');
    fireEvent.click(screen.getByRole('button', { name: 'Niet bewaren' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Paneel' })).toBeNull());
    await historiekSchoon();
    expect(pad()).toBe('/hier');
    await eenKeerTerugIsVorigePagina();
  });

  it('Escape sluit één laag tegelijk: eerst de bevestiging, dan het paneel', async () => {
    render(<PaneelMetBevestiging opVerwijderen={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Verwijderen' }));
    expect(openLagen()).toEqual(['dialoog', 'dialoog']);
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Zeker verwijderen?' })).toBeNull());
    expect(screen.getByTestId('paneel').textContent).toBe('true');
    expect(openLagen()).toEqual(['dialoog']);
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(screen.getByTestId('paneel').textContent).toBe('false'));
    await historiekSchoon();
    await eenKeerTerugIsVorigePagina();
  });

  it('terugknop sluit alleen de bovenste laag', async () => {
    render(<PaneelMetBevestiging opVerwijderen={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Verwijderen' }));
    await act(async () => { window.history.back(); });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Zeker verwijderen?' })).toBeNull());
    expect(screen.getByTestId('paneel').textContent).toBe('true');
    await act(async () => { window.history.back(); });
    await waitFor(() => expect(screen.getByTestId('paneel').textContent).toBe('false'));
    await historiekSchoon();
    await eenKeerTerugIsVorigePagina();
  });

  it('verwijderen vanuit het paneel sluit bevestiging én paneel met één terugstap in de historiek', async () => {
    render(<PaneelMetBevestiging opVerwijderen={async () => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Verwijderen' }));
    fireEvent.click(screen.getByRole('button', { name: 'Ja, verwijderen' }));
    await waitFor(() => expect(screen.getByTestId('paneel').textContent).toBe('false'));
    await historiekSchoon();
    expect(openLagen()).toEqual([]);
    expect(actieveScrollLocks()).toEqual([]);
    await eenKeerTerugIsVorigePagina();
  });

  it('bevestiging die nog op de server wacht: terug en Escape sluiten niet, de entry blijft', async () => {
    let klaar: () => void = () => {};
    render(<PaneelMetBevestiging opVerwijderen={() => new Promise<void>((r) => { klaar = r; })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Verwijderen' }));
    fireEvent.click(screen.getByRole('button', { name: 'Ja, verwijderen' }));
    const id = bovenste();
    fireEvent.keyDown(window, { key: 'Escape' });
    await act(async () => { window.history.back(); });
    await waitFor(() => expect(bovenste()).toBeDefined());
    expect(screen.getByRole('dialog', { name: 'Zeker verwijderen?' })).toBeTruthy();
    expect(screen.getByTestId('paneel').textContent).toBe('true');
    expect(typeof id).toBe('string');
    await act(async () => { klaar(); });
    await waitFor(() => expect(screen.getByTestId('paneel').textContent).toBe('false'));
    await historiekSchoon();
    await eenKeerTerugIsVorigePagina();
  });

  it('Escape in een popover binnen een paneel sluit alleen de popover', async () => {
    function Paneel() {
      const [open, setOpen] = useState(true);
      const d = useDropdown();
      return (
        <SlideOver open={open} onClose={() => setOpen(false)} title="Paneel">
          <div ref={d.wortel}>
            {/* rauw: testattrap */}
            <button type="button" onClick={() => d.setOpen(true)}>Uitleg</button>
            {d.open && <p>Uitlegtekst</p>}
          </div>
        </SlideOver>
      );
    }
    render(<Paneel />);
    fireEvent.click(screen.getByRole('button', { name: 'Uitleg' }));
    expect(openLagen()).toEqual(['dialoog', 'popover']);
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByText('Uitlegtekst')).toBeNull());
    expect(screen.getByRole('dialog', { name: 'Paneel' })).toBeTruthy();
    // Een klein vlak op desktop krijgt geen eigen entry: alleen die van het paneel.
    expect(openLagen()).toEqual(['dialoog']);
  });

  it.each([
    { toestel: 'telefoon', scherm: [390, 844], smal: true, touch: true, planner: false, stap: true },
    { toestel: 'Duo binnen staand', scherm: [669, 951], smal: false, touch: true, planner: true, stap: true },
    { toestel: 'Duo binnen liggend', scherm: [951, 669], smal: false, touch: true, planner: true, stap: true },
    { toestel: 'Duo binnen, chauffeursweergave', scherm: [669, 951], smal: false, touch: true, planner: false, stap: false },
    { toestel: 'tablet met hetzelfde venster', scherm: [820, 1180], smal: false, touch: true, planner: true, stap: false },
    { toestel: 'desktop met dezelfde schermmaat', scherm: [669, 951], smal: false, touch: false, planner: true, stap: false },
  ])('$toestel: terug vanuit een mobielVol-menu', async ({ scherm, smal, touch, planner, stap }) => {
    vi.stubGlobal('screen', { width: scherm[0], height: scherm[1] });
    let vensterSmal = smal;
    vi.stubGlobal('matchMedia', (q: string) => ({
      matches: q.includes('max-width') ? vensterSmal : q === '(pointer: coarse)' && touch,
      media: q, addEventListener: () => {}, removeEventListener: () => {},
    }));
    function Bel() {
      const d = useDropdown({ mobielVol: true, terugBijVouwen: planner });
      return (
        <div ref={d.wortel}>
          {/* rauw: testattrap */}
          <button type="button" aria-expanded={d.open} onClick={() => d.setOpen(true)}>Meldingen</button>
          {d.open && <p>Meldingenpaneel</p>}
        </div>
      );
    }
    const { rerender } = render(<Bel />);
    fireEvent.click(screen.getByRole('button', { name: 'Meldingen' }));
    if (stap) {
      const id = bovenste();
      expect(typeof id).toBe('string');
      // Dichtvouwen wisselt het fysieke scherm en de breedte. De open laag
      // deelt nog steeds dezelfde terugstap met het oorspronkelijke menu.
      vensterSmal = true;
      vi.stubGlobal('screen', { width: 678, height: 466 });
      fireEvent(window, new Event('resize'));
      rerender(<Bel />);
      expect(bovenste()).toBe(id);
      await act(async () => { window.history.back(); });
      await waitFor(() => expect(screen.queryByText('Meldingenpaneel')).toBeNull());
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Meldingen' }));
    } else {
      expect(bovenste()).toBeUndefined();
      fireEvent.keyDown(window, { key: 'Escape' });
      expect(screen.queryByText('Meldingenpaneel')).toBeNull();
    }
    expect(pad()).toBe('/hier');
    await eenKeerTerugIsVorigePagina();
  });

  it('een modal die in dezelfde commit als een menu opent, neemt diens entry over', async () => {
    function Harnas() {
      const [menu, setMenu] = useState(true);
      const [modal, setModal] = useState(false);
      return (
        <>
          <Modal open={menu} onClose={() => setMenu(false)} ariaLabel="Menu">
            {/* rauw: testattrap */}
            <button type="button" onClick={() => { setMenu(false); setModal(true); }}>Kies</button>
          </Modal>
          <Modal open={modal} onClose={() => setModal(false)} ariaLabel="Formulier">
            {/* rauw: testattrap */}
            <button type="button" onClick={() => setModal(false)}>Klaar</button>
          </Modal>
        </>
      );
    }
    render(<Harnas />);
    const lengte = window.history.length;
    fireEvent.click(screen.getByRole('button', { name: 'Kies' }));
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.getByRole('dialog', { name: 'Formulier' })).toBeTruthy();
    expect(window.history.length).toBe(lengte);
    fireEvent.click(screen.getByRole('button', { name: 'Klaar' }));
    await historiekSchoon();
    await eenKeerTerugIsVorigePagina();
  });
});
