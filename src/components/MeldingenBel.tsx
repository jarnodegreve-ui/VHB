import { Bell } from 'lucide-react';
import { useAppDataContext } from '../app/AppDataContext';
import { cn } from '../lib/ui';
import type { View } from '../types';
import { IconButton } from './primitives';

/**
 * Bel in de topbar (meldingencentrum, 06-09): opent /meldingen en draagt de
 * ongelezen-teller als stille goud-badge — geen rood, geen puls. Bij staf
 * staat de werkvoorraad-knop ernaast met zijn eigen teller (open taken);
 * deze bel telt alleen wat er voor jóu binnenkwam. Leest de teller uit de
 * datalaag (useMeldingenData), die door Realtime mee-ververst.
 */
export function MeldingenBel({ onNavigate, actief = false }: { onNavigate: (view: View) => void; actief?: boolean }) {
  const { ongelezenMeldingen } = useAppDataContext();
  const teller = ongelezenMeldingen > 9 ? '9+' : String(ongelezenMeldingen);
  return (
    <IconButton
      label={ongelezenMeldingen > 0 ? `Meldingen (${ongelezenMeldingen} ongelezen)` : 'Meldingen'}
      title="Meldingen"
      variant="ghost"
      size="sm"
      aria-current={actief ? 'page' : undefined}
      className={cn('relative', actief && 'bg-slate-100 text-slate-800')}
      onClick={() => onNavigate('meldingen')}
    >
      <Bell size={16} />
      {ongelezenMeldingen > 0 && (
        <span
          aria-hidden="true"
          className="absolute -top-0.5 -right-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-oker-500 px-1 text-2xs font-bold tabular-nums text-slate-950 ring-2 ring-paper"
        >
          {teller}
        </span>
      )}
    </IconButton>
  );
}
