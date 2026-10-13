import { describe, expect, it } from 'vitest';
import { cacheVeiligeRitbladen, datumVoorVersie, kaartKop, volgordeVoorScherm, vorigeVoor, type RitbladBundel, type RitbladVersie } from './ritbladen';

const v = (id: string, geldigVanaf: string, status: RitbladVersie['status'], geldigTot: string | null = null, naam: string | null = null): RitbladVersie => ({ id, naam, geldigVanaf, geldigTot, status });
const b = (naam: string): RitbladBundel => ({ filename: naam, storagePath: naam, uploadedAt: '2026-09-01T00:00:00Z', uploadedBy: null, sizeBytes: 1, dienstregelingId: naam, url: `https://x.supabase.co/storage/v1/object/sign/ritblaadjes/${naam}?token=t` });
const sep = v('sep', '2026-09-01', 'verlopen', '2026-11-08', 'September');
const nov = v('nov', '2026-11-09', 'huidig', '2026-12-31');
const jan = v('jan', '2027-01-01', 'toekomstig');
const mrt = v('mrt', '2027-03-01', 'toekomstig');

describe('ritbladen: regels van het scherm', () => {
  it('volgorde: huidig, toekomstig (vroegste eerst), vorige (jongste eerst); zonder versie vooraan', () => {
    const regels = [{ versie: mrt, bundel: null }, { versie: sep, bundel: b('sep') }, { versie: jan, bundel: null }, { versie: nov, bundel: b('nov') }];
    expect(volgordeVoorScherm(regels).map((r) => r.versie?.id)).toEqual(['nov', 'jan', 'mrt', 'sep']);
    expect(volgordeVoorScherm([{ versie: nov, bundel: null }, { versie: null, bundel: b('x') }]).map((r) => r.versie?.id ?? '-')).toEqual(['-', 'nov']);
  });

  it('kaartKop: titel, toelichting en badge per status', () => {
    expect(kaartKop(nov)).toEqual({ titel: 'Huidige ritbladen', toelichting: 'vanaf 09/11/2026', badge: { tekst: 'Nu geldig', toon: 'oker' } });
    expect(kaartKop(jan)).toEqual({ titel: 'Vanaf 01/01/2027', toelichting: null, badge: { tekst: 'Toekomstig', toon: 'blue' } });
    expect(kaartKop(sep)).toEqual({ titel: 'Tot en met 08/11/2026', toelichting: 'September · vanaf 01/09/2026', badge: { tekst: 'Vorige', toon: 'slate' } });
    expect(kaartKop(null)).toEqual({ titel: 'Ritbladen', toelichting: null, badge: null });
  });

  it('datumVoorVersie: vandaag voor de huidige, de eerste dag van een toekomstige, de laatste van een verlopen', () => {
    expect(datumVoorVersie(nov, '2026-11-20')).toBeUndefined();
    expect(datumVoorVersie(null, '2026-11-20')).toBeUndefined();
    expect(datumVoorVersie(jan, '2026-11-20')).toBe('2027-01-01');
    expect(datumVoorVersie(sep, '2026-11-20')).toBe('2026-11-08');
    expect(datumVoorVersie({ ...sep, geldigTot: null }, '2026-11-20')).toBe('2026-11-20');
  });

  it('vorigeVoor: de jongste eerdere versie mét bundel', () => {
    const regels = [{ versie: sep, bundel: b('sep') }, { versie: nov, bundel: b('nov') }, { versie: jan, bundel: null }, { versie: mrt, bundel: null }];
    expect(vorigeVoor(regels, mrt)?.versie?.id).toBe('nov');
    expect(vorigeVoor(regels, jan)?.versie?.id).toBe('nov');
    expect(vorigeVoor([{ versie: nov, bundel: null }, { versie: jan, bundel: null }], jan)).toBeNull();
    expect(vorigeVoor(regels, null)).toBeNull();
  });

  it('cacheVeiligeRitbladen laat de tokens weg, in elke bundel', () => {
    const uit = cacheVeiligeRitbladen({ datum: '2026-11-20', versie: nov, bundel: b('nov'), vorige: { versie: sep, bundel: b('sep') }, bundels: [{ versie: sep, bundel: b('sep') }, { versie: jan, bundel: null }] });
    expect(JSON.stringify(uit)).not.toContain('token=');
    expect(uit.bundel?.url).toBe('https://x.supabase.co/storage/v1/object/sign/ritblaadjes/nov');
    expect(uit.vorige?.bundel.url).toBe('https://x.supabase.co/storage/v1/object/sign/ritblaadjes/sep');
    expect(uit.bundels[1].bundel).toBeNull();
  });
});
