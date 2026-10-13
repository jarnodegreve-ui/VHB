import { apiFetch } from './api';
import type { RitbladVersie } from './ritbladPaginas';

/**
 * Wat GET /api/ritbladen geeft (13-10): alle bundels met hun
 * dienstregelingversie, plus de keuze voor één dag. Alleen de types en de
 * lezer: dit bestand zit via ritbladCache.ts in de warmup van elke rol, de
 * regels van het scherm staan in ritbladen.ts (alleen de Ritbladen-chunk).
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
