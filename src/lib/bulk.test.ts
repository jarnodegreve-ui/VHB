import { describe, expect, it, vi } from 'vitest';
import { bulkSamenvatting, bulkUitvoeren, meldBulkResultaat } from './bulk';

describe('bulkUitvoeren', () => {
  it('voert sequentieel uit en bewaart per item de fout', async () => {
    const volgorde: number[] = [];
    let bezig = 0;
    let maxBezig = 0;
    const r = await bulkUitvoeren([1, 2, 3, 4], async (n) => {
      bezig += 1; maxBezig = Math.max(maxBezig, bezig);
      await new Promise((res) => setTimeout(res, 2));
      volgorde.push(n);
      bezig -= 1;
      if (n === 2) throw new Error('Al behandeld.');
      if (n === 3) return false;
    });
    expect(volgorde).toEqual([1, 2, 3, 4]);
    expect(maxBezig).toBe(1);
    expect(r.gelukt).toEqual([1, 4]);
    expect(r.mislukt).toEqual([
      { item: 2, fout: 'Al behandeld.' },
      { item: 3, fout: 'Mislukt.' },
    ]);
    expect(r.totaal).toBe(4);
  });

  it('neemt een eigen fouttekst over uit { fout } en de standaardFout uit de opties', async () => {
    const r = await bulkUitvoeren(['a', 'b', 'c'], (s) => {
      if (s === 'a') return { fout: 'Server zei nee.' };
      if (s === 'b') throw 'netwerk';
      if (s === 'c') throw new Error('');
    }, { standaardFout: 'Niet opgeslagen.' });
    expect(r.gelukt).toEqual([]);
    expect(r.mislukt.map((m) => m.fout)).toEqual(['Server zei nee.', 'netwerk', 'Niet opgeslagen.']);
  });

  it('kan parallel als dat expliciet gevraagd wordt', async () => {
    let bezig = 0;
    let maxBezig = 0;
    const r = await bulkUitvoeren([1, 2, 3], async () => {
      bezig += 1; maxBezig = Math.max(maxBezig, bezig);
      await new Promise((res) => setTimeout(res, 3));
      bezig -= 1;
    }, { parallel: true });
    expect(maxBezig).toBe(3);
    expect(r.gelukt).toEqual([1, 2, 3]);
  });

  it('geeft bij een lege lijst een leeg resultaat en meldt dan niets', async () => {
    const r = await bulkUitvoeren([], () => undefined);
    expect(r).toEqual({ gelukt: [], mislukt: [], totaal: 0 });
    const notify = vi.fn();
    meldBulkResultaat(notify, r, { item: ['aanvraag', 'aanvragen'], gedaan: 'goedgekeurd' });
    expect(notify).not.toHaveBeenCalled();
  });
});

describe('bulkSamenvatting / meldBulkResultaat', () => {
  it('alles gelukt: telling met enkel- of meervoud, toon success', () => {
    expect(bulkSamenvatting({ gelukt: [1], mislukt: [], totaal: 1 }, { item: ['aanvraag', 'aanvragen'], gedaan: 'goedgekeurd' }))
      .toEqual({ tekst: '1 aanvraag goedgekeurd.', toon: 'success' });
    expect(bulkSamenvatting({ gelukt: [1, 2], mislukt: [], totaal: 2 }, { item: ['aanvraag', 'aanvragen'], gedaan: 'geweigerd' }))
      .toEqual({ tekst: '2 aanvragen geweigerd.', toon: 'success' });
  });

  it('alles gelukt met eigen tekst', () => {
    expect(bulkSamenvatting({ gelukt: ['x'], mislukt: [], totaal: 1 }, { item: ['datum', 'datums'], gedaan: 'opgeslagen', allesGelukt: 'Vervaldata opgeslagen.' }))
      .toEqual({ tekst: 'Vervaldata opgeslagen.', toon: 'success' });
  });

  it('deels mislukt: "x van y", standaardstaart en toon error', () => {
    const notify = vi.fn();
    meldBulkResultaat(notify, { gelukt: [1, 2], mislukt: [{ item: 3, fout: 'Bezet.' }], totaal: 3 }, { item: ['dienst', 'diensten'], gedaan: 'herverdeeld' });
    expect(notify).toHaveBeenCalledWith('2 van 3 diensten herverdeeld, 1 mislukt.', 'error');
  });

  it('deels mislukt met eigen staart en toon', () => {
    const notify = vi.fn();
    meldBulkResultaat(
      notify,
      { gelukt: [1], mislukt: [{ item: 2, fout: 'Conflict' }, { item: 3, fout: 'Conflict' }], totaal: 3 },
      { item: ['aanvraag', 'aanvragen'], gedaan: 'goedgekeurd', rest: () => ', de rest was intussen al behandeld', misluktToon: 'info' },
    );
    expect(notify).toHaveBeenCalledWith('1 van 3 aanvragen goedgekeurd, de rest was intussen al behandeld.', 'info');
  });

  it('alles mislukt: de fouten staan ter beschikking voor de staart', () => {
    const s = bulkSamenvatting(
      { gelukt: [], mislukt: [{ item: 'rijbewijs', fout: '500' }, { item: 'medisch', fout: '500' }], totaal: 2 },
      { item: ['vervaldatum', 'vervaldata'], gedaan: 'opgeslagen', rest: (f) => `, niet gelukt: ${f.map((x) => x.item).join(' en ')}` },
    );
    expect(s).toEqual({ tekst: '0 van 2 vervaldata opgeslagen, niet gelukt: rijbewijs en medisch.', toon: 'error' });
  });
});
