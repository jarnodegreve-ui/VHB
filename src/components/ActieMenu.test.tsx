import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ActieMenu } from './ActieMenu';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// De history-opruiming (useHistoryDismiss → uitgestelde back()) loopt
// asynchroon door jsdom; wachten tot ze klaar is, anders lekt een popstate
// van de vorige test in de volgende en klapt dáár het menu dicht.
afterEach(async () => {
  document.body.innerHTML = '';
  await historiekRust();
});

async function monteer(ui: React.ReactElement): Promise<{ root: Root; container: HTMLElement }> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(ui); });
  return { root, container };
}

const klik = (el: Element | null | undefined) => {
  if (!el) throw new Error('element ontbreekt');
  el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
};
const menu = () => document.querySelector<HTMLElement>('[role="menu"]');
const items = () => Array.from(document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'));
const trigger = (c: HTMLElement) => c.querySelector<HTMLButtonElement>('[aria-haspopup="menu"]')!;
/** Wacht tot de history-entry van het menu is opgeruimd (asynchroon in jsdom). */
const historiekRust = () => vi.waitFor(() => expect(window.history.state?.vhbOverlay).toBeUndefined());

function Harnas({ onKies = () => {} }: { onKies?: (label: string) => void }) {
  return (
    <ActieMenu
      label="Meer acties"
      items={[
        { label: 'Bewerken', onClick: () => onKies('Bewerken') },
        { label: 'Verwijderen', gevaarlijk: true, scheiding: true, onClick: () => onKies('Verwijderen') },
      ]}
    />
  );
}

describe('ActieMenu', () => {
  it('opent, focust het eerste item en houdt items op het 44px-aanraakminimum', async () => {
    const { root, container } = await monteer(<Harnas />);
    const t = trigger(container);
    expect(menu()).toBeNull();
    await act(async () => { klik(t); });
    expect(menu()).not.toBeNull();
    expect(t.getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(items()[0]);
    for (const item of items()) {
      expect(item.classList.contains('min-h-11')).toBe(true);
      expect(item.classList.contains('sm:pointer-fine:min-h-9')).toBe(true);
    }
    // Sluit via de trigger (toggle) vóór het unmounten.
    await act(async () => { klik(t); });
    expect(menu()).toBeNull();
    expect(t.getAttribute('aria-expanded')).toBe('false');
    await act(async () => { root.unmount(); });
  });

  it('Escape sluit alleen het menu (bereikt geen window-listener) en zet de focus terug op de trigger', async () => {
    const opWindow = vi.fn();
    window.addEventListener('keydown', opWindow);
    try {
      const { root, container } = await monteer(<Harnas />);
      const t = trigger(container);
      await act(async () => { klik(t); });
      const eerste = items()[0];
      await act(async () => { eerste.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); });
      expect(menu()).toBeNull();
      expect(opWindow).not.toHaveBeenCalled();
      expect(document.activeElement).toBe(t);
      await historiekRust();
      // Een andere toets bereikt window wél (we slikken alleen Escape in).
      await act(async () => { klik(t); });
      await act(async () => { items()[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })); });
      expect(document.activeElement).toBe(items()[1]);
      expect(opWindow).toHaveBeenCalledTimes(1);
      await act(async () => { klik(t); });
      expect(menu()).toBeNull();
      await act(async () => { root.unmount(); });
    } finally {
      window.removeEventListener('keydown', opWindow);
    }
  });

  it('een item kiezen sluit het menu, voert de actie uit en zet de focus terug op de trigger', async () => {
    const onKies = vi.fn();
    const { root, container } = await monteer(<Harnas onKies={onKies} />);
    const t = trigger(container);
    await act(async () => { klik(t); });
    await act(async () => { klik(items()[1]); });
    expect(onKies).toHaveBeenCalledWith('Verwijderen');
    expect(menu()).toBeNull();
    expect(document.activeElement).toBe(t);
    await act(async () => { root.unmount(); });
  });

  it('de terugknop sluit het menu (history-entry bij openen, weg na sluiten)', async () => {
    const { root, container } = await monteer(<Harnas />);
    const t = trigger(container);
    await act(async () => { klik(t); });
    expect(typeof window.history.state?.vhbOverlay).toBe('string');
    await act(async () => { window.history.back(); });
    await vi.waitFor(() => expect(menu()).toBeNull());
    expect(window.history.state?.vhbOverlay).toBeUndefined();
    await act(async () => { root.unmount(); });
  });
});
