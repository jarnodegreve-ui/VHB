import type { ReactNode } from 'react';
import { motion } from 'motion/react';
import { CalendarClock, Inbox, RefreshCw, Repeat, FileWarning, Activity } from 'lucide-react';
import type { LeaveRequest, PlanningMatrixImportHistory, SwapRequest, User } from '../types';

/**
 * Planner/admin dashboard widgets. Toont KPI-tegels en pending-lijst
 * boven het standaard chauffeur-dashboard zodat planners in één blik
 * zien wat hun aandacht vereist.
 *
 * - Open verlof: aantal pending leave requests
 * - Open ruilen: aantal pending swap requests
 * - Laatste matrix-import: hoe oud + had het issues
 * - Klikbare quick-links naar verlofbeheer / ruil-verzoeken
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
    <motion.section
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-5"
    >
      {/* Eyebrow */}
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">
          Planner-overzicht
        </p>
        <p className="text-[10px] font-medium text-slate-400">
          {new Date().toLocaleDateString('nl-BE', { weekday: 'long', day: 'numeric', month: 'long' })}
        </p>
      </div>

      {/* KPI grid */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard
          icon={<Inbox size={18} />}
          label="Open verlof"
          value={pendingLeave.length}
          accent={pendingLeave.length > 0 ? 'amber' : 'emerald'}
          onClick={pendingLeave.length > 0 ? () => onNavigate('verlof-beheer') : undefined}
          actionLabel={pendingLeave.length > 0 ? 'Behandel →' : 'Alles afgehandeld'}
        />
        <KpiCard
          icon={<Repeat size={18} />}
          label="Open ruilen"
          value={pendingSwaps.length}
          accent={pendingSwaps.length > 0 ? 'amber' : 'emerald'}
          onClick={pendingSwaps.length > 0 ? () => onNavigate('ruil-verzoeken') : undefined}
          actionLabel={pendingSwaps.length > 0 ? 'Behandel →' : 'Alles afgehandeld'}
        />
        <KpiCard
          icon={<CalendarClock size={18} />}
          label="Laatste import"
          value={daysSinceImport === null ? '—' : daysSinceImport === 0 ? 'Vandaag' : `${daysSinceImport}d`}
          accent={lastImportHadIssues ? 'rose' : daysSinceImport && daysSinceImport > 14 ? 'amber' : 'slate'}
          onClick={() => onNavigate('beheer-roosters')}
          actionLabel={lastImportHadIssues ? 'Issues bekijken →' : 'Importeer →'}
          subValue={lastImport ? `${lastImport.importedDays} dagen verwerkt` : 'Nog geen import'}
        />
        <KpiCard
          icon={<FileWarning size={18} />}
          label="Omleidingen"
          value={diversionsCount}
          accent={diversionsCount > 0 ? 'oker' : 'slate'}
          onClick={() => onNavigate('beheer-omleidingen')}
          actionLabel="Beheer →"
        />
      </div>

      {/* Pending-overzicht: alleen tonen als er iets is */}
      {(previewLeave.length > 0 || previewSwaps.length > 0) && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {previewLeave.length > 0 && (
            <PendingPanel
              title="Wachtende verlofaanvragen"
              icon={<Inbox size={16} />}
              countLabel={`${pendingLeave.length} totaal`}
              onSeeAll={() => onNavigate('verlof-beheer')}
            >
              {previewLeave.map((req) => (
                <div key={req.id} className="flex items-start justify-between gap-3 py-2 border-b border-white/60 last:border-0">
                  <div className="min-w-0">
                    <p className="text-sm font-black text-slate-900 truncate">{userNameById(req.userId)}</p>
                    <p className="text-xs font-medium text-slate-500 mt-0.5">
                      {req.startDate}
                      {req.startDate !== req.endDate ? ` → ${req.endDate}` : ''} · {req.type}
                    </p>
                  </div>
                  <span className="shrink-0 rounded-full bg-amber-100 text-amber-700 text-[10px] font-black uppercase tracking-widest px-2 py-1">
                    Pending
                  </span>
                </div>
              ))}
            </PendingPanel>
          )}

          {previewSwaps.length > 0 && (
            <PendingPanel
              title="Wachtende dienstruilen"
              icon={<Repeat size={16} />}
              countLabel={`${pendingSwaps.length} totaal`}
              onSeeAll={() => onNavigate('ruil-verzoeken')}
            >
              {previewSwaps.map((swap) => (
                <div key={swap.id} className="flex items-start justify-between gap-3 py-2 border-b border-white/60 last:border-0">
                  <div className="min-w-0">
                    <p className="text-sm font-black text-slate-900 truncate">
                      {userNameById(swap.requesterId)}
                      {swap.targetDriverId && (
                        <>
                          <span className="text-slate-400 font-medium"> → </span>
                          {userNameById(swap.targetDriverId)}
                        </>
                      )}
                    </p>
                    <p className="text-xs font-medium text-slate-500 mt-0.5">
                      {swap.reason ? swap.reason : 'Geen reden opgegeven'}
                    </p>
                  </div>
                  <span className="shrink-0 rounded-full bg-amber-100 text-amber-700 text-[10px] font-black uppercase tracking-widest px-2 py-1">
                    Pending
                  </span>
                </div>
              ))}
            </PendingPanel>
          )}
        </div>
      )}

      {/* Quick-link bar */}
      <div className="flex flex-wrap gap-2">
        <QuickLink icon={<RefreshCw size={14} />} label="Matrix-import" onClick={() => onNavigate('beheer-roosters')} />
        <QuickLink icon={<Activity size={14} />} label="Activiteit" onClick={() => onNavigate('activiteit')} />
      </div>
    </motion.section>
  );
}

