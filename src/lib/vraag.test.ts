import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiFetch = vi.fn();
vi.mock('./api', () => ({ apiFetch: (...args: unknown[]) => apiFetch(...args) }));

import { ApiFout, json, maakVraag } from './vraag';
import { veldfoutenUitAntwoord } from './valideer';
import { laadDagtypes, verwijderImport } from './dienst';
import { laadLoonCodes, LoonFout, verwijderRij } from './loon';
import { laadVoertuigen, TechniekFout, verwijderVoertuig } from './techniek';

/**
 * De drie wrappers zoals ze vóór de samenvoeging in dienst.ts, loon.ts en
 * techniek.ts stonden, letterlijk overgenomen als referentie. De tests
 * hieronder geven de oude en de nieuwe weg hetzelfde antwoord en eisen
 * dezelfde uitkomst (waarde, melding, status, veldfouten, data).
 */
class OudeLoonFout extends Error {
  status: number;
  veldfouten: Record<string, string> | null;
  data: unknown;
  constructor(message: string, status: number, veldfouten: Record<string, string> | null, data: unknown) {
    super(message);
    this.status = status;
    this.veldfouten = veldfouten;
    this.data = data;
  }
}
class OudeTechniekFout extends Error {
  veldfouten: Record<string, string> | null;
  status: number;
  constructor(message: string, status: number, veldfouten: Record<string, string> | null) {
    super(message);
    this.status = status;
    this.veldfouten = veldfouten;
  }
}
async function oudDienst<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let d: { error?: string; details?: string } | null = null;
    try { d = await res.json(); } catch { /* geen json */ }
    throw Object.assign(new Error(d?.details || d?.error || `Er ging iets mis (code ${res.status}).`), { status: res.status });
  }
  return (await res.json()) as T;
}
async function oudLoon<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let data: unknown = null;
    try { data = await res.json(); } catch { /* geen json */ }
    const d = data as { error?: string; details?: string } | null;
    throw new OudeLoonFout(d?.details || d?.error || `Er ging iets mis (code ${res.status}).`, res.status, veldfoutenUitAntwoord(data), data);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}
async function oudTechniek<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let data: unknown = null;
    try { data = await res.json(); } catch { /* geen json */ }
    const d = data as { error?: string; details?: string } | null;
    throw new OudeTechniekFout(d?.details || d?.error || `Er ging iets mis (code ${res.status}).`, res.status, veldfoutenUitAntwoord(data));
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

type Geval = { naam: string; maak: () => Response };
const jsonAntwoord = (status: number, body: unknown) => () =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const GEVALLEN: Geval[] = [
  { naam: '200 met een lijst', maak: jsonAntwoord(200, [{ id: 'a' }, { id: 'b' }]) },
  { naam: '200 met een object', maak: jsonAntwoord(200, { success: true }) },
  { naam: '201 na aanmaken', maak: jsonAntwoord(201, { id: 'nieuw' }) },
  { naam: '400 met veldfouten', maak: jsonAntwoord(400, { error: 'Ongeldige invoer', details: 'Vul een busnummer in', veldfouten: { busnummer: 'Vul een busnummer in' } }) },
  { naam: '400 met alleen error', maak: jsonAntwoord(400, { error: 'Ongeldige invoer' }) },
  { naam: '403 zonder details', maak: jsonAntwoord(403, { error: 'Geen toegang' }) },
  { naam: '404 met extra gegevens (voorstel)', maak: jsonAntwoord(404, { error: 'Dag nog niet geopend', inPlanning: true, voorstel: [{ userId: 'u1', naam: 'Jan', planningCode: '2515' }] }) },
  { naam: '409 met details én error: details wint', maak: jsonAntwoord(409, { error: 'Conflict', details: 'Dit busnummer bestaat al.', veldfouten: { busnummer: 'Dit busnummer bestaat al.' } }) },
  { naam: '409 met lege veldfouten', maak: jsonAntwoord(409, { error: 'Conflict', veldfouten: {} }) },
  { naam: '500 met een HTML-pagina', maak: () => new Response('<html>Internal Server Error</html>', { status: 500 }) },
  { naam: '502 zonder body', maak: () => new Response(null, { status: 502 }) },
  { naam: '500 met leeg JSON-object', maak: jsonAntwoord(500, {}) },
  { naam: '500 met JSON null', maak: jsonAntwoord(500, null) },
];

type Uitkomst =
  | { ok: true; waarde: unknown }
  | { ok: false; melding: string; status: unknown; veldfouten: unknown; heeftVeldfouten: boolean; data: unknown };

const uitkomstVan = async (fn: () => Promise<unknown>): Promise<Uitkomst> => {
  try {
    return { ok: true, waarde: await fn() };
  } catch (err) {
    const e = err as Error & { status?: unknown; veldfouten?: unknown; data?: unknown };
    return { ok: false, melding: e.message, status: e.status, veldfouten: e.veldfouten ?? null, heeftVeldfouten: 'veldfouten' in e, data: e.data ?? null };
  }
};

beforeEach(() => {
  apiFetch.mockReset();
});

