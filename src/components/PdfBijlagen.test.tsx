import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import fs from 'node:fs';
import path from 'node:path';
import type { Diversion, Update } from '../types';

/**
 * De PDF-bijlagen van updates en omleidingen delen hun gedrag (controle-ronde
 * 29-09, nr. 31). Vroeger had elk scherm een eigen kopie en die waren uit
 * elkaar gegroeid: na een geweigerd bestand maakte het scherm van de updates
 * het bestandsveld niet leeg, waardoor hetzelfde bestand opnieuw kiezen niets
 * deed. Elke test hieronder draait daarom op allebei de schermen.
 */
const { apiFetchMock, notifyMock } = vi.hoisted(() => ({ apiFetchMock: vi.fn(), notifyMock: vi.fn() }));
vi.mock('../lib/api', () => ({ apiFetch: apiFetchMock }));
vi.mock('../lib/ui', async (importOriginal) => ({
  ...await importOriginal<typeof import('../lib/ui')>(),
  notify: notifyMock,
}));

import { UpdateBijlagen } from './UpdateBijlagen';
import { OmleidingBijlagen, uploadWachtrij } from './OmleidingBijlagen';
import { PDF_MAX_BYTES, eersteVrijeSlot, leesAlsDataUrl as viaBijlagen } from './PdfBijlagen';
import { leesAlsDataUrl } from '../lib/dataUrl';

const pdf = (naam = 'plan.pdf', bytes = 12) => new File([new Uint8Array(bytes)], naam, { type: 'application/pdf' });

const UPDATE: Update = {
  id: 'u 1', date: '29/09/2026', title: 'Mededeling', content: 'Tekst',
  bijlagen: [{ slot: 1, filename: 'eerste.pdf', sizeBytes: 100, url: 'https://opslag.test/u-1.pdf' }],
} as Update;
const OMLEIDING: Diversion = {
  id: 'o 1', line: '12', title: 'Werken', description: 'x', startDate: '2026-09-29',
  bijlagen: [
    { slot: 1, filename: 'eerste.pdf', sizeBytes: 100, url: 'https://opslag.test/o-1.pdf' },
    { slot: 3, filename: 'derde.pdf', sizeBytes: 100, url: 'https://opslag.test/o-3.pdf' },
  ],
};

type Scherm = {
  naam: string;
  /** API-pad van het record, zoals het scherm het moet opbouwen. */
  pad: string;
  /** De eerste vrije plaats in de fixture. */
  vrij: number;
  render: (onGewijzigd: () => void) => void;
};

const SCHERMEN: Scherm[] = [
  {
    naam: 'update',
    pad: '/api/updates/u%201',
    vrij: 2,
    render: (onGewijzigd) => { render(<UpdateBijlagen update={UPDATE} tonen={false} onTonenChange={() => {}} onGewijzigd={onGewijzigd} />); },
  },
  {
    naam: 'omleiding',
    pad: '/api/diversions/o%201',
    vrij: 2,
    render: (onGewijzigd) => { render(<OmleidingBijlagen diversion={OMLEIDING} wachtrij={[]} onWachtrij={() => {}} onGewijzigd={onGewijzigd} />); },
  },
];

/** Het verborgen bestandsveld, met een spion op het leegmaken (jsdom laat
 *  `files` niet terugvallen na `value = ''`, de toewijzing zelf is wat telt). */
const bestandsveld = () => {
  const veld = document.querySelector<HTMLInputElement>('input[type="file"]')!;
  expect(veld).toBeTruthy();
  const leeggemaakt = vi.fn();
  Object.defineProperty(veld, 'value', { configurable: true, get: () => '', set: leeggemaakt });
  return { veld, leeggemaakt };
};
const kies = async (veld: HTMLInputElement, file: File) => {
  await act(async () => {
    fireEvent.change(veld, { target: { files: [file] } });
    await new Promise((r) => setTimeout(r, 0));
  });
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
};

beforeEach(() => {
  apiFetchMock.mockReset();
  notifyMock.mockReset();
  apiFetchMock.mockResolvedValue(new Response(JSON.stringify({ success: true })));
});
afterEach(() => cleanup());

