import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { MaandoverzichtModal } from './MaandoverzichtModal';

const tabel = vi.hoisted(() => {
  let vrij!: () => void;
  const wacht = new Promise<void>(resolve => { vrij = resolve; });
  return { start: vi.fn(), wacht, vrij };
});
vi.mock('./MaandoverzichtTabel', async (origineel) => {
  tabel.start();
  await tabel.wacht;
  return origineel();
});

afterEach(cleanup);

it('opent en sluit direct wanneer de tabelcode nog laadt, met dezelfde focus bij aankomst', async () => {
  const sluit = vi.fn();
  const props = {
    onClose: sluit, monthIndex: 10, year: 2026, laden: true,
    overzicht: { dagen: 30, rijen: [], totaal: { diensten: 0, minuten: 0, anderWerk: 0, ziek: 0, betaald: 0, vrij: 0, dagen: 0 } },
    sort: { kolom: 'naam', richting: 1 } as const, sorteer: vi.fn(),
  };
  const { rerender } = render(<MaandoverzichtModal {...props} open={false} />);
  expect(tabel.start).not.toHaveBeenCalled();
  rerender(<MaandoverzichtModal {...props} open />);
  await waitFor(() => expect(tabel.start).toHaveBeenCalledOnce());
  expect(screen.getAllByRole('status')).toHaveLength(1);
  const knop = screen.getByRole('button', { name: 'Sluiten' });
  fireEvent.click(knop);
  expect(sluit).toHaveBeenCalledOnce();
  rerender(<MaandoverzichtModal {...props} open={false} />);
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

  rerender(<MaandoverzichtModal {...props} open laden={false} />);
  const dialoog = screen.getByRole('dialog');
  const sluiten = screen.getByRole('button', { name: 'Sluiten' });
  sluiten.focus();
  expect(screen.getByRole('status').textContent).toContain('Overzicht berekenen');
  await act(async () => { tabel.vrij(); });
  await screen.findByRole('table', { name: /Maandoverzicht november 2026/i });
  expect(screen.getByRole('dialog')).toBe(dialoog);
  expect(document.activeElement).toBe(sluiten);
  expect(screen.queryByRole('status')).toBeNull();
});
