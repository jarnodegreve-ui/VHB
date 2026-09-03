import type { LeaveBalance } from '../lib/leaveBalance';
import { cn } from '../lib/ui';
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
    <div className={cn('rounded-3xl border border-slate-100 bg-paper/55 p-5 space-y-4', compact && 'p-4 space-y-3')}>
      <div className="flex items-baseline justify-between gap-3">
        <h5 className={cn('font-bold text-slate-700 tracking-tight', compact ? 'text-sm' : 'text-base')}>Verlofbalans</h5>
        <span className={microLabelClass}>{year}</span>
      </div>

      <div className="space-y-2">
        <div className="flex items-baseline justify-between gap-3">
          <span className={microLabelClass}>Betaald verlof</span>
          <span className={cn('text-xs font-bold', overBudget ? 'text-red-500' : 'text-slate-600')}>
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
        <span className="text-2xs font-semibold uppercase tracking-[0.08em] text-slate-500">Klein verlet</span>
        <span className="text-xs font-bold text-slate-600">
          <span className={cn('font-bold tabular-nums', compact ? 'text-base' : 'text-lg')}>{balance.kleinVerletDagen}</span>
          <span className="text-slate-400"> {balance.kleinVerletDagen === 1 ? 'dag' : 'dagen'}</span>
        </span>
      </div>
    </div>
  );
}
