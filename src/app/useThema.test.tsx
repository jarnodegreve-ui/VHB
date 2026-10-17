import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { useThema, type ThemaVoorkeur } from './useThema';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Nep-matchMedia voor prefers-color-scheme, met een wissel zoals iOS 's avonds. */
let systeemDonker = false;
const luisteraars = new Set<() => void>();
const zetSysteem = (donker: boolean) => { systeemDonker = donker; luisteraars.forEach((l) => l()); };

// jsdom heeft hier geen localStorage: een eenvoudige opslag, zoals in de
// andere tests (startscherm, afmelden).
const maakOpslag = () => {
  const data = new Map<string, string>();
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => { data.set(k, String(v)); },
    removeItem: (k: string) => { data.delete(k); },
    clear: () => data.clear(),
    key: (i: number) => [...data.keys()][i] ?? null,
    get length() { return data.size; },
  };
};

beforeEach(() => {
  systeemDonker = false;
  luisteraars.clear();
  const opslag = maakOpslag();
  vi.stubGlobal('localStorage', opslag);
  if (window !== (globalThis as unknown as Window)) Object.defineProperty(window, 'localStorage', { value: opslag, configurable: true });
  document.documentElement.classList.remove('dark');
  window.matchMedia = ((query: string) => ({
    get matches() { return query.includes('dark') ? systeemDonker : false; },
    media: query,
    addEventListener: (_: string, l: () => void) => luisteraars.add(l),
    removeEventListener: (_: string, l: () => void) => luisteraars.delete(l),
  })) as unknown as typeof window.matchMedia;
});
afterEach(() => { document.body.innerHTML = ''; vi.unstubAllGlobals(); });

const mount = () => {
  let kies!: (v: ThemaVoorkeur) => void;
  function Proef() {
    const t = useThema(null);
    kies = t.kiesThema;
    return <span data-thema={t.theme} data-voorkeur={t.themaVoorkeur ?? ''} />;
  }
  const el = document.createElement('div');
  document.body.appendChild(el);
  const root = createRoot(el);
  act(() => root.render(<Proef />));
  return { kies: (v: ThemaVoorkeur) => act(() => kies(v)), span: () => el.querySelector('span')! };
};

describe('useThema: Automatisch volgt het toestel (Apple-review 17-10, nr. 8)', () => {
  it('Automatisch neemt het systeemthema over en volgt een wissel', () => {
    systeemDonker = true;
    const { kies, span } = mount();
    kies('auto');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(span().dataset.voorkeur).toBe('auto');
    expect(window.localStorage.getItem('vhb-theme')).toBe('auto');
    act(() => zetSysteem(false));
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    expect(span().dataset.thema).toBe('light');
  });

  it('Licht en Donker staan vast, ook als het toestel wisselt', () => {
    const { kies } = mount();
    kies('dark');
    act(() => zetSysteem(false));
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    kies('light');
    act(() => zetSysteem(true));
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('een opgeslagen Automatisch geldt meteen bij de start', () => {
    window.localStorage.setItem('vhb-theme', 'auto');
    systeemDonker = true;
    const { span } = mount();
    expect(span().dataset.thema).toBe('dark');
    expect(span().dataset.voorkeur).toBe('auto');
  });
});
