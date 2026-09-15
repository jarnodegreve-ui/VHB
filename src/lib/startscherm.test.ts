import { beforeEach, describe, expect, it, vi } from 'vitest';
import { STARTSCHERMEN as ZOD_VRIJ, isStartscherm, leesStartschermLokaal, onthoudStartschermLokaal } from './startscherm';
import { STARTSCHERMEN } from '../../shared/schemas/dashboardVoorkeuren';
import { ROUTES } from '../app/routes';

/** In-memory localStorage: Node ≥ 22 zet zelf een (lege, functieloze)
 *  `localStorage`-global die jsdom's exemplaar in vitest verdringt. */
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

describe('startscherm', () => {
  beforeEach(() => {
    const opslag = maakOpslag();
    vi.stubGlobal('localStorage', opslag);
    if (window !== (globalThis as unknown as Window)) Object.defineProperty(window, 'localStorage', { value: opslag, configurable: true });
  });

  it('de zod-vrije lijst is exact die van het gedeelde schema, en elk scherm bestaat in de routetabel', () => {
    expect([...ZOD_VRIJ]).toEqual([...STARTSCHERMEN]);
    for (const s of ZOD_VRIJ) expect(ROUTES.some((r) => r.view === s)).toBe(true);
  });

  it('valideert en bewaart lokaal', () => {
    expect(isStartscherm('rooster')).toBe(true);
    expect(isStartscherm('verlof')).toBe(false);
    onthoudStartschermLokaal('mijn-dag');
    expect(leesStartschermLokaal()).toBe('mijn-dag');
    window.localStorage.setItem('vhb-startscherm', 'onzin');
    expect(leesStartschermLokaal()).toBeNull();
    onthoudStartschermLokaal(null);
    expect(window.localStorage.getItem('vhb-startscherm')).toBeNull();
  });
});
