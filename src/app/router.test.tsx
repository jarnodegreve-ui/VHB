import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useRoute } from './router';
import { useHistoryDismiss } from '../lib/useHistoryDismiss';

/**
 * Navigeren vanuit de mobiele zijbalk (melding Jarno 11-09: "wat ik ook
 * aantik in het menu, ik kom steeds op dezelfde pagina terecht").
 *
 * De zijbalk is op mobiel een overlay met een eigen history-entry
 * (useHistoryDismiss), zodat de systeem-terugknop hem sluit; bij
 * programmatisch sluiten ruimt hij die entry op met een uitgestelde back().
 * Een tik op een menu-item wisselt de route én sluit de lade in één commit.
 * Wisselde de historiek pas in de view-transition-callback — een
 * rendering-stap later — dan was de lade eerder klaar met opruimen dan de
 * router met navigeren, en at die back() de verse pagina op.
 *
 * Vandaar de twee eigenschappen hieronder: de historiek wisselt synchroon in
 * de tik zelf, en een tik vanuit een open lade laat geen extra stap achter.
 * De echte volgorde van browser-traversals rijdt e2e/zijbalk.spec.ts.
 */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Start = (cb: () => void) => { finished: Promise<void> };
const doc = document as unknown as { startViewTransition?: Start };

/** Nep-view-transitie waarvan wíj bepalen wanneer de update draait — zo staat
 *  het gaatje tussen tik en schilderen open, net als in de browser. */
function handmatigeOvergang() {
  const wachtrij: Array<() => void> = [];
  doc.startViewTransition = (cb) => {
    wachtrij.push(cb);
    return { finished: Promise.resolve() };
  };
  return { schilder: () => wachtrij.splice(0).forEach((cb) => cb()) };
}

async function monteer(ui: React.ReactElement): Promise<Root> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(ui); });
  return root;
}

const tikken = () => new Promise((r) => setTimeout(r, 20));

/** Schil-attrap: een zijbalk-overlay met één menu-item, zoals App.tsx. */
function Schil() {
  const { view, navigeer } = useRoute();
  const [ladeOpen, setLadeOpen] = useState(false);
  useHistoryDismiss(ladeOpen, () => setLadeOpen(false));
  return (
    <>
      {/* rauw: testattrap */}
      <button type="button" data-knop="open-lade" onClick={() => setLadeOpen(true)} />
      {/* rauw: testattrap */}
      <button type="button" data-knop="naar-rooster" onClick={() => { navigeer('rooster'); setLadeOpen(false); }} />
      <span data-view={view} />
    </>
  );
}

const klik = (naam: string) => {
  document.querySelector<HTMLButtonElement>(`[data-knop="${naam}"]`)?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
};
const zichtbareView = () => document.querySelector('[data-view]')?.getAttribute('data-view');

beforeEach(() => {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: false, media: query, addEventListener: () => undefined, removeEventListener: () => undefined,
  }));
  window.history.pushState(null, '', '/verlof');
});

afterEach(async () => {
  delete doc.startViewTransition;
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
  await tikken();
});

describe('navigeren vanuit de mobiele zijbalk', () => {
  it('zet de nieuwe pagina meteen in de historiek, ook al schildert de overgang later', async () => {
    const overgang = handmatigeOvergang();
    const root = await monteer(<Schil />);
    await act(async () => { klik('open-lade'); });

    // Eén commit: route wisselen én de lade sluiten.
    await act(async () => { klik('naar-rooster'); });
    // Nog vóór de overgang schildert staat de pagina al in de historiek —
    // anders kan de opruim-back() van de lade haar opeten.
    expect(window.location.pathname).toBe('/rooster');
    expect(zichtbareView()).toBe('verlof');

    await act(async () => { overgang.schilder(); await tikken(); });
    expect(zichtbareView()).toBe('rooster');
    expect(window.location.pathname).toBe('/rooster');
    await act(async () => { root.unmount(); });
  });

  it('laat geen lege ladestap achter: één keer terug is één pagina terug', async () => {
    const overgang = handmatigeOvergang();
    const root = await monteer(<Schil />);
    await act(async () => { klik('open-lade'); });
    await act(async () => { klik('naar-rooster'); });
    await act(async () => { overgang.schilder(); await tikken(); });
    expect(zichtbareView()).toBe('rooster');

    await act(async () => { window.history.back(); await tikken(); });
    expect(window.location.pathname).toBe('/verlof');
    expect(zichtbareView()).toBe('verlof');
    await act(async () => { root.unmount(); });
  });

  it('navigeert gewoon door zonder open lade', async () => {
    const overgang = handmatigeOvergang();
    const root = await monteer(<Schil />);
    await act(async () => { klik('naar-rooster'); });
    await act(async () => { overgang.schilder(); await tikken(); });
    expect(window.location.pathname).toBe('/rooster');
    expect(zichtbareView()).toBe('rooster');

    await act(async () => { window.history.back(); await tikken(); });
    expect(zichtbareView()).toBe('verlof');
    await act(async () => { root.unmount(); });
  });
});
