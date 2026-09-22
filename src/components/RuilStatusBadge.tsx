import { ruilStatusMap } from '../../shared/ruilUitkomst';
import type { RuilVoorVerloop } from '../../shared/ruilVerloop';
import { StatusBadge } from './primitives';

/**
 * Status van een dienstruil als badge. Zoals StatusBadge, met één verschil
 * (Jarno 22-09): een afgewezen ruil heet "Geweigerd" als de collega hem
 * weigerde (uit het verloop, de rol van de actor), en "Afgewezen" als de
 * planner besliste of het log niet zegt wie het was.
 */
export function RuilStatusBadge({ swap, className, stil }: {
  swap: Pick<RuilVoorVerloop, 'status' | 'verloop'>;
  className?: string;
  stil?: boolean;
}) {
  return <StatusBadge status={swap.status} map={ruilStatusMap(swap)} stil={stil} className={className} />;
}
