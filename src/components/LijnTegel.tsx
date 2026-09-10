import { MapPin } from 'lucide-react';
import { cn } from '../lib/ui';
import { isAlleLijnen, lijnLabel, lijnenVan } from '../../shared/lijnen';

/**
 * Het vierkantje vóór een omleiding toont het lijnnummer in plaats van een
 * kaartspeldje, zodat de lijst in één oogopslag te scannen is (Jarno 09-09).
 * Eén lijn: het nummer groot. Twee lijnen: allebei, gestapeld. Meer: de
 * eerste met "+n". "Alle" of onbekend: het speldje.
 */
export function LijnTegel({ line, tone = 'accent', size = 'md', className }: {
  line: string;
  /** 'muted' voor verlopen omleidingen in beheer. */
  tone?: 'accent' | 'muted';
  /** 'sm' in lijstrijen (Jarno 10-09: het vierkant mag daar kleiner), 'md' in koppen. */
  size?: 'sm' | 'md';
  className?: string;
}) {
  const lijnen = lijnenVan(line);
  const basis = cn(
    'inline-flex shrink-0 items-center justify-center border font-bold',
    size === 'sm' ? 'h-7 w-7 rounded-lg' : 'h-9 w-9 rounded-xl',
    tone === 'muted'
      ? 'border-slate-200 bg-slate-500/12 text-slate-500'
      // oker-800, niet 700: kleine vette cijfers op oker-50 haalden AA-contrast niet (axe, 10-09).
      : 'border-oker-100 bg-oker-50 text-oker-800',
    className,
  );
  if (lijnen.length === 0 || isAlleLijnen(lijnen[0])) {
    return (
      <span className={basis} role="img" aria-label={lijnLabel(line)}>
        <MapPin size={size === 'sm' ? 13 : 16} />
      </span>
    );
  }
  if (lijnen.length === 1) {
    return (
      <span className={cn(basis, size === 'sm' ? 'text-xs tracking-tight' : 'text-sm tracking-tight')} role="img" aria-label={lijnLabel(line)}>
        {lijnen[0]}
      </span>
    );
  }
  return (
    <span className={cn(basis, 'flex-col text-2xs leading-none tracking-tight', size === 'sm' ? 'gap-px' : 'gap-0.5')} role="img" aria-label={lijnLabel(line)}>
      <span>{lijnen[0]}</span>
      <span>{lijnen.length === 2 ? lijnen[1] : `+${lijnen.length - 1}`}</span>
    </span>
  );
}
