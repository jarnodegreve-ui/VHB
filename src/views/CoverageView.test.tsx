import { describe, it, expect, vi, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { fireEvent } from '@testing-library/react';
import { CoverageView } from './CoverageView';
import { fetchCoverageGaps, saveCoverageConfig } from '../lib/coverage';

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

// De dekking stopt op de grens van de planning (24-11): de server geeft geen
// dagen na `planningTot`. Een maand (deels) na die dag zegt dat in woorden en
// nooit "Alle verwachte diensten zijn ingevuld" voor dagen zonder planning.
describe('CoverageView, de grens van de planning', () => {
  const GRENS = '2027-01-03';
  const dag = (date: string, missing: string[]) => ({ date, dayType: 'schooldag', expected: 1, covered: 1 - missing.length, missing, unknown: [] });
  const gaten = vi.mocked(fetchCoverageGaps);
  afterEach(() => { gaten.mockReset(); gaten.mockResolvedValue({ from: '', to: '', days: [] }); });
  const open = async (maand: string) => {
    window.history.replaceState(null, '', `/openstaande-diensten/${maand}`);
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => { root.render(<CoverageView />); });
    await flush();
    return { container, root, sluit: async () => { await act(async () => { root.unmount(); }); container.remove(); } };
  };
  const wacht = async () => { await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); await flush(); };
  const klikVolgende = async (c: HTMLElement) => {
    await act(async () => { c.querySelector<HTMLButtonElement>('button[aria-label="Volgende maand"]')!.click(); });
    await flush();
  };

  it('januari 2027 (grens 3/1): de open diensten tot de grens, plus de regel', async () => {
    gaten.mockResolvedValue({ from: '2027-01-01', to: '2027-01-31', days: [dag('2027-01-02', ['4101'])], planningTot: GRENS });
    const { container, sluit } = await open('2027-01');
    await wacht();
    expect(container.textContent).toContain('De planning loopt tot en met 03/01/2027.');
    expect(container.textContent).toContain('1 niet-ingevulde dienst deze maand');
    expect(container.textContent).not.toContain('Nog geen planning');
    await sluit();
  });

  // Tegenlezing 25-11: "Geen openstaande diensten in januari 2027. Alle
  // verwachte diensten zijn ingevuld." ging over de hele maand, ook over de
  // dagen na de grens zonder planning. De lege staat spreekt nu alleen over
  // de dagen tot en met de grens.
  it('januari zonder open diensten tot de grens: de lege staat spreekt alleen over de dagen t/m de grens', async () => {
    gaten.mockResolvedValue({ from: '2027-01-01', to: '2027-01-31', days: [dag('2027-01-02', [])], planningTot: GRENS });
    const { container, sluit } = await open('2027-01');
    await wacht();
    expect(container.textContent).toContain('Geen openstaande diensten t/m 03/01/2027.');
    expect(container.textContent).toContain('Alle verwachte diensten t/m 03/01/2027 zijn ingevuld.');
    // Ook de kopregel boven de lijst spreekt alleen over de dagen t/m de grens.
    expect(container.textContent).not.toContain('Alle verwachte diensten zijn ingevuld');
    expect(container.textContent).not.toContain('Geen openstaande diensten in januari 2027.');
    expect(container.textContent).toContain('De planning loopt tot en met 03/01/2027.');
    await sluit();
  });

  it('een maand die precies op de grens eindigt: de lege staat zoals vroeger, geen regel', async () => {
    gaten.mockResolvedValue({ from: '2027-01-01', to: '2027-01-31', days: [dag('2027-01-02', [])], planningTot: '2027-01-31' });
    const { container, sluit } = await open('2027-01');
    await wacht();
    expect(container.textContent).toContain('Geen openstaande diensten in januari 2027.');
    expect(container.textContent).toContain('Alle verwachte diensten zijn ingevuld.');
    expect(container.textContent).not.toContain('t/m 31/01/2027');
    expect(container.textContent).not.toContain('De planning loopt');
    await sluit();
  });

  it('februari 2027 helemaal na de grens: geen planning, nooit "alles ingevuld"', async () => {
    gaten.mockResolvedValue({ from: '2027-02-01', to: '2027-02-28', days: [], planningTot: GRENS });
    const { container, sluit } = await open('2027-02');
    await wacht();
    expect(container.textContent).toContain('Nog geen planning voor februari 2027.');
    expect(container.textContent).toContain('De planning loopt tot en met 03/01/2027.');
    expect(container.textContent).not.toContain('Alle verwachte diensten zijn ingevuld');
    expect(container.textContent).not.toContain('Geen openstaande diensten');
    expect(container.textContent).not.toContain('Alleen dagen met gaten');
    await sluit();
  });

  it('zonder grens in het antwoord (geen grens of een leesfout): zoals vroeger, geen regel', async () => {
    gaten.mockResolvedValue({ from: '2027-02-01', to: '2027-02-28', days: [], planningTot: null });
    const { container, sluit } = await open('2027-02');
    await wacht();
    expect(container.textContent).toContain('Geen openstaande diensten in februari 2027.');
    expect(container.textContent).not.toContain('De planning loopt');
    expect(container.textContent).not.toContain('Nog geen planning');
    await sluit();
  });

  it('een maand die eindigt vóór de grens: geen regel', async () => {
    gaten.mockResolvedValue({ from: '2026-12-01', to: '2026-12-31', days: [dag('2026-12-02', [])], planningTot: GRENS });
    const { container, sluit } = await open('2026-12');
    await wacht();
    expect(container.textContent).not.toContain('De planning loopt');
    await sluit();
  });

  it('snelle maandwissel: de regel van januari blijft niet staan terwijl februari laadt', async () => {
    let februari!: (v: Awaited<ReturnType<typeof fetchCoverageGaps>>) => void;
    gaten.mockImplementation(async (van) => (van.startsWith('2027-01')
      ? { from: van, to: '2027-01-31', days: [dag('2027-01-02', ['4101'])], planningTot: GRENS }
      : new Promise((r) => { februari = r; })));
    const { container, sluit } = await open('2027-01');
    await wacht();
    expect(container.textContent).toContain('De planning loopt tot en met 03/01/2027.');
    await klikVolgende(container);
    // Februari is onderweg: geen regel en geen telling van januari.
    expect(container.textContent).toContain('Februari 2027');
    expect(container.textContent).not.toContain('De planning loopt');
    expect(container.textContent).not.toContain('niet-ingevulde');
    await act(async () => { februari({ from: '2027-02-01', to: '2027-02-28', days: [], planningTot: GRENS }); });
    await wacht();
    expect(container.textContent).toContain('Nog geen planning voor februari 2027.');
    await sluit();
  });

  it('een laat antwoord van januari raakt februari niet meer', async () => {
    let januari!: (v: Awaited<ReturnType<typeof fetchCoverageGaps>>) => void;
    gaten.mockImplementation(async (van) => (van.startsWith('2027-01')
      ? new Promise((r) => { januari = r; })
      : { from: van, to: '2027-02-28', days: [], planningTot: GRENS }));
    const { container, sluit } = await open('2027-01');
    await klikVolgende(container);
    await wacht();
    expect(container.textContent).toContain('Nog geen planning voor februari 2027.');
    await act(async () => { januari({ from: '2027-01-01', to: '2027-01-31', days: [dag('2027-01-02', ['4101'])], planningTot: '2027-01-31' }); });
    await wacht();
    expect(container.textContent).toContain('Nog geen planning voor februari 2027.');
    expect(container.textContent).toContain('De planning loopt tot en met 03/01/2027.');
    expect(container.textContent).not.toContain('niet-ingevulde');
    await sluit();
  });
});
