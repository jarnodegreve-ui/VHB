import { useState } from 'react';
import { MapPin } from 'lucide-react';
import { cn } from '../lib/ui';
import { isAlleLijnen, lijnLabel, lijnenVan } from '../../shared/lijnen';
import lijn50 from '../assets/lijnbadges/50.png';
import lijn801 from '../assets/lijnbadges/801.png';
import lijn858 from '../assets/lijnbadges/858.png';
import lijn871 from '../assets/lijnbadges/871.png';
import lijn872 from '../assets/lijnbadges/872.png';
import lijn883 from '../assets/lijnbadges/883.png';
import lijn884 from '../assets/lijnbadges/884.png';

// Originele PNG's van Jarno (16-09-2026), inclusief hun kleurprofiel.
// Alle badges zijn 315 × 216 px; alleen de marge van de screenshots verschilt.
// We kaderen ze bij het weergeven in, zonder pixels of kleuren te wijzigen.
const LIJNBADGES: Record<string, { src: string; width: number; height: number; x: number; y: number }> = {
  '50': { src: lijn50, width: 396, height: 282, x: 42, y: 33 },
  '801': { src: lijn801, width: 388, height: 262, x: 38, y: 19 },
  '858': { src: lijn858, width: 378, height: 254, x: 32, y: 22 },
  '871': { src: lijn871, width: 388, height: 268, x: 38, y: 25 },
  '872': { src: lijn872, width: 388, height: 286, x: 34, y: 31 },
  '883': { src: lijn883, width: 380, height: 280, x: 34, y: 29 },
  '884': { src: lijn884, width: 374, height: 248, x: 28, y: 19 },
};

type Maat = 'sm' | 'md';
type Toon = 'accent' | 'muted';

/** Iedere lijn houdt haar eigen badge, ook bij meerdere lijnen of verlopen items.
 *  Kolom past vóór een compacte rij; rij laat badges in een overzicht teruglopen. */
export function LijnTegel({ line, tone = 'accent', size = 'md', layout = 'kolom', className }: {
  line: string;
  /** Alleen de terugval zonder aangeleverde badge volgt de portaaltoon. */
  tone?: Toon;
  size?: Maat;
  layout?: 'rij' | 'kolom';
  className?: string;
}) {
  const lijnen = lijnenVan(line);
  if (lijnen.length === 0 || isAlleLijnen(lijnen[0])) {
    return (
      <span className={cn(terugvalKlassen(size, tone), className)} role="img" aria-label={lijnLabel(line)}>
        <MapPin size={size === 'sm' ? 14 : 16} aria-hidden="true" />
      </span>
    );
  }
  return (
    <span className={cn('inline-flex max-w-full gap-1.5', layout === 'rij' ? 'flex-wrap items-center' : 'shrink-0 flex-col items-start', className)}>
      {lijnen.map((lijn) => <LijnBadge key={lijn} lijn={lijn} size={size} tone={tone} />)}
    </span>
  );
}

function terugvalKlassen(size: Maat, tone: Toon) {
  return cn(
    'inline-flex shrink-0 items-center justify-center rounded-lg border px-1.5 font-bold tracking-tight',
    size === 'sm' ? 'h-6 min-w-9 text-xs' : 'h-8 min-w-12 text-sm',
    tone === 'muted' ? 'border-hairline bg-slate-500/12 text-slate-600' : 'border-oker-100 bg-oker-50 text-oker-800',
  );
}

function LijnBadge({ lijn, size, tone }: { lijn: string; size: Maat; tone: Toon }) {
  // hasOwnProperty.call i.p.v. Object.hasOwn: dat bestaat pas vanaf Safari 15.4
  // en de build-target is safari14 (controle-ronde 16-09, nr. 20).
  const badge = Object.prototype.hasOwnProperty.call(LIJNBADGES, lijn) ? LIJNBADGES[lijn] : undefined;
  const [laadfout, setLaadfout] = useState(false);
  if (!badge || laadfout) {
    return <span className={terugvalKlassen(size, tone)} role="img" aria-label={lijnLabel(lijn)}>{lijn}</span>;
  }
  return (
    <span
      role="img"
      aria-label={lijnLabel(lijn)}
      className={cn('lijnbadge relative block shrink-0 overflow-hidden ring-1 ring-hairline', size === 'sm' ? 'h-6' : 'h-8')}
      style={{ aspectRatio: '315 / 216', borderRadius: '15% / 22%' }}
    >
      <img
        src={badge.src}
        alt=""
        aria-hidden="true"
        width={badge.width}
        height={badge.height}
        draggable={false}
        onError={() => setLaadfout(true)}
        className="absolute block max-w-none"
        style={{ width: `${badge.width / 315 * 100}%`, left: `${-badge.x / 315 * 100}%`, top: `${-badge.y / 216 * 100}%` }}
      />
    </span>
  );
}
