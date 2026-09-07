import { useState, useSyncExternalStore } from 'react';
import { Check, Copy } from 'lucide-react';
import { IconButton } from '../components/primitives';
import { cn } from '../lib/ui';
import { getLaatsteReferentie, subscribeReferentie } from '../lib/monitoring';

/** De laatst ontvangen foutreferentie (null zolang er geen rapport is aangekomen). */
export const useFoutReferentie = (): string | null =>
  useSyncExternalStore(subscribeReferentie, getLaatsteReferentie, () => null);

/**
 * Stille regel onder een foutmelding: "Referentie A7F3C1" met kopieerknop en
 * de vraag om de code door te geven. Rendert niets zolang het rapport nog
 * niet verstuurd is (of offline): dan is er niets om door te geven. De code
 * komt uit monitoring.ts (antwoord van POST /api/client-errors) en staat als
 * dezelfde code bij de foutgroep in Systeemstatus › Fouten.
 */
export function FoutReferentie({ className }: { className?: string }) {
  const referentie = useFoutReferentie();
  const [gekopieerd, setGekopieerd] = useState(false);
  if (!referentie) return null;
  const kopieer = () => {
    void navigator.clipboard?.writeText(referentie).then(() => {
      setGekopieerd(true);
      window.setTimeout(() => setGekopieerd(false), 1800);
    }).catch(() => undefined);
  };
  return (
    <div className={cn('flex flex-col items-center gap-0.5 text-xs text-slate-500', className)}>
      <span className="inline-flex items-center gap-1">
        Referentie <span className="font-mono font-semibold text-slate-700">{referentie}</span>
        <IconButton label={gekopieerd ? 'Referentie gekopieerd' : 'Referentie kopiëren'} size="sm" onClick={kopieer}>
          {gekopieerd ? <Check size={14} className="text-emerald-700" /> : <Copy size={14} />}
        </IconButton>
      </span>
      <span>Geef deze code door aan de planning.</span>
    </div>
  );
}
