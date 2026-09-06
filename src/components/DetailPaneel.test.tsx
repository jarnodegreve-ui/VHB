import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useStandaardKeuze } from './DetailPaneel';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** matchMedia ontbreekt in jsdom; `desktop` bepaalt of lg+ (inline paneel) geldt. */
let desktop = true;
beforeEach(() => {
  desktop = true;
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: desktop,
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
});
afterEach(() => {
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function monteer(ui: React.ReactElement): Promise<{ root: Root; container: HTMLElement }> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(ui); });
  return { root, container };
}

const klik = async (naam: string) => {
  const el = document.querySelector<HTMLButtonElement>(`[data-knop="${naam}"]`);
  if (!el) throw new Error(`knop ${naam} ontbreekt`);
  await act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
};
const gekozenNu = () => document.querySelector('[data-gekozen]')!.getAttribute('data-gekozen');

type Item = { id: string };
const ALLE: Item[] = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];

/** Master-detail-attrap: lijst in state, keuze in state, knoppen om items
 *  weg te halen / terug te zetten (optimistische DELETE + refetch/undo) en
 *  om zelf te kiezen. */
function Harnas() {
  const [items, setItems] = useState<Item[]>(ALLE);
  const [gekozen, setGekozen] = useState<string | null>(null);
  useStandaardKeuze({
    items,
    sleutelVan: (i) => i.id,
    gekozen,
    kies: (i) => setGekozen(i.id),
    wis: () => setGekozen(null),
  });
  return (
    <div data-gekozen={gekozen ?? ''}>
      {/* rauw: testattrap zonder design-primitieven */}
      {ALLE.map((i) => (
        <span key={i.id}>
          <button type="button" data-knop={`weg-${i.id}`} onClick={() => setItems((p) => p.filter((x) => x.id !== i.id))} />
          <button type="button" data-knop={`terug-${i.id}`} onClick={() => setItems(() => ALLE.filter((x) => x.id === i.id || items.some((y) => y.id === x.id)))} />
          <button type="button" data-knop={`kies-${i.id}`} onClick={() => setGekozen(i.id)} />
        </span>
      ))}
    </div>
  );
}

describe('useStandaardKeuze', () => {
  it('desktop: eerste item staat standaard open; verdwijnt het, dan schuift de keuze naar de buur', async () => {
    await monteer(<Harnas />);
    expect(gekozenNu()).toBe('a');
    await klik('weg-a');
    expect(gekozenNu()).toBe('b');
  });

  it('komt het weggeschoven item kort daarna terug (409/404 na DELETE, of ongedaan maken), dan gaat de keuze weer naar dat item', async () => {
    await monteer(<Harnas />);
    await klik('kies-b');
    expect(gekozenNu()).toBe('b');
    await klik('weg-b');
    expect(gekozenNu()).toBe('c'); // buur op dezelfde plek
    await klik('terug-b');
    expect(gekozenNu()).toBe('b');
  });

  it('springt niet terug als de gebruiker intussen zelf iets anders koos', async () => {
    await monteer(<Harnas />);
    await klik('weg-a');
    expect(gekozenNu()).toBe('b');
    await klik('kies-c');
    await klik('terug-a');
    expect(gekozenNu()).toBe('c');
  });

  it('springt niet terug als het item pas na de terugkeertermijn weer opduikt', async () => {
    const nu = Date.now();
    const klok = vi.spyOn(Date, 'now').mockReturnValue(nu);
    await monteer(<Harnas />);
    await klik('weg-a');
    expect(gekozenNu()).toBe('b');
    klok.mockReturnValue(nu + 16_000);
    await klik('terug-a');
    expect(gekozenNu()).toBe('b');
  });

  it('mobiel: geen preselectie, en een verdwenen keuze wordt gewist i.p.v. doorgeschoven', async () => {
    desktop = false;
    await monteer(<Harnas />);
    expect(gekozenNu()).toBe('');
    await klik('kies-a');
    await klik('weg-a');
    expect(gekozenNu()).toBe('');
    await klik('terug-a');
    expect(gekozenNu()).toBe('');
  });
});
