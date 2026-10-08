import { Megaphone } from 'lucide-react';
import { Card } from './Card';
import { cn } from '../lib/ui';
import { useMededeling } from '../lib/mededeling';

/**
 * Het geheugensteuntje voor de chauffeurs (08-10): één rustige strook in de
 * informatietint, dezelfde op Ritbladen, Mijn dag en het dashboard. Rendert
 * niets zolang de beheerder niets aangezet heeft of de einddag voorbij is.
 * Bewust op `Card` en niet op `Callout`: die brengt vijf standaardiconen mee
 * en dit onderdeel zit in de warmup van elke rol (budget 76,5 / 142,5 kB).
 */
export function MededelingStrook({ className }: { className?: string }) {
  const m = useMededeling();
  if (!m) return null;
  return (
    <Card tone="info" padding="none" role="status" className={cn('flex items-center gap-3 px-4 py-3 text-sm font-medium text-blue-800', className)}>
      <Megaphone size={16} className="shrink-0 text-blue-700" aria-hidden="true" />
      <span className="min-w-0 flex-1">{m.tekst}</span>
    </Card>
  );
}
