import type { LeaveBalance } from '../lib/leaveBalance';
import { cn } from '../lib/ui';
import { Card, CardHeader } from './Card';
import { microLabelClass } from './primitives';

/**
 * Visualisatie van de verlofbalans voor één gebruiker. Toont de
 * gebruikte / resterende dagen Betaald Verlof met een progress-bar,
 * en een aparte teller voor Klein Verlet. Werkt zowel in een
 * chauffeur-context (eigen balans) als planner-context (per chauffeur
 * in de historiek).
 */
export function LeaveBalanceCard({ balance, year, compact = false }: { balance: LeaveBalance; year: number; compact?: boolean }) {
  const percentage = balance.betaaldBudget > 0
    ? Math.min(100, Math.round((balance.betaaldGebruikt / balance.betaaldBudget) * 100))
    : balance.betaaldGebruikt > 0
      ? 100
      : 0;
  const overBudget = balance.betaaldGebruikt > balance.betaaldBudget;

  return (
    <Card padding={compact ? 'sm' : 'md'} className={compact ? 'space-y-3' : 'space-y-4'}>
      {/* flex-row/items-baseline: CardHeader stapelt titel en aside op mobiel;
          voor dit smalle kaartje horen ze op één regel. */}
      <CardHeader title="Verlofbalans" aside={<span className={microLabelClass}>{year}</span>} className="flex-row items-baseline" />

      <div className="space-y-2">
        <div className="flex items-baseline justify-between gap-3">
          <span className={microLabelClass}>Betaald verlof</span>
          <span className={cn('text-xs font-bold', overBudget ? 'text-red-700' : 'text-slate-600')}>
            <span className={cn('font-bold tabular-nums', compact ? 'text-base' : 'text-lg')}>{balance.betaaldGebruikt}</span>
            <span className="text-slate-400"> / {balance.betaaldBudget} dagen</span>
          </span>
        </div>
        <div className="h-2 rounded-full bg-surface-muted overflow-hidden">
          <div
            className={cn('h-full rounded-full transition-all', overBudget ? 'bg-red-500' : percentage > 80 ? 'bg-amber-500' : 'bg-emerald-500')}
            style={{ width: `${Math.max(2, percentage)}%` }}
          />
        </div>
        <p className="text-2xs font-medium text-slate-400">
          {overBudget
            ? `${balance.betaaldGebruikt - balance.betaaldBudget} dagen boven budget.`
            : `${balance.betaaldResterend} ${balance.betaaldResterend === 1 ? 'dag' : 'dagen'} resterend.`}
        </p>
      </div>

      <div className="flex items-baseline justify-between gap-3 pt-2 border-t border-slate-100">
        <span className={microLabelClass}>Klein verlet</span>
        <span className="text-xs font-bold text-slate-600">
          <span className={cn('font-bold tabular-nums', compact ? 'text-base' : 'text-lg')}>{balance.kleinVerletDagen}</span>
          <span className="text-slate-400"> {balance.kleinVerletDagen === 1 ? 'dag' : 'dagen'}</span>
        </span>
      </div>
    </Card>
  );
}
