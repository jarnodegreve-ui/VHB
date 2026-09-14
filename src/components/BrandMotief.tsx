import { GOUD } from './BrandLogo';
import { cn } from '../lib/ui';

/**
 * Streep-motief voor lege staten (09-2026): een abstractie van de gouden
 * schuine streep uit het VHB-merk, geflankeerd door twee dunne strepen in
 * inkt — bewust zónder letters. Het logo zelf mag niet vervormd of als
 * illustratie hergebruikt worden; dit is een UI-element dat het merk citeert
 * (zoals BrandSpinner dat al doet), geen logo.
 *
 * Zelfde helling als de streep in het merk (30° uit de verticaal). Inkt via
 * `currentColor` zodat `text-slate-400` en dark mode vanzelf meewerken; goud
 * is de vaste logo-kleur. Geen schaduw/gloed/verloop.
 */
// Drie evenwijdige strepen van y 10 tot y 38 (dy 28 → dx 16,2 bij 30°).
const STREEP = (x: number) => `M ${x} 38 L ${x + 16.2} 10`;

export type MotiefVariant = 'leeg' | 'klaar' | 'fout';

export function BrandMotief({ variant = 'leeg', className }: { variant?: MotiefVariant; className?: string }) {
  return (
    <svg viewBox="0 0 96 48" width={96} height={48} className={cn('shrink-0', className)} aria-hidden="true" fill="none" strokeLinecap="round" strokeLinejoin="round">
      <path d={STREEP(24)} stroke="currentColor" strokeWidth={2.5} />
      <path d={STREEP(40)} stroke="currentColor" strokeWidth={2.5} />
      {variant === 'leeg' && <path d={STREEP(56)} stroke={GOUD} strokeWidth={4} />}
      {variant === 'klaar' && (
        /* Vinkje in goud: het lange been ís de streep, het korte been eronder. */
        <path d="M 49 30 L 56 38 L 72.2 10" stroke={GOUD} strokeWidth={4} />
      )}
      {variant === 'fout' && (
        /* Uitroep-accent in goud langs de helling: streep + punt. */
        <>
          <path d="M 61.2 29 L 72.2 10" stroke={GOUD} strokeWidth={4} />
          <circle cx={57.6} cy={36.5} r={2.4} fill={GOUD} />
        </>
      )}
    </svg>
  );
}
