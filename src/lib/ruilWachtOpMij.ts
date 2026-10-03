import type { SwapRequest } from '../types';

/**
 * Ruilen die op de ingelogde chauffeur wachten (paneel "Wacht op jouw antwoord"
 * op het dashboard, getal op de Meer-tab en het nav-item Dienstruil; richting
 * beslist op 22-09, gebouwd op 03-10). Tot dan kreeg de collega alleen een
 * push en stond het verzoek in Dienstruil achter Meer: wie de push miste,
 * zag het pas als hij dat scherm toevallig opende.
 *
 * Deze module zit in de startbundel (App.tsx telt ermee), dus alleen de
 * selectie staat hier; de tekst van de rijen staat in `ruilWachtRegels.ts`,
 * dat alleen het dashboard laadt.
 *
 * Twee soorten vragen om een handeling van hem:
 *  - `antwoord`: een collega stelde hem een ruil of overname voor en de ruil
 *    staat nog op `pending` (aanvaarden of weigeren);
 *  - `bevestiging`: de planning keurde een ruil goed waardoor hij de dienst
 *    rijdt, en hij bevestigde nog niet dat hij dat zag (`targetSeenAt`),
 *    dezelfde regel als de lijst in Dienstruil.
 *
 * Bewust niet: een open overname zonder collega (`targetDriverId` leeg) is aan
 * niemand gericht en hoort niet op ieders dashboard; die blijft in de lijst
 * van Dienstruil. Eigen aanvragen wachten op een ander, niet op hem.
 */
export type RuilWachtSoort = 'antwoord' | 'bevestiging';

export type RuilWachtOpMij = {
  ruil: SwapRequest;
  soort: RuilWachtSoort;
};

export function ruilenDieOpMijWachten(swaps: readonly SwapRequest[], userId: string): RuilWachtOpMij[] {
  const uit: RuilWachtOpMij[] = [];
  for (const ruil of swaps) {
    if (ruil.requesterId === userId || ruil.targetDriverId !== userId) continue;
    if (ruil.status === 'pending') uit.push({ ruil, soort: 'antwoord' });
    else if (ruil.status === 'approved' && !ruil.targetSeenAt) uit.push({ ruil, soort: 'bevestiging' });
  }
  // Wat een antwoord vraagt eerst, daarbinnen de vroegste dienst bovenaan;
  // een ruil zonder dienstdatum (oud record) als laatste.
  return uit.sort((a, b) => {
    if (a.soort !== b.soort) return a.soort === 'antwoord' ? -1 : 1;
    return (a.ruil.shiftDate ?? '9999').localeCompare(b.ruil.shiftDate ?? '9999') || a.ruil.createdAt.localeCompare(b.ruil.createdAt);
  });
}

/** Hoeveel ruilen op hem wachten; voor badges en tellers. */
export const telRuilenDieOpMijWachten = (swaps: readonly SwapRequest[], userId: string): number =>
  ruilenDieOpMijWachten(swaps, userId).length;
