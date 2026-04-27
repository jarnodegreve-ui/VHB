import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'motion/react';
import { ChevronLeft, ChevronRight, Plus, User as UserIcon, X } from 'lucide-react';
import type { LeaveRequest, User } from '../types';
import { cn } from '../lib/ui';
import { PageHeader, PageShell } from '../components/ui';

const LEAVE_TYPE_LABELS: Record<string, string> = {
  betaald_verlof: 'Betaald verlof',
  klein_verlet: 'Klein verlet',
};
const formatLeaveType = (type: string) => LEAVE_TYPE_LABELS[type] ?? type;

export function LeaveManagementView({ user, leaveRequests, users, onSave, lastSeenDecisionAt, onMarkDecisionsSeen }: { user: User; leaveRequests: LeaveRequest[]; users: User[]; onSave: (l: LeaveRequest[]) => void; lastSeenDecisionAt?: string | null; onMarkDecisionsSeen?: () => void }) {
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
  const today = new Date().toISOString().split('T')[0];
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
    onSave([...leaveRequests, { id: Date.now().toString(), userId: user.id, ...formData, status: 'pending', createdAt: new Date().toISOString() }]);
    setShowRequestModal(false);
    setFormData({ startDate: '', endDate: '', type: 'betaald_verlof', comment: '' });
  };

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
        title="Verlof & Afwezigheid"
        description="Beheer verlofaanvragen en bekijk de bezetting."
        actions={(
          <button onClick={() => setShowRequestModal(true)} className="btn-primary ios-pressable px-8 py-4 text-sm flex items-center gap-2">
            <Plus size={20} /> Verlof Aanvragen
          </button>
        )}
      />

      <div className="grid lg:grid-cols-12 gap-8">
        <div className="lg:col-span-8 space-y-6">
          <div className="surface-card p-8 rounded-[28px]">
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
                <h4 className="text-lg font-black tracking-tight capitalize min-w-[160px] text-center">{monthName}</h4>
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
                    className="ios-pressable ml-1 px-3 h-9 rounded-xl border border-slate-200 bg-white text-[10px] font-black uppercase tracking-widest text-slate-500 hover:text-slate-800 hover:bg-slate-50 transition-colors"
                  >
                    Vandaag
                  </button>
                )}
              </div>
              <div className="flex flex-wrap gap-4">
                <div className="flex items-center gap-2"><div className="w-3 h-3 bg-emerald-500 rounded-full" /><span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Voldoende</span></div>
                <div className="flex items-center gap-2"><div className="w-3 h-3 bg-amber-500 rounded-full" /><span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Krap</span></div>
              </div>
            </div>
            <div className="grid grid-cols-7 gap-3">
              {['Ma', 'Di', 'Wo', 'Do', 'Vr', 'Za', 'Zo'].map((d) => <div key={d} className="text-center text-[10px] font-black text-slate-300 uppercase tracking-[0.2em] mb-2">{d}</div>)}
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
                    <span className={cn('text-sm font-black transition-colors', (isSelected || isInDraftRange) ? 'text-oker-600' : 'text-slate-400 group-hover:text-slate-600')}>{day}</span>
                    {occupancyCount > 0 && <div className={cn('w-1.5 h-1.5 rounded-full mt-1.5', statusColor)} />}
                  </button>
                );
              })}
            </div>
          </div>

          {selectedDate && (
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="surface-card p-8 rounded-[28px]">
              <div className="flex items-center justify-between mb-6">
                <h4 className="font-black text-slate-800">Afwezigheid op {new Date(selectedDate).toLocaleDateString('nl-BE', { day: 'numeric', month: 'long' })}</h4>
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
                          <p className="font-black text-slate-800 text-sm">{requester?.name}</p>
                          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{formatLeaveType(req.type)}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{req.startDate} - {req.endDate}</span>
                        {isPlanner && (
                          <button
                            type="button"
                            onClick={() => handleCancel(req.id)}
                            className="ios-pressable px-3 py-2 rounded-xl border border-red-200 bg-white text-[10px] font-black uppercase tracking-widest text-red-500 hover:bg-red-50 transition-colors"
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
          {isPlanner && (
            <div className="space-y-4">
              <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] ml-2">Wachtend op Goedkeuring</h4>
              <div className="space-y-4">
                {leaveRequests.filter((r) => {
                  if (r.status !== 'pending') return false;
                  const requester = users.find((u) => u.id === r.userId);
                  const isBeheerder = requester?.name.toLowerCase() === 'beheerder';
                  const isMe = r.userId === user.id;
                  if (isBeheerder && !isMe) return false;
                  return true;
                }).length > 0 ? leaveRequests.filter((r) => {
                  if (r.status !== 'pending') return false;
                  const requester = users.find((u) => u.id === r.userId);
                  const isBeheerder = requester?.name.toLowerCase() === 'beheerder';
                  const isMe = r.userId === user.id;
                  if (isBeheerder && !isMe) return false;
                  return true;
                }).map((req) => {
                  const requester = users.find((u) => u.id === req.userId);
                  return <div key={req.id} className="surface-card p-6 rounded-[32px] space-y-4"><div className="flex items-center gap-3"><div className="w-12 h-12 bg-slate-50 rounded-2xl flex items-center justify-center text-oker-500"><UserIcon size={24} /></div><div><p className="font-black text-slate-800">{requester?.name}</p><p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{req.type} • {req.createdAt.split('T')[0]}</p></div></div><div className="bg-slate-50 p-4 rounded-2xl space-y-2"><div className="flex justify-between text-[10px] font-black text-slate-400 uppercase tracking-widest"><span>Periode</span><span className="text-slate-800">{req.startDate} t/m {req.endDate}</span></div>{req.comment && <p className="text-xs text-slate-500 italic mt-2">"{req.comment}"</p>}</div><div className="flex gap-2"><button onClick={() => handleStatusUpdate(req.id, 'approved')} className="flex-1 py-3 bg-emerald-500 text-white rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-emerald-600 transition-all shadow-lg shadow-emerald-500/20">Goedkeuren</button><button onClick={() => handleStatusUpdate(req.id, 'rejected')} className="flex-1 py-3 bg-white border border-slate-200 text-red-500 rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-red-50 transition-all">Afwijzen</button></div></div>;
                }) : <div className="surface-card p-8 rounded-[32px] text-center"><p className="text-slate-400 font-bold text-sm">Geen openstaande aanvragen.</p></div>}
              </div>
            </div>
          )}

          <MyLeaveSection
            title="Mijn Openstaande Aanvragen"
            count={myPending.length}
            emptyText="Geen openstaande aanvragen."
            requests={myPending}
            isNew={isNewlyDecided}
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
            <motion.div initial={{ opacity: 0, scale: 0.95, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 20 }} className="glass-modal rounded-[28px] w-full max-w-md max-h-[90vh] flex flex-col overflow-hidden">
              <div className="p-8 border-b border-white/70 flex items-center justify-between shrink-0"><h4 className="text-xl font-black">Verlof Aanvragen</h4><button onClick={() => setShowRequestModal(false)} className="p-2 text-slate-400 hover:bg-slate-50 rounded-xl"><X size={24} /></button></div>
              <form onSubmit={handleRequestLeave} className="p-8 space-y-5 overflow-y-auto flex-1">
                <div className="rounded-3xl bg-oker-50/70 px-5 py-4 text-sm text-slate-600">
                  <p className="font-black text-oker-700 uppercase tracking-[0.18em] text-[10px]">Periode kiezen</p>
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
                    <span className="text-sm font-black capitalize">{monthName}</span>
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
                      <div key={d} className="text-center text-[9px] font-black text-slate-300 uppercase tracking-[0.15em] py-1">{d}</div>
                    ))}
                    {calendarDays.map((day, i) => {
                      if (day === null) return <div key={`m-empty-${i}`} />;
                      const dateStr = `${viewMonth.getFullYear()}-${(viewMonth.getMonth() + 1).toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
                      const inRange = isDateWithinDraftRange(dateStr);
                      const edge = isDraftBoundary(dateStr);
                      const isToday = dateStr === today;
                      return (
                        <button
                          key={day}
                          type="button"
                          onClick={() => handleCalendarDateClick(dateStr)}
                          className={cn(
                            'aspect-square rounded-xl text-xs font-black transition-colors flex items-center justify-center',
                            !inRange && !edge && 'text-slate-500 hover:bg-oker-50',
                            inRange && !edge && 'bg-oker-100 text-oker-700',
                            edge && 'bg-oker-500 text-white shadow-sm shadow-oker-500/30',
                            isToday && !inRange && !edge && 'ring-1 ring-oker-300',
                          )}
                        >
                          {day}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2"><label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Startdatum</label><input type="text" readOnly value={formData.startDate || 'Selecteer in kalender'} className="w-full px-4 py-3 rounded-2xl border border-slate-200 bg-slate-50/80 font-bold text-sm outline-none" /></div>
                  <div className="space-y-2"><label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Einddatum</label><input type="text" readOnly value={formData.endDate || 'Selecteer in kalender'} className="w-full px-4 py-3 rounded-2xl border border-slate-200 bg-slate-50/80 font-bold text-sm outline-none" /></div>
                </div>
                <button type="button" onClick={() => setFormData((current) => ({ ...current, startDate: '', endDate: '' }))} className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-xs font-black uppercase tracking-widest text-slate-500 transition-colors hover:bg-slate-50">
                  Periode wissen
                </button>
                <div className="space-y-2"><label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Type Verlof</label><select value={formData.type} onChange={(e) => setFormData({ ...formData, type: e.target.value as LeaveRequest['type'] })} className="control-input w-full px-4 py-3 rounded-2xl font-bold text-sm outline-none transition-all bg-white/60"><option value="betaald_verlof">Betaald verlof</option><option value="klein_verlet">Klein verlet</option></select></div>
                <div className="space-y-2"><label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Opmerking</label><textarea value={formData.comment} onChange={(e) => setFormData({ ...formData, comment: e.target.value })} className="w-full px-4 py-3 rounded-2xl border border-slate-200 font-bold text-sm outline-none focus:ring-4 focus:ring-oker-500/10 focus:border-oker-400 transition-all h-24 resize-none" placeholder="Optionele toelichting..." /></div>
                <button type="submit" disabled={!formData.startDate || !formData.endDate} className="btn-primary ios-pressable w-full py-4">Aanvraag Indienen</button>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>,
        document.body,
      )}
    </PageShell>
  );
}

function MyLeaveSection({ title, count, emptyText, requests, isNew, onCancel }: { title: string; count: number; emptyText: string; requests: LeaveRequest[]; isNew?: (r: LeaveRequest) => boolean; onCancel?: (id: string) => void }) {
  const statusLabels: Record<LeaveRequest['status'], string> = {
    pending: 'In behandeling',
    approved: 'Goedgekeurd',
    rejected: 'Afgewezen',
    cancelled: 'Geannuleerd',
  };
  const statusColors: Record<LeaveRequest['status'], { accent: string; text: string }> = {
    pending: { accent: 'bg-amber-500', text: 'text-amber-500' },
    approved: { accent: 'bg-emerald-500', text: 'text-emerald-500' },
    rejected: { accent: 'bg-red-500', text: 'text-red-500' },
    cancelled: { accent: 'bg-slate-400', text: 'text-slate-500' },
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between ml-2">
        <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">{title}</h4>
        <span className="text-[10px] font-black text-slate-300 uppercase tracking-[0.2em]">{count}</span>
      </div>
      <div className="space-y-4">
        {requests.length > 0 ? requests.map((req) => {
          const fresh = isNew?.(req) ?? false;
          const colors = statusColors[req.status];
          return (
            <div key={req.id} className={cn('surface-card p-6 rounded-[32px] relative overflow-hidden', fresh && 'ring-2 ring-oker-400/40')}>
              <div className={cn('absolute top-0 left-0 w-1 h-full', colors.accent)} />
              <div className="flex justify-between items-start mb-4 gap-3">
                <span className="px-3 py-1 bg-slate-100 text-slate-600 rounded-full text-[8px] font-black uppercase tracking-widest">{formatLeaveType(req.type)}</span>
                <div className="flex items-center gap-2">
                  {fresh && <span className="px-2 py-1 bg-oker-500 text-white rounded-full text-[8px] font-black uppercase tracking-widest">Nieuw</span>}
                  <span className={cn('text-[10px] font-black uppercase tracking-widest', colors.text)}>{statusLabels[req.status]}</span>
                </div>
              </div>
              <p className="font-black text-slate-800 text-sm mb-1">{new Date(req.startDate).toLocaleDateString('nl-BE', { day: 'numeric', month: 'short' })} - {new Date(req.endDate).toLocaleDateString('nl-BE', { day: 'numeric', month: 'short' })}</p>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Aangevraagd op {req.createdAt.split('T')[0]}</p>
              {req.comment && <p className="text-xs text-slate-500 italic mt-3">"{req.comment}"</p>}
              {onCancel && req.status === 'approved' && (
                <button
                  type="button"
                  onClick={() => onCancel(req.id)}
                  className="ios-pressable mt-4 w-full rounded-2xl border border-red-200 px-4 py-2.5 text-[10px] font-black uppercase tracking-widest text-red-500 hover:bg-red-50 transition-colors"
                >
                  Verlof annuleren
                </button>
              )}
            </div>
          );
        }) : (
          <div className="surface-card p-8 rounded-[32px] text-center">
            <p className="text-slate-400 font-bold text-sm">{emptyText}</p>
          </div>
        )}
      </div>
    </div>
  );
}
