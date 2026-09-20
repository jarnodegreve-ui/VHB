import { isStaf } from '../types';
import type { LeaveRequest, User } from '../types';
import { verlofBalans, type LeaveBalance } from './leaveBalance';

/**
 * De rijen van het saldo-overzicht in Verlof (VerlofSaldoModal): iedereen die
 * verlof opneemt (chauffeurs en techniekers, actief, niet het
 * beheerdersaccount) met zijn balans van het jaar. Uit de modal gehaald zodat
 * het rapport Verlofsaldo (server: api/_lib/rapporten/verlofsaldo.ts) er in
 * een test cijfer voor cijfer mee vergeleken kan worden
 * (src/rapportVerlofsaldo.test.ts). Staf houdt zijn saldo niet in het portaal bij.
 */
export type VerlofSaldoRij = { user: User; balans: LeaveBalance };

export const verlofSaldoRijen = (users: readonly User[], leaveRequests: LeaveRequest[], jaar: number): VerlofSaldoRij[] => users
  .filter((u) => !isStaf(u.role) && u.isActive !== false && u.name.trim().toLowerCase() !== 'beheerder')
  .map((u) => ({ user: u, balans: verlofBalans(leaveRequests, u.id, jaar, u.verlofBudget) }));
