import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { Field, Input, Select, Textarea } from './Field';
import { Formulier, focusEersteFout } from './Formulier';
import { Modal, useModalSluiten } from './Modal';
import { ModalHeader } from './ui';
import { useVuil } from '../lib/formulier';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('Field-context', () => {
  it('koppelt label, hint/fout en invalid aan een gewoon child-control', () => {
    render(
      <Field label="Naam" required error="Vul een naam in">
        <Input value="" onChange={() => {}} />
      </Field>,
    );
    const input = screen.getByLabelText(/Naam/);
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input.getAttribute('aria-required')).toBe('true');
    expect(input.getAttribute('aria-describedby')).toBe(`${input.id}-fout`);
    expect(screen.getByRole('alert').textContent).toContain('Vul een naam in');
  });

  it('twee controls in één veld: alleen het eerste krijgt de id, beide de beschrijving', () => {
    render(
      <Field label="Periode" hint="Van tot">
        <Input aria-label="Van" value="" onChange={() => {}} />
        <Input aria-label="Tot" value="" onChange={() => {}} />
      </Field>,
    );
    const van = screen.getByLabelText('Van');
    const tot = screen.getByLabelText('Tot');
    expect(van.id).toMatch(/^veld-/);
    expect(tot.id).toBe('');
    expect(van.getAttribute('aria-describedby')).toBe(`${van.id}-hint`);
    expect(tot.getAttribute('aria-describedby')).toBe(`${van.id}-hint`);
  });

  it('een eigen id of render-prop blijft leidend', () => {
    render(
      <>
        <Field label="A" htmlFor="eigen"><Select id="eigen" value="" onChange={() => {}}><option value="">-</option></Select></Field>
        <Field label="B">{({ id }) => <Textarea id={id} value="" onChange={() => {}} />}</Field>
      </>,
    );
    expect(screen.getByLabelText('A').id).toBe('eigen');
    expect(screen.getByLabelText('B').id).toMatch(/^veld-/);
  });
});

describe('Formulier', () => {
  it('Enter dient in en de focus gaat naar het eerste ongeldige veld', async () => {
    vi.useFakeTimers();
    function Demo() {
      const [fouten, setFouten] = useState<Record<string, string>>({});
      return (
        <Formulier onVerstuur={() => setFouten({ email: 'Ongeldig', naam: 'Leeg' })}>
          <Field label="Naam" error={fouten.naam}><Input value="" onChange={() => {}} /></Field>
          <Field label="E-mail" error={fouten.email}><Input value="" onChange={() => {}} /></Field>
          <button type="submit">Opslaan</button>
        </Formulier>
      );
    }
    render(<Demo />);
    const naam = screen.getByLabelText('Naam');
    naam.scrollIntoView = vi.fn();
    fireEvent.submit(screen.getByLabelText('E-mail'));
    await act(async () => { await vi.runAllTimersAsync(); });
    expect(document.activeElement).toBe(naam);
  });

  it('focusEersteFout vindt ook het control van een Field met fout zonder aria-invalid', () => {
    render(
      <div data-testid="root">
        <Field label="Ok"><Input value="" onChange={() => {}} /></Field>
        <Field label="Kies" error="Kies iets"><button type="button">kiezer</button></Field>
      </div>,
    );
    const kiezer = screen.getByRole('button', { name: 'kiezer' });
    kiezer.scrollIntoView = vi.fn();
    expect(focusEersteFout(screen.getByTestId('root'))).toBe(true);
    expect(document.activeElement).toBe(kiezer);
    expect(focusEersteFout(null)).toBe(false);
  });
});

describe('Modal met onbewaarde invoer', () => {
  function Demo({ onClose }: { onClose: () => void }) {
    const [naam, setNaam] = useState('A');
    const { vuil } = useVuil({ naam }, true);
    const sluitVia = useModalSluiten();
    return (
      <Modal open onClose={onClose} vuil={vuil} ariaLabel="Demo">
        <ModalHeader title="Demo" onClose={onClose} />
        <input aria-label="Naam" value={naam} onChange={(e) => setNaam(e.target.value)} />
        <Annuleer onClose={onClose} />
        <span data-testid="vuil">{String(vuil)}</span>
        <span data-testid="poort">{String(sluitVia !== undefined)}</span>
      </Modal>
    );
  }
  function Annuleer({ onClose }: { onClose: () => void }) {
    const sluitVia = useModalSluiten();
    return <button type="button" onClick={() => sluitVia(onClose)}>Annuleren</button>;
  }

  it('schoon: Escape sluit meteen', () => {
    const onClose = vi.fn();
    render(<Demo onClose={onClose} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('vuil: Escape, kruisje en Annuleren vragen eerst; "Verder bewerken" houdt open, "Niet bewaren" sluit', async () => {
    const onClose = vi.fn();
    render(<Demo onClose={onClose} />);
    fireEvent.change(screen.getByLabelText('Naam'), { target: { value: 'B' } });
    expect(screen.getByTestId('vuil').textContent).toContain('true');
    const vraag = () => screen.queryByRole('heading', { name: 'Wijzigingen niet bewaren?' });
    // De dialoog fadet uit (AnimatePresence): wachten tot hij echt weg is.
    const wegNaVerder = async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Verder bewerken' }));
      await waitFor(() => expect(vraag()).toBeNull());
    };

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
    expect(vraag()).toBeTruthy();
    await wegNaVerder();
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Sluiten' }));
    expect(vraag()).toBeTruthy();
    await wegNaVerder();

    fireEvent.click(screen.getByRole('button', { name: 'Annuleren' }));
    expect(vraag()).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Niet bewaren' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