// --- Subcomponents ---

function KpiCard({
  icon,
  label,
  value,
  subValue,
  accent,
  onClick,
  actionLabel,
}: {
  icon: ReactNode;
  label: string;
  value: string | number;
  subValue?: string;
  accent: 'amber' | 'emerald' | 'rose' | 'oker' | 'slate';
  onClick?: () => void;
  actionLabel?: string;
}) {
  const accentClasses = {
    amber: 'border-amber-200 bg-amber-50/70 text-amber-700',
    emerald: 'border-emerald-200 bg-emerald-50/70 text-emerald-700',
    rose: 'border-rose-200 bg-rose-50/70 text-rose-700',
    oker: 'border-oker-200 bg-oker-50/70 text-oker-700',
    slate: 'border-slate-200 bg-slate-50/70 text-slate-600',
  }[accent];

  const Body = (
    <>
      <div className="flex items-center justify-between">
        <div className={`rounded-xl p-1.5 ${accentClasses}`}>{icon}</div>
        {actionLabel && (
          <span className="text-[9px] font-black uppercase tracking-widest text-slate-400">
            {actionLabel}
          </span>
        )}
      </div>
      <p className="mt-3 text-[10px] font-black uppercase tracking-widest text-slate-400">{label}</p>
      <p className="mt-0.5 text-2xl font-black text-slate-900 tabular-nums">{value}</p>
      {subValue && <p className="mt-0.5 text-[11px] font-medium text-slate-500">{subValue}</p>}
    </>
  );

  if (onClick) {
    return (
      <button
        onClick={onClick}
        className="surface-card text-left rounded-2xl p-4 hover:shadow-md transition-all active:scale-[0.98] cursor-pointer"
      >
        {Body}
      </button>
    );
  }

  return <div className="surface-card rounded-2xl p-4">{Body}</div>;
}

function PendingPanel({
  title,
  icon,
  countLabel,
  onSeeAll,
  children,
}: {
  title: string;
  icon: ReactNode;
  countLabel: string;
  onSeeAll: () => void;
  children: ReactNode;
}) {
  return (
    <div className="surface-card rounded-[24px] p-5">
      <div className="flex items-center justify-between mb-3 pb-2 border-b border-white/60">
        <div className="flex items-center gap-2">
          <div className="rounded-lg bg-slate-100 p-1.5 text-slate-600">{icon}</div>
          <h3 className="text-sm font-black tracking-tight text-slate-900">{title}</h3>
        </div>
        <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
          {countLabel}
        </span>
      </div>
      <div>{children}</div>
      <button
        onClick={onSeeAll}
        className="mt-3 w-full text-center text-[11px] font-black uppercase tracking-widest text-slate-500 hover:text-slate-800 py-1.5 transition-colors"
      >
        Bekijk alle →
      </button>
    </div>
  );
}

function QuickLink({ icon, label, onClick }: { icon: ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-2 rounded-full border border-white/70 bg-white/60 px-3 py-1.5 text-[11px] font-black uppercase tracking-widest text-slate-600 hover:bg-white hover:shadow-sm transition-all active:scale-95"
    >
      {icon}
      {label}
    </button>
  );
}
