// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

vi.mock('../api/db.js', () => ({ db: null, supabase: null, supabaseAdmin: null }));
const { paginatedFetch } = await import('../api/storage.js');

type Oproep = { from: number; to: number; telling: boolean };

/** Nagebootste tabel; `metTelling=false` = een bouwer die het derde argument negeert. */
const tabel = (n: number, o: { metTelling?: boolean; vertraag?: boolean } = {}) => {
  const rijen = Array.from({ length: n }, (_, i) => i);
  const oproepen: Oproep[] = [];
  let lopend = 0;
  let maxLopend = 0;
  const bouw = async (from: number, to: number, telling?: { count: 'exact' }) => {
    oproepen.push({ from, to, telling: !!telling });
    lopend++; maxLopend = Math.max(maxLopend, lopend);
    // Latere pagina's eerst klaar: de volgorde van het resultaat mag daar niet van afhangen.
    if (o.vertraag) await new Promise((r) => setTimeout(r, Math.max(1, 12 - from / 500)));
    lopend--;
    return { data: rijen.slice(from, to + 1), error: null, count: telling && o.metTelling !== false ? rijen.length : null };
  };
  return { rijen, oproepen, bouw, maxLopend: () => maxLopend };
};

describe('paginatedFetch', () => {
  it('één pagina: één aanroep, klaar', async () => {
    const t = tabel(420);
    expect(await paginatedFetch(t.bouw)).toEqual(t.rijen);
    expect(t.oproepen).toHaveLength(1);
  });

  it('met telling: vervolgpagina\'s gelijktijdig, resultaat in dezelfde volgorde', async () => {
    const t = tabel(3456, { vertraag: true });
    expect(await paginatedFetch(t.bouw)).toEqual(t.rijen);
    expect(t.oproepen.map((o) => o.from)).toEqual([0, 1000, 2000, 3000]);
    expect(t.oproepen.map((o) => o.telling)).toEqual([true, false, false, false]);
    expect(t.maxLopend()).toBe(3);
  });

  it('exact een veelvoud van de paginagrootte: geen overbodige lege pagina', async () => {
    const t = tabel(2000);
    expect(await paginatedFetch(t.bouw)).toHaveLength(2000);
    expect(t.oproepen).toHaveLength(2);
  });

  it('begrenst het aantal gelijktijdige pagina\'s', async () => {
    const t = tabel(12_500, { vertraag: true });
    expect(await paginatedFetch(t.bouw)).toEqual(t.rijen);
    expect(t.maxLopend()).toBeLessThanOrEqual(6);
  });

  it('zonder telling (bouwer negeert het argument): serieel zoals vroeger', async () => {
    const t = tabel(2500, { metTelling: false, vertraag: true });
    expect(await paginatedFetch(t.bouw)).toEqual(t.rijen);
    expect(t.oproepen.map((o) => o.from)).toEqual([0, 1000, 2000]);
    expect(t.maxLopend()).toBe(1);
  });

  it('valt terug op de seriële lus wanneer het totaal niet klopt met de telling', async () => {
    // De tabel groeit tussen de eerste pagina en de rest: telling 2500, daarna 3200 rijen.
    let rijen = Array.from({ length: 2500 }, (_, i) => i);
    const froms: number[] = [];
    const bouw = async (from: number, to: number, telling?: { count: 'exact' }) => {
      froms.push(from);
      const antwoord = { data: rijen.slice(from, to + 1), error: null, count: telling ? rijen.length : null };
      if (telling) rijen = Array.from({ length: 3200 }, (_, i) => i);
      return antwoord;
    };
    const uit = await paginatedFetch(bouw);
    expect(uit).toHaveLength(3200);
    expect(uit).toEqual(rijen);
    // parallel (0,1000,2000) → mismatch → serieel opnieuw vanaf 0.
    expect(froms).toEqual([0, 1000, 2000, 0, 1000, 2000, 3000]);
  });

  it('gooit een fout van een vervolgpagina door', async () => {
    const bouw = async (from: number, to: number, telling?: { count: 'exact' }) =>
      from === 1000
        ? { data: null, error: new Error('pagina stuk'), count: null }
        : { data: Array.from({ length: Math.min(1000, 2400 - from) }, (_, i) => from + i), error: null, count: telling ? 2400 : null };
    await expect(paginatedFetch(bouw)).rejects.toThrow('pagina stuk');
  });

  it('max blijft serieel en kapt af', async () => {
    const t = tabel(5000);
    expect(await paginatedFetch(t.bouw, 1500)).toHaveLength(1500);
    expect(t.oproepen.map((o) => o.from)).toEqual([0, 1000]);
  });
});
