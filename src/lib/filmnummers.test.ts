import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { apiJsonMock } = vi.hoisted(() => ({ apiJsonMock: vi.fn() }));
vi.mock('./api', () => ({ apiJson: apiJsonMock }));

import { _resetFilmnummersVoorTests, haalFilmnummers, leesFilmnummersLokaal, noteerFilmnummerImport, warmFilmnummers } from './filmnummers';

const SLEUTEL = 'vhb-filmnummers';
const OUD = { bijgewerktOp: '2026-10-01T13:30:00.000Z', items: [{ code: '1', lijn: '', tekst: 'Geen dienst' }, { code: '5000', lijn: '50', tekst: 'Brugge Station' }] };
const NIEUW = { bijgewerktOp: '2026-10-02T08:00:00.000Z', items: [{ code: '1', lijn: '', tekst: 'Geen dienst' }, { code: '9070', lijn: '907', tekst: 'Mariakerke VISO-AHS' }] };

let opslag: Map<string, string>;

beforeEach(() => {
  apiJsonMock.mockReset();
  _resetFilmnummersVoorTests();
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-01T16:00:00'));
  opslag = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => opslag.get(key) ?? null,
    setItem: (key: string, value: string) => opslag.set(key, value),
    removeItem: (key: string) => opslag.delete(key),
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('de filmnummers op het toestel', () => {
  it('haalFilmnummers bewaart de lijst; een lege lijst van de server wist de kopie', async () => {
    apiJsonMock.mockResolvedValueOnce(OUD);
    expect(await haalFilmnummers()).toEqual(OUD);
    expect(leesFilmnummersLokaal()).toEqual(OUD);

    // De server zegt dat er geen lijst is (nooit geïmporteerd, of bewust leeggemaakt).
    apiJsonMock.mockResolvedValueOnce({ items: [], bijgewerktOp: null });
    expect((await haalFilmnummers()).items).toEqual([]);
    expect(opslag.has(SLEUTEL)).toBe(false);
    expect(leesFilmnummersLokaal()).toBeNull();
  });

  it('een antwoord in een onverwachte vorm is een laadfout en laat de kopie staan', async () => {
    noteerFilmnummerImport(OUD);
    _resetFilmnummersVoorTests();
    for (const vreemd of [null, [], 'tekst', { ok: true }, { items: 'nee' }]) {
      apiJsonMock.mockResolvedValueOnce(vreemd);
      await expect(haalFilmnummers()).rejects.toThrow('De filmnummers konden niet laden.');
    }
    expect(leesFilmnummersLokaal()).toEqual(OUD);
  });

  it('een antwoord dat vóór een eigen import vertrok zet de lijst niet terug', async () => {
    let antwoord!: (waarde: unknown) => void;
    apiJsonMock.mockReturnValueOnce(new Promise((resolve) => { antwoord = resolve; }));
    const onderweg = haalFilmnummers();
    // De admin importeert terwijl de verversing nog loopt.
    noteerFilmnummerImport(NIEUW);
    antwoord(OUD);
    expect(await onderweg).toEqual(NIEUW);
    expect(leesFilmnummersLokaal()).toEqual(NIEUW);

    // Een verversing van ná de import telt weer gewoon.
    apiJsonMock.mockResolvedValueOnce(OUD);
    expect(await haalFilmnummers()).toEqual(OUD);
    expect(leesFilmnummersLokaal()).toEqual(OUD);
  });
});

describe('warmFilmnummers, de stille ophaling na de start', () => {
  it('haalt de lijst op als er nog geen kopie staat, en daarna een halve dag niet meer', async () => {
    apiJsonMock.mockResolvedValue(OUD);
    await warmFilmnummers();
    expect(apiJsonMock).toHaveBeenCalledTimes(1);
    expect(leesFilmnummersLokaal()).toEqual(OUD);

    vi.advanceTimersByTime(11 * 60 * 60 * 1000);
    await warmFilmnummers();
    expect(apiJsonMock).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(2 * 60 * 60 * 1000);
    apiJsonMock.mockResolvedValue(NIEUW);
    await warmFilmnummers();
    expect(apiJsonMock).toHaveBeenCalledTimes(2);
    expect(leesFilmnummersLokaal()).toEqual(NIEUW);
  });

  it('een kopie van vóór deze versie (zonder ophaalmoment) wordt één keer ververst', async () => {
    opslag.set(SLEUTEL, JSON.stringify(OUD));
    apiJsonMock.mockResolvedValue(NIEUW);
    await warmFilmnummers();
    expect(apiJsonMock).toHaveBeenCalledTimes(1);
    expect(leesFilmnummersLokaal()).toEqual(NIEUW);
  });

  it('zonder bereik gebeurt er niets: geen fout, en de kopie blijft staan', async () => {
    opslag.set(SLEUTEL, JSON.stringify(OUD));
    apiJsonMock.mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(warmFilmnummers()).resolves.toBeUndefined();
    expect(leesFilmnummersLokaal()).toEqual(OUD);
  });

  it('geblokkeerde opslag (privémodus) breekt niets', async () => {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('geblokkeerd'); },
      setItem: () => { throw new Error('geblokkeerd'); },
      removeItem: () => { throw new Error('geblokkeerd'); },
    });
    apiJsonMock.mockResolvedValue(OUD);
    expect(leesFilmnummersLokaal()).toBeNull();
    await expect(warmFilmnummers()).resolves.toBeUndefined();
    expect(await haalFilmnummers()).toEqual(OUD);
  });
});
