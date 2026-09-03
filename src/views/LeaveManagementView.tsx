import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { AlertTriangle, Check, ChevronDown, ChevronRight as ChevronRightSmall, History, Plus, Printer, User as UserIcon, X } from 'lucide-react';
import type { LeaveRequest, Shift, User } from '../types';
import { cn, notify, openPdfInNewTab } from '../lib/ui';
import { Modal } from '../components/Modal';
import { ConfirmationModal, ModalHeader, PageHeader, PageShell } from '../components/ui';
import { Button, IconButton, MicroLabel, microLabelClass, StatusBadge, Badge, statusAccentClass } from '../components/primitives';
import { Card } from '../components/Card';
import { Field, Input, Select, Textarea } from '../components/Field';
import { MaandNavigatie } from '../components/MaandNavigatie';
import { SlideOver } from '../components/SlideOver';
import { verlofBalans, daysBetween } from '../lib/leaveBalance';
import { LeaveBalanceCard } from '../components/LeaveBalanceCard';
import { shiftsConflictingWithLeave } from '../lib/conflicts';
import { isoDate } from '../lib/availability';
import { formatDateHuman } from '../lib/format';
import { EntityHistoryModal } from '../components/EntityHistoryModal';
import { formatLeaveType, WEEKDAY_SHORT_MON } from '../lib/format';


