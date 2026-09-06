import { notify } from './ui';

/**
 * "Live bijgewerkt"-signaal: wanneer een realtime-event (src/lib/realtime.ts)
 * een refetch triggert, één stille info-toast per collectie — "Planning
 * bijgewerkt", "Verlof bijgewerkt" — zodat je ziet dat het scherm net
 * veranderde door een collega. Twee vangrails:
 *  - hooguit één toast per 10 s per collectie (een bulk-goedkeuring van tien
 *    aanvragen is één signaal, geen salvo);
 *  - geen toast vlak na een eigen schrijfactie (apiFetch markeert die): je
 *    eigen opslag komt óók als realtime-event terug, en "Planning bijgewerkt"
 *    na je eigen klik op Opslaan is ruis.
 * Bewust een los module'tje: realtime.ts blijft ongemoeid, App.tsx roept
 * `meldLive` aan in de refetchers.
 */
export type LiveCollectie = 'planning' | 'verlof' | 'ruil' | 'omleidingen' | 'updates';

const LABEL: Record<LiveCollectie, string> = {
  planning: 'Planning bijgewerkt',
  verlof: 'Verlof bijgewerkt',
  ruil: 'Dienstruil bijgewerkt',
  omleidingen: 'Omleidingen bijgewerkt',
  updates: 'Updates bijgewerkt',
};

export const LIVE_THROTTLE_MS = 10_000;
/** Realtime-echo van een eigen schrijfactie komt binnen ±1–2 s; ruim venster. */
export const EIGEN_ACTIE_VENSTER_MS = 4000;

let laatstePerCollectie: Partial<Record<LiveCollectie, number>> = {};
let laatsteEigenActie = Number.NEGATIVE_INFINITY;

/** Door apiFetch aangeroepen na elke geslaagde niet-GET-call. */
export function markeerEigenSchrijfactie(nu = Date.now()) {
  laatsteEigenActie = nu;
}

/** Geeft terug of er een toast is getoond. */
export function meldLive(collectie: LiveCollectie, nu = Date.now()): boolean {
  if (nu - laatsteEigenActie < EIGEN_ACTIE_VENSTER_MS) return false;
  const vorige = laatstePerCollectie[collectie];
  if (vorige !== undefined && nu - vorige < LIVE_THROTTLE_MS) return false;
  laatstePerCollectie[collectie] = nu;
  notify(LABEL[collectie], 'info');
  return true;
}

/** Alleen voor tests. */
export function resetLiveSignaal() {
  laatstePerCollectie = {};
  laatsteEigenActie = Number.NEGATIVE_INFINITY;
}
