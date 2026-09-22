import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { VerlofBeoordelingKnoppen, type VerlofBeoordelingActies } from './VerlofBeoordeling';
import type { LeaveRequest } from '../types';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(() => {
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: false, media: query, addEventListener: () => undefined, removeEventListener: () => undefined }));
});
afterEach(() => {
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

const AANVRAAG: LeaveRequest = { id: 'l-1', userId: '3', startDate: '2026-10-05', endDate: '2026-10-07', type: 'betaald_verlof', status: 'pending', createdAt: '2026-09-20T08:00:00Z' };

const knop = (tekst: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.trim() === tekst);
const klik = async (tekst: string) => {
  const el = knop(tekst);
  if (!el) throw new Error(`knop ${tekst} ontbreekt`);
  await act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
};

async function monteer(onDecide: VerlofBeoordelingActies['onDecide']) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<VerlofBeoordelingKnoppen aanvraag={AANVRAAG} onDecide={onDecide} onClose={() => undefined} today="2026-09-22" isPlanner />);
  });
}

describe('VerlofBeoordelingKnoppen: afwijzen met reden', () => {
  it('opent bij Afwijzen eerst een tekstvak en beslist pas na de tweede klik, mét de getrimde reden', async () => {
    const onDecide = vi.fn<VerlofBeoordelingActies['onDecide']>();
    await monteer(onDecide);
    expect(document.querySelector('textarea')).toBeNull();

    await klik('Afwijzen');
    expect(onDecide).not.toHaveBeenCalled();
    const vak = document.querySelector<HTMLTextAreaElement>('textarea');
    expect(vak).not.toBeNull();
    // Goedkeuren is in de weigerstap weg: één beslissing tegelijk.
    expect(knop('Goedkeuren')).toBeUndefined();

    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
      setter.call(vak, '  Te veel collega\'s al vrij.  ');
      vak!.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await klik('Afwijzen');
    expect(onDecide).toHaveBeenCalledWith('l-1', 'rejected', 'pending', "Te veel collega's al vrij.");
  });

  it('beslist zonder reden als het vak leeg blijft, en Terug sluit de weigerstap zonder beslissing', async () => {
    const onDecide = vi.fn<VerlofBeoordelingActies['onDecide']>();
    await monteer(onDecide);
    await klik('Afwijzen');
    await klik('Terug');
    expect(document.querySelector('textarea')).toBeNull();
    expect(knop('Goedkeuren')).toBeDefined();
    expect(onDecide).not.toHaveBeenCalled();

    await klik('Afwijzen');
    await klik('Afwijzen');
    expect(onDecide).toHaveBeenCalledWith('l-1', 'rejected', 'pending', undefined);
  });
});
