import type { ReactNode } from 'react';
import { CalendarClock, Inbox, RefreshCw, Repeat, FileWarning, Activity, ArrowUpRight } from 'lucide-react';
import type { LeaveRequest, PlanningMatrixImportHistory, SwapRequest, User } from '../types';

/**
 * Planner/admin dashboard widgets — Linear/Notion-stijl.
 *
 * Designtokens:
 * - Geen glass/blur; solid wit met 1px slate-border
 * - Radius rounded-lg (8px) ipv rounded-[32px]
 * - Hi-density: kleinere padding, kleinere font-sizes
 * - Status-kleuren als dot + text, niet als grote pill
 * - Oker accent enkel op key-indicators
 */
export function PlannerDashboardWidgets({
  leaveRequests,
  swaps,
  matrixHistory,
  diversionsCount,
  users,
  onNavigate,
}: {
  leaveRequests: LeaveRequest[];
  swaps: SwapRequest[];
  matrixHistory: PlanningMatrixImportHistory[];
  diversionsCount: number;
  users: User[];
  onNavigate: (view: 'verlof-beheer' | 'ruil-verzoeken' | 'beheer-roosters' | 'beheer-omleidingen' | 'activiteit') => void;
}) {
  const pendingLeave = leaveRequests.filter((r) => r.status === 'pending');
  const pendingSwaps = swaps.filter((s) => s.status === 'pending');
  const lastImport = matrixHistory[0] || null;
  const lastImportHadIssues =
    !!lastImport && (lastImport.unknownCodes.length > 0 || lastImport.unmatchedDrivers.length > 0);

  const daysSinceImport = lastImport
    ? Math.floor((Date.now() - new Date(lastImport.createdAt).getTime()) / (1000 * 60 * 60 * 24))
    : null;

  const userNameById = (id: string) =>
    users.find((u) => String(u.id) === String(id))?.name || 'Onbekend';

  const previewLeave = pendingLeave.slice(0, 3);
  const previewSwaps = pendingSwaps.slice(0, 3);

  return (
    <section className="space-y-4">
      {/* Eyebrow + datum */}
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-900">Planner-overzicht</h2>
        <p className="text-xs text-slate-500">
          {new Date().toLocaleDateString('nl-BE', { weekday: 'long', day: 'numeric', month: 'long' })}
        </p>
      </div>

      {/* KPI grid */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard
          icon={<Inbox size={14} />}
          label="Open verlof"
          value={pendingLeave.length}
          dotColor={pendingLeave.length > 0 ? 'amber' : 'emerald'}
          onClick={pendingLeave.length > 0 ? () => onNavigate('verlof-beheer') : undefined}
        />
        <KpiCard
          icon={<Repeat size={14} />}
          label="Open ruilen"
          value={pendingSwaps.length}
          dotColor={pendingSwaps.length > 0 ? 'amber' : 'emerald'}
          onClick={pendingSwaps.length > 0 ? () => onNavigate('ruil-verzoeken') : undefined}
        />
        <KpiCard
          icon={<CalendarClock size={14} />}
          label="Laatste import"
          value={
            daysSinceImport === null
              ? '—'
              : daysSinceImport === 0
              ? 'Vandaag'
              : `${daysSinceImport}d geleden`
          }
          dotColor={lastImportHadIssues ? 'rose' : daysSinceImport && daysSinceImport > 14 ? 'amber' : 'slate'}
          onClick={() => onNavigate('beheer-roosters')}
          subValue={lastImport ? `${lastImport.importedDays} dagen verwerkt` : 'Nog geen import'}
        />
        <KpiCard
          icon={<FileWarning size={14} />}
          label="Omleidingen"
          value={diversionsCount}
          dotColor={diversionsCount > 0 ? 'oker' : 'slate'}
          onClick={() => onNavigate('beheer-omleidingen')}
        />
      </div>

      {/* Pending-overzicht */}
      {(previewLeave.length > 0 || previewSwaps.length > 0) && (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {previewLeave.length > 0 && (
            <PendingPanel
              title="Wachtende verlofaanvragen"
              count={pendingLeave.length}
              onSeeAll={() => onNavigate('verlof-beheer')}
            >
              {previewLeave.map((req) => (
                <div key={req.id}>
                  <PendingRow
                    primary={userNameById(req.userId)}
                    secondary={`${req.startDate}${
                      req.startDate !== req.endDate ? ` → ${req.endDate}` : ''
                    } · ${req.type}`}
                  />
                </div>
              ))}
            </PendingPanel>
          )}

          {previewSwaps.length > 0 && (
            <PendingPanel
              title="Wachtende dienstruilen"
              count={pendingSwaps.length}
              onSeeAll={() => onNavigate('ruil-verzoeken')}
            >
              {previewSwaps.map((swap) => (
                <div key={swap.id}>
                  <PendingRow
                    primary={
                      swap.targetDriverId
                        ? `${userNameById(swap.requesterId)} → ${userNameById(swap.targetDriverId)}`
                        : userNameById(swap.requesterId)
                    }
                    secondary={swap.reason || 'Geen reden opgegeven'}
                  />
                </div>
              ))}
            </PendingPanel>
          )}
        </div>
      )}

      {/* Quick links */}
      <div className="flex flex-wrap gap-2 pt-1">
        <QuickLink icon={<RefreshCw size={12} />} label="Matrix-import" onClick={() => onNavigate('beheer-roosters')} />
        <QuickLink icon={<Activity size={12} />} label="Activiteit" onClick={() => onNavigate('activiteit')} />
      </div>
    </section>
  );
}

// --- Subcomponents ---

function KpiCard({
  icon,
  label,
  value,
  subValue,
  dotColor,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  value: string | number;
  subValue?: string;
  dotColor: 'amber' | 'emerald' | 'rose' | 'oker' | 'slate';
  onClick?: () => void;
}) {
  const dotBg = {
    amber: 'bg-amber-500',
    emerald: 'bg-emerald-500',
    rose: 'bg-rose-500',
    oker: 'bg-oker-500',
    slate: 'bg-slate-300',
  }[dotColor];

  const Body = (
    <>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-slate-500">
          <span className="text-slate-400">{icon}</span>
          <span className="text-xs font-medium">{label}</span>
        </div>
        <span className={`h-1.5 w-1.5 rounded-full ${dotBg}`} />
      </div>
      <p className="mt-3 text-2xl font-semibold text-slate-900 tabular-nums tracking-tight">
        {value}
      </p>
      {subValue && <p className="mt-0.5 text-xs text-slate-500">{subValue}</p>}
      {onClick && (
        <div className="mt-2 flex items-center gap-1 text-xs font-medium text-slate-600 group-hover:text-slate-900 transition-colors">
          <span>Behandel</span>
          <ArrowUpRight size={12} />
        </div>
      )}
    </>
  );

  if (onClick) {
    return (
      <button
        onClick={onClick}
        className="group text-left rounded-lg border border-slate-200 bg-white p-4 hover:border-slate-300 hover:shadow-sm transition-all"
      >
        {Body}
      </button>
    );
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">{Body}</div>
  );
}

function PendingPanel({
  title,
  count,
  onSeeAll,
  children,
}: {
  title: string;
  count: number;
  onSeeAll: () => void;
  children: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-100">
        <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
        <span className="text-xs text-slate-500 tabular-nums">{count} totaal</span>
      </div>
      <div>{children}</div>
      <button
        onClick={onSeeAll}
        className="w-full px-4 py-2 text-xs font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-50 transition-colors border-t border-slate-100 flex items-center justify-center gap-1"
      >
        Bekijk alle
        <ArrowUpRight size={12} />
      </button>
    </div>
  );
}

function PendingRow({ primary, secondary }: { primary: string; secondary: string }) {
  return (
    <div className="flex items-start justify-between gap-3 px-4 py-2.5 border-b border-slate-100 last:border-0 hover:bg-slate-50 transition-colors">
      <div className="min-w-0">
        <p className="text-sm font-medium text-slate-900 truncate">{primary}</p>
        <p className="text-xs text-slate-500 mt-0.5 truncate">{secondary}</p>
      </div>
      <span className="shrink-0 inline-flex items-center gap-1 text-xs text-amber-700">
        <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
        Pending
      </span>
    </div>
  );
}

function QuickLink({ icon, label, onClick }: { icon: ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-600 hover:border-slate-300 hover:bg-slate-50 transition-all"
    >
      {icon}
      {label}
    </button>
  );
}
