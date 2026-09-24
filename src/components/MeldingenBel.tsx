import { Suspense, lazy } from 'react';
import { Bell } from 'lucide-react';
import { useAppDataContext } from '../app/AppDataContext';
import { cn } from '../lib/ui';
import type { View } from '../types';
import { CountUp } from './CountUp';
import { IconButton } from './primitives';
import { useDropdown } from './useDropdown';

/**
 * Bel in de topbar (meldingencentrum, 06-09): draagt de ongelezen-teller als
 * stille goud-badge — geen rood, geen puls. Bij staf staat de knop Open taken
 * ernaast met zijn eigen teller; deze bel telt alleen wat er voor jóu
 * binnenkwam. Leest uit de datalaag (useMeldingenData), die door Realtime
 * mee-ververst.
 *
 * Sinds 21-09 opent hij een paneel in plaats van meteen het scherm (puntje
 * Jarno). Dat paneel is lazy: de bel staat in de topbar en dus in de
 * hoofdbundel, het paneel (motion, acht iconen) hoort daar niet bij — zelfde
 * afspraak als WerkvoorraadMenu. De chunk wordt al opgehaald zodra de muis de
 * knop raakt, dus bij de klik staat hij er meestal al.
 */
const laadMeldingenPaneel = () => import('./MeldingenPaneel');
const LazyMeldingenPaneel = lazy(() => laadMeldingenPaneel().then((m) => ({ default: m.MeldingenPaneel })));

export function MeldingenBel({ onNavigate, actief = false }: { onNavigate: (view: View) => void; actief?: boolean }) {
  const { ongelezenMeldingen } = useAppDataContext();
  const { open, setOpen, wortel } = useDropdown({ mobielVol: true });

  return (
    <div ref={wortel} className="relative">
      <IconButton
        label={ongelezenMeldingen > 0 ? `Meldingen (${ongelezenMeldingen} ongelezen)` : 'Meldingen'}
        title="Meldingen"
        variant="ghost"
        size="sm"
        onClick={() => setOpen((v) => !v)}
        onPointerEnter={() => void laadMeldingenPaneel()}
        onFocus={() => void laadMeldingenPaneel()}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-current={actief ? 'page' : undefined}
        className={cn('relative', (open || actief) && 'bg-slate-100 text-slate-800')}
      >
        <Bell size={16} />
        {ongelezenMeldingen > 0 && (
          <span
            aria-hidden="true"
            className="absolute -top-0.5 -right-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-oker-500 px-1 text-2xs font-bold text-slate-950 ring-2 ring-paper"
          >
            <CountUp value={ongelezenMeldingen} badge format={(n) => (n > 9 ? '9+' : n)} />
          </span>
        )}
      </IconButton>

      {open && (
        <Suspense fallback={null}>
          <LazyMeldingenPaneel onNavigate={onNavigate} onSluit={() => setOpen(false)} />
        </Suspense>
      )}
    </div>
  );
}
