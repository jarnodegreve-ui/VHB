import { useEffect, useRef, type ReactNode } from 'react';
import { bewaakInBeeld, meldRuilBekeken } from '../lib/ruilBekeken';

/**
 * Wikkel om de kaart van een aan mij gerichte, nog onbeantwoorde dienstruil:
 * staat ze echt in beeld, dan hoort de server dat één keer (zie
 * src/lib/ruilBekeken.ts). `actief` uit = een gewone div, er wordt niets
 * waargenomen of verstuurd.
 */
export function RuilBekekenBaken({ swapId, actief, children }: { swapId: string; actief: boolean; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!actief || !ref.current) return;
    return bewaakInBeeld(ref.current, () => meldRuilBekeken(swapId));
  }, [actief, swapId]);
  return <div ref={ref}>{children}</div>;
}