describe.each(SCHERMEN)('bijlagen bij een $naam', (scherm) => {
  it('een geweigerd bestand (geen PDF) meldt de fout, stuurt niets en maakt het veld leeg', async () => {
    const onGewijzigd = vi.fn();
    scherm.render(onGewijzigd);
    const { veld, leeggemaakt } = bestandsveld();
    await kies(veld, new File(['x'], 'foto.png', { type: 'image/png' }));
    expect(notifyMock).toHaveBeenCalledExactlyOnceWith('Alleen PDF-bestanden.', 'error');
    expect(apiFetchMock).not.toHaveBeenCalled();
    expect(onGewijzigd).not.toHaveBeenCalled();
    // Zonder dit vuurt het veld geen change meer af bij hetzelfde bestand.
    expect(leeggemaakt).toHaveBeenCalledWith('');
  });

  it('een te groot bestand (boven 3,5 MB) wordt geweigerd met de bestaande melding en maakt het veld leeg', async () => {
    scherm.render(vi.fn());
    const { veld, leeggemaakt } = bestandsveld();
    await kies(veld, pdf('groot.pdf', PDF_MAX_BYTES + 1));
    expect(notifyMock).toHaveBeenCalledExactlyOnceWith('PDF is te groot (max 4 MB).', 'error');
    expect(apiFetchMock).not.toHaveBeenCalled();
    expect(leeggemaakt).toHaveBeenCalledWith('');
  });

  it('een geldige PDF gaat naar de eerste vrije plaats van het record, meldt succes en maakt het veld leeg', async () => {
    const onGewijzigd = vi.fn();
    scherm.render(onGewijzigd);
    const { veld, leeggemaakt } = bestandsveld();
    await kies(veld, pdf('haltekaart.pdf'));
    expect(apiFetchMock).toHaveBeenCalledTimes(1);
    const [pad, init] = apiFetchMock.mock.calls[0];
    expect(pad).toBe(`${scherm.pad}/bijlage`);
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({ slot: scherm.vrij, filename: 'haltekaart.pdf' });
    expect(body.dataUrl).toMatch(/^data:application\/pdf;base64,/);
    expect(notifyMock).toHaveBeenCalledExactlyOnceWith('PDF toegevoegd.', 'success');
    expect(onGewijzigd).toHaveBeenCalledTimes(1);
    expect(leeggemaakt).toHaveBeenCalledWith('');
  });

  it('een geweigerde upload meldt de reden van de server, laadt niets opnieuw en maakt het veld leeg', async () => {
    apiFetchMock.mockResolvedValue(new Response(JSON.stringify({ error: 'Bestand is te groot (max 4 MB).' }), { status: 413 }));
    const onGewijzigd = vi.fn();
    scherm.render(onGewijzigd);
    const { veld, leeggemaakt } = bestandsveld();
    await kies(veld, pdf());
    expect(notifyMock).toHaveBeenCalledTimes(1);
    expect(notifyMock.mock.calls[0][0]).toMatch(/^Uploaden is mislukt\. Bestand is te groot \(max 4 MB\)\./);
    expect(notifyMock.mock.calls[0][1]).toBe('error');
    expect(onGewijzigd).not.toHaveBeenCalled();
    expect(leeggemaakt).toHaveBeenCalledWith('');
    // Het blok is daarna weer bruikbaar.
    expect(screen.getByText('PDF toevoegen…')).toBeTruthy();
  });

  it('verwijderen stuurt de DELETE naar de plaats van die bijlage', async () => {
    const onGewijzigd = vi.fn();
    scherm.render(onGewijzigd);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Bijlage eerste.pdf verwijderen' }));
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(apiFetchMock).toHaveBeenCalledExactlyOnceWith(`${scherm.pad}/bijlage/1`, { method: 'DELETE' });
    expect(notifyMock).toHaveBeenCalledExactlyOnceWith('PDF verwijderd.', 'success');
    expect(onGewijzigd).toHaveBeenCalledTimes(1);
  });
});