// Ziek melden zit BEWUST niet meer in deze view maar in de kop van het
// planner-dashboard (PlannerDashboardWidgets). Het is geen verlofaanvraag maar
// een registratie die de planning meteen raakt, en ze komt telefonisch binnen
// tijdens de rit — dus hoort ze in de cockpit, niet achter een menu-item dat
// verder over aanvragen beoordelen gaat.
export function LeaveManagementView({ user, leaveRequests, users, onSave, onDecide, lastSeenDecisionAt, onMarkDecisionsSeen, shifts = [] }: { user: User; leaveRequests: LeaveRequest[]; users: User[]; onSave: (l: LeaveRequest[]) => void | boolean | Promise<void | boolean>; onDecide?: (id: string, status: LeaveRequest['status'], seenStatus?: string) => Promise<boolean>; lastSeenDecisionAt?: string | null; onMarkDecisionsSeen?: () => void; shifts?: Shift[] }) {
  const [showRequestModal, setShowRequestModal] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Bevestigingen via ConfirmationModal i.p.v. kale window.confirm
  // (browser-popup met "vhb-five.vercel.app meldt…" schrikt chauffeurs af).
  const [confirmAction, setConfirmAction] = useState<{
    title: string;
    message: string;
    confirmText: string;
    variant: 'danger' | 'warning';
    run: () => void;
  } | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  // Historiek standaard gecapt op 5 — de volledige lijst groeide onbegrensd.
  const [formData, setFormData] = useState({ startDate: '', endDate: '', type: 'betaald_verlof' as LeaveRequest['type'], comment: '' });
  // Voor wie vraag je aan? Alleen zichtbaar voor planner/admin: in de
  // testfase belt of zegt een deel van de chauffeurs zijn verlof gewoon door,
  // en dan kon de planning dat nergens kwijt. Leeg = voor jezelf.
  const [voorWie, setVoorWie] = useState<string>('');
  const [viewMonth, setViewMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });

  const goToPrevMonth = () => setViewMonth((d) => new Date(d.getFullYear(), d.getMonth() - 1, 1));
  const goToNextMonth = () => setViewMonth((d) => new Date(d.getFullYear(), d.getMonth() + 1, 1));
  // Maand-swipe op touch (verbeterronde 01-09, nr. 3): veeg links/rechts over
  // de kalender i.p.v. de kleine pijltjes te raken. Duidelijk horizontaal
  // (>56 px en ~2× de verticale beweging) zodat gewoon scrollen niet bladert.
  const swipeStart = useRef<{ x: number; y: number } | null>(null);
  const swipeHandlers = {
    onTouchStart: (e: React.TouchEvent) => {
      const t = e.touches[0];
      swipeStart.current = t ? { x: t.clientX, y: t.clientY } : null;
    },
    onTouchEnd: (e: React.TouchEvent) => {
      const s = swipeStart.current;
      swipeStart.current = null;
      const t = e.changedTouches[0];
      if (!s || !t) return;
      const dx = t.clientX - s.x;
      const dy = t.clientY - s.y;
      if (Math.abs(dx) > 56 && Math.abs(dx) > 1.8 * Math.abs(dy)) {
        if (dx < 0) goToNextMonth(); else goToPrevMonth();
      }
    },
  };
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

  // Voor wie wordt deze aanvraag opgeslagen? Chauffeurs altijd voor zichzelf;
  // een planner kan een collega kiezen (dan is het een registratie van iets
  // dat al mondeling is afgesproken).
  const aanvraagVoorId = isPlanner && voorWie ? voorWie : String(user.id);
  const namensIemandAnders = aanvraagVoorId !== String(user.id);

  const handleRequestLeave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;
    if (!formData.startDate || !formData.endDate) {
      return;
    }
    // Een planner die verlof achteraf registreert mag wél in het verleden
    // boeken (de chauffeur belde het vorige week door); een eigen aanvraag
    // niet.
    if (formData.startDate < today && !namensIemandAnders) {
      notify('Je kan geen verlof aanvragen in het verleden.', 'error');
      return;
    }
    // Pas sluiten/wissen ná een geslaagde save — bij een fout blijft de
    // aanvraag ingevuld staan zodat de chauffeur niet opnieuw moet beginnen.
    setIsSubmitting(true);
    // Namens een chauffeur ingevoerd verlof staat meteen op goedgekeurd: de
    // planner ís de beoordelaar, en een eigen aanvraag die je daarna zelf nog
    // moet goedkeuren is een lege stap (en zou wél als "wacht op planner" in
    // de open taken staan).
    const nieuw: LeaveRequest = {
      id: typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      userId: aanvraagVoorId,
      ...formData,
      status: namensIemandAnders ? 'approved' : 'pending',
      createdAt: new Date().toISOString(),
      ...(namensIemandAnders ? { decidedAt: new Date().toISOString() } : {}),
    };
    const ok = await Promise.resolve(onSave([...leaveRequests, nieuw])).finally(() => setIsSubmitting(false));
    if (ok === false) return;
    setShowRequestModal(false);
    setFormData({ startDate: '', endDate: '', type: 'betaald_verlof', comment: '' });
    setVoorWie('');
    if (namensIemandAnders) {
      const naam = users.find((u) => String(u.id) === aanvraagVoorId)?.name ?? 'de chauffeur';
      notify(`Verlof voor ${naam} vastgelegd en meteen goedgekeurd.`, 'success');
    }
  };

  // === Live preview van impact van de nieuwe aanvraag ===
  // - Hoeveel dagen vraagt-ie aan?
  // - Gaat hij over budget?
  // - Heeft hij al diensten ingepland in die periode? (conflict)
  const requestPreview = useMemo(() => {
    if (!formData.startDate || !formData.endDate) return null;
    const requestedYear = parseInt(formData.startDate.slice(0, 4), 10);
    // DST-veilig tellen via UTC (zie leaveBalance.daysBetween) — lokale
    // middernacht + floor telde 1 dag te weinig over de lente-DST-zondag.
    const requestedDays = daysBetween(formData.startDate, formData.endDate);
    if (requestedDays <= 0) return null;

    // Saldo en conflicten van dégene voor wie je aanvraagt — anders keek een
    // planner naar zijn eigen saldo terwijl hij verlof van een chauffeur
    // invoert.
    const doelUser = users.find((u) => String(u.id) === aanvraagVoorId) ?? user;
    const currentBalance = verlofBalans(leaveRequests, aanvraagVoorId, requestedYear, doelUser.verlofBudget);
    const wouldExceed =
      formData.type === 'betaald_verlof' &&
      currentBalance.betaaldGebruikt + requestedDays > currentBalance.betaaldBudget;
    const remainingAfter = currentBalance.betaaldBudget - currentBalance.betaaldGebruikt - requestedDays;

    const conflictingShifts = shiftsConflictingWithLeave(shifts, {
      id: '__draft__',
      userId: aanvraagVoorId,
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
  }, [formData.startDate, formData.endDate, formData.type, leaveRequests, shifts, aanvraagVoorId, users, user]);

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

  const decisionToast = (status: LeaveRequest['status']) =>
    status === 'approved' ? 'Verlof goedgekeurd.' : status === 'rejected' ? 'Verlof afgewezen.' : 'Verlof geannuleerd.';

  const handleStatusUpdate = (requestId: string, newStatus: LeaveRequest['status'], seenStatus?: string) => {
    // Delta-pad (PATCH per record): conflictveilig bij twee gelijktijdige
    // beoordelaars — de tweede krijgt een melding i.p.v. een stille overschrijf.
    // seenStatus = de status die de beslisser op het scherm zag; zonder die
    // referentie vergeleek de server met de (al ververste) live status en
    // was de conflictcheck feitelijk uitgeschakeld.
    if (onDecide) {
      // Succes-toast bij bevestiging: een beslissing zonder enige feedback
      // voelde als "is er iets gebeurd?" (controleronde 30/07).
      void onDecide(requestId, newStatus, seenStatus).then((ok) => {
        if (ok) notify(decisionToast(newStatus), 'success');
      });
      return;
    }
    const decidedAt = new Date().toISOString();
    onSave(leaveRequests.map((r) => (r.id === requestId ? { ...r, status: newStatus, decidedAt } : r)));
  };

  // Bulk-selectie voor planner-goedkeuring van meerdere pending aanvragen.
  const [selectedPendingIds, setSelectedPendingIds] = useState<Set<string>>(new Set());
  const [historyLeave, setHistoryLeave] = useState<LeaveRequest | null>(null);
  // Beoordeling in een side panel: alle context (saldo, conflicten,
  // toelichting) + beslis-acties zonder paginawissel.
  const [reviewLeave, setReviewLeave] = useState<LeaveRequest | null>(null);
  useEffect(() => {
    if (!reviewLeave) return;
    const fresh = leaveRequests.find((r) => r.id === reviewLeave.id);
    if (!fresh) { setReviewLeave(null); return; }
    if (fresh.status !== reviewLeave.status || fresh.decidedAt !== reviewLeave.decidedAt) {
      setReviewLeave(fresh);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leaveRequests]);
  const togglePendingSelection = (id: string) => {
    setSelectedPendingIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const bulkDecide = (status: 'approved' | 'rejected') => {
    const ids = leaveRequests
      .filter((r) => selectedPendingIds.has(r.id) && r.status === 'pending')
      .map((r) => r.id);
    if (onDecide) {
      // Sequentieel per record: elk met eigen conflictdetectie — een aanvraag
      // die intussen al behandeld is, geeft een melding en slaat over. Eén
      // samenvattende toast na afloop i.p.v. n stiltes.
      void (async () => {
        let ok = 0;
        for (const id of ids) {
          if (await onDecide(id, status, 'pending')) ok += 1;
        }
        const label = status === 'approved' ? 'goedgekeurd' : 'geweigerd';
        if (ok === ids.length) notify(`${ok} ${ok === 1 ? 'aanvraag' : 'aanvragen'} ${label}.`, 'success');
        else notify(`${ok} van ${ids.length} ${label} — de rest was intussen al behandeld.`, 'info');
      })();
      return;
    }
    const decidedAt = new Date().toISOString();
    onSave(leaveRequests.map((r) => (ids.includes(r.id) ? { ...r, status, decidedAt } : r)));
  };

  const handleBulkApprove = () => {
    if (selectedPendingIds.size === 0) return;
    // Zelfde bevestigingspatroon als bulk-weigeren — goedkeuren was de enige
    // bulk-actie zónder bevestiging, terwijl juist dáár planningsconflicten
    // kunnen zitten. De telling maakt dat expliciet vóór de klik.
    const selected = leaveRequests.filter((r) => selectedPendingIds.has(r.id) && r.status === 'pending');
    const withConflicts = selected.filter((r) =>
      shiftsConflictingWithLeave(shifts, r).length > 0,
    ).length;
    setConfirmAction({
      title: 'Aanvragen goedkeuren',
      message: withConflicts > 0
        ? `${selected.length} aanvragen goedkeuren? Let op: ${withConflicts} ervan ${withConflicts === 1 ? 'heeft' : 'hebben'} al ingeplande diensten in die periode.`
        : `${selected.length} aanvragen goedkeuren?`,
      confirmText: 'Goedkeuren',
      variant: 'warning',
      run: () => { bulkDecide('approved'); setSelectedPendingIds(new Set()); },
    });
  };

  const handleBulkReject = () => {
    if (selectedPendingIds.size === 0) return;
    setConfirmAction({
      title: 'Aanvragen weigeren',
      message: `${selectedPendingIds.size} aanvragen weigeren? Dit kan niet ongedaan gemaakt worden.`,
      confirmText: 'Weigeren',
      variant: 'danger',
      run: () => { bulkDecide('rejected'); setSelectedPendingIds(new Set()); },
    });
  };

  const handleCancel = (requestId: string) => {
    const target = leaveRequests.find((r) => r.id === requestId);
    if (!target) return;
    const cancelledByOther = target.userId !== user.id;
    setConfirmAction({
      title: 'Verlof annuleren',
      message: cancelledByOther
        ? 'Deze goedgekeurde verlofaanvraag annuleren? De aanvrager ziet dit terug onder zijn historiek.'
        : 'Eigen verlofaanvraag annuleren?',
      confirmText: 'Annuleren',
      variant: 'danger',
      run: () => {
        if (onDecide) {
          void onDecide(requestId, 'cancelled');
          return;
        }
        const update: Partial<LeaveRequest> = { status: 'cancelled' };
        if (cancelledByOther) update.decidedAt = new Date().toISOString();
        void onSave(leaveRequests.map((r) => (r.id === requestId ? { ...r, ...update } : r)));
      },
    });
  };

  // Eigen nog-niet-besliste aanvraag intrekken (vergissing rechtzetten).
  // Mag alleen voor 'pending' — de aanvraag wordt volledig verwijderd, niet
  // op 'cancelled' gezet. Goedgekeurd verlof blijft via handleCancel
  // (planner/admin) zodat de rij-/rusttijden-check intact blijft.
  const handleWithdraw = (requestId: string) => {
    const target = leaveRequests.find((r) => r.id === requestId);
    if (!target || target.status !== 'pending') return;
    setConfirmAction({
      title: 'Aanvraag intrekken',
      message: 'Deze openstaande aanvraag intrekken? Ze wordt volledig verwijderd.',
      confirmText: 'Intrekken',
      variant: 'danger',
      run: () => {
        void (async () => {
          const ok = await Promise.resolve(onSave(leaveRequests.filter((r) => r.id !== requestId)));
          if (ok !== false) notify('Aanvraag ingetrokken.', 'success');
        })();
      },
    });
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
    <PageShell className="pb-20">
      <PageHeader
        title="Verlof"
        description={isPlanner ? 'Beheer verlofaanvragen en bekijk de bezetting.' : 'Vraag verlof aan en volg je aanvragen op.'}
        actions={(
          <div className="flex items-center gap-2">
            <Button variant="primary" size="lg" icon={<Plus size={18} />} onClick={() => setShowRequestModal(true)}>
              Verlof aanvragen
            </Button>
          </div>
        )}
      />

      {/* grid-cols-1 expliciet: de impliciete auto-track liet het breedste
          kind (een niet-krimpbare rij) de héle kolom oprekken, waardoor de
          kalender op mobiel rechts buiten beeld viel (melding Jarno 01-09).
          minmax(0,1fr) + min-w-0 klemt alles op de viewport. */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        <div className="min-w-0 lg:col-span-8 space-y-6">
          <Card padding="lg" {...swipeHandlers}>
            <div className="flex flex-wrap items-center justify-between gap-4 mb-8">
              <MaandNavigatie label={monthName} labelClassName="text-lg font-bold tracking-tight min-w-[160px]" onVorige={goToPrevMonth} onVolgende={goToNextMonth}>
                {!isCurrentMonth && (
                  <Button variant="secondary" size="sm" className="ml-1" onClick={goToCurrentMonth}>
                    Vandaag
                  </Button>
                )}
              </MaandNavigatie>
              <div className="flex flex-wrap gap-4">
                <div className="flex items-center gap-2"><div className="w-3 h-3 bg-emerald-500 rounded-full" /><span className="text-xs font-medium text-slate-500">Voldoende</span></div>
                <div className="flex items-center gap-2"><div className="w-3 h-3 bg-amber-500 rounded-full" /><span className="text-xs font-medium text-slate-500">Krap</span></div>
              </div>
            </div>
            <div className="grid grid-cols-7 gap-3">
              {WEEKDAY_SHORT_MON.map((d) => <div key={d} className={cn(microLabelClass, 'text-center mb-2')}>{d}</div>)}
              {calendarDays.map((day, i) => {
                if (day === null) return <div key={`empty-${i}`} />;
                const dateStr = `${viewMonth.getFullYear()}-${(viewMonth.getMonth() + 1).toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
                const occupancyCount = getRequestsForDate(dateStr).length;
                const statusColor = occupancyCount >= 2 ? 'bg-amber-500' : occupancyCount >= 1 ? 'bg-emerald-500' : 'bg-surface-muted';
                const isSelected = selectedDate === dateStr;
                const isInDraftRange = isDateWithinDraftRange(dateStr);
                const isDraftEdge = isDraftBoundary(dateStr);
                return (
                  // rauw: kalender-dagcel (eigen selectie-/bereik-stijl)
                  <button
                    key={day}
                    onClick={() => handleCalendarDateClick(dateStr)}
                    className={cn(
                      'aspect-square rounded-2xl border transition-all flex flex-col items-center justify-center relative group',
                      isSelected && 'border-oker-500 bg-oker-50 ring-4 ring-oker-500/10',
                      !isSelected && !isInDraftRange && 'border-slate-50 hover:border-slate-200 bg-surface-white',
                      isInDraftRange && 'border-oker-200 bg-oker-50/70',
                      isDraftEdge && 'border-oker-500 bg-oker-100 ring-4 ring-oker-500/10'
                    )}
                  >
                    <span className={cn('text-sm font-semibold transition-colors', (isSelected || isInDraftRange) ? 'text-oker-700' : 'text-slate-400 group-hover:text-slate-600')}>{day}</span>
                    {occupancyCount > 0 && <div className={cn('w-1.5 h-1.5 rounded-full mt-1.5', statusColor)} />}
                  </button>
                );
              })}
            </div>
          </Card>

          {selectedDate && (
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
              <Card padding="lg">
                {/* Bewust geen CardHeader: die zet de aside op mobiel ónder de
                    titel, en een sluitknop hoort rechts naast de kop te blijven. */}
                <div className="flex items-center justify-between mb-6">
                  <h3 className="text-card-title">Afwezigheid op {new Date(`${selectedDate}T00:00:00`).toLocaleDateString('nl-BE', { day: 'numeric', month: 'long' })}</h3>
                  <IconButton label="Sluiten" variant="ghost" size="sm" onClick={() => setSelectedDate(null)}><X size={18} /></IconButton>
                </div>
                <div className="space-y-3">
                  {getRequestsForDate(selectedDate).length > 0 ? getRequestsForDate(selectedDate).map((req) => {
                    const requester = users.find((u) => u.id === req.userId);
                    return (
                      <Card key={req.id} tone="muted" padding="sm" className="flex flex-wrap items-center justify-between gap-3">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 bg-surface-white rounded-xl flex items-center justify-center text-slate-400 border border-slate-100"><UserIcon size={20} /></div>
                          <div>
                            <p className="font-semibold text-slate-800 text-sm">{requester?.name}</p>
                            <MicroLabel>{formatLeaveType(req.type)}</MicroLabel>
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="text-2xs font-medium text-slate-400 tabular-nums">{req.startDate} – {req.endDate}</span>
                          {isPlanner && (
                            <Button variant="danger" size="sm" onClick={() => handleCancel(req.id)}>
                              Annuleren
                            </Button>
                          )}
                        </div>
                      </Card>
                    );
                  }) : <p className="text-center py-4 text-sm text-slate-500">Geen afwezigen op deze dag.</p>}
                </div>
              </Card>
            </motion.div>
          )}
        </div>

        <div className="min-w-0 lg:col-span-4 space-y-8">
          <div className="space-y-2">
            <LeaveBalanceCard balance={verlofBalans(leaveRequests, user.id, new Date().getFullYear(), user.verlofBudget)} year={new Date().getFullYear()} compact />
            {/* Nieuw tabblad: de print-modus rendert een kale pagina in plaats
                van de app (zelfde patroon als het maandrooster). Via
                openPdfInNewTab, niet via rauwe window.open — die geeft in
                iOS-standalone geregeld null terug, en dan deed deze knop
                niets. Dit is chauffeurs-facing, dus dat is een dood pad. */}
            <Button
              variant="secondary"
              size="md"
              full
              icon={<Printer size={14} />}
              onClick={() => openPdfInNewTab(`${window.location.origin}${window.location.pathname}?print-verlof-driver=${encodeURIComponent(user.id)}&print-verlof-jaar=${new Date().getFullYear()}`)}
            >
              Jaaroverzicht (PDF)
            </Button>
          </div>

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
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setSelectedPendingIds(allSelected ? new Set() : new Set(plannerPending.map((r) => r.id)))}
                    >
                      {allSelected ? 'Deselecteer alles' : 'Selecteer alles'}
                    </Button>
                  )}
                </div>
                {selectedPendingIds.size > 0 && (
                  <Card tone="muted" padding="none" className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                    <span className="text-xs font-semibold text-slate-700">
                      {selectedPendingIds.size} {selectedPendingIds.size === 1 ? 'aanvraag' : 'aanvragen'} geselecteerd
                    </span>
                    <div className="flex items-center gap-2">
                      <Button variant="danger" size="sm" onClick={handleBulkReject}>Weigeren ({selectedPendingIds.size})</Button>
                      <Button variant="success" size="sm" icon={<Check size={14} />} onClick={handleBulkApprove}>Goedkeuren ({selectedPendingIds.size})</Button>
                    </div>
                  </Card>
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
                          'group flex items-center gap-3 rounded-xl bg-surface-row ring-1 ring-hairline px-3.5 py-2.5 transition-all hover:bg-surface-row-hover hover:ring-hairline-strong hover:shadow-sm',
                          isSelected && 'ring-2 ring-oker-400/50',
                        )}
                      >
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => togglePendingSelection(req.id)}
                          className="w-4 h-4 rounded border-slate-300 text-oker-500 focus:ring-oker-400 cursor-pointer shrink-0"
                          aria-label={`Selecteer ${requester?.name}`}
                        />
                        {/* rauw: rij-inhoud (naam + periode + chevron) als knop naast de checkbox — geen knopvorm */}
                        <button
                          type="button"
                          onClick={() => setReviewLeave(req)}
                          className="flex min-w-0 flex-1 items-center gap-3 text-left"
                        >
                          <span className="min-w-0 flex-1">
                            <span className="flex items-center gap-2">
                              <span className="truncate text-sm font-semibold text-slate-800">{requester?.name ?? 'Onbekend'}</span>
                              {conflictShifts.length > 0 && (
                                <span title={`${conflictShifts.length} ingeplande dienst(en) in deze periode`}>
                                  <AlertTriangle size={14} className="shrink-0 text-red-500" />
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
                    <Card tone="success" padding="none" className="px-4 py-3.5">
                      <p className="text-sm font-semibold text-slate-800">Alles beoordeeld</p>
                      <p className="text-xs font-normal text-slate-500">Geen openstaande verlofaanvragen.</p>
                    </Card>
                  )}
                </div>
              </div>
            );
          })()}

          <MyLeaveSection
            title="Mijn openstaande aanvragen"
            count={myPending.length}
            emptyText="Geen openstaande aanvragen."
            requests={myPending}
            isNew={isNewlyDecided}
            onWithdraw={handleWithdraw}
          />

          <MyLeaveSection
            title="Mijn geplande verloven"
            count={myUpcoming.length}
            emptyText="Geen goedgekeurd verlof gepland."
            requests={myUpcoming}
            isNew={isNewlyDecided}
            onCancel={isPlanner ? handleCancel : undefined}
          />

          <MyLeaveSection
            title="Mijn historiek"
            count={myHistory.length}
            emptyText="Nog geen afgehandelde aanvragen."
            requests={myHistory}
            isNew={isNewlyDecided}
          />
        </div>
      </div>

      {/* Gedeelde Modal i.p.v. eigen portal: ESC, backdrop-tap, safe-area en
          dvh-begrenzing (verbeterronde 29/07 #3). */}
      <Modal open={showRequestModal} onClose={() => setShowRequestModal(false)} maxWidth="md" className="flex max-h-[88dvh] flex-col !overflow-hidden !p-0">
              <ModalHeader title="Verlof aanvragen" onClose={() => setShowRequestModal(false)} />
              <form onSubmit={handleRequestLeave} className="p-8 space-y-5 overflow-y-auto flex-1">
                {/* Alleen planner/admin: verlof registreren dat een chauffeur
                    mondeling of telefonisch doorgaf. Kiest de planner een
                    collega, dan is het meteen goedgekeurd (hij ís de
                    beoordelaar) en rekenen saldo én dienstconflicten hieronder
                    op díe chauffeur. */}
                {isPlanner && (
                  <Field label="Voor wie">
                    {({ id }) => (
                      <>
                        <Select
                          id={id}
                          value={voorWie}
                          onChange={(e) => setVoorWie(e.target.value)}
                        >
                          <option value="">Mezelf ({user.name})</option>
                          {users
                            .filter((u) => u.role === 'chauffeur' && u.isActive !== false && u.name.trim().toLowerCase() !== 'beheerder')
                            .sort((a, b) => a.name.localeCompare(b.name, 'nl'))
                            .map((u) => (
                              <option key={u.id} value={String(u.id)}>{u.name}</option>
                            ))}
                        </Select>
                        {namensIemandAnders && (
                          <p className="text-2xs font-medium text-oker-700">
                            Wordt meteen als goedgekeurd verlof vastgelegd — je hoeft het daarna niet nog eens te beoordelen.
                          </p>
                        )}
                      </>
                    )}
                  </Field>
                )}

                <Card tone="accent" padding="none" className="px-5 py-4 text-sm text-slate-600">
                  <MicroLabel className="text-oker-700">Periode kiezen</MicroLabel>
                  <p className="mt-2 font-medium">
                    {!formData.startDate
                      ? 'Klik op de startdatum.'
                      : !formData.endDate
                        ? 'Klik nu op de einddatum (of dezelfde dag voor één dag verlof).'
                        : 'Periode geselecteerd. Pas aan via "Periode wissen" of klik een nieuwe startdatum aan.'}
                  </p>
                </Card>

                <Card padding="sm" className="space-y-3" {...swipeHandlers}>
                  <MaandNavigatie className="justify-between" label={monthName} onVorige={goToPrevMonth} onVolgende={goToNextMonth} />
                  <div className="grid grid-cols-7 gap-1">
                    {WEEKDAY_SHORT_MON.map((d) => (
                      <div key={d} className={cn(microLabelClass, 'text-center py-1')}>{d}</div>
                    ))}
                    {calendarDays.map((day, i) => {
                      if (day === null) return <div key={`m-empty-${i}`} />;
                      const dateStr = `${viewMonth.getFullYear()}-${(viewMonth.getMonth() + 1).toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
                      const inRange = isDateWithinDraftRange(dateStr);
                      const edge = isDraftBoundary(dateStr);
                      const isToday = dateStr === today;
                      const isPast = dateStr < today;
                      return (
                        // rauw: kalender-dagcel in de datumkiezer (eigen bereik-/randstijl)
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
                            !isPast && edge && 'bg-oker-500 text-slate-950 shadow-sm shadow-oker-500/30',
                            !isPast && isToday && !inRange && !edge && 'ring-1 ring-oker-300',
                          )}
                        >
                          {day}
                        </button>
                      );
                    })}
                  </div>
                </Card>
                <div className="grid grid-cols-2 gap-4">
                  {/* tabIndex -1: puur weergavevelden — focus zou op iOS alleen maar inzoomen */}
                  <Field label="Startdatum">
                    {({ id }) => <Input id={id} type="text" readOnly tabIndex={-1} value={formData.startDate || 'Selecteer in kalender'} />}
                  </Field>
                  <Field label="Einddatum">
                    {({ id }) => <Input id={id} type="text" readOnly tabIndex={-1} value={formData.endDate || 'Selecteer in kalender'} />}
                  </Field>
                </div>
                <Button variant="secondary" size="md" full onClick={() => setFormData((current) => ({ ...current, startDate: '', endDate: '' }))}>
                  Periode wissen
                </Button>
                <Field label="Type verlof">
                  {({ id }) => (
                    <Select id={id} value={formData.type} onChange={(e) => setFormData({ ...formData, type: e.target.value as LeaveRequest['type'] })}>
                      <option value="betaald_verlof">Betaald verlof</option>
                      <option value="klein_verlet">Klein verlet</option>
                    </Select>
                  )}
                </Field>
                <Field label="Opmerking">
                  {({ id }) => (
                    <Textarea
                      id={id}
                      value={formData.comment}
                      onChange={(e) => setFormData({ ...formData, comment: e.target.value })}
                      onFocus={(e) => setTimeout(() => e.target.scrollIntoView({ block: 'center', behavior: 'smooth' }), 250)}
                      className="h-24"
                      placeholder="Optionele toelichting..."
                    />
                  )}
                </Field>

                {/* Live impact-preview: budget + shift-conflicten */}
                {requestPreview && (
                  <div className="space-y-2">
                    {/* Budget-saldo */}
                    {formData.type === 'betaald_verlof' && (
                      <Card
                        tone={requestPreview.wouldExceed ? 'danger' : 'success'}
                        padding="none"
                        className={cn('px-4 py-3 text-xs font-medium', requestPreview.wouldExceed ? 'text-red-700' : 'text-emerald-700')}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <span className="font-semibold">
                            {requestPreview.requestedDays} {requestPreview.requestedDays === 1 ? 'dag' : 'dagen'} aangevraagd
                          </span>
                          <span className="font-bold tabular-nums">
                            {requestPreview.gebruikt + requestPreview.requestedDays} / {requestPreview.budget}
                          </span>
                        </div>
                        <p className="mt-1 text-2xs font-medium opacity-90">
                          {requestPreview.wouldExceed
                            ? `⚠ ${Math.abs(requestPreview.remainingAfter)} ${Math.abs(requestPreview.remainingAfter) === 1 ? 'dag' : 'dagen'} boven je jaarbudget. Planner moet beoordelen.`
                            : `${requestPreview.remainingAfter} ${requestPreview.remainingAfter === 1 ? 'dag' : 'dagen'} resterend na deze aanvraag.`}
                        </p>
                      </Card>
                    )}

                    {/* Shift-conflict */}
                    {requestPreview.conflictingShifts.length > 0 && (
                      <Card tone="warning" padding="none" className="px-4 py-3 text-xs font-medium text-amber-800">
                        <div className="flex items-center gap-2">
                          <AlertTriangle size={14} className="shrink-0" />
                          <span className="font-semibold">
                            {requestPreview.conflictingShifts.length}{' '}
                            {requestPreview.conflictingShifts.length === 1 ? 'dienst staat' : 'diensten staan'} al ingepland in deze periode
                          </span>
                        </div>
                        <p className="mt-1 text-2xs font-medium opacity-90">
                          De planner herverdeelt deze bij goedkeuring.
                        </p>
                      </Card>
                    )}
                  </div>
                )}

                <Button type="submit" variant="primary" size="lg" full disabled={!formData.startDate || !formData.endDate || isSubmitting}>{isSubmitting ? 'Versturen…' : 'Aanvraag indienen'}</Button>
              </form>
      </Modal>

      {/* Beoordeling in een side panel: volledige context + beslissing
          zonder paginawissel. */}
      <SlideOver
        open={!!reviewLeave}
        onClose={() => setReviewLeave(null)}
        title={reviewLeave ? (users.find((u) => u.id === reviewLeave.userId)?.name ?? 'Onbekend') : 'Verlofaanvraag'}
        subtitle={reviewLeave ? `Aangevraagd op ${formatDateHuman(reviewLeave.createdAt)}` : undefined}
        icon={
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-oker-500/15 text-oker-700">
            <UserIcon size={16} />
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
              onClick={() => { handleStatusUpdate(reviewLeave.id, 'rejected', reviewLeave.status); setReviewLeave(null); }}
            >
              Afwijzen
            </Button>
            <Button
              variant="success"
              size="lg"
              className="flex-1"
              icon={<Check size={16} />}
              onClick={() => { handleStatusUpdate(reviewLeave.id, 'approved', reviewLeave.status); setReviewLeave(null); }}
            >
              Goedkeuren
            </Button>
          </div>
        ) : undefined}
      >
        {reviewLeave && (() => {
          const requester = users.find((u) => u.id === reviewLeave.userId);
          const conflictShifts = shiftsConflictingWithLeave(shifts, reviewLeave);
          const dayCount = Math.max(1, daysBetween(reviewLeave.startDate, reviewLeave.endDate));
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
                  <Badge tone="red" icon={<AlertTriangle size={12} />}>
                    {conflictShifts.length} {conflictShifts.length === 1 ? 'dienst' : 'diensten'} ingepland
                  </Badge>
                )}
              </div>

              <Card tone="muted" padding="sm">
                <MicroLabel className="text-slate-500">Periode</MicroLabel>
                <p className="mt-1.5 text-sm font-semibold text-slate-800 tabular-nums">
                  {reviewLeave.startDate}{reviewLeave.startDate !== reviewLeave.endDate ? ` → ${reviewLeave.endDate}` : ''}
                  <span className="ml-2 font-medium text-slate-500">({dayCount} {dayCount === 1 ? 'dag' : 'dagen'})</span>
                </p>
              </Card>

              {/* Saldo-context van de aanvrager — beslis met het budget in beeld. */}
              {reviewLeave.type === 'betaald_verlof' && (
                <Card tone={exceeds ? 'danger' : 'success'} padding="none" className="px-4 py-3">
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
                </Card>
              )}

              {/* Dekkingsimpact: hoeveel andere chauffeurs zijn deze periode al
                  afwezig (goedgekeurd verlof/ziekte) — beslis met het gat in beeld. */}
              {(() => {
                const others = leaveRequests.filter((r) => r.status === 'approved' && String(r.userId) !== String(reviewLeave.userId));
                const overlap = others.filter((r) => r.startDate <= reviewLeave.endDate && r.endDate >= reviewLeave.startDate);
                const uniqueOthers = new Set(overlap.map((r) => String(r.userId))).size;
                if (uniqueOthers === 0) return null;
                let peak = 0;
                const cur = new Date(`${reviewLeave.startDate}T00:00:00`);
                const end = new Date(`${reviewLeave.endDate}T00:00:00`);
                for (let guard = 0; cur <= end && guard < 400; guard++) {
                  const iso = `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}-${String(cur.getDate()).padStart(2, '0')}`;
                  const c = overlap.filter((r) => r.startDate <= iso && r.endDate >= iso).length;
                  if (c > peak) peak = c;
                  cur.setDate(cur.getDate() + 1);
                }
                return (
                  <Card tone="muted" padding="none" className="px-4 py-3">
                    <MicroLabel className="text-slate-500">Dekking deze periode</MicroLabel>
                    <p className="mt-1 text-xs font-normal text-slate-600">
                      {uniqueOthers === 1 ? 'Er is al 1 andere chauffeur' : `Er zijn al ${uniqueOthers} andere chauffeurs`} afwezig in deze periode{peak > 1 ? ` — tot ${peak} tegelijk op de drukste dag` : ''}.
                    </p>
                  </Card>
                );
              })()}

              {conflictShifts.length > 0 && (
                <div>
                  <MicroLabel className="text-red-700">Conflict met planning</MicroLabel>
                  <div className="mt-2 space-y-1.5">
                    {conflictShifts.slice(0, 5).map((s) => (
                      <div key={s.id} className="flex items-center justify-between rounded-lg bg-red-50 border border-red-100 px-3 py-2 text-xs">
                        <span className="font-semibold text-slate-800 tabular-nums">{s.date}</span>
                        <span className="font-medium text-slate-600 tabular-nums">Dienst {s.line} · {s.startTime}–{s.endTime}</span>
                      </div>
                    ))}
                    {conflictShifts.length > 5 && (
                      <p className="text-2xs font-medium text-slate-500">+ {conflictShifts.length - 5} andere diensten in deze periode.</p>
                    )}
                  </div>
                  <p className="mt-2 text-xs font-normal text-slate-500">Bij goedkeuring moeten deze diensten herverdeeld worden.</p>
                </div>
              )}

              {reviewLeave.comment && (
                <div>
                  <MicroLabel>Toelichting van de aanvrager</MicroLabel>
                  <p className="mt-2 whitespace-pre-wrap rounded-xl bg-surface-soft border border-slate-100 px-4 py-3 text-sm font-normal leading-relaxed text-slate-700">
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

      <ConfirmationModal
        isOpen={!!confirmAction}
        onClose={() => setConfirmAction(null)}
        onConfirm={() => { confirmAction?.run(); setConfirmAction(null); }}
        title={confirmAction?.title ?? ''}
        message={confirmAction?.message ?? ''}
        confirmText={confirmAction?.confirmText ?? 'Bevestigen'}
        variant={confirmAction?.variant ?? 'warning'}
      />
    </PageShell>
  );
}

function MyLeaveSection({ title, count, emptyText, requests, isNew, onCancel, onWithdraw }: { title: string; count: number; emptyText: string; requests: LeaveRequest[]; isNew?: (r: LeaveRequest) => boolean; onCancel?: (id: string) => void; onWithdraw?: (id: string) => void }) {
  // Compacte, uitklapbare rijen in een eigen scrollcontainer: de historiek
  // groeit onbegrensd mee, dus de dichte kaarten werden onoverzichtelijk
  // (wens Jarno). Dicht = periode + status; open = de details + acties.
  const [openIds, setOpenIds] = useState<string[]>([]);
  const toggle = (id: string) => setOpenIds((cur) => (
    cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]
  ));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between px-1">
        <MicroLabel className="text-slate-500">{title}</MicroLabel>
        <MicroLabel>{count}</MicroLabel>
      </div>
      <div className="max-h-[420px] overflow-y-auto overscroll-contain space-y-2 -mx-1 px-1">
        {requests.length > 0 ? requests.map((req) => {
          const fresh = isNew?.(req) ?? false;
          const open = openIds.includes(req.id);
          return (
            <Card key={req.id} padding="none" className={cn('relative overflow-hidden', fresh && 'ring-2 ring-oker-400/40')}>
              <div className={cn('absolute top-0 left-0 w-1 h-full', statusAccentClass(req.status))} />
              {/* rauw: uitklapbare kaartkop (periode + type + status + chevron) — hele rij klikbaar */}
              <button
                type="button"
                onClick={() => toggle(req.id)}
                aria-expanded={open}
                className="w-full flex items-center justify-between gap-3 p-3.5 pl-4 text-left"
              >
                <div className="min-w-0 flex items-baseline gap-2.5">
                  <span className="text-sm font-bold tracking-tight text-slate-800 whitespace-nowrap">{new Date(`${req.startDate}T00:00:00`).toLocaleDateString('nl-BE', { day: 'numeric', month: 'short' })} – {new Date(`${req.endDate}T00:00:00`).toLocaleDateString('nl-BE', { day: 'numeric', month: 'short' })}</span>
                  <span className="text-2xs font-medium text-slate-400 truncate">{formatLeaveType(req.type)}</span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {fresh && <Badge tone="oker">Nieuw</Badge>}
                  <StatusBadge status={req.status} />
                  <ChevronDown size={16} className={cn('text-slate-400 transition-transform duration-200', open && 'rotate-180')} />
                </div>
              </button>
              {open && (
                <div className="px-4 pb-4 pt-0.5">
                  <p className="text-2xs font-medium text-slate-400">Aangevraagd op {formatDateHuman(req.createdAt)}</p>
                  {req.comment && <p className="text-xs text-slate-500 italic mt-2">"{req.comment}"</p>}
                  {onCancel && req.status === 'approved' && (
                    <Button variant="danger" size="sm" full className="mt-3" onClick={() => onCancel(req.id)}>
                      Verlof annuleren
                    </Button>
                  )}
                  {onWithdraw && req.status === 'pending' && (
                    <Button variant="secondary" size="sm" full className="mt-3" onClick={() => onWithdraw(req.id)}>
                      Aanvraag intrekken
                    </Button>
                  )}
                </div>
              )}
            </Card>
          );
        }) : (
          <Card padding="md" className="text-center">
            <p className="text-slate-400 font-medium text-sm">{emptyText}</p>
          </Card>
        )}
      </div>
    </div>
  );
}
