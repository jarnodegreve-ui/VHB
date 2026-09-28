import type { SwapRequest } from '../types';

/**
 * Volgorde van de dienstruilen op het scherm Dienstruil (Jarno 28-09): wat nog
 * actie vraagt staat bovenaan. Voordien volgden de lijsten de database, die op
 * id sorteert, dus in de praktijk willekeurig.
 *
 *   0  jij bent aan zet: een ruil aan jou die op je antwoord wacht, of een
 *      doorgevoerde wissel die jij nog moet bevestigen
 *   1  collega akkoord, de planner keurt goed (`accepted`)
 *   2  wacht nog op de collega (`pending`)
 *   3  goedgekeurd, alleen nog af te handelen (`approved`)
 *   4  afgerond: afgehandeld, afgewezen of ingetrokken
 *
 * Binnen een open groep (0 tot 3) komt de vroegste dienst eerst, want die
 * vraagt het eerst een beslissing, en op dezelfde dag de oudste aanvraag.
 * Afgeronde ruilen staan omgekeerd, de laatste eerst, zoals Afgehandeld en de
 * verlofgeschiedenis. Een ruil zonder dienstdatum sluit zijn groep af.
 * Zonder `kijkerId` (de beheerlijst) is er geen groep 0: daar telt alleen de
 * stand van de ruil.
 */
export type RuilVoorVolgorde = Pick<SwapRequest, 'id' | 'status' | 'createdAt' | 'targetDriverId' | 'targetSeenAt'>;

const AFGEROND = 4;

export function ruilGroep(ruil: RuilVoorVolgorde, kijkerId?: string): number {
  const aanJou = !!kijkerId && String(ruil.targetDriverId ?? '') === String(kijkerId);
  if (aanJou && (ruil.status === 'pending' || (ruil.status === 'approved' && !ruil.targetSeenAt))) return 0;
  if (ruil.status === 'accepted') return 1;
  if (ruil.status === 'pending') return 2;
  if (ruil.status === 'approved') return 3;
  return AFGEROND;
}

/** Een nieuwe, gesorteerde lijst; `dienstDatum` wordt één keer per ruil gevraagd. */
export function sorteerRuilen<T extends RuilVoorVolgorde>(
  ruilen: readonly T[],
  { dienstDatum, kijkerId }: { dienstDatum: (ruil: T) => string | undefined; kijkerId?: string },
): T[] {
  return ruilen
    .map((ruil) => ({ ruil, groep: ruilGroep(ruil, kijkerId), datum: dienstDatum(ruil) ?? '' }))
    .sort((a, b) => {
      if (a.groep !== b.groep) return a.groep - b.groep;
      if (!a.datum !== !b.datum) return a.datum ? -1 : 1;
      const richting = a.groep === AFGEROND ? -1 : 1;
      return richting * (a.datum.localeCompare(b.datum) || String(a.ruil.createdAt ?? '').localeCompare(String(b.ruil.createdAt ?? '')))
        || String(a.ruil.id).localeCompare(String(b.ruil.id));
    })
    .map(({ ruil }) => ruil);
}
