import { AlertTriangle } from 'lucide-react';
import { Card } from '../components/Card';
import { Button } from '../components/primitives';

/**
 * Fallback van de foutgrens per view: één scherm dat crasht sloopt niet
 * langer de hele schil (sidebar, sessie, context) — alleen de inhoud, met
 * een knop om het opnieuw te proberen.
 */
export function ViewFout({ onRetry }: { onRetry: () => void }) {
  return (
    <Card tone="dashed" className="text-center py-10">
      <div className="w-14 h-14 bg-red-50 text-red-700 rounded-2xl flex items-center justify-center mx-auto mb-4">
        <AlertTriangle size={24} />
      </div>
      <h2 className="text-card-title">Dit scherm kon niet geladen worden</h2>
      <p className="mt-1.5 text-sm text-slate-500 max-w-md mx-auto">Er ging iets mis bij het tonen van deze pagina. De fout is automatisch gemeld. Probeer het opnieuw of kies een ander scherm.</p>
      <div className="mt-5 flex justify-center"><Button variant="secondary" onClick={onRetry}>Opnieuw proberen</Button></div>
    </Card>
  );
}
