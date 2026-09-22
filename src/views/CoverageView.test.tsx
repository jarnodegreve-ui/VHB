import { describe, it, expect, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { fireEvent } from '@testing-library/react';
import { CoverageView } from './CoverageView';
import { saveCoverageConfig } from '../lib/coverage';

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

describe('CoverageView, onvolledige rijen blokkeren Opslaan', () => {
  const klik = async (el: Element | undefined) => {
    await act(async () => { el!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    await flush();
  };
  const opent = async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => { root.render(<CoverageView />); });
    await flush();
    await klik(findBtn(container, /Instellen/i));
    return { container, root };
  };

  it('een dag-type met diensten maar zonder naam wordt niet bewaard en zegt wat ontbreekt', async () => {
    const save = vi.mocked(saveCoverageConfig);
    save.mockClear();
    const { container, root } = await opent();
    await klik(findBtn(container, /Dag-type/i));
    // Nieuwe kaart staat open: vink een dienst aan, geen naam.
    await klik([...container.querySelectorAll('button')].find((b) => b.textContent === '4102'));
    await klik(findBtn(container, /^Opslaan$/));

    expect(save).not.toHaveBeenCalled();
    const naam = nameInputs(container)[0];
    expect(naam.getAttribute('aria-invalid')).toBe('true');
    const fout = document.getElementById(naam.getAttribute('aria-describedby')!);
    expect(fout?.textContent).toBe('Onvolledig, nog nodig: een naam. Vul aan of verwijder de rij.');
    // Focus gaat naar de rij met het probleem.
    await act(async () => { await new Promise((r) => setTimeout(r, 5)); });
    expect(document.activeElement).toBe(naam);

    // Aanvullen wist de fout, daarna gaat Opslaan wel door.
    await act(async () => { fireEvent.change(naam, { target: { value: 'vakantie' } }); });
    expect(naam.getAttribute('aria-invalid')).toBeNull();
    await klik(findBtn(container, /^Opslaan$/));
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0][0].dayTypes.map((d) => d.name)).toEqual(['vakantie', 'schooldag', 'zaterdag']);

    await act(async () => { root.unmount(); });
    container.remove();
  });

  it('een volledig lege nieuwe rij valt stil weg, zoals vroeger', async () => {
    const save = vi.mocked(saveCoverageConfig);
    save.mockClear();
    const { container, root } = await opent();
    await klik(findBtn(container, /Dag-type/i));
    await klik(findBtn(container, /^Opslaan$/));
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0][0].dayTypes.map((d) => d.name)).toEqual(['schooldag', 'zaterdag']);
    await act(async () => { root.unmount(); });
    container.remove();
  });
});
