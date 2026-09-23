import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

// Looncode en import hebben geen veilige herstelweg (harde delete): een
// expliciete, server-confirmed bevestiging, géén undo (CLAUDE.md,
// Verwijderen, uitzondering 23-09). Deze tests bewijzen per scherm: geen
// DELETE vóór de bevestiging, wel erna, annuleren stuurt niets, de dialoog
// blijft open (bezig) tot de server antwoordt, en een fout geeft
// meldSchrijffout met "Opnieuw proberen".

const { verwijderCodeMock, laadCodesMock, verwijderImportMock, notifyMock } = vi.hoisted(() => ({
  verwijderCodeMock: vi.fn(), laadCodesMock: vi.fn(), verwijderImportMock: vi.fn(), notifyMock: vi.fn(),
}));
vi.mock('../../lib/loon', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../lib/loon')>(),
  verwijderLoonCode: verwijderCodeMock,
  laadLoonCodes: laadCodesMock,
}));
vi.mock('../../lib/dienst', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../lib/dienst')>(),
  verwijderImport: verwijderImportMock,
}));
vi.mock('../../lib/ui', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../lib/ui')>(),
  notify: notifyMock,
}));

import { CodesTab } from './LooncontroleView';
import { ImportsTab } from './DienstopbouwView';
import type { LoonCode } from '../../lib/loon';
import type { SegmentImport } from '../../lib/dienst';

const CODE = {
  code: '2102', codeWeergave: '2102', omschrijving: 'Lijn 2', dienstType: 'lijn', inExport: true, easypayActiviteit: 'LIJN', easypayTypePrest: 40140,
  tik1: '06:00', tik2: '14:00', tik3: null, tik4: null, tik5: null, tik6: null,
  lbRijtijd: null, lbStat100At: null, lbStat100Nat: null, lbStat50Nat: null, lbOnd: null, lbAndWrk: null, lbNacht: null, updatedAt: null, bron: 'handmatig',
} as unknown as LoonCode;

const IMPORTS: SegmentImport[] = [
  { id: 'imp-actief', createdAt: '2026-09-20T08:00:00Z', importedBy: null, filename: 'ET-sept.xlsx', rijen: 900, diensten: 60, dagtypes: ['21/0'], waarschuwingen: [], bevindingen: [], actief: true, actiefSinds: '2026-09-20T09:00:00Z' },
  { id: 'imp-oud', createdAt: '2026-09-01T08:00:00Z', importedBy: null, filename: 'ET-aug.xlsx', rijen: 812, diensten: 57, dagtypes: ['21/0'], waarschuwingen: [], bevindingen: [], actief: false, actiefSinds: null },
];