describe('gedeelde wrapper tegenover de drie oude kopieën', () => {
  for (const geval of GEVALLEN) {
    it(`loon: ${geval.naam}`, async () => {
      apiFetch.mockResolvedValueOnce(geval.maak());
      const nieuw = await uitkomstVan(() => laadLoonCodes());
      const oud = await uitkomstVan(() => oudLoon(geval.maak()));
      expect(nieuw).toEqual(oud);
    });

    it(`techniek: ${geval.naam}`, async () => {
      apiFetch.mockResolvedValueOnce(geval.maak());
      const nieuw = await uitkomstVan(() => laadVoertuigen());
      const oud = await uitkomstVan(() => oudTechniek(geval.maak()));
      // TechniekFout draagt nu ook `data` (altijd null); de oude klasse had het veld niet.
      expect(nieuw).toEqual(oud);
    });

    it(`dienst: ${geval.naam}`, async () => {
      apiFetch.mockResolvedValueOnce(geval.maak());
      const nieuw = await uitkomstVan(() => laadDagtypes());
      const oud = await uitkomstVan(() => oudDienst(geval.maak()));
      expect(nieuw).toEqual(oud);
    });
  }
});

describe('204 zonder inhoud', () => {
  const leeg = () => new Response(null, { status: 204 });

  it('loon en techniek geven undefined, zoals vroeger', async () => {
    apiFetch.mockResolvedValueOnce(leeg());
    await expect(verwijderRij('2026-09-29', 'r1')).resolves.toBeUndefined();
    await expect(oudLoon(leeg())).resolves.toBeUndefined();
    apiFetch.mockResolvedValueOnce(leeg());
    await expect(verwijderVoertuig('v1')).resolves.toBeUndefined();
    await expect(oudTechniek(leeg())).resolves.toBeUndefined();
  });

  it('dienst geeft nu ook undefined; de oude kopie struikelde over de lege body', async () => {
    await expect(oudDienst(leeg())).rejects.toBeInstanceOf(SyntaxError);
    apiFetch.mockResolvedValueOnce(leeg());
    await expect(verwijderImport('imp-1')).resolves.toBeUndefined();
  });
});

describe('foutklassen blijven onder hun naam bestaan', () => {
  const fout400 = jsonAntwoord(400, { error: 'Ongeldige invoer', veldfouten: { reden: 'Geef een reden op' } });

  it('loon gooit een LoonFout met veldfouten en het ruwe antwoord', async () => {
    apiFetch.mockResolvedValueOnce(fout400());
    const err = await laadLoonCodes().catch((e) => e);
    expect(err).toBeInstanceOf(LoonFout);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(TechniekFout);
    expect(err.status).toBe(400);
    expect(err.veldfouten).toEqual({ reden: 'Geef een reden op' });
    expect(err.data).toEqual({ error: 'Ongeldige invoer', veldfouten: { reden: 'Geef een reden op' } });
  });

  it('techniek gooit een TechniekFout met veldfouten', async () => {
    apiFetch.mockResolvedValueOnce(fout400());
    const err = await laadVoertuigen().catch((e) => e);
    expect(err).toBeInstanceOf(TechniekFout);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(LoonFout);
    expect(err.status).toBe(400);
    expect(err.veldfouten).toEqual({ reden: 'Geef een reden op' });
  });

  it('de constructors nemen dezelfde argumenten aan als vroeger', () => {
    const t = new TechniekFout('Dit voertuig heeft meldingen of werkprestaties.', 409, null);
    expect(t).toBeInstanceOf(TechniekFout);
    expect(t.message).toBe('Dit voertuig heeft meldingen of werkprestaties.');
    expect(t.status).toBe(409);
    expect(t.veldfouten).toBeNull();
    const l = new LoonFout('Niet gevonden', 404, null, { voorstel: [] });
    expect(l).toBeInstanceOf(LoonFout);
    expect(l.data).toEqual({ voorstel: [] });
  });

  it('dienst gooit een gewone Error met status, zonder veldfouten', async () => {
    apiFetch.mockResolvedValueOnce(fout400());
    const err = await laadDagtypes().catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(ApiFout);
    expect(err.status).toBe(400);
    expect('veldfouten' in err).toBe(false);
  });
});

describe('maakVraag en json', () => {
  it('geeft url en init ongewijzigd door aan apiFetch', async () => {
    apiFetch.mockResolvedValueOnce(jsonAntwoord(200, { ok: 1 })());
    const vraag = maakVraag((melding) => new Error(melding));
    const init = json('PUT', { a: 1 });
    await vraag('/api/iets', init);
    expect(apiFetch).toHaveBeenCalledWith('/api/iets', init);
    expect(init).toEqual({ method: 'PUT', body: '{"a":1}' });
  });

  it('een netwerkfout van apiFetch gaat ongewijzigd door', async () => {
    const netwerk = new TypeError('Failed to fetch');
    apiFetch.mockRejectedValueOnce(netwerk);
    await expect(laadDagtypes()).rejects.toBe(netwerk);
  });
});
