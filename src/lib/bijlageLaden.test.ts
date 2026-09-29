import { beforeEach, describe, expect, it, vi } from 'vitest';

const { apiFetchMock } = vi.hoisted(() => ({ apiFetchMock: vi.fn() }));
vi.mock('./api', () => ({ apiFetch: apiFetchMock }));

import { bijlageVersie } from './bijlageCache';
import { BijlageWeg, LINK_MARGE_MS, haalVerseBijlage, isPdf, laadBijlage, linkVerlooptOp, linkVerlopen, type BijlageBron } from './bijlageLaden';

const NU = Date.parse('2026-09-29T08:00:00Z');
const OPSLAG = 'https://x.supabase.co/storage/v1/object/sign/diversions/o-1-1.pdf';
/** Ondertekende URL zoals Supabase ze geeft: een JWT met `exp` in seconden. */
const link = (verlooptOp: number, merk = 'a') => {
  const deel = (o: unknown) => btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${OPSLAG}?token=${deel({ alg: 'HS256' })}.${deel({ url: 'diversions/o-1-1.pdf', exp: Math.floor(verlooptOp / 1000), merk })}.handtekening`;
};
const GELDIG = link(NU + 6 * 3600_000);
const VERLOPEN = link(NU - 3600_000);
const VERS = link(NU + 12 * 3600_000, 'vers');

const pdf = (inhoud = 'een') => new TextEncoder().encode(`%PDF-1.7\n${inhoud}`);
const bron = (url: string, extra: Partial<BijlageBron> = {}): BijlageBron => ({ soort: 'omleiding', recordId: 'o-1', slot: 1, filename: 'plan.pdf', sizeBytes: 1200, url, ...extra });
const tekst = (b: Uint8Array) => new TextDecoder().decode(b);

describe('bijlageLaden: leeftijd van de link', () => {
  it('leest het verloopmoment uit het token', () => {
    expect(linkVerlooptOp(GELDIG)).toBe(NU + 6 * 3600_000);
    expect(linkVerlooptOp('https://x.test/plan.pdf')).toBeNull();
    expect(linkVerlooptOp('https://x.test/plan.pdf?token=geen-jwt')).toBeNull();
    expect(linkVerlooptOp('geen url')).toBeNull();
  });

  it('verlopen of binnen de marge = eerst een verse link; onbekend = gewoon proberen', () => {
    expect(linkVerlopen(GELDIG, NU)).toBe(false);
    expect(linkVerlopen(VERLOPEN, NU)).toBe(true);
    expect(linkVerlopen(link(NU + LINK_MARGE_MS - 1000), NU)).toBe(true);
    expect(linkVerlopen(link(NU + LINK_MARGE_MS + 1000), NU)).toBe(false);
    expect(linkVerlopen('https://x.test/plan.pdf', NU)).toBe(false);
  });
});

describe('bijlageLaden: is het een PDF', () => {
  it('herkent de PDF-kop en weigert een foutpagina met status 200', () => {
    expect(isPdf(pdf())).toBe(true);
    expect(isPdf(new TextEncoder().encode('\n\n%PDF-1.4'))).toBe(true);
    expect(isPdf(new TextEncoder().encode('<!doctype html><title>Inloggen op wifi</title>'))).toBe(false);
    expect(isPdf(new Uint8Array())).toBe(false);
  });
});

describe('bijlageLaden: de bijlage ophalen', () => {
  const lees = vi.fn();
  const bewaar = vi.fn();
  const vers = vi.fn();
  const net = vi.fn();
  const deps = { lees, bewaar, vers, fetch: net as unknown as typeof fetch, nu: () => NU };
  const antwoord = (b: Uint8Array, status = 200) => new Response(b, { status });

  beforeEach(() => {
    for (const m of [lees, bewaar, vers, net]) m.mockReset();
    lees.mockResolvedValue(null);
    bewaar.mockResolvedValue(true);
    vers.mockResolvedValue({ status: 'onbekend' });
  });

  it('een bewaarde bijlage komt van het toestel: geen netwerk, ook met een verlopen link', async () => {
    lees.mockResolvedValue(pdf('bewaard'));
    const uit = await laadBijlage(bron(VERLOPEN), undefined, deps);
    expect(tekst(uit.bytes)).toContain('bewaard');
    expect(uit.bewaard).toBe(true);
    expect(lees).toHaveBeenCalledWith(OPSLAG, bijlageVersie({ filename: 'plan.pdf', sizeBytes: 1200 }), NU);
    expect(net).not.toHaveBeenCalled();
    expect(vers).not.toHaveBeenCalled();
  });

  it('downloadt met een geldige link en bewaart daarna op sleutel en versie', async () => {
    net.mockResolvedValue(antwoord(pdf('server')));
    const uit = await laadBijlage(bron(GELDIG), undefined, deps);
    expect(tekst(uit.bytes)).toContain('server');
    expect(net).toHaveBeenCalledTimes(1);
    expect(net.mock.calls[0][0]).toBe(GELDIG);
    expect(vers).not.toHaveBeenCalled();
    expect(bewaar).toHaveBeenCalledWith(OPSLAG, 'omleiding', bijlageVersie({ filename: 'plan.pdf', sizeBytes: 1200 }), expect.any(Uint8Array), NU);
    expect(uit).toMatchObject({ bewaard: true, url: GELDIG, sleutel: OPSLAG });
  });

  it('vraagt bij een verlopen link eerst een verse en gebruikt de oude niet meer', async () => {
    vers.mockResolvedValue({ status: 'vers', bron: bron(VERS) });
    net.mockResolvedValue(antwoord(pdf()));
    const uit = await laadBijlage(bron(VERLOPEN), undefined, deps);
    expect(net.mock.calls.map((c) => c[0])).toEqual([VERS]);
    expect(uit.url).toBe(VERS);
  });

  it('haalt na een fout één keer een verse link op en probeert opnieuw', async () => {
    net.mockResolvedValueOnce(antwoord(new TextEncoder().encode('{"error":"InvalidJWT"}'), 400)).mockResolvedValueOnce(antwoord(pdf('tweede')));
    vers.mockResolvedValue({ status: 'vers', bron: bron(VERS) });
    const uit = await laadBijlage(bron(GELDIG), undefined, deps);
    expect(net.mock.calls.map((c) => c[0])).toEqual([GELDIG, VERS]);
    expect(vers).toHaveBeenCalledTimes(1);
    expect(tekst(uit.bytes)).toContain('tweede');
  });

  it('een vervangen bijlage wordt onder de nieuwe versie bewaard', async () => {
    net.mockResolvedValueOnce(antwoord(new Uint8Array(), 400)).mockResolvedValueOnce(antwoord(pdf('nieuw')));
    vers.mockResolvedValue({ status: 'vers', bron: bron(VERS, { filename: 'plan-nieuw.pdf', sizeBytes: 1350 }) });
    await laadBijlage(bron(GELDIG), undefined, deps);
    expect(bewaar.mock.calls[0][2]).toBe(bijlageVersie({ filename: 'plan-nieuw.pdf', sizeBytes: 1350 }));
  });

  it('mislukt alles, dan een fout en niets in de cache', async () => {
    net.mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(laadBijlage(bron(GELDIG), undefined, deps)).rejects.toThrow('Bijlage ophalen mislukte.');
    // Geen verse lijst te krijgen (geen bereik): één poging, geen tweede download.
    expect(net).toHaveBeenCalledTimes(1);
    expect(vers).toHaveBeenCalledTimes(1);
    expect(bewaar).not.toHaveBeenCalled();
  });

  it('een foutpagina met status 200 wordt nooit als bijlage bewaard', async () => {
    net.mockResolvedValue(antwoord(new TextEncoder().encode('<!doctype html>')));
    await expect(laadBijlage(bron(GELDIG), undefined, deps)).rejects.toThrow();
    expect(bewaar).not.toHaveBeenCalled();
  });

  it('staat de bijlage niet meer in de verse lijst, dan is ze weg', async () => {
    net.mockResolvedValue(antwoord(new Uint8Array(), 404));
    vers.mockResolvedValue({ status: 'weg' });
    await expect(laadBijlage(bron(GELDIG), undefined, deps)).rejects.toBeInstanceOf(BijlageWeg);
  });

  it('zonder opslag opent de bijlage toch, alleen niet offline', async () => {
    net.mockResolvedValue(antwoord(pdf()));
    bewaar.mockResolvedValue(false);
    expect((await laadBijlage(bron(GELDIG), undefined, deps)).bewaard).toBe(false);
  });
});

describe('bijlageLaden: een verse link uit de lijst', () => {
  const lijst = [{ id: 'o-1', bijlagen: [{ slot: 1, filename: 'plan.pdf', sizeBytes: 1200, url: VERS }, { slot: 2, filename: 'haltes.pdf', url: 'https://x.test/h.pdf' }] }, { id: 'o-2' }];
  const json = (data: unknown, init: ResponseInit = {}) => new Response(JSON.stringify(data), init);
  beforeEach(() => apiFetchMock.mockReset());

  it('vraagt de lijst van de juiste soort, zonder cache, en geeft de bijlage van record en plaats', async () => {
    apiFetchMock.mockResolvedValue(json(lijst));
    const uit = await haalVerseBijlage({ soort: 'omleiding', recordId: 'o-1', slot: 1 });
    expect(apiFetchMock).toHaveBeenCalledWith('/api/diversions', { cache: 'no-store', signal: undefined });
    expect(uit).toEqual({ status: 'vers', bron: { soort: 'omleiding', recordId: 'o-1', slot: 1, filename: 'plan.pdf', sizeBytes: 1200, uploadedAt: undefined, url: VERS } });
    apiFetchMock.mockResolvedValue(json([]));
    await haalVerseBijlage({ soort: 'update', recordId: 'u-1', slot: 1 });
    expect(apiFetchMock).toHaveBeenLastCalledWith('/api/updates', { cache: 'no-store', signal: undefined });
  });

  it('record of plaats verdwenen = weg', async () => {
    apiFetchMock.mockImplementation(async () => json(lijst));
    expect(await haalVerseBijlage({ soort: 'omleiding', recordId: 'o-9', slot: 1 })).toEqual({ status: 'weg' });
    expect(await haalVerseBijlage({ soort: 'omleiding', recordId: 'o-1', slot: 3 })).toEqual({ status: 'weg' });
    expect(await haalVerseBijlage({ soort: 'omleiding', recordId: 'o-2', slot: 1 })).toEqual({ status: 'weg' });
  });

  it('een lijst uit de cache van de service worker is niet vers', async () => {
    apiFetchMock.mockResolvedValue(json([], { headers: { 'X-VHB-Bron': 'cache' } }));
    expect(await haalVerseBijlage({ soort: 'omleiding', recordId: 'o-1', slot: 1 })).toEqual({ status: 'onbekend' });
  });

  it('een serverfout, een onverwachte vorm of geen bereik zegt niets', async () => {
    apiFetchMock.mockResolvedValueOnce(json({ error: 'stuk' }, { status: 500 }));
    expect(await haalVerseBijlage({ soort: 'omleiding', recordId: 'o-1', slot: 1 })).toEqual({ status: 'onbekend' });
    apiFetchMock.mockResolvedValueOnce(json({ error: 'geen lijst' }));
    expect(await haalVerseBijlage({ soort: 'omleiding', recordId: 'o-1', slot: 1 })).toEqual({ status: 'onbekend' });
    apiFetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    expect(await haalVerseBijlage({ soort: 'omleiding', recordId: 'o-1', slot: 1 })).toEqual({ status: 'onbekend' });
  });
});
