// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  BLOKKEERT_STAP_2,
  OUDE_PDF_NAAM,
  planBackfill,
  stap2Veilig,
  telPlan,
  voerBackfillUit,
} from '../../scripts/omleiding-pdf-backfill-kern.mjs';
import { LEGACY_OMLEIDING_PDF_NAAM, omleidingBijlagen } from '../../api/helpers';

/**
 * Kern van scripts/omleiding-pdf-backfill.mjs (controle-ronde 29-09, nr. 30,
 * stap 1): elke omleiding met een PDF van vóór 25-09 verhuist naar de
 * bijlagenlijst, zodat de overgangslaag later weg kan. De opslag is hier een
 * in-memory bucket en tabel met dezelfde twee bewerkingen als api/storage.ts.
 */
type Rij = { id: string; title: string; pdfUrl?: string | null; bijlagen?: Array<{ slot: number; filename: string; sizeBytes?: number }> | null };

const MARKER = 'https://x.supabase.co/storage/v1/object/sign/diversions/oud.pdf?token=t';

const wereld = () => {
  const bucket = new Map<string, number>([
    ['oud.pdf', 1200],
    ['half-1.pdf', 800],
    ['dubbel.pdf', 10],
    ['dubbel-1.pdf', 20],
    ['nieuw-1.pdf', 300],
    ['nieuw-2.pdf', 400],
  ]);
  const tabel: Rij[] = [
    { id: 'oud', title: 'Oude PDF', pdfUrl: MARKER },
    { id: 'half', title: 'Verhuisd zonder lijst', pdfUrl: MARKER },
    { id: 'dubbel', title: 'Beide sleutels', pdfUrl: MARKER },
    { id: 'dood', title: 'Marker zonder bestand', pdfUrl: MARKER },
    { id: 'nieuw', title: 'Al een lijst', bijlagen: [{ slot: 1, filename: 'a.pdf' }, { slot: 2, filename: 'b.pdf' }] },
    { id: 'leeg', title: 'Geen PDF' },
    { id: '../kwaad', title: 'Vreemd id', pdfUrl: MARKER },
  ];
  const bestanden = () => [...bucket].map(([naam, sizeBytes]) => ({ naam, sizeBytes }));
  const verplaats = async (id: string) => {
    if (!bucket.has(`${id}.pdf`)) throw new Error('Object not found');
    bucket.set(`${id}-1.pdf`, bucket.get(`${id}.pdf`)!);
    bucket.delete(`${id}.pdf`);
  };
  // Zoals zetDiversionBijlagen: de lijst schrijven en de marker op null.
  const zetLijst = async (id: string, lijst: NonNullable<Rij['bijlagen']>) => {
    const rij = tabel.find((r) => r.id === id);
    if (!rij) throw new Error('rij niet gevonden');
    rij.bijlagen = lijst.length > 0 ? lijst : null;
    rij.pdfUrl = null;
  };
  return { bucket, tabel, bestanden, verplaats, zetLijst };
};

describe('planBackfill', () => {
  it('kiest per omleiding de juiste actie', () => {
    const w = wereld();
    const plan = planBackfill(w.tabel, w.bestanden());
    expect(plan.map((r) => [r.id, r.actie])).toEqual([
      ['oud', 'verhuizen'],
      ['half', 'lijst-herstellen'],
      ['dubbel', 'conflict'],
      ['dood', 'marker-zonder-bestand'],
      ['nieuw', 'klaar'],
      ['leeg', 'geen-pdf'],
      ['../kwaad', 'ongeldig-id'],
    ]);
    expect(plan[0]).toMatchObject({ titel: 'Oude PDF', sizeBytes: 1200 });
    expect(telPlan(plan)).toEqual({ klaar: 1, 'geen-pdf': 1, verhuizen: 1, 'lijst-herstellen': 1, conflict: 1, 'marker-zonder-bestand': 1, 'ongeldig-id': 1 });
  });

  it('een rij met een lijst is klaar, ook als de marker er nog staat', () => {
    expect(planBackfill([{ id: 'x', title: 'X', pdfUrl: MARKER, bijlagen: [{ slot: 2, filename: 'b.pdf' }] }], [{ naam: 'x.pdf' }])[0].actie).toBe('klaar');
  });

  it('stap 2 is pas veilig als niets meer op de oude sleutel leunt; een dode marker houdt niets tegen', () => {
    const w = wereld();
    expect(stap2Veilig(planBackfill(w.tabel, w.bestanden()))).toBe(false);
    expect(BLOKKEERT_STAP_2).not.toContain('marker-zonder-bestand');
    const schoon = w.tabel.filter((r) => ['dood', 'nieuw', 'leeg'].includes(r.id));
    expect(stap2Veilig(planBackfill(schoon, w.bestanden()))).toBe(true);
  });
});

