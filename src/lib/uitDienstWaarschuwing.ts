import type { Shift, SwapRequest } from '../types';
import { aantal, formatDatumDMJ } from './format';

/**
 * Wie uit dienst gaat of gepauzeerd wordt, houdt zijn toekomstige diensten
 * op naam: het portaal verplaatst niets, want er is niemand om ze aan te
 * geven. Gebruikers waarschuwt daarom vóór de handeling (nr. 48, 05-11: een
 * ruil naar een chauffeur die daarna uit dienst ging, bleef onzichtbaar).
 * Geteld in de client uit de planningrijen en ruilen die de staf al heeft.
 */
export type ToekomstOpNaam = {
  /** Diensten vanaf vandaag op naam (een gesplitste dienst telt één keer). */
  diensten: number;
  /** De dag van de eerste daarvan (ISO), of null. */
  eerste: string | null;
  /** Open ruilverzoeken (pending, accepted) waarin deze persoon partij is. */
  openRuilen: number;
};

export function toekomstOpNaam(
  shifts: ReadonlyArray<Pick<Shift, 'date' | 'line' | 'driverId'>>,
  swaps: ReadonlyArray<Pick<SwapRequest, 'requesterId' | 'targetDriverId' | 'status'>>,
  userId: string,
  vandaag: string,
): ToekomstOpNaam {
  const id = String(userId);
  const perDienst = new Set<string>();
  let eerste = null as string | null;
  for (const s of shifts) {
    if (String(s.driverId) !== id || s.date < vandaag) continue;
    perDienst.add(`${s.date}|${String(s.line ?? '').trim().toLowerCase()}`);
    if (!eerste || s.date < eerste) eerste = s.date;
  }
  const openRuilen = swaps.filter((sw) =>
    (sw.status === 'pending' || sw.status === 'accepted')
    && (String(sw.requesterId) === id || String(sw.targetDriverId ?? '') === id)).length;
  return { diensten: perDienst.size, eerste, openRuilen };
}

/** De waarschuwing als zin zonder onderwerp ("staat nog op …"), of null als er niets op naam staat. */
export function uitDienstWaarschuwing(t: ToekomstOpNaam): string | null {
  if (t.diensten === 0 && t.openRuilen === 0) return null;
  const delen: string[] = [];
  if (t.diensten > 0) delen.push(`op ${aantal(t.diensten, 'dienst', 'diensten')} vanaf vandaag${t.eerste ? ` (eerste ${formatDatumDMJ(t.eerste)})` : ''}`);
  if (t.openRuilen > 0) delen.push(`in ${aantal(t.openRuilen, 'open ruilverzoek', 'open ruilverzoeken')}`);
  const vervolg = t.diensten > 0
    ? ' De diensten blijven op naam staan en verschijnen in Openstaande diensten.'
    : ' Die blijven open tot iemand ze afwijst.';
  return `staat nog ${delen.join(' en ')}.${vervolg}`;
}
