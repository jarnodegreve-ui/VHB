import { Calendar, Clock, RotateCcw } from 'lucide-react';
import type { LeaveRequest, Shift, SwapRequest, User } from '../../types';
import { Modal } from '../../components/Modal';
import { ModalHeader } from '../../components/ui';
import { MicroLabel, microLabelClass } from '../../components/primitives';
import { cn } from '../../lib/ui';
import { isoDate } from '../../lib/availability';
import { verlofBalans } from '../../lib/leaveBalance';
import { LeaveBalanceCard } from '../../components/LeaveBalanceCard';
import { formatLeaveType, serviceNumberOf } from '../../lib/format';


const LEAVE_STATUS_LABELS: Record<LeaveRequest['status'], string> = {
  pending: 'In behandeling',
  approved: 'Goedgekeurd',
  rejected: 'Afgewezen',
  cancelled: 'Geannuleerd',
};
const LEAVE_STATUS_STYLES: Record<LeaveRequest['status'], string> = {
  pending: 'bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-400',
  approved: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400',
  rejected: 'bg-red-50 text-red-600 dark:bg-red-500/10 dark:text-red-400',
  cancelled: 'bg-surface-muted text-slate-500 dark:bg-slate-500/15 dark:text-slate-400',
};

const SWAP_STATUS_LABELS: Record<SwapRequest['status'], string> = {
  pending: 'In behandeling',
  accepted: 'Wacht op planner',
  approved: 'Goedgekeurd',
  rejected: 'Afgewezen',
  cancelled: 'Geannuleerd',
  completed: 'Voltooid',
};
const SWAP_STATUS_STYLES: Record<SwapRequest['status'], string> = {
  pending: 'bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-400',
  accepted: 'bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-300',
  approved: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400',
  rejected: 'bg-red-50 text-red-600 dark:bg-red-500/10 dark:text-red-400',
  cancelled: 'bg-surface-muted text-slate-500 dark:bg-slate-500/15 dark:text-slate-400',
  completed: 'bg-blue-50 text-blue-600 dark:bg-blue-500/10 dark:text-blue-400',
};

