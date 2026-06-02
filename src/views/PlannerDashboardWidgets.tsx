import type { ReactNode } from 'react';
import { CalendarClock, Inbox, RefreshCw, Repeat, FileWarning, Activity, ArrowUpRight, Sparkles } from 'lucide-react';
import type { LeaveRequest, PlanningMatrixImportHistory, SwapRequest, User } from '../types';

/**
 * Planner/admin dashboard widgets — Bento-stijl (Apple iOS Settings,
 * Apple Intelligence, Notion homepage tiles).
 *
 * - Grote gekleurde tegels, elk eigen pastel-tint
 * - Substantial radius (rounded-3xl) + zachte schaduw
 * - Icoon-blokje + groot getal + label
 * - Verschillende tile-groottes (sommige span 2 cols)
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
      {/* Eyebrow */}
      <div className="flex items-baseline justify-between px-1">
        <h2 className="text-2xl font-black tracking-tight text-slate-900">Overzicht</h2>
        <p className="text-xs font-medium text-slate-500">
          {new Date().toLocaleDateString('nl-BE', { weekday: 'long', day: 'numeric', month: 'long' })}
        </p>
      </div>

      {/* Bento KPI grid: 4 tegels op desktop, 2x2 op mobile */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <BentoTile
          color="amber"
          icon={<Inbox size={20} />}
          label="Verlofaanvragen"
          value={pendingLeave.length}
          actionLabel={pendingLeave.length > 0 ? 'Behandelen' : 'Up to date'}
          onClick={pendingLeave.length > 0 ? () => onNavigate('verlof-beheer') : undefined}
        />
        <BentoTile
          color="blue"
          icon={<Repeat size={20} />}
          label="Dienstruilen"
          value={pendingSwaps.length}
          actionLabel={pendingSwaps.length > 0 ? 'Behandelen' : 'Up to date'}
          onClick={pendingSwaps.length > 0 ? () => onNavigate('ruil-verzoeken') : undefined}
        />
        <BentoTile
          color={lastImportHadIssues ? 'rose' : 'emerald'}
          icon={<CalendarClock size={20} />}
          label="Laatste import"
          value={
            daysSinceImport === null
              ? '—'
              : daysSinceImport === 0
              ? 'Vandaag'
              : `${daysSinceImport}d`
          }
          subValue={lastImport ? `${lastImport.importedDays} dagen verwerkt` : 'Nog geen import'}
          actionLabel={lastImportHadIssues ? 'Issues' : 'Importeer'}
          onClick={() => onNavigate('beheer-roosters')}
        />
        <BentoTile
          color="oker"
          icon={<FileWarning size={20} />}
          label="Omleidingen"
          value={diversionsCount}
          actionLabel="Beheer"
          onClick={() => onNavigate('beheer-omleidingen')}
        />
      </div>

      {/* Pending-tegels: groter, spannend over volledige breedte */}
      {(previewLeave.length > 0 || previewSwaps.length > 0) && (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {previewLeave.length > 0 && (
            <BentoPanel
              color="amber"
              icon={<Inbox size={18} />}
              title="Wachtende verlofaanvragen"
              countLabel={`${pendingLeave.length} totaal`}
              onSeeAll={() => onNavigate('verlof-beheer')}
            >
              {previewLeave.map((req) => (
                <div key={req.id}>
                  <BentoRow
                    primary={userNameById(req.userId)}
                    secondary={`${req.startDate}${
                      req.startDate !== req.endDate ? ` → ${req.endDate}` : ''
                    } · ${req.type}`}
                  />
                </div>
              ))}
            </BentoPanel>
          )}

          {previewSwaps.length > 0 && (
            <BentoPanel
              color="blue"
              icon={<Repeat size={18} />}
              title="Wachtende dienstruilen"
              countLabel={`${pendingSwaps.length} totaal`}
              onSeeAll={() => onNavigate('ruil-verzoeken')}
            >
              {previewSwaps.map((swap) => (
                <div key={swap.id}>
                  <BentoRow
                    primary={
                      swap.targetDriverId
                        ? `${userNameById(swap.requesterId)} → ${userNameById(swap.targetDriverId)}`
                        : userNameById(swap.requesterId)
                    }
                    secondary={swap.reason || 'Geen reden opgegeven'}
                  />
                </div>
              ))}
            </BentoPanel>
          )}
        </div>
      )}

      {/* Quick-actions als tegels */}
      <div className="grid grid-cols-2 gap-3">
        <BentoActionTile
          icon={<Sparkles size={18} />}
          label="Matrix-import"
          subLabel="Nieuwe planning uploaden"
          onClick={() => onNavigate('beheer-roosters')}
        />
        <BentoActionTile
          icon={<Activity size={18} />}
          label="Activiteit"
          subLabel="Recente acties bekijken"
          onClick={() => onNavigate('activiteit')}
        />
      </div>
    </section>
  );
}

// --- Bento subcomponents ---