describe('wat per scherm verschilt blijft verschillen', () => {
  it('een nieuwe update heeft nog geen kiesknop: eerst publiceren', () => {
    render(<UpdateBijlagen update={null} tonen={false} onTonenChange={() => {}} onGewijzigd={() => {}} />);
    expect(document.querySelector('input[type="file"]')).toBeNull();
    expect(screen.getByText('Publiceer de update eerst, daarna kan je PDF’s toevoegen.')).toBeTruthy();
  });

  it('een nieuwe omleiding zet de gekozen PDF in de wachtrij, zonder iets te sturen', async () => {
    const onWachtrij = vi.fn();
    const eerste = pdf('plan.pdf');
    render(<OmleidingBijlagen diversion={null} wachtrij={[eerste]} onWachtrij={onWachtrij} onGewijzigd={() => {}} />);
    const { veld, leeggemaakt } = bestandsveld();
    const tweede = pdf('haltes.pdf');
    await kies(veld, tweede);
    expect(onWachtrij).toHaveBeenCalledExactlyOnceWith([eerste, tweede]);
    expect(apiFetchMock).not.toHaveBeenCalled();
    expect(leeggemaakt).toHaveBeenCalledWith('');
    expect(screen.getByText('Wordt toegevoegd bij het opslaan')).toBeTruthy();
  });

  it('twee plaatsen bij een update, vijf bij een omleiding: vol = geen kiesknop meer', () => {
    const vol: Update = { ...UPDATE, bijlagen: [UPDATE.bijlagen![0], { slot: 2, filename: 'tweede.pdf', sizeBytes: 1, url: 'https://opslag.test/u-2.pdf' }] };
    render(<UpdateBijlagen update={vol} tonen={false} onTonenChange={() => {}} onGewijzigd={() => {}} />);
    expect(document.querySelector('input[type="file"]')).toBeNull();
    cleanup();
    const vijf: Diversion = { ...OMLEIDING, bijlagen: [1, 2, 3, 4, 5].map((slot) => ({ slot, filename: `p${slot}.pdf`, sizeBytes: 1, url: `https://opslag.test/o-${slot}.pdf` })) };
    render(<OmleidingBijlagen diversion={vijf} wachtrij={[]} onWachtrij={() => {}} onGewijzigd={() => {}} />);
    expect(document.querySelector('input[type="file"]')).toBeNull();
  });

  it('de wachtrij van een nieuwe omleiding gaat naar de plaatsen 1, 2, … en stopt bij de eerste mislukking', async () => {
    apiFetchMock
      .mockResolvedValueOnce(new Response('{}'))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'Kon de PDF niet opslaan.' }), { status: 500 }));
    const geslaagd = await uploadWachtrij('nieuw', [pdf('a.pdf'), pdf('b.pdf'), pdf('c.pdf')]);
    expect(geslaagd).toBe(1);
    expect(apiFetchMock.mock.calls.map(([pad, init]) => [pad, JSON.parse(init.body).slot])).toEqual([
      ['/api/diversions/nieuw/bijlage', 1],
      ['/api/diversions/nieuw/bijlage', 2],
    ]);
  });
});

describe('eersteVrijeSlot', () => {
  it('geeft de laagste vrije plaats, of null als alles bezet is', () => {
    expect(eersteVrijeSlot([], 2)).toBe(1);
    expect(eersteVrijeSlot([{ slot: 1 }, { slot: 3 }], 5)).toBe(2);
    expect(eersteVrijeSlot([{ slot: 2 }], 2)).toBe(1);
    expect(eersteVrijeSlot([{ slot: 1 }, { slot: 2 }], 2)).toBeNull();
  });
});

describe('een bestand lezen als data-URL: één helper', () => {
  it('leest de inhoud als base64 data-URL', async () => {
    const url = await leesAlsDataUrl(new File(['%PDF-1.4'], 'x.pdf', { type: 'application/pdf' }));
    expect(url).toBe(`data:application/pdf;base64,${btoa('%PDF-1.4')}`);
  });

  it('PdfBijlagen geeft dezelfde functie door', () => {
    expect(viaBijlagen).toBe(leesAlsDataUrl);
  });

  it('geen enkel scherm heeft nog een eigen kopie van de FileReader-lus', () => {
    const wortel = path.resolve(__dirname, '..');
    const metKopie: string[] = [];
    const loop = (map: string) => {
      for (const naam of fs.readdirSync(map, { withFileTypes: true })) {
        const vol = path.join(map, naam.name);
        if (naam.isDirectory()) { loop(vol); continue; }
        if (!/\.tsx?$/.test(naam.name) || /\.test\.tsx?$/.test(naam.name)) continue;
        if (fs.readFileSync(vol, 'utf8').includes('readAsDataURL')) metKopie.push(path.relative(wortel, vol));
      }
    };
    loop(wortel);
    expect(metKopie).toEqual(['lib/dataUrl.ts']);
  });
});