export function UserHistoryModal({
  user,
  shifts,
  leaveRequests,
  swaps,
  users,
  onClose,
}: {
  user: User | null;
  shifts: Shift[];
  leaveRequests: LeaveRequest[];
  swaps: SwapRequest[];
  users: User[];
  onClose: () => void;
}) {
  if (!user) return null;

  const today = isoDate(new Date()); // lokale datum (niet UTC → geen dag-verschuiving 's nachts)
  const currentYear = new Date().getFullYear();
  const yearStart = `${currentYear}-01-01`;
  const yearEnd = `${currentYear}-12-31`;

  // Diensten dit jaar
  const allShifts = shifts.filter((s) => s.driverId === user.id && s.date >= yearStart && s.date <= yearEnd);
  const upcomingShifts = allShifts.filter((s) => s.date >= today).sort((a, b) => a.date.localeCompare(b.date));
  const pastShifts = allShifts.filter((s) => s.date < today).sort((a, b) => b.date.localeCompare(a.date));

  // Verlof dit jaar
  const userLeave = leaveRequests
    .filter((l) => l.userId === user.id && l.startDate <= yearEnd && l.endDate >= yearStart)
    .sort((a, b) => b.startDate.localeCompare(a.startDate));
  const approvedLeaveCount = userLeave.filter((l) => l.status === 'approved').length;

  // Dienstruilen dit jaar (als aanvrager OF doelchauffeur)
  const userSwaps = swaps
    .filter((s) => (s.requesterId === user.id || s.targetDriverId === user.id) && (s.createdAt || '').slice(0, 10) >= yearStart)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const userName = (id?: string) => users.find((u) => u.id === id)?.name || 'Onbekend';

  return (
    <Modal open={!!user} onClose={onClose} maxWidth="2xl" className="flex flex-col !p-0">
      <ModalHeader
        eyebrow={`Historiek ${currentYear}`}
        title={user.name}
        description={<span className="capitalize">{user.role}{user.employeeId ? ` · #${user.employeeId}` : ''}</span>}
        onClose={onClose}
      />

      <div className="p-6 md:p-7 space-y-8 overflow-y-auto flex-1">
        {/* Verlofbalans */}
        <LeaveBalanceCard balance={verlofBalans(leaveRequests, user.id, currentYear, user.verlofBudget)} year={currentYear} />

        {/* Stats overview */}
        <div className="grid grid-cols-3 gap-3">
          <div className="surface-muted rounded-2xl p-4">
            <MicroLabel>Diensten</MicroLabel>
            <p className="mt-1 text-2xl font-mono font-semibold tabular-nums tracking-[-0.01em] text-slate-900">{allShifts.length}</p>
            <p className="text-2xs font-medium text-slate-400 mt-1">{upcomingShifts.length} komende</p>
          </div>
          <div className="surface-muted rounded-2xl p-4">
            <MicroLabel>Verlof</MicroLabel>
            <p className="mt-1 text-2xl font-mono font-semibold tabular-nums tracking-[-0.01em] text-slate-900">{approvedLeaveCount}</p>
            <p className="text-2xs font-medium text-slate-400 mt-1">goedgekeurd</p>
          </div>
          <div className="surface-muted rounded-2xl p-4">
            <MicroLabel>Dienstruilen</MicroLabel>
            <p className="mt-1 text-2xl font-mono font-semibold tabular-nums tracking-[-0.01em] text-slate-900">{userSwaps.length}</p>
            <p className="text-2xs font-medium text-slate-400 mt-1">totaal</p>
          </div>
        </div>

        {/* Verlof */}
        <section className="space-y-3">
          <h5 className={microLabelClass}>Verlof dit jaar</h5>
          {userLeave.length === 0 ? (
            <p className="text-sm text-slate-500">Geen verlof geregistreerd in {currentYear}.</p>
          ) : (
            <div className="space-y-2">
              {userLeave.map((l) => (
                <div key={l.id} className="flex items-center justify-between gap-3 p-3 rounded-2xl border border-slate-100 bg-white/55">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-800">
                      {l.startDate}{l.startDate !== l.endDate ? ` t/m ${l.endDate}` : ''}
                    </p>
                    <p className="text-xs font-medium text-slate-500">{formatLeaveType(l.type)}{l.comment ? ` — "${l.comment}"` : ''}</p>
                  </div>
                  <span className={cn('px-3 py-1 rounded-full text-2xs font-semibold uppercase tracking-[0.08em] shrink-0', LEAVE_STATUS_STYLES[l.status])}>
                    {LEAVE_STATUS_LABELS[l.status]}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Dienstruilen */}
        <section className="space-y-3">
          <h5 className={microLabelClass}>Dienstruilen dit jaar</h5>
          {userSwaps.length === 0 ? (
            <p className="text-sm text-slate-500">Geen dienstruilen in {currentYear}.</p>
          ) : (
            <div className="space-y-2">
              {userSwaps.map((s) => {
                const isRequester = s.requesterId === user.id;
                const counterpartId = isRequester ? s.targetDriverId : s.requesterId;
                // Een handmatige admin-wissel draagt dat in zijn reden ("Handmatige
                // wissel door … — Ziekte"): dat is precies wat je bij een discussie
                // over "wie moest hoe vaak inspringen" wil kunnen teruglezen.
                const handmatig = (s.reason || '').startsWith('Handmatige wissel door');
                return (
                  <div key={s.id} className="p-3 rounded-2xl border border-slate-100 bg-white/55 space-y-1.5">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0 flex items-center gap-2 text-sm">
                        <RotateCcw size={14} className="text-slate-400 shrink-0" />
                        <span className="font-medium text-slate-500">{isRequester ? 'Aan' : 'Van'}</span>
                        <span className="font-semibold text-slate-800 truncate">{userName(counterpartId)}</span>
                      </div>
                      <span className={cn('px-3 py-1 rounded-full text-2xs font-semibold uppercase tracking-[0.08em] shrink-0', SWAP_STATUS_STYLES[s.status])}>
                        {SWAP_STATUS_LABELS[s.status]}
                      </span>
                    </div>
                    <p className="text-xs font-medium text-slate-500 tabular-nums">
                      {s.shiftLine ? `Dienst ${s.shiftLine}` : 'Dienst onbekend'}
                      {s.shiftDate ? ` op ${s.shiftDate}` : ''}
                      {handmatig ? ' · handmatig overgezet' : ''}
                      {` · aangevraagd ${s.createdAt.slice(0, 10)}`}
                    </p>
                    {s.reason && (
                      <p className="text-xs font-normal italic text-slate-500 line-clamp-2">"{s.reason}"</p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* Komende diensten */}
        <section className="space-y-3">
          <h5 className={microLabelClass}>Komende diensten</h5>
          {upcomingShifts.length === 0 ? (
            <p className="text-sm text-slate-500">Geen geplande diensten.</p>
          ) : (
            <div className="space-y-2">
              {upcomingShifts.slice(0, 10).map((s) => (
                <div key={s.id} className="flex items-center justify-between gap-3 p-3 rounded-2xl border border-slate-100 bg-white/55">
                  <div className="flex items-center gap-3 min-w-0">
                    <Calendar size={14} className="text-slate-400 shrink-0" />
                    <span className="text-sm font-semibold text-slate-800">{s.date}</span>
                    <span className="text-xs font-medium text-slate-500">Dienst <span className="text-oker-700">{serviceNumberOf(s)}</span></span>
                  </div>
                  <span className="flex items-center gap-1 text-xs font-bold text-slate-500 shrink-0">
                    <Clock size={12} />
                    {s.startTime} - {s.endTime}
                  </span>
                </div>
              ))}
              {upcomingShifts.length > 10 && (
                <p className="text-xs text-slate-500 px-3">… en nog {upcomingShifts.length - 10} meer.</p>
              )}
            </div>
          )}
        </section>

        {/* Laatste 5 voorbije diensten */}
        {pastShifts.length > 0 && (
          <section className="space-y-3">
            <h5 className={microLabelClass}>Recent gewerkt</h5>
            <div className="space-y-2">
              {pastShifts.slice(0, 5).map((s) => (
                <div key={s.id} className="flex items-center justify-between gap-3 p-3 rounded-2xl border border-slate-100 bg-white/40 opacity-80">
                  <div className="flex items-center gap-3 min-w-0">
                    <Calendar size={14} className="text-slate-400 shrink-0" />
                    <span className="text-sm font-semibold text-slate-700">{s.date}</span>
                    <span className="text-xs font-medium text-slate-500">Dienst <span className="text-oker-700">{serviceNumberOf(s)}</span></span>
                  </div>
                  <span className="flex items-center gap-1 text-xs font-bold text-slate-500 shrink-0">
                    <Clock size={12} />
                    {s.startTime} - {s.endTime}
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </Modal>
  );
}