beforeEach(() => {
  verwijderCodeMock.mockReset();
  laadCodesMock.mockReset().mockResolvedValue([CODE]);
  verwijderImportMock.mockReset();
  notifyMock.mockReset();
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: false, media: query,
    addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(),
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

/** Onder jsdom staan tabel én lijst in de DOM (CSS wisselt ze); de eerste knop volstaat. */
const bevestigKnop = (dialoog: HTMLElement) => within(dialoog).getByRole('button', { name: 'Verwijderen' });

describe('Looncode verwijderen', () => {
  const opent = async () => {
    render(<CodesTab onVersheid={vi.fn()} />);
    const knoppen = await screen.findAllByRole('button', { name: '2102 verwijderen' });
    fireEvent.click(knoppen[0]);
    return screen.findByRole('dialog', { name: 'Looncode verwijderen?' });
  };

  it('stuurt de DELETE pas na de bevestiging en sluit pas na het antwoord', async () => {
    let klaar!: () => void;
    verwijderCodeMock.mockImplementation(() => new Promise<{ success: true }>((r) => { klaar = () => r({ success: true }); }));
    const dialoog = await opent();
    expect(dialoog.textContent).toContain('2102');
    expect(dialoog.textContent).toContain('onbekende code');
    expect(dialoog.textContent).toContain('niet ongedaan');
    expect(verwijderCodeMock).not.toHaveBeenCalled();

    fireEvent.click(bevestigKnop(dialoog));
    expect(verwijderCodeMock).toHaveBeenCalledWith('2102');
    // Server-confirmed: dialoog blijft open met de knop bezig, de rij staat er nog.
    await waitFor(() => expect(bevestigKnop(dialoog).getAttribute('aria-busy')).toBe('true'));
    expect(screen.getByRole('dialog', { name: 'Looncode verwijderen?' })).toBeTruthy();
    expect(screen.getAllByRole('button', { name: '2102 verwijderen' }).length).toBeGreaterThan(0);

    klaar();
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Looncode verwijderen?' })).toBeNull());
    expect(screen.queryAllByRole('button', { name: '2102 verwijderen' })).toHaveLength(0);
    expect(notifyMock).toHaveBeenCalledWith('Looncode 2102 verwijderd.', 'success');
    // Geen undo: de toast draagt geen ongedaan-optie.
    expect(notifyMock.mock.calls[0][2]).toBeUndefined();
  });

  it('annuleren stuurt niets', async () => {
    const dialoog = await opent();
    fireEvent.click(within(dialoog).getByRole('button', { name: 'Annuleren' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Looncode verwijderen?' })).toBeNull());
    expect(verwijderCodeMock).not.toHaveBeenCalled();
  });

  it('meldt een fout met Opnieuw proberen en laat de code staan', async () => {
    verwijderCodeMock.mockRejectedValueOnce(Object.assign(new Error('Kon de looncode niet verwijderen.'), { status: 500 }));
    const dialoog = await opent();
    fireEvent.click(bevestigKnop(dialoog));
    await waitFor(() => expect(notifyMock).toHaveBeenCalled());
    const [tekst, toon, opties] = notifyMock.mock.calls[0];
    expect(tekst).toMatch(/^Verwijderen is mislukt/);
    expect(toon).toBe('error');
    expect(opties?.action?.label).toBe('Opnieuw proberen');
    expect(screen.getAllByRole('button', { name: '2102 verwijderen' }).length).toBeGreaterThan(0);
  });
});

describe('Import verwijderen', () => {
  const opent = () => {
    const onChanged = vi.fn().mockResolvedValue(undefined);
    render(<ImportsTab imports={IMPORTS} isLoading={false} isAdmin onChanged={onChanged} />);
    // Alleen de niet-actieve import heeft een verwijderknop (de server weigert een actieve met 409).
    const knoppen = screen.getAllByRole('button', { name: 'Import verwijderen' });
    expect(knoppen).toHaveLength(1);
    fireEvent.click(knoppen[0]);
    return onChanged;
  };

  it('stuurt de DELETE pas na de bevestiging en sluit pas na het antwoord', async () => {
    let klaar!: () => void;
    verwijderImportMock.mockImplementation(() => new Promise<{ success: true }>((r) => { klaar = () => r({ success: true }); }));
    const onChanged = opent();
    const dialoog = await screen.findByRole('dialog', { name: 'Import verwijderen?' });
    expect(dialoog.textContent).toContain('ET-aug.xlsx');
    expect(dialoog.textContent).toContain('812 ritdelen');
    expect(dialoog.textContent).toContain('niet ongedaan');
    expect(verwijderImportMock).not.toHaveBeenCalled();

    fireEvent.click(bevestigKnop(dialoog));
    expect(verwijderImportMock).toHaveBeenCalledWith('imp-oud');
    await waitFor(() => expect(bevestigKnop(dialoog).getAttribute('aria-busy')).toBe('true'));
    expect(screen.getByRole('dialog', { name: 'Import verwijderen?' })).toBeTruthy();
    expect(onChanged).not.toHaveBeenCalled();

    klaar();
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Import verwijderen?' })).toBeNull());
    expect(onChanged).toHaveBeenCalled();
    expect(notifyMock).toHaveBeenCalledWith('Import verwijderd.', 'success');
  });

  it('annuleren stuurt niets', async () => {
    opent();
    const dialoog = await screen.findByRole('dialog', { name: 'Import verwijderen?' });
    fireEvent.click(within(dialoog).getByRole('button', { name: 'Annuleren' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Import verwijderen?' })).toBeNull());
    expect(verwijderImportMock).not.toHaveBeenCalled();
  });

  it('meldt een fout met Opnieuw proberen', async () => {
    verwijderImportMock.mockRejectedValueOnce(Object.assign(new Error('Alleen een niet-actieve import kan verwijderd worden.'), { status: 409 }));
    const onChanged = opent();
    const dialoog = await screen.findByRole('dialog', { name: 'Import verwijderen?' });
    fireEvent.click(bevestigKnop(dialoog));
    await waitFor(() => expect(notifyMock).toHaveBeenCalled());
    const [tekst, toon, opties] = notifyMock.mock.calls[0];
    expect(tekst).toMatch(/^Verwijderen is mislukt\. Alleen een niet-actieve import/);
    expect(toon).toBe('error');
    expect(opties?.action?.label).toBe('Opnieuw proberen');
    expect(onChanged).not.toHaveBeenCalled();
  });
});
