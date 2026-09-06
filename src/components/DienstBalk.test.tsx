import { afterEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { DienstBalk } from './DienstBalk';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => { document.body.innerHTML = ''; });

async function monteer(ui: React.ReactElement): Promise<{ root: Root; container: HTMLElement }> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(ui); });
  return { root, container };
}

const stijl = (el: Element | null) => (el as HTMLElement | null)?.style.transform ?? '';

describe('DienstBalk', () => {
  it('beweegt wijzer, label en vulling via transform (geen left/width-animatie)', async () => {
    // Dienst 8:00–12:00, nu 10:00 → wijzer op 50 %, eerste deel half gereden.
    const { root, container } = await monteer(
      <DienstBalk delen={[{ start: 480, end: 720 }]} nuMin={600} />,
    );
    expect(stijl(container.querySelector('[data-rol="wijzer"]'))).toBe('translateX(50%)');
    expect(stijl(container.querySelector('[data-rol="wijzer-label"]'))).toBe('translateX(50%)');
    expect(container.querySelector('[data-rol="wijzer-label"]')!.textContent).toBe('10:00');
    expect(stijl(container.querySelector('[data-rol="vulling"]'))).toBe('translateX(-50%)');
    // Geen enkel bewegend element animeert nog `left` of `width`.
    for (const el of container.querySelectorAll('[data-rol]')) {
      expect(el.className).not.toMatch(/transition-\[(left|width)\]/);
      expect((el as HTMLElement).style.left).toBe('');
    }
    await act(async () => { root.unmount(); });
  });

  it('zonder "nu" (morgen) geen wijzer; gereden delen staan vol, komende delen leeg', async () => {
    const { root, container } = await monteer(
      <DienstBalk delen={[{ start: 480, end: 600 }, { start: 660, end: 780 }]} nuMin={630} compact />,
    );
    const vullingen = [...container.querySelectorAll('[data-rol="vulling"]')].map(stijl);
    expect(vullingen).toEqual(['translateX(0%)', 'translateX(-100%)']);
    await act(async () => { root.unmount(); });

    const morgen = await monteer(<DienstBalk delen={[{ start: 480, end: 600 }]} nuMin={null} />);
    expect(morgen.container.querySelector('[data-rol="wijzer"]')).toBeNull();
    expect(morgen.container.querySelector('[data-rol="wijzer-label"]')).toBeNull();
    expect(morgen.container.querySelector('[role="img"]')!.getAttribute('aria-label')).toBe('Dienst van 08:00 tot 10:00');
    await act(async () => { morgen.root.unmount(); });
  });
});
