import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'motion/react';
import { AlertTriangle, Check, ChevronLeft, ChevronRight, ChevronRight as ChevronRightSmall, History, Plus, User as UserIcon, X } from 'lucide-react';
import type { LeaveRequest, Shift, User } from '../types';
import { cn, notify } from '../lib/ui';
import { PageHeader, PageShell } from '../components/ui';
import { Button, MicroLabel, StatusBadge, Badge } from '../components/primitives';
import { SlideOver } from '../components/SlideOver';
import { verlofBalans } from '../lib/leaveBalance';
import { LeaveBalanceCard } from '../components/LeaveBalanceCard';
import { leaveIdsWithConflict, shiftsConflictingWithLeave } from '../lib/conflicts';
import { isoDate } from '../lib/availability';
import { EntityHistoryModal } from '../components/EntityHistoryModal';

const LEAVE_TYPE_LABELS: Record<string, string> = {
  betaald_verlof: 'Betaald verlof',
  klein_verlet: 'Klein verlet',
};
const formatLeaveType = (type: string) => LEAVE_TYPE_LABELS[type] ?? type;

export function LeaveManagementView({ user, leaveRequests, users, onSave, lastSeenDecisionAt, onMarkDecisionsSeen, shifts = [] }: { user: User; leaveRequests: LeaveRequest[]; users: User[]; onSave: (l: LeaveRequest[]) => void; lastSeenDecisionAt?: string | null; onMarkDecisionsSeen?: () => void; shifts?: Shift[] }) {
  const [showRequestModal, setShowRequestModal] = useState(false);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [formData, setFormData] = useState({ startDate: '', endDate: '', type: 'betaald_verlof' as LeaveRequest['type'], comment: '' });
  const [viewMonth, setViewMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });

  const goToPrevMonth = () => setViewMonth((d) => new Date(d.getFullYear(), d.getMonth() - 1, 1));
  const goToNextMonth = () => setViewMonth((d) => new Date(d.getFullYear(), d.getMonth() + 1, 1));
  const goToCurrentMonth = () => {
    const now = new Date();
    setViewMonth(new Date(now.getFullYear(), now.getMonth(), 1));
  };
  const isCurrentMonth = (() => {
    const now = new Date();
    return viewMonth.getFullYear() === now.getFullYear() && viewMonth.getMonth() === now.getMonth();
  })();

  const isPlanner = user.role === 'planner' || user.role === 'admin';
  // Lokale dag i.p.v. UTC (toISOString gaf 's nachts in BE de vorige dag).
  const today = isoDate(new Date());
  const myRequests = leaveRequests.filter((r) => r.userId === user.id);
  const myPending = myRequests
    .filter((r) => r.status === 'pending')
    .sort((a, b) => a.startDate.localeCompare(b.startDate));
  const myUpcoming = myRequests
    .filter((r) => r.status === 'approved' && r.endDate >= today)
    .sort((a, b) => a.startDate.localeCompare(b.startDate));
  const myHistory = myRequests
    .filter((r) => r.status === 'rejected' || r.status === 'cancelled' || (r.status === 'approved' && r.endDate < today))
    .sort((a, b) => b.startDate.localeCompare(a.startDate));

  const handleRequestLeave = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.startDate || !formData.endDate) {
      return;
    }
    if (formData.startDate < today) {
      notify('Je kan geen verlof aanvragen in het verleden.', 'error');
      return;
    }
    onSave([...leaveRequests, { id: Date.now().toString(), userId: user.id, ...formData, status: 'pending', createdAt: new Date().toISOString() }]);
    setShowRequestModal(false);
    setFormData({ startDate: '', endDate: '', type: 'betaald_verlof', comment: '' });
  };

  // === Live preview van impact van de nieuwe aanvraag ===
  // - Hoeveel dagen vraagt-ie aan?
  // - Gaat hij over budget?
  // - Heeft hij al diensten ingepland in die periode? (conflict)
  const requestPreview = useMemo(() => {
    if (!formData.startDate || !formData.endDate) return null;
    const requestedYear = parseInt(formData.startDate.slice(0, 4), 10);
    const startD = new Date(`${formData.startDate}T00:00:00`);
    const endD = new Date(`${formData.endDate}T00:00:00`);
    const ms = endD.getTime() - startD.getTime();
    if (Number.isNaN(ms) || ms < 0) return null;
    const requestedDays = Math.floor(ms / (1000 * 60 * 60 * 24)) + 1;

    const currentBalance = verlofBalans(leaveRequests, user.id, requestedYear, user.verlofBudget);
    const wouldExceed =
      formData.type === 'betaald_verlof' &&
      currentBalance.betaaldGebruikt + requestedDays > currentBalance.betaaldBudget;
    const remainingAfter = currentBalance.betaaldBudget - currentBalance.betaaldGebruikt - requestedDays;

    const conflictingShifts = shiftsConflictingWithLeave(shifts, {
      id: '__draft__',
      userId: user.id,
      startDate: formData.startDate,
      endDate: formData.endDate,
      type: formData.type,
      status: 'pending',
      createdAt: new Date().toISOString(),
    });

    return {
      requestedDays,
      wouldExceed,
      remainingAfter,
      budget: currentBalance.betaaldBudget,
      gebruikt: currentBalance.betaaldGebruikt,
      conflictingShifts,
    };
  }, [formData.startDate, formData.endDate, formData.type, leaveRequests, shifts, user.id, user.verlofBudget]);

  const handleCalendarDateClick = (dateStr: string) => {
    if (!showRequestModal) {
      setSelectedDate((current) => (current === dateStr ? null : dateStr));
      return;
    }

    setFormData((current) => {
      // Geen actief bereik (nog niets, of allebei al gevuld) → start een nieuw bereik.
      if (!current.startDate || current.endDate) {
        return { ...current, startDate: dateStr, endDate: '' };
      }

      // Tweede klik vóór de startdatum → herstart vanaf deze datum als nieuwe start.
      if (dateStr < current.startDate) {
        return { ...current, startDate: dateStr, endDate: '' };
      }

      // Geldige tweede klik (zelfde dag = één-dag verlof, latere dag = einde van bereik).
      return { ...current, endDate: dateStr };
    });
  };

  const isDateWithinDraftRange = (dateStr: string) => {
    if (!showRequestModal || !formData.startDate) return false;
    if (!formData.endDate) return dateStr === formData.startDate;
    return dateStr >= formData.startDate && dateStr <= formData.endDate;
  };

  const isDraftBoundary = (dateStr: string) =>
    showRequestModal && (dateStr === formData.startDate || dateStr === formData.endDate);

  const handleStatusUpdate = (requestId: string, newStatus: LeaveRequest['status']) => {
    const decidedAt = new Date().toISOString();
    onSave(leaveRequests.map((r) => (r.id === requestId ? { ...r, status: newStatus, decidedAt } : r)));
  };

  // Bulk-selectie voor planner-goedkeuring van meerdere pending aanvragen.
  const [selectedPendingIds, setSelectedPendingIds] = useState<Set<string>>(new Set());
  const [historyLeave, setHistoryLeave] = useState<LeaveRequest | null>(null);
  // Beoordeling in een side panel: alle context (saldo, conflicten,
  // toelichting) + beslis-acties zonder paginawissel.
  const [reviewLeave, setReviewLeave] = useState<LeaveRequest | null>(null);
  const togglePendingSelection = (id: string) => {
    setSelectedPendingIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const handleBulkApprove = () => {
    if (selectedPendingIds.size === 0) return;
    const decidedAt = new Date().toISOString();
    const updated = leaveRequests.map((r) =>
      selectedPendingIds.has(r.id) && r.status === 'pending'
        ? { ...r, status: 'approved' as const, decidedAt }
        : r,
    );
    onSave(updated);
    setSelectedPendingIds(new Set());
  };

  const handleBulkReject = () => {
    if (selectedPendingIds.size === 0) return;
    if (!window.confirm(`${selectedPendingIds.size} aanvragen weigeren? Dit kan niet ongedaan gemaakt worden.`)) return;
    const decidedAt = new Date().toISOString();
    const updated = leaveRequests.map((r) =>
      selectedPendingIds.has(r.id) && r.status === 'pending'
        ? { ...r, status: 'rejected' as const, decidedAt }
        : r,
    );
    onSave(updated);
    setSelectedPendingIds(new Set());
  };

  const handleCancel = (requestId: string) => {
    const target = leaveRequests.find((r) => r.id === requestId);
    if (!target) return;
    const cancelledByOther = target.userId !== user.id;
    const message = cancelledByOther
      ? 'Deze goedgekeurde verlofaanvraag annuleren? De aanvrager ziet dit terug onder zijn historiek.'
      : 'Eigen verlofaanvraag annuleren?';
    if (!window.confirm(message)) return;
    const update: Partial<LeaveRequest> = { status: 'cancelled' };
    if (cancelledByOther) update.decidedAt = new Date().toISOString();
    onSave(leaveRequests.map((r) => (r.id === requestId ? { ...r, ...update } : r)));
  };

  // Eigen nog-niet-besliste aanvraag intrekken (vergissing rechtzetten).
  // Mag alleen voor 'pending' — de aanvraag wordt volledig verwijderd, niet
  // op 'cancelled' gezet. Goedgekeurd verlof blijft via handleCancel
  // (planner/admin) zodat de rij-/rusttijden-check intact blijft.
  const handleWithdraw = (requestId: string) => {
    const target = leaveRequests.find((r) => r.id === requestId);
    if (!target || target.status !== 'pending') return;
    if (!window.confirm('Deze openstaande aanvraag intrekken? Ze wordt volledig verwijderd.')) return;
    onSave(leaveRequests.filter((r) => r.id !== requestId));
    notify('Aanvraag ingetrokken.', 'success');
  };

  const initialLastSeen = useRef(lastSeenDecisionAt ?? null).current;
  const isNewlyDecided = (req: LeaveRequest) =>
    req.userId === user.id &&
    !!req.decidedAt &&
    req.status !== 'pending' &&
    (!initialLastSeen || req.decidedAt > initialLastSeen);

  useEffect(() => {
    if (!onMarkDecisionsSeen) return;
    const hasUnseen = myRequests.some(
      (r) => r.decidedAt && r.status !== 'pending' && (!initialLastSeen || r.decidedAt > initialLastSeen),
    );
    if (hasUnseen) onMarkDecisionsSeen();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const getRequestsForDate = (dateStr: string) =>
    leaveRequests.filter((r) => {
      const start = new Date(r.startDate);
      const end = new Date(r.endDate);
      const current = new Date(dateStr);
      if (r.status !== 'approved' || current < start || current > end) return false;
      const requester = users.find((u) => u.id === r.userId);
      const isBeheerder = requester?.name.toLowerCase() === 'beheerder';
      const isMe = r.userId === user.id;
      if (isBeheerder && !isMe) return false;
      return true;
    });

  const daysInMonth = new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 0).getDate();
  const firstDayOfMonth = new Date(viewMonth.getFullYear(), viewMonth.getMonth(), 1).getDay();
  const monthName = viewMonth.toLocaleString('nl-BE', { month: 'long', year: 'numeric' });
  const calendarDays = [];
  const startOffset = firstDayOfMonth === 0 ? 6 : firstDayOfMonth - 1;
  for (let i = 0; i < startOffset; i++) calendarDays.push(null);
  for (let i = 1; i <= daysInMonth; i++) calendarDays.push(i);

  return (
    <PageShell width="6xl" className="pb-20">
      <PageHeader
        title="Verlof"
        description="Beheer verlofaanvragen en bekijk de bezetting."
        actions={(
          <button onClick={() => setShowRequestModal(true)} className="btn-primary ios-pressable px-8 py-4 text-sm flex items-center gap-2">
            <Plus size={20} /> Verlof Aanvragen
          </button>
        )}
      />

      <div className="grid lg:grid-cols-12 gap-8">
        <div className="lg:col-span-8 space-y-6">
          <div className="surface-card p-8 rounded-3xl">
            <div className="flex flex-wrap items-center justify-between gap-4 mb-8">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={goToPrevMonth}
                  aria-label="Vorige maand"
                  className="ios-pressable w-9 h-9 rounded-xl border border-slate-200 bg-white text-slate-500 hover:text-slate-800 hover:bg-slate-50 flex items-center justify-center transition-colors"
                >
                  <ChevronLeft size={18} />
                </button>
                <h4 className="text-lg font-bold tracking-tight capitalize min-w-[160px] text-center">{monthName}</h4>
                <button
                  type="button"
                  onClick={goToNextMonth}
                  aria-label="Volgende maand"
                  className="ios-pressable w-9 h-9 rounded-xl border border-slate-200 bg-white text-slate-500 hover:text-slate-800 hover:bg-slate-50 flex items-center justify-center transition-colors"
                >
                  <ChevronRight size={18} />
                </button>
                {!isCurrentMonth && (
                  <button
                    type="button"
                    onClick={goToCurrentMonth}
                    className="ios-pressable ml-1 px-3 h-9 rounded-xl border border-slate-200 bg-white text-[11px] font-semibold text-slate-500 hover:text-slate-800 hover:bg-slate-50 transition-colors"
                  >
                    Vandaag
                  </button>
                )}
              </div>
              <div className="flex flex-wrap gap-4">
                <div className="flex items-center gap-2"><div className="w-3 h-3 bg-emerald-500 rounded-full" /><span className="text-[10px] font-semibold text-slate-400 uppercase tracking-[0.08em]">Voldoende</span></div>
                <div className="flex items-center gap-2"><div className="w-3 h-3 bg-amber-500 rounded-full" /><span className="text-[10px] font-semibold text-slate-400 uppercase tracking-[0.08em]">Krap</span></div>
              </div>
            </div>
            <div className="grid grid-cols-7 gap-3">
              {['Ma', 'Di', 'Wo', 'Do', 'Vr', 'Za', 'Zo'].map((d) => <div key={d} className="text-center text-[10px] font-semibold text-slate-300 uppercase tracking-[0.08em] mb-2">{d}</div>)}
              {calendarDays.map((day, i) => {
                if (day === null) return <div key={`empty-${i}`} />;
                const dateStr = `${viewMonth.getFullYear()}-${(viewMonth.getMonth() + 1).toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
                const occupancyCount = getRequestsForDate(dateStr).length;
                const statusColor = occupancyCount >= 2 ? 'bg-amber-500' : occupancyCount >= 1 ? 'bg-emerald-500' : 'bg-slate-100';
                const isSelected = selectedDate === dateStr;
                const isInDraftRange = isDateWithinDraftRange(dateStr);
                const isDraftEdge = isDraftBoundary(dateStr);
                return (
                  <button
                    key={day}
                    onClick={() => handleCalendarDateClick(dateStr)}
                    className={cn(
                      'aspect-square rounded-2xl border transition-all flex flex-col items-center justify-center relative group',
                      isSelected && 'border-oker-500 bg-oker-50 ring-4 ring-oker-500/10',
                      !isSelected && !isInDraftRange && 'border-slate-50 hover:border-slate-200 bg-white',
                      isInDraftRange && 'border-oker-200 bg-oker-50/70',
                      isDraftEdge && 'border-oker-500 bg-oker-100 ring-4 ring-oker-500/10'
                    )}
                  >
                    <span className={cn('text-sm font-semibold transition-colors', (isSelected || isInDraftRange) ? 'text-oker-600' : 'text-slate-400 group-hover:text-slate-600')}>{day}</span>
                    {occupancyCount > 0 && <div className={cn('w-1.5 h-1.5 rounded-full mt-1.5', statusColor)} />}
                  </button>
                );
              })}
            </div>
          </div>

          {selectedDate && (
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="surface-card p-8 rounded-3xl">
              <div className="flex items-center justify-between mb-6">
                <h4 className="font-bold tracking-tight text-slate-800">Afwezigheid op {new Date(selectedDate).toLocaleDateString('nl-BE', { day: 'numeric', month: 'long' })}</h4>
                <button onClick={() => setSelectedDate(null)} className="text-slate-400 hover:text-slate-600"><X size={20} /></button>
              </div>
              <div className="space-y-3">
                {getRequestsForDate(selectedDate).length > 0 ? getRequestsForDate(selectedDate).map((req) => {
                  const requester = users.find((u) => u.id === req.userId);
                  return (
                    <div key={req.id} className="flex flex-wrap items-center justify-between gap-3 p-4 bg-slate-50 rounded-2xl">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-white rounded-xl flex items-center justify-center text-slate-400 border border-slate-100"><UserIcon size={20} /></div>
                        <div>
                          <p className="font-semibold text-slate-800 text-sm">{requester?.name}</p>
                          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.08em]">{formatLeaveType(req.type)}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-[11px] font-medium text-slate-400 tabular-nums">{req.startDate} – {req.endDate}</span>
                        {isPlanner && (
                          <button
                            type="button"
                            onClick={() => handleCancel(req.id)}
                            className="ios-pressable px-3 py-2 rounded-xl border border-red-200 bg-white text-[11px] font-semibold text-red-600 hover:bg-red-50 transition-colors"
                          >
                            Annuleren
                          </button>
                        )}
                      </div>
                    </div>
                  );
                }) : <p className="text-center py-4 text-slate-400 font-medium italic">Geen afwezigen op deze dag.</p>}
              </div>
            </motion.div>
          )}
        </div>

        <div className="lg:col-span-4 space-y-8">
          <LeaveBalanceCard balance={verlofBalans(leaveRequests, user.id, new Date().getFullYear(), user.verlofBudget)} year={new Date().getFullYear()} compact />

          {isPlanner && (() => {
            const plannerPending = leaveRequests.filter((r) => {
              if (r.status !== 'pending') return false;
              const requester = users.find((u) => u.id === r.userId);
              const isBeheerder = requester?.name.toLowerCase() === 'beheerder';
              const isMe = r.userId === user.id;
              if (isBeheerder && !isMe) return false;
              return true;
            });
            const allSelected = plannerPending.length > 0 && plannerPending.every((r) => selectedPendingIds.has(r.id));
            return (
              <div className="space-y-3">
                <div className="flex items-center justify-between px-1">
                  <MicroLabel className="text-slate-500">Wachtend op goedkeuring</MicroLabel>
                  {plannerPending.length > 1 && (
                    <button
                      type="button"
                      onClick={() => setSelectedPendingIds(allSelected ? new Set() : new Set(plannerPending.map((r) => r.id)))}
                      className="text-[11px] font-semibold text-slate-500 hover:text-oker-700 transition-colors"
                    >
                      {allSelected ? 'Deselecteer alles' : 'Selecteer alles'}
                    </button>
                  )}
                </div>
                {selectedPendingIds.size > 0 && (
                  <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 rounded-2xl bg-slate-50/80 border border-slate-200">
                    <span className="text-xs font-semibold text-slate-700">
                      {selectedPendingIds.size} {selectedPendingIds.size === 1 ? 'aanvraag' : 'aanvragen'} geselecteerd
                    </span>
                    <div className="flex items-center gap-2">
                      <Button variant="danger" size="sm" onClick={handleBulkReject}>Weigeren ({selectedPendingIds.size})</Button>
                      <Button variant="success" size="sm" icon={<Check size={13} />} onClick={handleBulkApprove}>Goedkeuren ({selectedPendingIds.size})</Button>
                    </div>
                  </div>
                )}
                <div className="space-y-1.5">
                  {plannerPending.length > 0 ? plannerPending.map((req) => {
                    const requester = users.find((u) => u.id === req.userId);
                    const isSelected = selectedPendingIds.has(req.id);
                    const conflictShifts = shiftsConflictingWithLeave(shifts, req);
                    return (
                      <div
                        key={req.id}
                        className={cn(
                          'group flex items-center gap-3 rounded-xl bg-white/70 ring-1 ring-slate-200/60 px-3.5 py-2.5 transition-all hover:bg-white hover:ring-slate-300/80 hover:shadow-sm',
                          isSelected && 'ring-2 ring-emerald-400/50',
                        )}
                      >
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => togglePendingSelection(req.id)}
                          className="w-4 h-4 rounded border-slate-300 text-emerald-500 focus:ring-emerald-400 cursor-pointer shrink-0"
                          aria-label={`Selecteer ${requester?.name}`}
                        />
                        <button
                          type="button"
                          onClick={() => setReviewLeave(req)}
                          className="flex min-w-0 flex-1 items-center gap-3 text-left"
                        >
                          <span className="min-w-0 flex-1">
                            <span className="flex items-center gap-2">
                              <span className="truncate text-[13.5px] font-semibold text-slate-800">{requester?.name ?? 'Onbekend'}</span>
                              {conflictShifts.length > 0 && (
                                <span title={`${conflictShifts.length} ingeplande dienst(en) in deze periode`}>
                                  <AlertTriangle size={13} className="shrink-0 text-red-500" />
                                </span>
                              )}
                            </span>
                            <span className="mt-px block truncate text-xs font-normal text-slate-500 tabular-nums">
                              {req.startDate}{req.startDate !== req.endDate ? ` → ${req.endDate}` : ''} · {formatLeaveType(req.type)}
                            </span>
                          </span>
                          <ChevronRightSmall size={14} className="shrink-0 text-slate-300 transition-colors group-hover:text-slate-600" />
                        </button>
                      </div>
                    );
                  }) : (
                    <div className="rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-3.5">
                      <p className="text-[13px] font-semibold text-slate-800">Alles beoordeeld</p>
                      <p className="text-xs font-normal text-slate-500">Geen openstaande verlofaanvragen.</p>
                    </div>
                  )}
                </div>
              </div>
            );
          })()}

          <MyLeaveSection
            title="Mijn Openstaande Aanvragen"
            count={myPending.length}
            emptyText="Geen openstaande aanvragen."
            requests={myPending}
            isNew={isNewlyDecided}
            onWithdraw={handleWithdraw}
          />

          <MyLeaveSection
            title="Mijn Geplande Verloven"
            count={myUpcoming.length}
            emptyText="Geen goedgekeurd verlof gepland."
            requests={myUpcoming}
            isNew={isNewlyDecided}
            onCancel={isPlanner ? handleCancel : undefined}
          />

          <MyLeaveSection
            title="Mijn Historiek"
            count={myHistory.length}
            emptyText="Nog geen afgehandelde aanvragen."
            requests={myHistory}
            isNew={isNewlyDecided}
          />
        </div>
      </div>

      {createPortal(
      <AnimatePresence>
        {showRequestModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm">
            <motion.div initial={{ opacity: 0, scale: 0.95, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 20 }} className="glass-modal rounded-3xl w-full max-w-md max-h-[90vh] flex flex-col overflow-hidden">
              <div className="p-8 border-b border-white/70 flex items-center justify-between shrink-0"><h4 className="text-lg font-bold tracking-tight">Verlof Aanvragen</h4><button onClick={() => setShowRequestModal(false)} className="p-2 text-slate-400 hover:bg-slate-50 rounded-xl"><X size={24} /></button></div>
              <form onSubmit={handleRequestLeave} className="p-8 space-y-5 overflow-y-auto flex-1">
                <div className="rounded-3xl bg-oker-50/70 px-5 py-4 text-sm text-slate-600">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-oker-700">Periode kiezen</p>
                  <p className="mt-2 font-medium">
                    {!formData.startDate
                      ? 'Klik op de startdatum.'
                      : !formData.endDate
                        ? 'Klik nu op de einddatum (of dezelfde dag voor één dag verlof).'
                        : 'Periode geselecteerd. Pas aan via "Periode wissen" of klik een nieuwe startdatum aan.'}
                  </p>
                </div>

                <div className="rounded-3xl border border-slate-200 bg-white p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <button
                      type="button"
                      onClick={goToPrevMonth}
                      aria-label="Vorige maand"
                      className="ios-pressable w-8 h-8 rounded-xl border border-slate-200 text-slate-500 hover:text-slate-800 hover:bg-slate-50 flex items-center justify-center transition-colors"
                    >
                      <ChevronLeft size={16} />
                    </button>
                    <span className="text-sm font-semibold capitalize">{monthName}</span>
                    <button
                      type="button"
                      onClick={goToNextMonth}
                      aria-label="Volgende maand"
                      className="ios-pressable w-8 h-8 rounded-xl border border-slate-200 text-slate-500 hover:text-slate-800 hover:bg-slate-50 flex items-center justify-center transition-colors"
                    >
                      <ChevronRight size={16} />
                    </button>
                  </div>
                  <div className="grid grid-cols-7 gap-1">
                    {['Ma', 'Di', 'Wo', 'Do', 'Vr', 'Za', 'Zo'].map((d) => (
                      <div key={d} className="text-center text-[9px] font-semibold text-slate-300 uppercase tracking-[0.08em] py-1">{d}</div>
                    ))}
                    {calendarDays.map((day, i) => {
                      if (day === null) return <div key={`m-empty-${i}`} />;
                      const dateStr = `${viewMonth.getFullYear()}-${(viewMonth.getMonth() + 1).toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
                      const inRange = isDateWithinDraftRange(dateStr);
                      const edge = isDraftBoundary(dateStr);
                      const isToday = dateStr === today;
                      const isPast = dateStr < today;
                      return (
                        <button
                          key={day}
                          type="button"
                          disabled={isPast}
                          title={isPast ? 'Je kan geen verlof aanvragen in het verleden.' : undefined}
                          onClick={() => handleCalendarDateClick(dateStr)}
                          className={cn(
                            'aspect-square rounded-xl text-xs font-semibold transition-colors flex items-center justify-center',
                            isPast && 'text-slate-300 cursor-not-allowed',
                            !isPast && !inRange && !edge && 'text-slate-500 hover:bg-oker-50',
                            !isPast && inRange && !edge && 'bg-oker-100 text-oker-700',
                            !isPast && edge && 'bg-oker-500 text-white shadow-sm shadow-oker-500/30',
                            !isPast && isToday && !inRange && !edge && 'ring-1 ring-oker-300',
                          )}
                        >
                          {day}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2"><label className="text-[10px] font-semibold text-slate-400 uppercase tracking-[0.08em] ml-1">Startdatum</label><input type="text" readOnly value={formData.startDate || 'Selecteer in kalender'} className="w-full px-4 py-3 rounded-2xl border border-slate-200 bg-slate-50/80 font-bold text-sm outline-none" /></div>
                  <div className="space-y-2"><label className="text-[10px] font-semibold text-slate-400 uppercase tracking-[0.08em] ml-1">Einddatum</label><input type="text" readOnly value={formData.endDate || 'Selecteer in kalender'} className="w-full px-4 py-3 rounded-2xl border border-slate-200 bg-slate-50/80 font-bold text-sm outline-none" /></div>
                </div>
                <button type="button" onClick={() => setFormData((current) => ({ ...current, startDate: '', endDate: '' }))} className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-xs font-semibold text-slate-500 transition-colors hover:bg-slate-50">
                  Periode wissen
                </button>
                <div className="space-y-2"><label className="text-[10px] font-semibold text-slate-400 uppercase tracking-[0.08em] ml-1">Type Verlof</label><select value={formData.type} onChange={(e) => setFormData({ ...formData, type: e.target.value as LeaveRequest['type'] })} className="control-input w-full px-4 py-3 rounded-2xl font-bold text-sm outline-none transition-all bg-white/60"><option value="betaald_verlof">Betaald verlof</option><option value="klein_verlet">Klein verlet</option></select></div>
                <div className="space-y-2"><label className="text-[10px] font-semibold text-slate-400 uppercase tracking-[0.08em] ml-1">Opmerking</label><textarea value={formData.comment} onChange={(e) => setFormData({ ...formData, comment: e.target.value })} className="w-full px-4 py-3 rounded-2xl border border-slate-200 font-bold text-sm outline-none focus:ring-4 focus:ring-oker-500/10 focus:border-oker-400 transition-all h-24 resize-none" placeholder="Optionele toelichting..." /></div>

                {/* Live impact-preview: budget + shift-conflicten */}
                {requestPreview && (
                  <div className="space-y-2">
                    {/* Budget-saldo */}
                    {formData.type === 'betaald_verlof' && (
                      <div className={cn(
                        'rounded-2xl px-4 py-3 text-xs font-medium border',
                        requestPreview.wouldExceed
                          ? 'bg-red-50/80 border-red-200 text-red-700'
                          : 'bg-emerald-50/60 border-emerald-200/80 text-emerald-700'
                      )}>
                        <div className="flex items-center justify-between gap-3">
                          <span className="font-semibold">
                            {requestPreview.requestedDays} {requestPreview.requestedDays === 1 ? 'dag' : 'dagen'} aangevraagd
                          </span>
                          <span className="font-bold tabular-nums">
                            {requestPreview.gebruikt + requestPreview.requestedDays} / {requestPreview.budget}
                          </span>
                        </div>
                        <p className="mt-1 text-[11px] font-medium opacity-90">
                          {requestPreview.wouldExceed
                            ? `⚠ ${Math.abs(requestPreview.remainingAfter)} ${Math.abs(requestPreview.remainingAfter) === 1 ? 'dag' : 'dagen'} boven je jaarbudget. Planner moet beoordelen.`
                            : `${requestPreview.remainingAfter} ${requestPreview.remainingAfter === 1 ? 'dag' : 'dagen'} resterend na deze aanvraag.`}
                        </p>
                      </div>
                    )}

                    {/* Shift-conflict */}
                    {requestPreview.conflictingShifts.length > 0 && (
                      <div className="rounded-2xl px-4 py-3 text-xs font-medium border bg-amber-50/80 border-amber-200 text-amber-800">
                        <div className="flex items-center gap-2">
                          <AlertTriangle size={14} className="shrink-0" />
                          <span className="font-semibold">
                            {requestPreview.conflictingShifts.length}{' '}
                            {requestPreview.conflictingShifts.length === 1 ? 'dienst staat' : 'diensten staan'} al ingepland in deze periode
                          </span>
                        </div>
                        <p className="mt-1 text-[11px] font-medium opacity-90">
                          De planner herverdeelt deze bij goedkeuring.
                        </p>
                      </div>
                    )}
                  </div>
                )}

                <button type="submit" disabled={!formData.startDate || !formData.endDate} className="btn-primary ios-pressable w-full py-4">Aanvraag Indienen</button>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>,
        document.body,
      )}

      {/* Beoordeling in een side panel: volledige context + beslissing
          zonder paginawissel. */}
      <SlideOver
        open={!!reviewLeave}
        onClose={() => setReviewLeave(null)}
        title={reviewLeave ? (users.find((u) => u.id === reviewLeave.userId)?.name ?? 'Onbekend') : 'Verlofaanvraag'}
        subtitle={reviewLeave ? `Aangevraagd op ${reviewLeave.createdAt.split('T')[0]}` : undefined}
        icon={
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-oker-500/15 text-oker-600 dark:text-oker-400">
            <UserIcon size={17} />
          </span>
        }
        footer={reviewLeave && reviewLeave.status === 'pending' ? (
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="md"
              icon={<History size={14} />}
              onClick={() => { setHistoryLeave(reviewLeave); }}
              aria-label="Wijzigingsgeschiedenis"
            />
            <Button
              variant="danger"
              size="lg"
              className="flex-1"
              onClick={() => { handleStatusUpdate(reviewLeave.id, 'rejected'); setReviewLeave(null); }}
            >
              Afwijzen
            </Button>
            <Button
              variant="success"
              size="lg"
              className="flex-1"
              icon={<Check size={15} />}
              onClick={() => { handleStatusUpdate(reviewLeave.id, 'approved'); setReviewLeave(null); }}
            >
              Goedkeuren
            </Button>
          </div>
        ) : undefined}
      >
        {reviewLeave && (() => {
          const requester = users.find((u) => u.id === reviewLeave.userId);
          const conflictShifts = shiftsConflictingWithLeave(shifts, reviewLeave);
          const startD = new Date(`${reviewLeave.startDate}T00:00:00`);
          const endD = new Date(`${reviewLeave.endDate}T00:00:00`);
          const dayCount = Math.max(1, Math.floor((endD.getTime() - startD.getTime()) / 86400000) + 1);
          const requestYear = parseInt(reviewLeave.startDate.slice(0, 4), 10);
          const balance = verlofBalans(leaveRequests, reviewLeave.userId, requestYear, requester?.verlofBudget);
          const exceeds = reviewLeave.type === 'betaald_verlof'
            && balance.betaaldGebruikt + dayCount > balance.betaaldBudget;
          return (
            <div className="space-y-5">
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge status={reviewLeave.status} />
                <Badge tone="slate">{formatLeaveType(reviewLeave.type)}</Badge>
                {conflictShifts.length > 0 && (
                  <Badge tone="red" icon={<AlertTriangle size={11} />}>
                    {conflictShifts.length} {conflictShifts.length === 1 ? 'dienst' : 'diensten'} ingepland
                  </Badge>
                )}
              </div>

              <div className="surface-muted rounded-xl p-4">
                <MicroLabel className="text-slate-500">Periode</MicroLabel>
                <p className="mt-1.5 text-sm font-semibold text-slate-800 tabular-nums">
                  {reviewLeave.startDate}{reviewLeave.startDate !== reviewLeave.endDate ? ` → ${reviewLeave.endDate}` : ''}
                  <span className="ml-2 font-medium text-slate-500">({dayCount} {dayCount === 1 ? 'dag' : 'dagen'})</span>
                </p>
              </div>

              {/* Saldo-context van de aanvrager — beslis met het budget in beeld. */}
              {reviewLeave.type === 'betaald_verlof' && (
                <div className={cn(
                  'rounded-xl border px-4 py-3',
                  exceeds ? 'border-red-100 bg-red-50' : 'border-emerald-100 bg-emerald-50',
                )}>
                  <div className="flex items-center justify-between gap-3">
                    <MicroLabel className={exceeds ? 'text-red-700' : 'text-emerald-700'}>
                      Verlofsaldo {requestYear}
                    </MicroLabel>
                    <span className={cn('text-sm font-semibold tabular-nums', exceeds ? 'text-red-700' : 'text-emerald-700')}>
                      {balance.betaaldGebruikt + dayCount} / {balance.betaaldBudget}
                    </span>
                  </div>
                  <p className="mt-1 text-xs font-normal text-slate-600">
                    {exceeds
                      ? `Deze aanvraag gaat ${balance.betaaldGebruikt + dayCount - balance.betaaldBudget} ${balance.betaaldGebruikt + dayCount - balance.betaaldBudget === 1 ? 'dag' : 'dagen'} over het jaarbudget.`
                      : `Na goedkeuring resteren ${balance.betaaldBudget - balance.betaaldGebruikt - dayCount} dagen.`}
                  </p>
                </div>
              )}

              {conflictShifts.length > 0 && (
                <div>
                  <MicroLabel className="text-red-600">Conflict met planning</MicroLabel>
                  <div className="mt-2 space-y-1.5">
                    {conflictShifts.slice(0, 5).map((s) => (
                      <div key={s.id} className="flex items-center justify-between rounded-lg bg-red-50 border border-red-100 px-3 py-2 text-xs">
                        <span className="font-semibold text-slate-800 tabular-nums">{s.date}</span>
                        <span className="font-medium text-slate-600 tabular-nums">Dienst {s.line} · {s.startTime}–{s.endTime}</span>
                      </div>
                    ))}
                    {conflictShifts.length > 5 && (
                      <p className="text-[11px] font-medium text-slate-500">+ {conflictShifts.length - 5} andere diensten in deze periode.</p>
                    )}
                  </div>
                  <p className="mt-2 text-xs font-normal text-slate-500">Bij goedkeuring moeten deze diensten herverdeeld worden.</p>
                </div>
              )}

              {reviewLeave.comment && (
                <div>
                  <MicroLabel>Toelichting van de aanvrager</MicroLabel>
                  <p className="mt-2 whitespace-pre-wrap rounded-xl bg-slate-50 border border-slate-100 px-4 py-3 text-sm font-normal leading-relaxed text-slate-700">
                    {reviewLeave.comment}
                  </p>
                </div>
              )}
            </div>
          );
        })()}
      </SlideOver>

      <EntityHistoryModal
        open={!!historyLeave}
        onClose={() => setHistoryLeave(null)}
        entityType="leave"
        entityId={historyLeave?.id ?? ''}
        title={historyLeave ? `${users.find((u) => u.id === historyLeave.userId)?.name || 'Onbekend'} — ${historyLeave.startDate} t/m ${historyLeave.endDate}` : undefined}
      />
    </PageShell>
  );
}

function MyLeaveSection({ title, count, emptyText, requests, isNew, onCancel, onWithdraw }: { title: string; count: number; emptyText: string; requests: LeaveRequest[]; isNew?: (r: LeaveRequest) => boolean; onCancel?: (id: string) => void; onWithdraw?: (id: string) => void }) {
  const statusAccents: Record<LeaveRequest['status'], string> = {
    pending: 'bg-amber-500',
    approved: 'bg-emerald-500',
    rejected: 'bg-red-500',
    cancelled: 'bg-slate-400',
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between px-1">
        <MicroLabel className="text-slate-500">{title}</MicroLabel>
        <MicroLabel>{count}</MicroLabel>
      </div>
      <div className="space-y-3">
        {requests.length > 0 ? requests.map((req) => {
          const fresh = isNew?.(req) ?? false;
          return (
            <div key={req.id} className={cn('surface-card p-5 rounded-2xl relative overflow-hidden', fresh && 'ring-2 ring-oker-400/40')}>
              <div className={cn('absolute top-0 left-0 w-1 h-full', statusAccents[req.status])} />
              <div className="flex justify-between items-start mb-3 gap-3">
                <Badge tone="slate">{formatLeaveType(req.type)}</Badge>
                <div className="flex items-center gap-2">
                  {fresh && <Badge tone="oker">Nieuw</Badge>}
                  <StatusBadge status={req.status} />
                </div>
              </div>
              <p className="font-bold text-slate-800 text-sm mb-0.5">{new Date(req.startDate).toLocaleDateString('nl-BE', { day: 'numeric', month: 'short' })} – {new Date(req.endDate).toLocaleDateString('nl-BE', { day: 'numeric', month: 'short' })}</p>
              <p className="text-[11px] font-medium text-slate-400 tabular-nums">Aangevraagd op {req.createdAt.split('T')[0]}</p>
              {req.comment && <p className="text-xs text-slate-500 italic mt-2.5">"{req.comment}"</p>}
              {onCancel && req.status === 'approved' && (
                <Button variant="danger" size="sm" full className="mt-3.5" onClick={() => onCancel(req.id)}>
                  Verlof annuleren
                </Button>
              )}
              {onWithdraw && req.status === 'pending' && (
                <Button variant="secondary" size="sm" full className="mt-3.5" onClick={() => onWithdraw(req.id)}>
                  Aanvraag intrekken
                </Button>
              )}
            </div>
          );
        }) : (
          <div className="surface-card p-6 rounded-2xl text-center">
            <p className="text-slate-400 font-medium text-sm">{emptyText}</p>
          </div>
        )}
      </div>
    </div>
  );
}
