import { apiFetch } from './api';
import { formatDatumDMJ } from './format';
import type { RitbladVersie } from './ritbladPaginas';

/**
 * Ritbladen per dienstregelingversie (13-10, keuzes Jarno): wat
 * GET /api/ritbladen geeft en de zuivere regels van het scherm Ritbladen.
 * Geen zod: dit zit in de warmup van elke rol.
 */
export type { RitbladVersie };
export type RitbladBundel = { filename: string; storagePath: string; uploadedAt: string; uploadedBy: string | null; sizeBytes: number | null; dienstregelingId: string | null; url?: string };
export type RitbladRegel = { versie: RitbladVersie | null; bundel: RitbladBundel | null };
export type Ritbladen = {
  datum: string;
  versie: RitbladVersie | null;
  bundel: RitbladBundel | null;
  vorige: { versie: RitbladVersie; bundel: RitbladBundel } | null;
  bundels: RitbladRegel[];
};

export const ritbladenPad = (datum?: string | null): string => (datum ? `/api/ritbladen?datum=${encodeURIComponent(datum)}` : '/api/ritbladen');

/** Alle bundels met hun versie, altijd vers (de links verlopen). */
export async function haalRitbladen(datum?: string | null): Promise<Ritbladen> {
  const res = await apiFetch(ritbladenPad(datum), { cache: 'no-store' });
  if (!res.ok) throw Object.assign(new Error(`Server antwoordde ${res.status}`), { status: res.status });
  return (await res.json()) as Ritbladen;
}

const RANG: Record<RitbladVersie['status'], number> = { huidig: 0, toekomstig: 1, verlopen: 2 };

/** Volgorde voor het scherm: de huidige eerst, dan de toekomstige (vroegste
 *  eerst), dan de vorige (jongste eerst); een regel zonder versie vooraan. */
export function volgordeVoorScherm(regels: readonly RitbladRegel[]): RitbladRegel[] {
  return [...regels].sort((a, b) => {
    if (!a.versie || !b.versie) return (a.versie ? 1 : 0) - (b.versie ? 1 : 0);
    const r = RANG[a.versie.status] - RANG[b.versie.status];
    if (r !== 0) return r;
    const d = a.versie.geldigVanaf.localeCompare(b.versie.geldigVanaf);
    return a.versie.status === 'verlopen' ? -d : d;
  });
}

export type KaartKop = { titel: string; toelichting: string | null; badge: { tekst: string; toon: 'oker' | 'blue' | 'slate' } | null };

/** Kop van de kaart van een versie: wat ze is en wanneer ze geldt. */
export function kaartKop(versie: RitbladVersie | null): KaartKop {
  if (!versie) return { titel: 'Ritbladen', toelichting: null, badge: null };
  const naam = (versie.naam ?? '').trim();
  const vanaf = `vanaf ${formatDatumDMJ(versie.geldigVanaf)}`;
  switch (versie.status) {
    case 'huidig':
      return { titel: 'Huidige ritbladen', toelichting: naam ? `${naam} · ${vanaf}` : vanaf, badge: { tekst: 'Nu geldig', toon: 'oker' } };
    case 'toekomstig':
      return { titel: `Vanaf ${formatDatumDMJ(versie.geldigVanaf)}`, toelichting: naam || null, badge: { tekst: 'Toekomstig', toon: 'blue' } };
    default:
      return { titel: `Tot en met ${formatDatumDMJ(versie.geldigTot ?? versie.geldigVanaf)}`, toelichting: naam ? `${naam} · ${vanaf}` : vanaf, badge: { tekst: 'Vorige', toon: 'slate' } };
  }
}

/** De dag waarmee de viewer de bundel van deze versie opent: vandaag voor de
 *  huidige (en zonder versie), de eerste dag van een toekomstige, de laatste
 *  dag van een verlopen. */
export function datumVoorVersie(versie: RitbladVersie | null, vandaag: string): string | undefined {
  if (!versie || versie.status === 'huidig') return undefined;
  if (versie.status === 'toekomstig') return versie.geldigVanaf;
  return versie.geldigTot ?? vandaag;
}

/** Voor een versie zonder bundel: de jongste eerdere versie die er wél een heeft. */
export function vorigeVoor(regels: readonly RitbladRegel[], versie: RitbladVersie | null): RitbladRegel | null {
  if (!versie) return null;
  return regels
    .filter((r): r is RitbladRegel & { versie: RitbladVersie; bundel: RitbladBundel } => !!r.versie && !!r.bundel && r.versie.geldigVanaf < versie.geldigVanaf)
    .sort((a, b) => b.versie.geldigVanaf.localeCompare(a.versie.geldigVanaf))[0] ?? null;
}

const zonderToken = (url: string | undefined): string | undefined => {
  if (!url) return undefined;
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname}`;
  } catch {
    return undefined;
  }
};
const bundelZonderToken = (b: RitbladBundel | null): RitbladBundel | null => (b ? { ...b, url: zonderToken(b.url) } : null);

/** De lijst voor de offline-kopie in localStorage: de signed URL's zonder
 *  token (ze verlenen toegang buiten de login om), alleen het query-loze pad,
 *  precies de sleutel waaronder de service worker de PDF bewaart. */
export function cacheVeiligeRitbladen(lijst: Ritbladen): Ritbladen {
  return {
    ...lijst,
    bundel: bundelZonderToken(lijst.bundel),
    vorige: lijst.vorige ? { versie: lijst.vorige.versie, bundel: bundelZonderToken(lijst.vorige.bundel)! } : null,
    bundels: lijst.bundels.map((r) => ({ versie: r.versie, bundel: bundelZonderToken(r.bundel) })),
  };
}
