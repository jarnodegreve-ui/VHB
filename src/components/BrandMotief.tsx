import { GOUD } from './BrandLogo';
import { cn } from '../lib/ui';

/**
 * Lus-motief voor lege staten (idee 8, 09-2026): een abstractie van de
 * onderbroken ovale lus met het gouden segment uit het VHB-logo — bewust
 * zónder monogram of naamregel. Het logo zelf mag niet vervormd of als
 * illustratie hergebruikt worden; dit is een UI-element dat het merk citeert
 * (zoals BrandSpinner dat al doet), geen logo.
 *
 * Geometrie is de lus van BrandLogo op schaal (r 177 → 16, lusdikte 57 → 5,
 * dezelfde onderbreking rechtsboven tussen ink en goud). Ink via
 * `currentColor` zodat `text-slate-400` en dark mode vanzelf meewerken;
 * goud is de vaste logo-kleur. Geen schaduw/gloed/verloop.
 */
const LUS_INK = 'M 66.1 8 H 24 A 16 16 0 0 0 24 40 H 72 A 16 16 0 0 0 87.76 21.22';
const LUS_GOUD = 'M 69.8 8 H 72 A 16 16 0 0 1 86.73 17.75';

export type MotiefVariant = 'leeg' | 'klaar' | 'fout';

export function BrandMotief({ variant = 'leeg', className }: { variant?: MotiefVariant; className?: string }) {
  return (
    <svg viewBox="0 0 96 48" width={96} height={48} className={cn('shrink-0', className)} aria-hidden="true">
      <g fill="none" strokeWidth={5} strokeLinecap="butt" strokeLinejoin="round">
        <path d={LUS_INK} stroke="currentColor" />
        <path d={LUS_GOUD} stroke={GOUD} />
      </g>
      {variant === 'klaar' && (
        /* Vinkje in goud, sober en klein — binnen de lus. */
        <path d="M 40 24.5 L 46 30.5 L 57 18.5" fill="none" stroke={GOUD} strokeWidth={3.5} strokeLinecap="round" strokeLinejoin="round" />
      )}
      {variant === 'fout' && (
        /* Uitroep-accent in goud: streep + punt, binnen de lus. */
        <g fill={GOUD}>
          <path d="M 48 14 V 27" fill="none" stroke={GOUD} strokeWidth={3.5} strokeLinecap="round" />
          <circle cx={48} cy={33.5} r={2.1} />
        </g>
      )}
    </svg>
  );
}
