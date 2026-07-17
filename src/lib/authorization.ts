import type { User, SwapRequest } from '../types';

/**
 * Authorization-helper voor de UI (knoppen tonen/verbergen). De API enforced
 * dezelfde regels via `requireRole(...)` in `api/middleware.ts` — dit predicate
 * is dus puur voor de UX, niet voor security.
 *
 * De bredere set rol-predicates die hier ooit stond (canApproveLeave,
 * canManageUsers, …) is in de controle-ronde van juli 2026 verwijderd: de
 * views checken rollen inline en de API is de echte poortwachter.
 */

/**
 * Mag deze gebruiker een aan hem/haar gerichte dienstruil accepteren of
 * weigeren? Enkel de aangeduide collega, op een nog openstaande (pending)
 * ruil die niet van henzelf is. Na accepteren gaat 'ie naar 'accepted' en
 * wacht op validatie door planner/admin (rij-/rusttijden).
 */
export const canRespondToSwap = (
  user: Pick<User, 'id' | 'role'> | null | undefined,
  swap: Pick<SwapRequest, 'status' | 'requesterId' | 'targetDriverId'>,
): boolean =>
  !!user &&
  swap.status === 'pending' &&
  swap.requesterId !== user.id &&
  swap.targetDriverId === user.id;
