import { EmptyState } from '../components/ui';
import { Button } from '../components/primitives';
import { Fout } from '../components/illustraties';
import { wisReferentie } from '../lib/monitoring';
import { FoutReferentie } from './FoutReferentie';

/**
 * Fallback van de foutgrens per view: één scherm dat crasht sloopt niet
 * langer de hele schil (sidebar, sessie, context) — alleen de inhoud, met
 * een knop om het opnieuw te proberen. Zelfde lege-staat-taal als de rest
 * (lus-motief, variant 'fout'). Onder de knop de foutreferentie zodra het
 * rapport is aangekomen (07-09, nr. 6).
 */
export function ViewFout({ onRetry }: { onRetry: () => void }) {
  return (
    <EmptyState
      variant="fout"
      illustratie={<Fout />}
      title="Dit scherm kon niet geladen worden"
      message="Er ging iets mis bij het tonen van deze pagina. De fout is automatisch gemeld. Probeer het opnieuw of kies een ander scherm."
      action={(
        <div className="flex flex-col items-center gap-3">
          <Button variant="secondary" onClick={() => { wisReferentie(); onRetry(); }}>Opnieuw proberen</Button>
          <FoutReferentie />
        </div>
      )}
    />
  );
}
