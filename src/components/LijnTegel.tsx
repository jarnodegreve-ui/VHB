import { MapPin } from 'lucide-react';
import { cn } from '../lib/ui';
import { isAlleLijnen, lijnLabel, lijnenVan } from '../../shared/lijnen';

// Alleen deze aangeleverde lijnen hebben een vaste De Lijn-kleur.
const STREEKLIJNEN = new Set(['801', '858', '871', '872', '883', '884']);

type Maat = 'sm' | 'md';
type Toon = 'accent' | 'muted';

/** Eén scherp getekende badge met dezelfde maat en centrering voor iedere lijn.
 *  Kolom past vóór een compacte rij; rij laat badges in een overzicht teruglopen. */
export function LijnTegel({ line, tone = 'accent', size = 'md', layout = 'kolom', className }: {
  line: string;
  /** Alleen lijnen zonder aangeleverde kleur volgen de portaaltoon. */
  tone?: Toon;
  size?: Maat;
  layout?: 'rij' | 'kolom';
  className?: string;
}) {
  const lijnen = lijnenVan(line);
  if (lijnen.length === 0 || isAlleLijnen(lijnen[0])) {
    return (
      <span className={cn(badgeKlassen(size, tone), className)} role="img" aria-label={lijnLabel(line)}>
        <MapPin size={size === 'sm' ? 14 : 16} aria-hidden="true" />
      </span>
    );
  }
  return (
    <span className={cn('inline-flex max-w-full gap-1.5', layout === 'rij' ? 'flex-wrap items-center' : 'shrink-0 flex-col items-start', className)}>
      {lijnen.map((lijn) => (
        <span key={lijn} className={badgeKlassen(size, tone, lijn)} role="img" aria-label={lijnLabel(lijn)}>
          {lijn}
        </span>
      ))}
    </span>
  );
}

function badgeKlassen(size: Maat, tone: Toon, lijn?: string) {
  return cn(
    'lijnbadge',
    size === 'sm' ? 'lijnbadge--sm' : 'lijnbadge--md',
    lijn === '50' ? 'lijnbadge--oranje'
      : lijn && STREEKLIJNEN.has(lijn) ? 'lijnbadge--streek'
      : tone === 'muted' ? 'border-hairline bg-slate-500/12 text-slate-600'
      : 'border-oker-100 bg-oker-50 text-oker-800',
  );
}
