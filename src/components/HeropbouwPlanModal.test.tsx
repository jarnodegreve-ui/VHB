import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { HeropbouwPlanChauffeurs, HeropbouwPlanModal } from './HeropbouwPlanModal';
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

describe('HeropbouwPlanChauffeurs (gedeeld met het import-voorbeeld, ronde 6 punt 18)', () => {
  it('zonder voet is het de lijst zoals ze in het venster stond: één lijst met het kader erop', () => {
    const { container } = render(<HeropbouwPlanChauffeurs chauffeurs={PLAN.chauffeurs} />);
    const lijst = container.firstElementChild as HTMLElement;
    expect(lijst.tagName).toBe('UL');
    expect(lijst.className).toBe('divide-y divide-hairline-subtle rounded-2xl ring-1 ring-hairline');
    expect(lijst.children).toHaveLength(2);
    expect(screen.getByText(/dienst 14, 06:00 tot 14:00/)).toBeTruthy();
    expect(screen.getByText('weg')).toBeTruthy();
  });

  it('met een voet staat die als laatste regel in hetzelfde kader, buiten de lijst', () => {
    const { container } = render(<HeropbouwPlanChauffeurs chauffeurs={PLAN.chauffeurs} voet={<div data-testid="voet">Toon 10 meer</div>} />);
    const kader = container.firstElementChild as HTMLElement;
    expect(kader.tagName).toBe('DIV');
    expect(kader.className).toContain('ring-1 ring-hairline');
    expect(kader.children).toHaveLength(2);
    expect(kader.children[0].tagName).toBe('UL');
    expect(kader.children[0].children).toHaveLength(2);
    expect((kader.children[1] as HTMLElement).dataset.testid).toBe('voet');
  });

  it('hoogstens zes dagen per chauffeur voluit, de rest als één regel', () => {
    const dagen = Array.from({ length: 9 }, (_, i) => ({ dag: `2026-10-0${i + 1}`, was: [], wordt: ['dienst 12, 06:00 tot 14:00'], soort: 'erbij' as const }));
    render(<HeropbouwPlanChauffeurs chauffeurs={[{ id: '3', naam: 'Chauffeur A', dagen }]} />);
    expect(screen.getAllByText('erbij')).toHaveLength(6);
    expect(screen.getByText('+ 3 dagen meer')).toBeTruthy();
  });
});
