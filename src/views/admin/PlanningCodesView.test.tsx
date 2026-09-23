import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { PlanningCode } from '../../types';

// Aanwezigheid leest Supabase Realtime; hier niet nodig.
vi.mock('../../components/AanwezigOpScherm', () => ({ AanwezigOpScherm: () => null }));

import { PlanningCodesView } from './PlanningCodesView';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(() => {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: false, media: query,
    addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(),
  }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const code = (c: string, category: PlanningCode['category'], description: string): PlanningCode => ({
  code: c, category, description, countsAsShift: false, isPaidAbsence: false, isDayOff: false,
});

// Volgorde in het concept: bv (0), d1 (1), z (2), av (3). Gefilterd op Verlof
// en op code gesorteerd staat av (index 3) bovenaan en bv (index 0) eronder:
// de rij op het scherm is dus niet de index in het concept.
const CODES = [
  code('bv', 'leave', 'Betaald verlof'),
  code('d1', 'service', 'Dienst 1'),
  code('z', 'absence', 'Ziek'),
  code('av', 'leave', 'Anciënniteitsverlof'),
];

/** De tabel (xl); in jsdom staan tabel en kaartlijst er allebei. */
const rijen = () => within(screen.getByRole('table', { name: 'Planningscodes' })).getAllByRole('row').slice(1);

describe('Planningscodes: bewerken in een gefilterde, gesorteerde weergave', () => {
  it('een invoer bewerkt precies de conceptrij die op die plek staat', async () => {
    const onSave = vi.fn().mockResolvedValue(true);
    render(<PlanningCodesView codes={CODES} onSave={onSave} canAdminDelete />);

    fireEvent.click(within(screen.getByRole('group', { name: 'Categorie' })).getByRole('button', { name: 'Verlof' }));
    expect(rijen()).toHaveLength(2);
    expect((within(rijen()[0]).getByLabelText('Code') as HTMLInputElement).value).toBe('av');

    // Eerste zichtbare rij (av, index 3): nieuwe beschrijving.
    fireEvent.change(within(rijen()[0]).getByLabelText('Beschrijving'), { target: { value: 'Nieuw' } });
    // Tweede zichtbare rij (bv, index 0): de code wordt aa, dus schuift ze naar boven.
    fireEvent.change(within(rijen()[1]).getByLabelText('Code'), { target: { value: 'aa' } });
    expect((within(rijen()[0]).getByLabelText('Code') as HTMLInputElement).value).toBe('aa');
    // Nu bovenaan: nog steeds conceptrij 0.
    fireEvent.change(within(rijen()[0]).getByLabelText('Beschrijving'), { target: { value: 'Eerste' } });
    fireEvent.click(within(rijen()[1]).getByRole('checkbox', { name: 'Vrije dag' }));

    fireEvent.click(screen.getByRole('button', { name: 'Opslaan' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0][0]).toEqual([
      code('aa', 'leave', 'Eerste'),
      code('d1', 'service', 'Dienst 1'),
      code('z', 'absence', 'Ziek'),
      { ...code('av', 'leave', 'Nieuw'), isDayOff: true },
    ]);
  });

  it('een filter zonder codes zegt dat, niet "Nog geen planningscodes"', () => {
    render(<PlanningCodesView codes={CODES} onSave={vi.fn()} canAdminDelete />);
    fireEvent.click(within(screen.getByRole('group', { name: 'Categorie' })).getByRole('button', { name: 'Opleiding' }));
    expect(screen.getByText('Geen codes in de categorie Opleiding')).toBeTruthy();
    expect(screen.queryByText('Nog geen planningscodes')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Alle codes tonen' }));
    expect(rijen()).toHaveLength(4);
  });

  it('zonder codes blijft de lege lijst "Nog geen planningscodes"', () => {
    render(<PlanningCodesView codes={[]} onSave={vi.fn()} canAdminDelete />);
    expect(screen.getByText('Nog geen planningscodes')).toBeTruthy();
  });
});
