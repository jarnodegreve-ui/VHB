import { cn } from '../lib/ui';

/**
 * Dienstnummer als chip — één vorm door de hele app, zodat het nummer
 * overal even snel te scannen is (rooster, dashboard, popups, ruilwizard).
 *
 * `tone`: 'oker' voor de eigen/actieve dienst, 'slate' voor een neutrale
 * vermelding in lijsten.
 */
export function ServiceChip({
  serviceNumber,
  loopnr,
  tone = 'slate',
  className,
}: {
  serviceNumber: string;
  /** Optioneel loopnummer — het deel van de dienst waar ritten onder vallen. */
  loopnr?: string;
  tone?: 'oker' | 'slate';
  className?: string;
}) {
  const nummer = String(serviceNumber || '').trim();
  if (!nummer || nummer === '--') return null;
  return (
    <span
      className={cn(
        // font-mono: dienst- en loopnummers zijn operationele codes — het
        // monospace-accent maakt ze in één oogopslag herkenbaar (dispatch).
        'inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-0.5 text-xs font-mono font-semibold tabular-nums',
        tone === 'oker'
          ? 'bg-oker-500/15 text-oker-700 dark:text-oker-400'
          : 'bg-surface-muted text-slate-700',
        className,
      )}
    >
      {nummer}
      {loopnr?.trim() && (
        <span className="font-semibold text-2xs opacity-70">loop {loopnr.trim()}</span>
      )}
    </span>
  );
}
