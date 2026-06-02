import type { ReactNode } from 'react';
import { CalendarClock, Inbox, Repeat, FileWarning, Activity, ArrowUpRight, Sparkles } from 'lucide-react';
import type { LeaveRequest, PlanningMatrixImportHistory, SwapRequest, User } from '../types';
import { StatTile, type TilePalette } from './DashboardView';

/**
 * Planner/admin dashboard widgets — Bento premium-stijl.
 * Hergebruikt StatTile uit DashboardView voor consistentie.
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

  const importColor: TilePalette = lastImportHadIssues ? 'rose' : 'emerald';

  return (
    <section className="space-y-4">
      <div className="flex items-baseline justify-between px-1">
        <h2 className="text-2xl font-black tracking-[-0.025em] text-slate-900">Overzicht</h2>
        <p className="text-xs font-semibold text-slate-500">
          {new Date().toLocaleDateString('nl-BE', { weekday: 'long', day: 'numeric', month: 'long' })}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile
          icon={<Inbox size={18} />}
          color="oker"
          label="Verlofaanvragen"
          value={pendingLeave.length}
          subValue={pendingLeave.length > 0 ? 'Wachten op besluit' : 'Up to date'}
          onClick={pendingLeave.length > 0 ? () => onNavigate('verlof-beheer') : undefined}
        />
        <StatTile
          icon={<Repeat size={18} />}
          color="blue"
          label="Dienstruilen"
          value={pendingSwaps.length}
          subValue={pendingSwaps.length > 0 ? 'Wachten op besluit' : 'Up to date'}
          onClick={pendingSwaps.length > 0 ? () => onNavigate('ruil-verzoeken') : undefined}
        />
        <StatTile
          icon={<CalendarClock size={18} />}
          color={importColor}
          label="Laatste import"
          value={daysSinceImport === null ? '—' : daysSinceImport === 0 ? 'Vandaag' : `${daysSinceImport}d`}
          subValue={lastImport ? `${lastImport.importedDays} dagen verwerkt` : 'Nog geen import'}
          onClick={() => onNavigate('beheer-roosters')}
        />
        <StatTile
          icon={<FileWarning size={18} />}
          color="rose"
          label="Omleidingen"
          value={diversionsCount}
          subValue="Actief in netwerk"
          onClick={() => onNavigate('beheer-omleidingen')}
        />
      </div>

      {(previewLeave.length > 0 || previewSwaps.length > 0) && (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {previewLeave.length > 0 && (
            <BentoListPanel
              icon={<Inbox size={16} />}
              iconBg="bg-oker-500"
              title="Wachtende verlofaanvragen"
              count={pendingLeave.length}
              accent="oker"
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
            </BentoListPanel>
          )}

          {previewSwaps.length > 0 && (
            <BentoListPanel
              icon={<Repeat size={16} />}
              iconBg="bg-blue-500"
              title="Wachtende dienstruilen"
              count={pendingSwaps.length}
              accent="blue"
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
            </BentoListPanel>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <QuickActionTile
          icon={<Sparkles size={18} />}
          label="Matrix-import"
          subLabel="Nieuwe planning uploaden"
          onClick={() => onNavigate('beheer-roosters')}
        />
        <QuickActionTile
          icon={<Activity size={18} />}
          label="Activiteit"
          subLabel="Recente acties bekijken"
          onClick={() => onNavigate('activiteit')}
        />
      </div>
    </section>
  );
}

// === Subcomponents ===

const PANEL_PALETTE = {
  oker: {
    bg: 'linear-gradient(135deg, #fffbeb 0%, #fef3c7 100%)',
    shadow:
      'inset 0 1px 0 rgba(255, 255, 255, 0.8), 0 10px 28px rgba(245, 158, 11, 0.10), 0 2px 8px rgba(245, 158, 11, 0.06)',
    sub: 'text-oker-700/70',
  },
  blue: {
    bg: 'linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%)',
    shadow:
      'inset 0 1px 0 rgba(255, 255, 255, 0.8), 0 10px 28px rgba(59, 130, 246, 0.10), 0 2px 8px rgba(59, 130, 246, 0.06)',
    sub: 'text-blue-700/70',
  },
} as const;

function BentoListPanel({
  icon,
  iconBg,
  title,
  count,
  accent,
  onSeeAll,
  children,
}: {
  icon: ReactNode;
  iconBg: string;
  title: string;
  count: number;
  accent: keyof typeof PANEL_PALETTE;
  onSeeAll: () => void;
  children: ReactNode;
}) {
  const p = PANEL_PALETTE[accent];
  return (
    <div
      className="rounded-[28px] p-5 relative overflow-hidden"
      style={{ background: p.bg, boxShadow: p.shadow }}
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2.5">
          <div className={`inline-flex items-center justify-center w-8 h-8 rounded-xl ${iconBg} text-white shadow-md shadow-black/10`}>
            {icon}
          </div>
          <h3 className="text-sm font-black text-slate-900 tracking-tight">{title}</h3>
        </div>
        <span className={`text-[10px] font-bold uppercase tracking-widest ${p.sub}`}>
          {count} totaal
        </span>
      </div>
      <div className="space-y-1.5">{children}</div>
      <button
        onClick={onSeeAll}
        className="mt-3 w-full inline-flex items-center justify-center gap-1 rounded-2xl bg-white/60 ring-1 ring-white/80 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-slate-700 hover:bg-white hover:shadow-sm transition-all"
      >
        Bekijk alle
        <ArrowUpRight size={12} />
      </button>
    </div>
  );
}

function PendingRow({ primary, secondary }: { primary: string; secondary: string }) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-2xl bg-white/65 ring-1 ring-white/80 px-3 py-2 hover:bg-white hover:shadow-sm transition-all">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-black text-slate-900 truncate">{primary}</p>
        <p className="text-xs font-semibold text-slate-600/80 mt-0.5 truncate">{secondary}</p>
      </div>
    </div>
  );
}

function QuickActionTile({
  icon,
  label,
  subLabel,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  subLabel: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="group text-left rounded-[24px] p-4 relative overflow-hidden hover:scale-[1.01] active:scale-[0.99] transition-transform"
      style={{
        background: 'linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)',
        boxShadow:
          'inset 0 1px 0 rgba(255, 255, 255, 0.9), 0 8px 24px rgba(15, 23, 42, 0.05), 0 2px 6px rgba(15, 23, 42, 0.03)',
      }}
    >
      <div className="flex items-center gap-3">
        <div className="inline-flex items-center justify-center w-10 h-10 rounded-2xl bg-slate-900 text-white shadow-md shadow-black/10">
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-black text-slate-900 tracking-tight">{label}</p>
          <p className="text-xs font-semibold text-slate-500 mt-0.5">{subLabel}</p>
        </div>
        <ArrowUpRight size={16} className="text-slate-400 group-hover:text-slate-900 transition-colors shrink-0" />
      </div>
    </button>
  );
}
