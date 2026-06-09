import type { Role, User, LeaveRequest, SwapRequest } from '../types';

/**
 * Role-based authorization helpers — centrale plek voor wie wat mag doen.
 * Worden gebruikt door de UI om knoppen te tonen/verbergen. De API enforced
 * dezelfde regels via `requireRole(...)` in `api/middleware.ts` — de
 * predicates hier zijn dus puur voor de UX, niet voor security.
 *
 * Houd deze synchroon met de server-side checks.
 */

const isRole = (user: Pick<User, 'role'> | null | undefined, ...roles: Role[]): boolean =>
  !!user && roles.includes(user.role);

export const isChauffeur = (user: Pick<User, 'role'> | null | undefined) => isRole(user, 'chauffeur');
export const isPlanner = (user: Pick<User, 'role'> | null | undefined) => isRole(user, 'planner');
export const isAdmin = (user: Pick<User, 'role'> | null | undefined) => isRole(user, 'admin');
export const isPlannerOrAdmin = (user: Pick<User, 'role'> | null | undefined) =>
  isRole(user, 'planner', 'admin');

/** Mag de gebruiker verlof goedkeuren/weigeren? */
export const canApproveLeave = (user: Pick<User, 'role'> | null | undefined) =>
  isPlannerOrAdmin(user);

/**
 * Mag de gebruiker een verlofaanvraag annuleren?
 * Belangrijk: chauffeurs mogen NIET zelf hun pending aanvraag annuleren —
 * dit moet altijd door een planner/admin gebeuren zodat de rij- en rusttijden
 * gecontroleerd worden.
 */
export const canCancelLeave = (
  user: Pick<User, 'role'> | null | undefined,
  _leave: Pick<LeaveRequest, 'userId' | 'status'>,
) => isPlannerOrAdmin(user);

/**
 * Mag de gebruiker zijn EIGEN nog-niet-besliste (pending) verlofaanvraag
 * intrekken? Dit mag wél — een 'pending' aanvraag is nog nooit goedgekeurd,
 * dus er is geen planning- of rij-/rusttijden-impact. Een vergissing snel
 * zelf rechtzetten kan dus. Goedgekeurd verlof annuleren blijft via
 * `canCancelLeave` (planner/admin), zodat dáár de validatie behouden blijft.
 */
export const canWithdrawOwnLeave = (
  user: Pick<User, 'id' | 'role'> | null | undefined,
  leave: Pick<LeaveRequest, 'userId' | 'status'>,
) => {
  if (!user) return false;
  if (leave.status !== 'pending') return false;
  return String(leave.userId) === String(user.id) || isPlannerOrAdmin(user);
};

/** Mag de gebruiker zelf een verlofaanvraag indienen voor een chauffeur? */
export const canSubmitLeaveFor = (
  actor: Pick<User, 'id' | 'role'> | null | undefined,
  targetUserId: string,
) => {
  if (!actor) return false;
  if (isPlannerOrAdmin(actor)) return true;
  // Chauffeurs mogen alleen voor zichzelf indienen
  return actor.role === 'chauffeur' && actor.id === targetUserId;
};

/** Mag de gebruiker gebruikersbeheer/admin doen? */
export const canManageUsers = (user: Pick<User, 'role'> | null | undefined) => isAdmin(user);

/** Mag de gebruiker planning (roosters, codes, services) beheren? */
export const canManagePlanning = (user: Pick<User, 'role'> | null | undefined) =>
  isPlannerOrAdmin(user);

/** Mag de gebruiker omleidingen beheren? */
export const canManageDiversions = (user: Pick<User, 'role'> | null | undefined) =>
  isPlannerOrAdmin(user);

/** Mag de gebruiker updates posten? */
export const canPostUpdates = (user: Pick<User, 'role'> | null | undefined) =>
  isPlannerOrAdmin(user);

/** Mag de gebruiker de activiteit-log inzien? */
export const canViewActivityLog = (user: Pick<User, 'role'> | null | undefined) => isAdmin(user);

/** Mag de gebruiker een dienstruil valideren (definitief goedkeuren/weigeren)? */
export const canDecideSwap = (user: Pick<User, 'role'> | null | undefined) =>
  isPlannerOrAdmin(user);

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
