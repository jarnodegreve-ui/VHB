import { useMemo, useState } from 'react';
import { ShieldCheck, ShieldAlert, ChevronDown } from 'lucide-react';
import type { Shift, User } from '../../types';
import { cn } from '../../lib/ui';
import { analyzeCompliance, type ComplianceFinding } from '../../lib/compliance';
import { EmptyState, PageHeader, PageShell } from '../../components/ui';
import { Badge, MicroLabel } from '../../components/primitives';

const RULE_LABELS: Record<ComplianceFinding['rule'], string> = {
  'dagelijkse-rust': 'Dagelijkse rust',
  'wekelijkse-rust': 'Wekelijkse rust',
  amplitude: 'Amplitude',
  'dagelijkse-werktijd': 'Werktijd per dag',
  'werkdagen-op-rij': 'Werkdagen op rij',
};

export function ComplianceView({ shifts, users }: { shifts: Shift[]; users: User[] }) {
  const [openDriver, setOpenDriver] = useState<string | null>(null);

  const report = useMemo(() => analyzeCompliance(shifts), [shifts]);
  const nameOf = (id: string) => users.find((u) => String(u.id) === String(id))?.name || `Chauffeur ${id}`;

  const drivers = useMemo(() => {
    return [...report.perDriver.entries()]
      .map(([driverId, findings]) => ({
        driverId,
        findings,
        violations: findings.filter((f) => f.severity === 'violation').length,
        warnings: findings.filter((f) => f.severity === 'warning').length,
      }))
      .sort((a, b) => b.violations - a.violations || b.warnings - a.warnings || nameOf(a.driverId).localeCompare(nameOf(b.driverId)));
  }, [report, users]);

  const analyzedDrivers = useMemo(() => new Set(shifts.map((s) => String(s.driverId))).size, [shifts]);
  const dateRange = useMemo(() => {
    const dates = shifts.map((s) => s.date).filter(Boolean).sort();
    return dates.length ? { from: dates[0], to: dates[dates.length - 1] } : null;
  }, [shifts]);

  return (
    <PageShell width="5xl">
      <PageHeader
        eyebrow="Beheer"
        title="Rij- & rusttijden"
        description={
          dateRange
            ? `Controle op de geladen planning (${dateRange.from} t/m ${dateRange.to}, ${analyzedDrivers} chauffeurs) volgens EU 561/2006 en het KB geregeld vervoer. Gebaseerd op dienst-spans — pauzes en effectieve rijtijd kent de planning niet.`
            : 'Importeer eerst een planning om de rusttijden te controleren.'
        }
        actions={
          <div className="flex items-center gap-2">
            <Badge tone={report.violations > 0 ? 'red' : 'emerald'} dot>
              {report.violations} overtreding{report.violations === 1 ? '' : 'en'}
            </Badge>
            <Badge tone={report.warnings > 0 ? 'amber' : 'slate'} dot>
              {report.warnings} waarschuwing{report.warnings === 1 ? '' : 'en'}
            </Badge>
          </div>
        }
      />

      {drivers.length === 0 ? (
        <EmptyState
          title={shifts.length === 0 ? 'Geen planning geladen' : 'Alles in orde'}
          message={
            shifts.length === 0
              ? 'Zodra er een planning geïmporteerd is, verschijnt hier de rusttijdcontrole.'
              : `Geen rusttijd-problemen gevonden bij ${analyzedDrivers} chauffeurs in deze periode.`
          }
        />
      ) : (
        <div className="space-y-3">
          {drivers.map(({ driverId, findings, violations, warnings }) => {
            const isOpen = openDriver === driverId;
            return (
              <div key={driverId} className="surface-card rounded-3xl overflow-hidden">
                <button
                  onClick={() => setOpenDriver(isOpen ? null : driverId)}
                  className="flex w-full items-center gap-4 px-5 py-4 text-left hover:bg-slate-50/70 transition-colors"
                >
                  <span
                    className={cn(
                      'inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl',
                      violations > 0 ? 'bg-red-50 text-red-600' : 'bg-amber-50 text-amber-700',
                    )}
                  >
                    {violations > 0 ? <ShieldAlert size={18} /> : <ShieldCheck size={18} />}
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm font-semibold text-slate-900 truncate">{nameOf(driverId)}</span>
                    <span className="block text-xs font-medium text-slate-500">
                      {violations > 0 ? `${violations} overtreding${violations === 1 ? '' : 'en'}` : ''}
                      {violations > 0 && warnings > 0 ? ' · ' : ''}
                      {warnings > 0 ? `${warnings} waarschuwing${warnings === 1 ? '' : 'en'}` : ''}
                    </span>
                  </span>
                  <ChevronDown size={16} className={cn('shrink-0 text-slate-400 transition-transform', isOpen && 'rotate-180')} />
                </button>
                {isOpen && (
                  <div className="border-t border-slate-200/70 px-5 py-4 space-y-2.5">
                    {findings.map((f, i) => (
                      <div key={i} className="flex items-start gap-3">
                        <Badge tone={f.severity === 'violation' ? 'red' : 'amber'} dot>
                          {RULE_LABELS[f.rule]}
                        </Badge>
                        <p className="flex-1 text-sm font-medium text-slate-700 leading-snug">{f.message}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="surface-muted rounded-2xl px-5 py-4">
        <MicroLabel>Gecontroleerde regels</MicroLabel>
        <p className="mt-1.5 text-xs font-medium leading-relaxed text-slate-500">
          Dagelijkse rust ≥ 11u tussen diensten (verkort ≥ 9u, max 3× per week) · wekelijkse rust: één blok ≥ 45u per week ma–zo (24–45u = verkort, met compensatieplicht) · amplitude ≤ 14u per dag · werktijd ≤ 12u per dag (waarschuwing boven 10u) · maximaal 6 werkdagen op rij. Weken aan de rand van het importvenster krijgen het voordeel van de twijfel.
        </p>
      </div>
    </PageShell>
  );
}