const TILE_COLORS = {
  amber: {
    bg: 'bg-gradient-to-br from-amber-50 via-amber-100/50 to-amber-200/30',
    icon: 'bg-amber-500 text-white',
    text: 'text-amber-900',
    sub: 'text-amber-700/70',
    ring: 'ring-amber-200/50',
  },
  blue: {
    bg: 'bg-gradient-to-br from-blue-50 via-blue-100/50 to-blue-200/30',
    icon: 'bg-blue-500 text-white',
    text: 'text-blue-900',
    sub: 'text-blue-700/70',
    ring: 'ring-blue-200/50',
  },
  emerald: {
    bg: 'bg-gradient-to-br from-emerald-50 via-emerald-100/50 to-emerald-200/30',
    icon: 'bg-emerald-500 text-white',
    text: 'text-emerald-900',
    sub: 'text-emerald-700/70',
    ring: 'ring-emerald-200/50',
  },
  rose: {
    bg: 'bg-gradient-to-br from-rose-50 via-rose-100/50 to-rose-200/30',
    icon: 'bg-rose-500 text-white',
    text: 'text-rose-900',
    sub: 'text-rose-700/70',
    ring: 'ring-rose-200/50',
  },
  oker: {
    bg: 'bg-gradient-to-br from-oker-50 via-oker-100/60 to-oker-200/40',
    icon: 'bg-oker-500 text-white',
    text: 'text-oker-900',
    sub: 'text-oker-700/70',
    ring: 'ring-oker-200/60',
  },
  slate: {
    bg: 'bg-gradient-to-br from-slate-50 via-slate-100/50 to-slate-200/30',
    icon: 'bg-slate-500 text-white',
    text: 'text-slate-900',
    sub: 'text-slate-600',
    ring: 'ring-slate-200/50',
  },
} as const;

type TileColor = keyof typeof TILE_COLORS;

function BentoTile({
  color,
  icon,
  label,
  value,
  subValue,
  actionLabel,
  onClick,
}: {
  color: TileColor;
  icon: ReactNode;
  label: string;
  value: string | number;
  subValue?: string;
  actionLabel?: string;
  onClick?: () => void;
}) {
  const c = TILE_COLORS[color];

  const Body = (
    <>
      <div className={`inline-flex items-center justify-center w-9 h-9 rounded-xl ${c.icon} shadow-sm`}>
        {icon}
      </div>
      <p className={`mt-3 text-[10px] font-black uppercase tracking-widest ${c.sub}`}>{label}</p>
      <p className={`mt-0.5 text-3xl font-black tabular-nums tracking-tight ${c.text}`}>{value}</p>
      {subValue && <p className={`mt-1 text-xs font-medium ${c.sub}`}>{subValue}</p>}
      {actionLabel && (
        <div className={`mt-2 flex items-center gap-1 text-xs font-bold ${c.text} opacity-80`}>
          <span>{actionLabel}</span>
          {onClick && <ArrowUpRight size={12} />}
        </div>
      )}
    </>
  );

  if (onClick) {
    return (
      <button
        onClick={onClick}
        className={`group text-left rounded-3xl p-4 ring-1 ${c.ring} ${c.bg} hover:shadow-md hover:scale-[1.01] transition-all active:scale-[0.99]`}
      >
        {Body}
      </button>
    );
  }
  return <div className={`rounded-3xl p-4 ring-1 ${c.ring} ${c.bg}`}>{Body}</div>;
}

function BentoPanel({
  color,
  icon,
  title,
  countLabel,
  onSeeAll,
  children,
}: {
  color: TileColor;
  icon: ReactNode;
  title: string;
  countLabel: string;
  onSeeAll: () => void;
  children: ReactNode;
}) {
  const c = TILE_COLORS[color];
  return (
    <div className={`rounded-3xl ring-1 ${c.ring} ${c.bg} overflow-hidden`}>
      <div className="flex items-center justify-between gap-3 p-4 pb-2">
        <div className="flex items-center gap-2.5">
          <div className={`inline-flex items-center justify-center w-8 h-8 rounded-xl ${c.icon} shadow-sm`}>
            {icon}
          </div>
          <h3 className={`text-sm font-black ${c.text}`}>{title}</h3>
        </div>
        <span className={`text-[10px] font-bold uppercase tracking-widest ${c.sub}`}>
          {countLabel}
        </span>
      </div>
      <div className="px-4 pb-2">{children}</div>
      <button
        onClick={onSeeAll}
        className={`w-full px-4 py-2.5 text-xs font-black uppercase tracking-widest ${c.text} opacity-70 hover:opacity-100 hover:bg-white/40 transition-all flex items-center justify-center gap-1`}
      >
        Bekijk alle
        <ArrowUpRight size={12} />
      </button>
    </div>
  );
}

function BentoRow({ primary, secondary }: { primary: string; secondary: string }) {
  return (
    <div className="flex items-start justify-between gap-3 py-2 border-b border-white/40 last:border-0">
      <div className="min-w-0">
        <p className="text-sm font-black text-slate-900 truncate">{primary}</p>
        <p className="text-xs font-medium text-slate-600/70 mt-0.5 truncate">{secondary}</p>
      </div>
    </div>
  );
}

function BentoActionTile({
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
      className="group text-left rounded-3xl p-4 ring-1 ring-slate-200/60 bg-gradient-to-br from-white to-slate-50/50 hover:shadow-md hover:scale-[1.01] transition-all active:scale-[0.99]"
    >
      <div className="flex items-center gap-3">
        <div className="inline-flex items-center justify-center w-10 h-10 rounded-2xl bg-slate-900 text-white shadow-sm">
          {icon}
        </div>
        <div className="min-w-0">
          <p className="text-sm font-black text-slate-900">{label}</p>
          <p className="text-xs font-medium text-slate-500 mt-0.5">{subLabel}</p>
        </div>
        <ArrowUpRight size={16} className="ml-auto text-slate-400 group-hover:text-slate-900 transition-colors" />
      </div>
    </button>
  );
}
