import { afterEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { RuilStatusBadge } from './RuilStatusBadge';
import type { RuilVerloopStap } from '../../shared/ruilVerloop';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => { document.body.innerHTML = ''; });

const tekst = (swap: { status: string; verloop?: RuilVerloopStap[] }) => {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const root = createRoot(el);
  act(() => root.render(<RuilStatusBadge swap={swap} stil />));
  const uit = el.textContent;
  act(() => root.unmount());
  return uit;
};
const weigering = (door: RuilVerloopStap['door']): RuilVerloopStap[] => [{ soort: 'geweigerd', op: '2026-09-11T08:00:00Z', door }];

describe('RuilStatusBadge', () => {
  it('de collega weigerde: "Geweigerd"', () => {
    expect(tekst({ status: 'rejected', verloop: weigering('collega') })).toBe('Geweigerd');
  });
  it('de planner wees af, of niet geregistreerd wie: "Afgewezen"', () => {
    expect(tekst({ status: 'rejected', verloop: weigering('planner') })).toBe('Afgewezen');
    expect(tekst({ status: 'rejected', verloop: weigering(null) })).toBe('Afgewezen');
    expect(tekst({ status: 'rejected' })).toBe('Afgewezen');
  });
  it('andere statussen zoals StatusBadge', () => {
    expect(tekst({ status: 'approved' })).toBe('Goedgekeurd');
  });
});
