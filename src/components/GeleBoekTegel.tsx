import { useEffect, useState } from 'react';
import { Wrench } from 'lucide-react';
import { OpsStat } from './ops';
import { TOON_NAAR_BADGE } from './primitives';
import { laadOpenDefectenAantal } from '../lib/techniek';
import { DEFECT_STATUS } from '../../shared/status';

/**
 * Dashboardtegel voor de technieker: aantal open meldingen in het gele boek.
 * Eigen chunk (lazy vanuit DashboardView) zodat chauffeurs deze code nooit
 * laden; haalt zelf zijn teller op.
 */
export function GeleBoekTegel({ className, onClick }: { className?: string; onClick?: () => void }) {
  const [open, setOpen] = useState<number | null>(null);
  useEffect(() => {
    let actief = true;
    void laadOpenDefectenAantal().then((r) => { if (actief) setOpen(r.open); }).catch(() => { if (actief) setOpen(0); });
    return () => { actief = false; };
  }, []);
  return (
    <OpsStat
      icon={<Wrench size={16} />}
      tone={open ? TOON_NAAR_BADGE[DEFECT_STATUS.open.toon] : 'slate'}
      className={className}
      label="Gele boek"
      value={open ?? 0}
      sub={open === null ? 'laden…' : open === 1 ? 'open melding' : 'open meldingen'}
      onClick={onClick}
    />
  );
}
