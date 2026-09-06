import { describe, it, expect, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { CoverageView } from './CoverageView';

// React's act(...) verwacht deze vlag in een testomgeving.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Config met bestaande dag-types: zo verifiëren we dat een nieuw dag-type
// bovenaan verschijnt (anders verdwijnt het onder de lange chips-lijsten en
// lijkt "+ Dag-type" niets te doen — dat was de bug).
vi.mock('../lib/coverage', () => ({
  fetchCoverageConfig: vi.fn().mockResolvedValue({
    services: ['4101', '4102', '4103'],
    dayTypes: [
      { name: 'schooldag', services: ['4101'] },
      { name: 'zaterdag', services: [] },
    ],
    weekdays: ['zondag', 'schooldag', 'schooldag', 'schooldag', 'schooldag', 'schooldag', 'zaterdag'],
    overrides: [],
  }),
  fetchCoverageGaps: vi.fn().mockResolvedValue({ from: '', to: '', days: [] }),
  fetchExpectationCheck: vi.fn().mockResolvedValue({ from: '', to: '', dagen: 0, afwijkingen: [] }),
  saveCoverageConfig: vi.fn().mockResolvedValue({ success: true }),
}));
vi.mock('../lib/availability', () => ({
  fetchAvailability: vi.fn().mockResolvedValue({ drivers: [], days: [] }),
}));

const flush = async () => { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); };
const findBtn = (c: HTMLElement, re: RegExp) =>
  [...c.querySelectorAll('button')].find((b) => re.test(b.textContent || ''));
const nameInputs = (c: HTMLElement) =>
  [...c.querySelectorAll('input[placeholder="Naam dag-type"]')] as HTMLInputElement[];

describe('CoverageView, dag-type toevoegen', () => {
  it('voegt een leeg dag-type bovenaan de lijst toe', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => { root.render(<CoverageView />); });
    await flush();

    await act(async () => { findBtn(container, /Instellen/i)!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    await flush();

    expect(nameInputs(container).map((i) => i.value)).toEqual(['schooldag', 'zaterdag']);

    await act(async () => { findBtn(container, /Dag-type/i)!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    await flush();

    const values = nameInputs(container).map((i) => i.value);
    expect(values).toHaveLength(3);
    expect(values[0]).toBe(''); // nieuw, leeg, bovenaan
    expect(values.slice(1)).toEqual(['schooldag', 'zaterdag']);

    await act(async () => { root.unmount(); });
  });
});
