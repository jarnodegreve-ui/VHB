// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { fingerprintVan, groepeerFouten, normaliseerFoutmelding, topFrameSleutel, type FoutRij, type FoutStatus } from '../api/_lib/foutgroepen';

const rij = (over: Partial<FoutRij>): FoutRij => ({
  id: over.id ?? Math.random(),
  createdAt: '2026-09-06T10:00:00Z',
  message: 'boem',
  source: 'error-toast',
  ...over,
});

describe('fingerprint', () => {
  it('normaliseert getallen, uuid\'s en witruimte weg', () => {
    expect(normaliseerFoutmelding('Dienst 2515 niet gevonden (id 3f2a9c1e-1111-2222-3333-444455556666)  op  06/09'))
      .toBe('Dienst # niet gevonden (id #) op #/#');
  });

  it('is gelijk voor dezelfde fout met andere getallen, en verschilt per bron en top-frame', () => {
    const a = fingerprintVan({ message: 'Kon dienst 2515 niet laden', source: 'error-toast' });
    const b = fingerprintVan({ message: 'Kon dienst 2607 niet laden', source: 'error-toast' });
    expect(a).toBe(b);
    expect(a).toHaveLength(16);
    expect(fingerprintVan({ message: 'Kon dienst 2515 niet laden', source: 'window.onerror' })).not.toBe(a);
    expect(fingerprintVan({ message: 'Kon dienst 2515 niet laden', source: 'error-toast', topFrame: 'src/x.tsx:12' })).not.toBe(a);
  });

  it('laat de functienaam van het top-frame buiten de sleutel', () => {
    expect(topFrameSleutel('src/views/DashboardView.tsx:142 (render)')).toBe('src/views/DashboardView.tsx:142');
    expect(fingerprintVan({ message: 'x', topFrame: 'src/a.tsx:1 (f)' })).toBe(fingerprintVan({ message: 'x', topFrame: 'src/a.tsx:1 (g)' }));
  });
});

describe('groepeerFouten', () => {
  it('groepeert per fingerprint en telt voorvallen, releases en unieke gebruikers', () => {
    const { groepen } = groepeerFouten([
      rij({ id: 1, message: 'Kon dienst 1 niet laden', createdAt: '2026-09-01T10:00:00Z', release: 'aaa1111', userId: '3' }),
      rij({ id: 2, message: 'Kon dienst 2 niet laden', createdAt: '2026-09-02T10:00:00Z', release: 'bbb2222', userId: 'onbevestigd:3' }),
      rij({ id: 3, message: 'Kon dienst 3 niet laden', createdAt: '2026-09-03T10:00:00Z', release: 'bbb2222', userId: '4' }),
      rij({ id: 4, message: 'Iets anders', createdAt: '2026-09-03T11:00:00Z' }),
    ], new Map());
    expect(groepen).toHaveLength(2);
    const g = groepen.find((x) => x.message.startsWith('Kon dienst'))!;
    expect(g.aantal).toBe(3);
    expect(g.eerste).toBe('2026-09-01T10:00:00Z');
    expect(g.laatste).toBe('2026-09-03T10:00:00Z');
    expect(g.releases).toEqual(['bbb2222', 'aaa1111']);
    expect(g.gebruikers).toBe(2);
    expect(g.status).toBe('open');
    expect(g.message).toBe('Kon dienst 3 niet laden');
  });

  it('gebruikt een opgeslagen fingerprint als die er is (rijen mét en zonder blijven consistent)', () => {
    const fp = fingerprintVan({ message: 'boem', source: 'error-toast' });
    const { groepen } = groepeerFouten([rij({ id: 1, fingerprint: fp }), rij({ id: 2 })], new Map());
    expect(groepen).toHaveLength(1);
    expect(groepen[0].fingerprint).toBe(fp);
  });

  it('heropent een opgeloste groep alleen bij een voorval ná het oplossen in een ándere release', () => {
    const fp = fingerprintVan({ message: 'boem', source: 'error-toast' });
    const opgelost: FoutStatus = { fingerprint: fp, status: 'opgelost', release: 'aaa1111', bijgewerktOp: '2026-09-02T00:00:00Z', door: '1' };
    // Zelfde release, later: nog niet uitgerold — blijft opgelost.
    let r = groepeerFouten([rij({ createdAt: '2026-09-03T00:00:00Z', release: 'aaa1111' })], new Map([[fp, opgelost]]));
    expect(r.groepen[0].status).toBe('opgelost');
    expect(r.heropend).toEqual([]);
    // Eerder dan het oplossen, andere release: oud voorval — blijft opgelost.
    r = groepeerFouten([rij({ createdAt: '2026-09-01T00:00:00Z', release: 'zzz9999' })], new Map([[fp, opgelost]]));
    expect(r.groepen[0].status).toBe('opgelost');
    // Later én andere release: regressie → open.
    r = groepeerFouten([rij({ createdAt: '2026-09-03T00:00:00Z', release: 'ccc3333' })], new Map([[fp, opgelost]]));
    expect(r.groepen[0].status).toBe('open');
    expect(r.groepen[0].regressie).toBe(true);
    expect(r.heropend).toEqual([fp]);
  });

  it('sorteert open (regressies eerst) vóór opgelost vóór genegeerd', () => {
    const a = fingerprintVan({ message: 'a', source: 's' });
    const b = fingerprintVan({ message: 'b', source: 's' });
    const statussen = new Map<string, FoutStatus>([
      [a, { fingerprint: a, status: 'genegeerd', release: null, bijgewerktOp: null, door: null }],
      [b, { fingerprint: b, status: 'opgelost', release: 'x', bijgewerktOp: '2026-09-01T00:00:00Z', door: null }],
    ]);
    const { groepen } = groepeerFouten([
      rij({ message: 'a', source: 's', createdAt: '2026-09-05T00:00:00Z' }),
      rij({ message: 'b', source: 's', createdAt: '2026-09-04T00:00:00Z', release: 'y' }),
      rij({ message: 'c', source: 's', createdAt: '2026-09-03T00:00:00Z' }),
    ], statussen);
    expect(groepen.map((g) => g.message)).toEqual(['b', 'c', 'a']);
    expect(groepen[0].regressie).toBe(true);
  });
});
