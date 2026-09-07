import { Wrench } from 'lucide-react';
import { Card } from './Card';
import { cn } from '../lib/ui';
import { ONDERHOUD_STANDAARD_TEKST, type OnderhoudPubliek } from '../../shared/schemas/onderhoud';

/**
 * Rustige onderhoudsstrook: in de schil een `Card tone="warning"` boven de
 * inhoud (zelfde plek als de offline-kaart), op het donkere loginscherm een
 * stille amber strook in de stijl van de uitlogmelding. Geen neon, geen
 * animatie; rendert niets zolang het onderhoud niet actief is.
 */
export function OnderhoudBanner({ onderhoud, tone = 'licht', tot, className }: {
  onderhoud: OnderhoudPubliek;
  tone?: 'licht' | 'donker';
  /** Optioneel einde (ISO); wordt als "tot HH:MM" achter de tekst gezet. */
  tot?: string;
  className?: string;
}) {
  if (!onderhoud.actief) return null;
  const tekst = onderhoud.tekst.trim() || ONDERHOUD_STANDAARD_TEKST;
  const einde = tot ? new Date(tot) : null;
  const totTekst = einde && Number.isFinite(einde.getTime())
    ? ` Verwacht klaar rond ${einde.toLocaleTimeString('nl-BE', { hour: '2-digit', minute: '2-digit' })}.`
    : '';
  if (tone === 'donker') {
    return (
      <div role="status" className={cn('flex items-start gap-2.5 rounded-2xl border border-amber-500/25 bg-amber-500/12 px-4 py-3', className)}>
        <Wrench size={16} className="mt-px shrink-0 text-amber-400" />
        <p className="text-sm font-medium leading-relaxed text-amber-100">{tekst}{totTekst}</p>
      </div>
    );
  }
  return (
    <Card tone="warning" padding="none" role="status" className={cn('flex items-start gap-2.5 px-4 py-3 text-sm font-semibold text-amber-800', className)}>
      <Wrench size={14} className="mt-0.5 shrink-0" />
      <span>{tekst}{totTekst}</span>
    </Card>
  );
}
