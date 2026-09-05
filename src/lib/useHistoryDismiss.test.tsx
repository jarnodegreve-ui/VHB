import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useHistoryDismiss } from './useHistoryDismiss';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// jsdom voert history.back() asynchroon uit: wachten tot de historiek
// schoon is, anders lekt een popstate in de volgende test.
afterEach(async () => {
  document.body.innerHTML = '';
  await vi.waitFor(() => expect(window.history.state?.vhbOverlay).toBeUndefined());
});

async function monteer(ui: React.ReactElement): Promise<{ root: Root; container: HTMLElement }> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(ui); });
  return { root, container };
}

const klik = (el: Element | null) => { el?.dispatchEvent(new MouseEvent('click', { bubbles: true })); };
const knop = (naam: string) => document.querySelector<HTMLButtonElement>(`[data-knop="${naam}"]`);

/** Overlay-attrap: alleen de hook, met een knop om te sluiten. */
function Overlay({ naam, open, onClose }: { naam: string; open: boolean; onClose: () => void }) {
  useHistoryDismiss(open, onClose);
  return open ? <div data-overlay={naam} /> : null;
}

/** Menu dat bij "kies" zichzelf sluit én een modal opent — in één commit. */
function Harnas({ onModalDicht }: { onModalDicht: () => void }) {
  const [menu, setMenu] = useState(false);
  const [modal, setModal] = useState(false);
  return (
    <>
      {/* rauw: testattrap */}
      <button type="button" data-knop="open-menu" onClick={() => setMenu(true)} />
      {/* rauw: testattrap */}
      <button type="button" data-knop="kies" onClick={() => { setMenu(false); setModal(true); }} />
      {/* rauw: testattrap */}
      <button type="button" data-knop="sluit-modal" onClick={() => setModal(false)} />
      <Overlay naam="menu" open={menu} onClose={() => setMenu(false)} />
      <Overlay naam="modal" open={modal} onClose={() => { setModal(false); onModalDicht(); }} />
    </>
  );
}

const overlay = (naam: string) => document.querySelector(`[data-overlay="${naam}"]`);
const wachtOpHistoriek = () => new Promise((r) => setTimeout(r, 30));

describe('useHistoryDismiss', () => {
  it('sluit door de terugknop en ruimt zijn entry op bij programmatisch sluiten', async () => {
    const basisLengte = window.history.length;
    const { root } = await monteer(<Harnas onModalDicht={() => {}} />);
    await act(async () => { klik(knop('open-menu')); });
    expect(window.history.length).toBe(basisLengte + 1);
    expect(typeof window.history.state?.vhbOverlay).toBe('string');
    // Terugknop → overlay dicht, geen extra back.
    await act(async () => { window.history.back(); });
    await vi.waitFor(() => expect(overlay('menu')).toBeNull());
    expect(window.history.state?.vhbOverlay).toBeUndefined();
    await act(async () => { root.unmount(); });
  });

  it('menu sluit en modal opent in één commit: de modal blijft open en bezit de bovenste entry', async () => {
    const onModalDicht = vi.fn();
    const { root } = await monteer(<Harnas onModalDicht={onModalDicht} />);
    await act(async () => { klik(knop('open-menu')); });
    const menuId = window.history.state?.vhbOverlay as string;
    await act(async () => { klik(knop('kies')); });
    expect(overlay('menu')).toBeNull();
    expect(overlay('modal')).not.toBeNull();
    await act(async () => { await wachtOpHistoriek(); });
    // De modal is niet door de opruim-back van het menu weggeklapt …
    expect(onModalDicht).not.toHaveBeenCalled();
    expect(overlay('modal')).not.toBeNull();
    // … en de entry van het menu is niet als wees achtergebleven onder die van de modal.
    const modalId = window.history.state?.vhbOverlay as string;
    expect(modalId).toBeDefined();
    expect(modalId).not.toBe(menuId);
    await act(async () => { klik(knop('sluit-modal')); });
    await vi.waitFor(() => expect(window.history.state?.vhbOverlay).toBeUndefined());
    await act(async () => { root.unmount(); });
  });
});
