import type { ReactNode } from 'react';
import { cn } from '../lib/ui';
import { Card } from './Card';
import { MicroLabel } from './primitives';

/**
 * Stat (ronde 5, F2): het neutrale cijferblok buiten de ops-familie
 * (samenvatting van een import, historiek van een gebruiker, jaartotalen).
 * Label in de micro-rol, cijfer in `text-stat` (+ `mono` voor dienstnummers
 * en tijden), optionele toelichting. Op een gedempt vlak, tenzij `kaal`
 * (dan zet de omliggende kaart het vlak). Vervangt veertien losse
 * `MicroLabel + text-stat`-blokken met drie verschillende marges.
 *
 * Voor de cockpit-tegels met icoon, tint en klikgedrag blijft `OpsStat`.
 */
export function Stat({ label, value, sub, mono = false, aandacht = false, kaal = false, className }: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  mono?: boolean;
  /** Cijfer in amber: vraagt aandacht (vervallen, open). */
  aandacht?: boolean;
  kaal?: boolean;
  className?: string;
}) {
  const inhoud = (
    <>
      <MicroLabel>{label}</MicroLabel>
      <p className={cn('mt-2 text-stat', mono && 'text-stat-mono', aandacht ? 'text-amber-800' : 'text-slate-900')}>{value}</p>
      {sub && <p className="mt-1 text-xs font-medium text-slate-500">{sub}</p>}
    </>
  );
  if (kaal) return <div className={cn('min-w-0', className)}>{inhoud}</div>;
  return <Card tone="muted" padding="sm" className={cn('min-w-0', className)}>{inhoud}</Card>;
}
