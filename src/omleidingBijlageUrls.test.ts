// @vitest-environment node
/**
 * Ondertekende URL's van omleidingsbijlagen (snelheidsonderzoek 15-10): één
 * Storage-aanroep per lijst paden in plaats van één per bestand, en elke URL
 * 30 min onthouden per instantie. Een pad zonder bestand ontbreekt in het
 * antwoord en wordt nooit onthouden; een schrijfactie vergeet haar pad.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const storage = vi.hoisted(() => ({
  aanroepen: [] as Array<{ bucket: string; paden: string[]; ttl: number }>,
  antwoord: null as null | ((paden: string[]) => unknown),
}));

vi.mock('../api/db.js', () => {
  const from = (bucket: string) => ({
    createSignedUrls: async (paden: string[], ttl: number) => {
      storage.aanroepen.push({ bucket, paden, ttl });
      if (storage.antwoord) return storage.antwoord(paden);
      return { data: paden.map((path) => ({ path, signedUrl: `https://opslag.test/${path}?sig=${storage.aanroepen.length}`, error: null })), error: null };
    },
  });
  const client = { storage: { from } };
  return { db: client, supabase: client, supabaseAdmin: client };
});

const { ondertekenDiversionBijlagen, ondertekenDiversionBijlage, vergeetDiversionBijlageUrls, DIVERSION_URL_TTL_SEC } = await import('../api/storage.js');

beforeEach(() => {
  storage.aanroepen = [];
  storage.antwoord = null;
  vergeetDiversionBijlageUrls();
});

describe('ondertekenDiversionBijlagen', () => {
  it('ondertekent alle paden in één Storage-aanroep en laat een pad zonder bestand weg', async () => {
    storage.antwoord = (paden) => ({
      data: paden.map((path) => (path === 'o-2-1.pdf'
        ? { path, signedUrl: '', error: 'Object not found' }
        : { path, signedUrl: `https://opslag.test/${path}?sig=a`, error: null })),
      error: null,
    });
    const urls = await ondertekenDiversionBijlagen(['o-1-1.pdf', 'o-1-2.pdf', 'o-2-1.pdf', 'o-1-1.pdf']);
    expect(storage.aanroepen).toEqual([{ bucket: 'diversions', paden: ['o-1-1.pdf', 'o-1-2.pdf', 'o-2-1.pdf'], ttl: DIVERSION_URL_TTL_SEC }]);
    expect([...urls.entries()]).toEqual([
      ['o-1-1.pdf', 'https://opslag.test/o-1-1.pdf?sig=a'],
      ['o-1-2.pdf', 'https://opslag.test/o-1-2.pdf?sig=a'],
    ]);
  });

  it('een tweede lijst binnen 30 min komt uit het geheugen: geen Storage-aanroep', async () => {
    await ondertekenDiversionBijlagen(['o-1-1.pdf', 'o-1-2.pdf']);
    const urls = await ondertekenDiversionBijlagen(['o-1-2.pdf', 'o-1-1.pdf']);
    expect(storage.aanroepen).toHaveLength(1);
    expect(urls.get('o-1-1.pdf')).toBe('https://opslag.test/o-1-1.pdf?sig=1');
    // Een nieuw pad erbij: alleen dát pad gaat naar Storage.
    await ondertekenDiversionBijlagen(['o-1-1.pdf', 'o-3-1.pdf']);
    expect(storage.aanroepen[1]?.paden).toEqual(['o-3-1.pdf']);
  });

  it('na 30 min wordt een URL opnieuw ondertekend, een pad zonder bestand wordt nooit onthouden', async () => {
    let nu = 1_000_000;
    const klok = () => nu;
    storage.antwoord = (paden) => ({ data: paden.map((path) => ({ path, signedUrl: path === 'weg.pdf' ? '' : `https://opslag.test/${path}?sig=${storage.aanroepen.length}`, error: path === 'weg.pdf' ? 'Object not found' : null })), error: null });
    await ondertekenDiversionBijlagen(['o-1-1.pdf', 'weg.pdf'], klok);
    nu += 29 * 60_000;
    await ondertekenDiversionBijlagen(['o-1-1.pdf', 'weg.pdf'], klok);
    // o-1-1 uit de cache, weg.pdf opnieuw geprobeerd.
    expect(storage.aanroepen.map((a) => a.paden)).toEqual([['o-1-1.pdf', 'weg.pdf'], ['weg.pdf']]);
    nu += 2 * 60_000;
    const urls = await ondertekenDiversionBijlagen(['o-1-1.pdf'], klok);
    expect(storage.aanroepen).toHaveLength(3);
    expect(urls.get('o-1-1.pdf')).toBe('https://opslag.test/o-1-1.pdf?sig=3');
  });

  it('een schrijfactie vergeet haar pad, de andere blijven onthouden', async () => {
    await ondertekenDiversionBijlagen(['o-1-1.pdf', 'o-1-2.pdf']);
    vergeetDiversionBijlageUrls(['o-1-2.pdf']);
    await ondertekenDiversionBijlagen(['o-1-1.pdf', 'o-1-2.pdf']);
    expect(storage.aanroepen.map((a) => a.paden)).toEqual([['o-1-1.pdf', 'o-1-2.pdf'], ['o-1-2.pdf']]);
  });

  it('een storing bij Storage geeft een lege lijst en onthoudt niets', async () => {
    storage.antwoord = () => { throw new Error('Storage down'); };
    const urls = await ondertekenDiversionBijlagen(['o-1-1.pdf']);
    expect(urls.size).toBe(0);
    storage.antwoord = null;
    await ondertekenDiversionBijlagen(['o-1-1.pdf']);
    expect(storage.aanroepen).toHaveLength(2);
  });

  it('een lege lijst doet geen aanroep', async () => {
    expect((await ondertekenDiversionBijlagen([])).size).toBe(0);
    expect(storage.aanroepen).toEqual([]);
  });

  it('de losse variant loopt door dezelfde cache (ook de oude sleutel <id>.pdf)', async () => {
    expect(await ondertekenDiversionBijlage('o-1', 2)).toBe('https://opslag.test/o-1-2.pdf?sig=1');
    expect(await ondertekenDiversionBijlage('o-1', 2)).toBe('https://opslag.test/o-1-2.pdf?sig=1');
    expect(await ondertekenDiversionBijlage('o-1', 1, true)).toBe('https://opslag.test/o-1.pdf?sig=2');
    expect(storage.aanroepen.map((a) => a.paden)).toEqual([['o-1-2.pdf'], ['o-1.pdf']]);
  });
});