describe('voerBackfillUit', () => {
  it('verhuist het bestand naar slot 1, schrijft de lijst en wist de marker', async () => {
    const w = wereld();
    const uit = await voerBackfillUit(planBackfill(w.tabel, w.bestanden()), w);
    expect(uit).toEqual({ verhuisd: 1, hersteld: 1, mislukt: [] });

    const oud = w.tabel.find((r) => r.id === 'oud')!;
    expect(oud.pdfUrl).toBeNull();
    expect(oud.bijlagen).toEqual([{ slot: 1, filename: 'omleiding.pdf', sizeBytes: 1200 }]);
    expect(w.bucket.has('oud.pdf')).toBe(false);
    expect(w.bucket.get('oud-1.pdf')).toBe(1200);

    const half = w.tabel.find((r) => r.id === 'half')!;
    expect(half.pdfUrl).toBeNull();
    expect(half.bijlagen).toEqual([{ slot: 1, filename: 'omleiding.pdf', sizeBytes: 800 }]);
  });

  it('blijft af van conflicten, dode markers, vreemde id’s en wat al een lijst heeft', async () => {
    const w = wereld();
    const voor = JSON.stringify(w.tabel.filter((r) => !['oud', 'half'].includes(r.id)));
    await voerBackfillUit(planBackfill(w.tabel, w.bestanden()), w);
    expect(JSON.stringify(w.tabel.filter((r) => !['oud', 'half'].includes(r.id)))).toBe(voor);
    expect(w.bucket.has('dubbel.pdf')).toBe(true);
    expect(w.bucket.get('dubbel-1.pdf')).toBe(20);
    expect(w.bucket.get('nieuw-1.pdf')).toBe(300);
  });

  it('is idempotent: een tweede run doet niets', async () => {
    const w = wereld();
    await voerBackfillUit(planBackfill(w.tabel, w.bestanden()), w);
    const stand = JSON.stringify([w.tabel, [...w.bucket]]);
    const tweede = planBackfill(w.tabel, w.bestanden());
    expect(telPlan(tweede)).toMatchObject({ verhuizen: 0, 'lijst-herstellen': 0, klaar: 3 });
    const aanroepen: string[] = [];
    const uit = await voerBackfillUit(tweede, {
      verplaats: async (id) => { aanroepen.push(`verplaats ${id}`); },
      zetLijst: async (id) => { aanroepen.push(`zetLijst ${id}`); },
    });
    expect(uit).toEqual({ verhuisd: 0, hersteld: 0, mislukt: [] });
    expect(aanroepen).toEqual([]);
    expect(JSON.stringify([w.tabel, [...w.bucket]])).toBe(stand);
  });

  it('een fout bij één omleiding stopt de rest niet, en een run die strandde wordt de volgende keer afgemaakt', async () => {
    const w = wereld();
    let eersteKeer = true;
    const uit = await voerBackfillUit(planBackfill(w.tabel, w.bestanden()), {
      verplaats: w.verplaats,
      zetLijst: async (id, lijst) => {
        if (id === 'oud' && eersteKeer) { eersteKeer = false; throw new Error('time-out'); }
        await w.zetLijst(id, lijst);
      },
    });
    expect(uit).toEqual({ verhuisd: 0, hersteld: 1, mislukt: [{ id: 'oud', fout: 'time-out' }] });
    // Het bestand is verhuisd, de lijst niet geschreven: de marker staat er nog.
    expect(w.bucket.has('oud-1.pdf')).toBe(true);
    expect(w.tabel.find((r) => r.id === 'oud')!.pdfUrl).toBe(MARKER);

    const tweede = planBackfill(w.tabel, w.bestanden());
    expect(tweede.find((r) => r.id === 'oud')!.actie).toBe('lijst-herstellen');
    expect(await voerBackfillUit(tweede, w)).toEqual({ verhuisd: 0, hersteld: 1, mislukt: [] });
    expect(w.tabel.find((r) => r.id === 'oud')!.bijlagen).toEqual([{ slot: 1, filename: 'omleiding.pdf', sizeBytes: 1200 }]);
  });
});

describe('de chauffeur ziet voor en na dezelfde bijlage', () => {
  it('de naam in het script is de naam van de overgangslaag', () => {
    expect(OUDE_PDF_NAAM).toBe(LEGACY_OMLEIDING_PDF_NAAM);
  });

  it('omleidingBijlagen geeft vóór de verhuis slot 1 via de oude sleutel en erna slot 1 uit de lijst', async () => {
    const w = wereld();
    const oud = w.tabel.find((r) => r.id === 'oud')!;
    expect(omleidingBijlagen(oud)).toEqual([{ slot: 1, filename: 'omleiding.pdf', legacy: true }]);
    await voerBackfillUit(planBackfill(w.tabel, w.bestanden()), w);
    expect(omleidingBijlagen(oud)).toEqual([{ slot: 1, filename: 'omleiding.pdf', sizeBytes: 1200 }]);
  });
});
