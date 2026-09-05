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
  const budget = balance.betaaldBudget;
  const overBudget = balance.betaaldGebruikt > budget;
  // Jaarbalk in drie segmenten: opgenomen (goedgekeurd) · aangevraagd (nog
  // niet beoordeeld) · vrij. Percentages op het budget; bij overschrijding
  // vult opgenomen de hele balk.
  const pct = (n: number) => (budget > 0 ? Math.min(100, (n / budget) * 100) : n > 0 ? 100 : 0);
  const pctGebruikt = pct(balance.betaaldGebruikt);
  const pctAangevraagd = Math.min(100 - pctGebruikt, pct(balance.betaaldAangevraagd));
  const dagen = (n: number) => `${n} ${n === 1 ? 'dag' : 'dagen'}`;

  return (
    <Card padding={compact ? 'sm' : 'md'} className={compact ? 'space-y-3' : 'space-y-4'}>
      {/* flex-row/items-baseline: CardHeader stapelt titel en aside op mobiel;
          voor dit smalle kaartje horen ze op één regel. */}
      <CardHeader title="Verlofbalans" aside={<span className={microLabelClass}>{year}</span>} className="flex-row items-baseline" />

      <div className="space-y-2">
        <div className="flex items-baseline justify-between gap-3">
          <span className={microLabelClass}>Betaald verlof</span>
          <span className={cn('text-xs font-bold', overBudget ? 'text-red-700' : 'text-slate-600')}>
            <span className={cn('font-bold tabular-nums', compact ? 'text-base' : 'text-lg')}>{balance.betaaldVrij}</span>
            <span className="text-slate-500"> / {budget} vrij</span>
          </span>
        </div>
        <div
          className="flex h-2 gap-px overflow-hidden rounded-full bg-surface-muted"
          role="img"
          aria-label={`${dagen(balance.betaaldGebruikt)} opgenomen, ${dagen(balance.betaaldAangevraagd)} aangevraagd, ${dagen(balance.betaaldVrij)} vrij van ${budget}`}
        >
          {pctGebruikt > 0 && (
            <div className={cn('h-full rounded-full transition-all', overBudget ? 'bg-red-500' : 'bg-emerald-500')} style={{ width: `${Math.max(2, pctGebruikt)}%` }} />
          )}
          {pctAangevraagd > 0 && (
            <div className="h-full rounded-full bg-amber-400 transition-all" style={{ width: `${Math.max(2, pctAangevraagd)}%` }} />
          )}
        </div>
        <ul className="flex flex-wrap gap-x-3 gap-y-1 text-2xs font-medium text-slate-500" aria-hidden="true">
          <li className="flex items-center gap-1.5">
            <span className={cn('h-1.5 w-1.5 rounded-full', overBudget ? 'bg-red-500' : 'bg-emerald-500')} />
            {balance.betaaldGebruikt} opgenomen
          </li>
          {balance.betaaldAangevraagd > 0 && (
            <li className="flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
              {balance.betaaldAangevraagd} aangevraagd
            </li>
          )}
          <li className="flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-slate-300" />
            {balance.betaaldVrij} vrij
          </li>
        </ul>
        {overBudget && (
          <p className="text-2xs font-medium text-red-700">{dagen(balance.betaaldGebruikt - budget)} boven budget.</p>
        )}
      </div>

      <div className="flex items-baseline justify-between gap-3 pt-2 border-t border-slate-100">
        <span className={microLabelClass}>Klein verlet</span>
        <span className="text-xs font-bold text-slate-600">
          <span className={cn('font-bold tabular-nums', compact ? 'text-base' : 'text-lg')}>{balance.kleinVerletDagen}</span>
          <span className="text-slate-500"> {balance.kleinVerletDagen === 1 ? 'dag' : 'dagen'}</span>
        </span>
      </div>
    </Card>
  );
}
