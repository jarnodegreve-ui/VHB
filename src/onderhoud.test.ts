// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { beslisSchrijfblok, effectiefOnderhoud, isSchrijfblokUitzondering, isSchrijfmethode, ONDERHOUD_FOUT } from '../api/_lib/onderhoudRegels';
import { GEEN_ONDERHOUD, onderhoudSchema, parseOnderhoud, valideer, type Onderhoud } from '../shared/schemas';

const BLOK: Onderhoud = { actief: true, tekst: 'Even geduld.', schrijfblok: true };

describe('onderhoudsmodus: schema', () => {
  it('normaliseert een geldige instelling en vult de defaults', () => {
    expect(valideer(onderhoudSchema, { actief: true })).toEqual({ ok: true, data: { actief: true, tekst: '', schrijfblok: false } });
    expect(valideer(onderhoudSchema, { actief: true, tekst: '  Migratie  ', schrijfblok: true, tot: '2026-09-07T22:00:00+02:00' }))
      .toEqual({ ok: true, data: { actief: true, tekst: 'Migratie', schrijfblok: true, tot: '2026-09-07T22:00:00+02:00' } });
    // '' en null voor `tot` = geen einde.
    expect(valideer(onderhoudSchema, { actief: false, tot: '' })).toEqual({ ok: true, data: { actief: false, tekst: '', schrijfblok: false } });
  });

  it('geeft Nederlandse veldfouten', () => {
    expect(valideer(onderhoudSchema, {})).toEqual({ ok: false, fouten: { actief: 'Kies aan of uit' } });
    expect(valideer(onderhoudSchema, { actief: true, tekst: 'x'.repeat(241) })).toEqual({ ok: false, fouten: { tekst: 'Hooguit 240 tekens' } });
    expect(valideer(onderhoudSchema, { actief: true, tot: 'morgen' })).toEqual({ ok: false, fouten: { tot: 'Ongeldig tijdstip' } });
  });

  it('parseOnderhoud valt bij rommel terug op "geen onderhoud"', () => {
    expect(parseOnderhoud(null)).toBe(GEEN_ONDERHOUD);
    expect(parseOnderhoud([])).toBe(GEEN_ONDERHOUD);
    expect(parseOnderhoud({ actief: true })).toEqual({ actief: true, tekst: '', schrijfblok: false });
  });
});

describe('onderhoudsmodus: schrijfblok', () => {
  it('kent de schrijfmethodes en de uitzonderingspaden', () => {
    expect(['POST', 'put', 'Patch', 'DELETE'].every(isSchrijfmethode)).toBe(true);
    expect(['GET', 'HEAD', 'OPTIONS'].some(isSchrijfmethode)).toBe(false);
    expect(isSchrijfblokUitzondering('/api/auth/session')).toBe(true);
    expect(isSchrijfblokUitzondering('/api/devices/register')).toBe(true);
    expect(isSchrijfblokUitzondering('/api/client-errors')).toBe(true);
    expect(isSchrijfblokUitzondering('/api/csp-report')).toBe(true);
    expect(isSchrijfblokUitzondering('/api/devices/approve')).toBe(false);
    expect(isSchrijfblokUitzondering('/api/client-errors/status')).toBe(false);
    expect(isSchrijfblokUitzondering('/api/me/voorkeuren')).toBe(false);
  });

  it('blokkeert alleen schrijfacties van niet-admins buiten de uitzonderingen', () => {
    const basis = { method: 'POST', path: '/api/leave', onderhoud: BLOK };
    expect(beslisSchrijfblok({ ...basis, role: 'chauffeur' })).toBe(true);
    expect(beslisSchrijfblok({ ...basis, role: 'planner' })).toBe(true);
    expect(beslisSchrijfblok({ ...basis, role: 'admin' })).toBe(false);
    expect(beslisSchrijfblok({ ...basis, role: 'chauffeur', method: 'GET' })).toBe(false);
    expect(beslisSchrijfblok({ ...basis, role: 'chauffeur', path: '/api/auth/session' })).toBe(false);
    expect(beslisSchrijfblok({ ...basis, role: 'chauffeur', onderhoud: { ...BLOK, schrijfblok: false } })).toBe(false);
    expect(beslisSchrijfblok({ ...basis, role: 'chauffeur', onderhoud: { ...BLOK, actief: false } })).toBe(false);
    expect(beslisSchrijfblok({ ...basis, role: null })).toBe(true);
  });

  it('een verlopen `tot` maakt het onderhoud inactief, een toekomstig niet', () => {
    const nu = Date.parse('2026-09-07T21:00:00Z');
    expect(effectiefOnderhoud({ ...BLOK, tot: '2026-09-07T20:00:00Z' }, nu).actief).toBe(false);
    expect(effectiefOnderhoud({ ...BLOK, tot: '2026-09-07T22:00:00Z' }, nu).actief).toBe(true);
    expect(effectiefOnderhoud(BLOK, nu)).toBe(BLOK);
    expect(beslisSchrijfblok({ method: 'POST', path: '/api/leave', role: 'chauffeur', onderhoud: { ...BLOK, tot: '2026-09-07T20:00:00Z' }, nu })).toBe(false);
  });

  it('de 503-body heeft de vaste tekst en code waarop de client reageert', () => {
    expect(ONDERHOUD_FOUT).toEqual({ error: 'Het portaal is even in onderhoud, probeer het zo opnieuw.', code: 'onderhoud' });
  });
});
