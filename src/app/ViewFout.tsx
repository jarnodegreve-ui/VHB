import { EmptyState } from '../components/ui';
import { Button } from '../components/primitives';

/**
 * Fallback van de foutgrens per view: één scherm dat crasht sloopt niet
 * langer de hele schil (sidebar, sessie, context) — alleen de inhoud, met
 * een knop om het opnieuw te proberen. Zelfde lege-staat-taal als de rest
 * (lus-motief, variant 'fout').
 */
export function ViewFout({ onRetry }: { onRetry: () => void }) {
  return (
    <EmptyState
      variant="fout"
      title="Dit scherm kon niet geladen worden"
      message="Er ging iets mis bij het tonen van deze pagina. De fout is automatisch gemeld. Probeer het opnieuw of kies een ander scherm."
      action={<Button variant="secondary" onClick={onRetry}>Opnieuw proberen</Button>}
    />
  );
}
