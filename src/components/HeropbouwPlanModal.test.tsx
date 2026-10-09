import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { HeropbouwPlanModal } from './HeropbouwPlanModal';
import type { HeropbouwPlan } from '../../shared/heropbouwPlan';

/**
 * De droge run vóór "Planning opnieuw opbouwen" (09-10): wat de planner ziet
 * vóór hij bevestigt, en wanneer de knop uit staat.
 */
beforeEach(() => {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: false, media: query, onchange: null,
    addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const PLAN: HeropbouwPlan = {
  diensten: 40, dagenInMatrix: 20, periode: { van: '2026-10-01', tot: '2026-10-31' }, ruilen: { toegepast: 2, nietToepasbaar: 0 },
  chauffeurs: [
    { id: '3', naam: 'Chauffeur A', dagen: [{ dag: '2026-10-14', was: ['dienst 12, 06:00 tot 14:00'], wordt: ['dienst 12, 06:30 tot 14:00'], soort: 'gewijzigd' }] },
    { id: '4', naam: 'Chauffeur B', dagen: [{ dag: '2026-10-15', was: ['dienst 14, 06:00 tot 14:00'], wordt: [], soort: 'weg' }] },
  ],
  totaal: { chauffeurs: 2, dagen: 2, erbij: 0, weg: 1, gewijzigd: 1 },
};
const LEEG: HeropbouwPlan = { ...PLAN, chauffeurs: [], totaal: { chauffeurs: 0, dagen: 0, erbij: 0, weg: 0, gewijzigd: 0 } };
const niets = () => {};

describe('HeropbouwPlanModal', () => {
  it('toont per chauffeur de dagen met wat er nu staat en wat het wordt, en de knop staat aan', () => {
    render(<HeropbouwPlanModal open stand={{ status: 'klaar', plan: PLAN }} bezig={false} onClose={niets} onBevestig={niets} onOpnieuw={niets} />);
    expect(screen.getByText('Chauffeur A')).toBeTruthy();
    expect(screen.getByText('Chauffeur B')).toBeTruthy();
    expect(screen.getByText('14/10/2026')).toBeTruthy();
    expect(screen.getByText(/dienst 12, 06:00 tot 14:00, wordt dienst 12, 06:30 tot 14:00/)).toBeTruthy();
    expect(screen.getByText(/2 chauffeurs, 2 dagen veranderen/)).toBeTruthy();
    expect(screen.getByText(/40 diensten uit de matrix over 20 dagen \(01\/10\/2026 t\/m 31\/10\/2026\)/)).toBeTruthy();
    const knop = screen.getByRole('button', { name: 'Opnieuw opbouwen' }) as HTMLButtonElement;
    expect(knop.disabled).toBe(false);
  });

  it('niets te doen: geen knop om op te bouwen, alleen Sluiten', () => {
    render(<HeropbouwPlanModal open stand={{ status: 'klaar', plan: LEEG }} bezig={false} onClose={niets} onBevestig={niets} onOpnieuw={niets} />);
    expect(screen.getByText('Niets te doen')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Opnieuw opbouwen' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Sluiten' })).toBeTruthy();
  });

  it('tijdens het berekenen en bij een blokkade staat de knop uit', () => {
    const { unmount } = render(<HeropbouwPlanModal open stand={{ status: 'laden' }} bezig={false} onClose={niets} onBevestig={niets} onOpnieuw={niets} />);
    expect(screen.getByRole('status').textContent).toContain('Berekenen');
    expect((screen.getByRole('button', { name: 'Opnieuw opbouwen' }) as HTMLButtonElement).disabled).toBe(true);
    unmount();
    render(<HeropbouwPlanModal open stand={{ status: 'geblokkeerd', melding: 'Onbekende codes.', unknownCodes: ['XYZ'], unmatchedDrivers: [] }} bezig={false} onClose={niets} onBevestig={niets} onOpnieuw={niets} />);
    expect(screen.getByText('Opnieuw opbouwen kan nu niet')).toBeTruthy();
    expect(screen.getByText(/Onbekende codes: XYZ/)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Opnieuw opbouwen' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
