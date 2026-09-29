import { apiFetch } from './api';

/**
 * De gedeelde fetch-wrapper van de zelf-ladende modules (techniek, loon,
 * dienstopbouw). Vroeger stond hij drie keer, en de kopieën liepen al uit
 * elkaar: alleen loon en techniek vingen een 204 af.
 *
 * Bewust niet `apiJson` uit api.ts: die leest de servermelding als
 * `error || details` en sluit af met "Probeer het opnieuw."; deze modules
 * tonen `details || error` en "Er ging iets mis (code N).". De tekst die de
 * gebruiker ziet blijft dus wat ze was.
 *
 * Elke module kiest zelf welke fout ze gooit (`maakFout`), zodat
 * `instanceof LoonFout` en `instanceof TechniekFout` in de schermen blijven
 * werken.
 */

/** Serverfout met status, eventuele veldfouten (400 uit valideerRecord, 409)
 *  en het ruwe antwoord. Basis van LoonFout en TechniekFout. */
export class ApiFout extends Error {
  status: number;
  veldfouten: Record<string, string> | null;
  data: unknown;
  constructor(message: string, status: number, veldfouten: Record<string, string> | null, data: unknown = null) {
    super(message);
    this.status = status;
    this.veldfouten = veldfouten;
    this.data = data;
  }
}

export type Vraag = <T>(url: string, init?: RequestInit) => Promise<T>;

/** apiFetch + JSON. Niet-ok: gooit wat `maakFout` van melding, status en
 *  antwoord maakt. 204: undefined. */
export const maakVraag = (maakFout: (melding: string, status: number, data: unknown) => Error): Vraag =>
  async <T>(url: string, init?: RequestInit): Promise<T> => {
    const res = await apiFetch(url, init);
    if (!res.ok) {
      let data: unknown = null;
      try { data = await res.json(); } catch { /* geen json */ }
      const d = data as { error?: string; details?: string } | null;
      throw maakFout(d?.details || d?.error || `Er ging iets mis (code ${res.status}).`, res.status, data);
    }
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  };

export const json = (method: string, body: unknown): RequestInit => ({ method, body: JSON.stringify(body) });
