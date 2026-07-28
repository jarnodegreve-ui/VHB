import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'motion/react';
import { ArrowLeftRight, ChevronDown, ChevronRight, History, X, Check } from 'lucide-react';
import type { LeaveRequest, Shift, SwapRequest, User } from '../types';
import { ConfirmationModal, EmptyState, PageHeader, PageShell } from '../components/ui';
import { Badge, Button, MicroLabel, StatusBadge, TableShell, Td, Th } from '../components/primitives';
import { SlideOver } from '../components/SlideOver';
import { EntityHistoryModal } from '../components/EntityHistoryModal';
import { fetchAvailability, isoDate, addDays } from '../lib/availability';
import { formatDateHuman, formatShortDay } from '../lib/format';
import { canRespondToSwap } from '../lib/authorization';

type ReturnOption = { date: string; code: string; isFree: boolean };

export function SwapRequestsView({ user, swaps, shifts, users, leaveRequests = [], onSave, onDecide, preselectShiftId = null, onPreselectConsumed }: { user: User, swaps: SwapRequest[], shifts: Shift[], users: User[], leaveRequests?: LeaveRequest[], onSave: (s: SwapRequest[]) => void | boolean | Promise<void | boolean>, onDecide?: (id: string, status: SwapRequest['status']) => Promise<boolean>, preselectShiftId?: string | null, onPreselectConsumed?: () => void }) {
  const [showOfferModal, setShowOfferModal] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Bevestigingen via de nette ConfirmationModal i.p.v. kale window.confirm
  // (browser-popup met "vhb-five.vercel.app meldt…" schrikt chauffeurs af).
  const [expandedSwapIds, setExpandedSwapIds] = useState<string[]>([]);
  const toggleSwapExpanded = (id: string) => setExpandedSwapIds((cur) => (
    cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]
  ));
  const [confirmAction, setConfirmAction] = useState<{
    title: string;
    message: string;
    confirmText: string;
    variant: 'danger' | 'warning';
    run: () => void;
  } | null>(null);
  const [selectedShift, setSelectedShift] = useState<string>('');
  const [selectedTargetDriver, setSelectedTargetDriver] = useState<string>('');
  const [reason, setReason] = useState('');
  // Wizard i.p.v. 3 afhankelijke dropdowns: één vraag per stap, tikbare
  // kaarten, en een samenvatting vóór het indienen (UX-review: dit was de
  // moeilijkste flow — keuze-overload met tot 56 opties in één select).
  const [wizardStep, setWizardStep] = useState<1 | 2 | 3>(1);
  const [showBusyColleagues, setShowBusyColleagues] = useState(false);
  const [showAllReturns, setShowAllReturns] = useState(false);
  // Stap 1 toont eerst de komende ~2 weken; bij een volle 8-wekenplanning
  // stonden er anders 30-40 kaarten in één modal.
  const [showAllShifts, setShowAllShifts] = useState(false);
  const [historySwap, setHistorySwap] = useState<SwapRequest | null>(null);
  // Beoordeling in een side panel: alle ruil-context + beslis-acties
  // zonder paginawissel (zelfde patroon als LeaveManagementView).
  const [reviewSwap, setReviewSwap] = useState<SwapRequest | null>(null);
  // Dienstruil-matching: wie is vrij op de dag van de gekozen dienst?
  const [freeForDate, setFreeForDate] = useState<Set<string> | null>(null);
  const [matchLoading, setMatchLoading] = useState(false);
  // 1-op-1 ruil: wat neemt de aanvrager in ruil van de collega?
  const [returnPick, setReturnPick] = useState<string>(''); // "date|code"
  const [returnOptions, setReturnOptions] = useState<ReturnOption[] | null>(null);
  const [returnLoading, setReturnLoading] = useState(false);

  const selectedShiftDate = shifts.find((s) => s.id === selectedShift)?.date;

  useEffect(() => {
    if (!selectedShiftDate) {
      setFreeForDate(null);
      return;
    }
    let cancelled = false;
    setMatchLoading(true);
    fetchAvailability(selectedShiftDate, selectedShiftDate)
      .then((res) => {
        if (cancelled) return;
        const day = res.days.find((d) => d.date === selectedShiftDate);
        setFreeForDate(new Set(day?.free ?? []));
      })
      .catch(() => { if (!cancelled) setFreeForDate(null); })
      .finally(() => { if (!cancelled) setMatchLoading(false); });
    return () => { cancelled = true; };
  }, [selectedShiftDate]);

  // Komende diensten + vrije dagen van de gekozen collega (8 weken vooruit),
  // zodat de aanvrager kiest wat hij in ruil neemt (1-op-1 ruil).
  useEffect(() => {
    if (!selectedTargetDriver) {
      setReturnOptions(null);
      setReturnPick('');
      return;
    }
    let cancelled = false;
    setReturnLoading(true);
    setReturnPick('');
    const today = new Date();
    fetchAvailability(isoDate(today), isoDate(addDays(today, 56)))
      .then((res) => {
        if (cancelled) return;
        const opts: ReturnOption[] = [];
        for (const day of res.days) {
          const dienst = day.lines?.[selectedTargetDriver];
          if (dienst) opts.push({ date: day.date, code: dienst, isFree: false });
          else if (day.free?.includes(selectedTargetDriver)) opts.push({ date: day.date, code: 'vrij', isFree: true });
        }
        opts.sort((a, b) => a.date.localeCompare(b.date));
        setReturnOptions(opts);
      })
      .catch(() => { if (!cancelled) setReturnOptions([]); })
      .finally(() => { if (!cancelled) setReturnLoading(false); });
    return () => { cancelled = true; };
  }, [selectedTargetDriver, user.id]);

  const isPlanner = user.role === 'planner' || user.role === 'admin';
  const isAdmin = user.role === 'admin';
  const todayIso = isoDate(new Date());
  // Alleen kómende eigen diensten, chronologisch — verleden diensten ruilen
  // heeft geen zin en vulde de keuzelijst nodeloos.
  const myShifts = shifts
    .filter(s => s.driverId === user.id && s.date >= todayIso)
    .sort((a, b) => a.date.localeCompare(b.date) || String(a.startTime).localeCompare(String(b.startTime)));
  const getServiceNumber = (shift: Shift | undefined) => String(shift?.line || '--').trim() || '--';
  // Gedeelde compacte dag-vorm ('vr 18 jul') — gelijk aan Dekking, i.p.v. de
  // eigen 'vr 18/07'-variant (datum-consolidatie).
  const fmtShort = formatShortDay;

  // Ruil gestart vanuit het rooster: open de wizard meteen op stap 2 met de
  // aangetikte dienst voorgeselecteerd (scheelt de chauffeur stap 1).
  useEffect(() => {
    if (!preselectShiftId) return;
    const shift = myShifts.find((s) => s.id === preselectShiftId);
    if (shift) {
      setSelectedShift(shift.id);
      setSelectedTargetDriver('');
      setReturnPick('');
      setWizardStep(2);
      setShowOfferModal(true);
    }
    onPreselectConsumed?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preselectShiftId]);
  // Tikbare wizard-kaart (stap 1/2/3): geselecteerd = oker-accent.
  const cnCard = (selected: boolean) =>
    `ios-pressable w-full flex items-center justify-between gap-3 rounded-2xl border px-4 py-3 text-left transition-colors ${selected ? 'border-oker-300 bg-oker-50 ring-1 ring-oker-200' : 'border-slate-200 bg-white hover:bg-slate-50'}`;
  // "krijgt: dienst 4101 (vr 10/07)" of "krijgt: vrij (vr 10/07)"
  const returnLabel = (swap: SwapRequest) => {
    if (!swap.returnCode || !swap.returnDate) return null;
    const what = swap.returnCode.toLowerCase() === 'vrij' ? 'vrij' : `dienst ${swap.returnCode}`;
    return `${what} (${fmtShort(swap.returnDate)})`;
  };
  const eligibleTargetDrivers = useMemo(() => {
    const base = users
      // Alleen chauffeurs: planner/admin staan niet in de planning-matrix en
      // toonden daardoor altijd "bezet" → doodlopend pad in stap 3.
      .filter((u) => u.id !== user.id && u.isActive !== false && u.role === 'chauffeur' && u.name.toLowerCase() !== 'beheerder')
      .sort((a, b) => a.name.localeCompare(b.name));
    if (!freeForDate) return base;
    // Vrije collega's eerst (matching), daarna de rest. Beide blijven kiesbaar
    // — de planner kan altijd overschrijven.
    return [...base].sort((a, b) => {
      const af = freeForDate.has(a.id) ? 0 : 1;
      const bf = freeForDate.has(b.id) ? 0 : 1;
      return af - bf || a.name.localeCompare(b.name);
    });
  }, [users, user.id, freeForDate]);
  const freeCount = freeForDate
    ? eligibleTargetDrivers.filter((u) => freeForDate.has(u.id)).length
    : null;
  const mySwaps = swaps.filter(s => s.requesterId === user.id);
  // Aan mij gerichte ruilverzoeken: pending (te beantwoorden) + accepted
  // (door mij geaccepteerd, wacht op planner) zodat de collega de status volgt.
  const availableSwaps = swaps.filter(s => {
    if (s.requesterId === user.id) return false;
    if (s.status !== 'pending' && s.status !== 'accepted') return false;
    // Tonen aan de chauffeur waaraan de ruil gericht is. Planner/admin
    // ziet alle openstaande ruilverzoeken (zoals voorheen).
    if (!isPlanner && s.targetDriverId && s.targetDriverId !== user.id) return false;

    const requester = users.find(u => u.id === s.requesterId);
    const isBeheerder = requester?.name.toLowerCase() === 'beheerder';
    if (isBeheerder) return false;
    return true;
  });

  const handleOfferShift = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;
    if (!selectedShift || !selectedTargetDriver || !returnPick) return;

    const sep = returnPick.indexOf('|');
    const returnDate = returnPick.slice(0, sep);
    const returnCode = returnPick.slice(sep + 1);

    const newSwap: SwapRequest = {
      id: typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      shiftId: selectedShift,
      requesterId: user.id,
      targetDriverId: selectedTargetDriver,
      status: 'pending',
      createdAt: new Date().toISOString(),
      reason,
      returnDate,
      returnCode,
    };

    // Pas sluiten/wissen ná een geslaagde save — bij een fout blijft de
    // ingevulde aanvraag staan zodat de chauffeur niet opnieuw moet beginnen.
    setIsSubmitting(true);
    const ok = await Promise.resolve(onSave([...swaps, newSwap])).finally(() => setIsSubmitting(false));
    if (ok === false) return;
    setShowOfferModal(false);
    setSelectedShift('');
    setSelectedTargetDriver('');
    setReason('');
    setReturnPick('');
  };

  const handleStatusUpdate = (swapId: string, newStatus: SwapRequest['status']) => {
    // Delta-pad (PATCH per record, met conflictdetectie): twee mensen die
    // tegelijk beoordelen overschrijven elkaar niet meer — de tweede krijgt
    // een nette melding en een verse lijst.
    if (onDecide) {
      void onDecide(swapId, newStatus);
      return;
    }
    // 'accepted' is een tussenstap (collega akkoord) — nog géén beslismoment;
    // decidedAt zetten we pas bij een definitieve beslissing.
    const isFinal = newStatus !== 'pending' && newStatus !== 'accepted';
    const decidedAt = isFinal ? new Date().toISOString() : undefined;
    const updatedSwaps = swaps.map(s =>
      s.id === swapId
        ? { ...s, status: newStatus, ...(decidedAt ? { decidedAt } : {}) }
        : s
    );
    onSave(updatedSwaps);
  };

  // Admin-override: een ruil die nog op de collega wacht ('pending') tóch
  // rechtstreeks goedkeuren, zónder bevestiging van de collega. Alleen admin
  // (de server dwingt dit ook af). Bewust met waarschuwing.
  const handleAdminForceApprove = (swapId: string) => {
    setConfirmAction({
      title: 'Direct goedkeuren',
      message: 'De collega heeft deze ruil nog niet bevestigd. Wil je hem als admin tóch rechtstreeks goedkeuren?',
      confirmText: 'Toch goedkeuren',
      variant: 'warning',
      run: () => handleStatusUpdate(swapId, 'approved'),
    });
  };

  // Collega-acties op een aan hem/haar gerichte, openstaande ruil.
  const handleAccept = (swapId: string) => {
    setConfirmAction({
      title: 'Dienstruil accepteren',
      message: 'Deze dienstruil accepteren? De planner beoordeelt ze daarna nog (rij- en rusttijden).',
      confirmText: 'Accepteren',
      variant: 'warning',
      run: () => handleStatusUpdate(swapId, 'accepted'),
    });
  };
  const handleDecline = (swapId: string) => {
    setConfirmAction({
      title: 'Dienstruil weigeren',
      message: 'Deze dienstruil weigeren? Je collega ziet dat je niet kan.',
      confirmText: 'Weigeren',
      variant: 'danger',
      run: () => handleStatusUpdate(swapId, 'rejected'),
    });
  };

  const handleCancel = (swapId: string) => {
    setConfirmAction({
      title: 'Dienstruil annuleren',
      message: 'Deze goedgekeurde dienstruil annuleren? De oorspronkelijke planning geldt dan weer.',
      confirmText: 'Annuleren',
      variant: 'danger',
      run: () => handleStatusUpdate(swapId, 'cancelled'),
    });
  };

  return (
    <PageShell>
      <PageHeader
        title="Dienstruil"
        description="Ruil een dienst met een collega, die accepteert eerst, daarna keurt de planning goed."
        actions={(
          <button
            onClick={() => {
              // Verse wizard bij elk openen — geen halve vorige aanvraag.
              setWizardStep(1);
              setSelectedShift('');
              setSelectedTargetDriver('');
              setReturnPick('');
              setReason('');
              setShowBusyColleagues(false);
              setShowAllReturns(false);
              setShowAllShifts(false);
              setShowOfferModal(true);
            }}
            className="btn-primary ios-pressable px-6 py-3 text-sm"
          >
            Dienstruil aanvragen
          </button>
        )}
      />

      <div className="grid md:grid-cols-2 gap-8">
        <div className="space-y-4">
          <MicroLabel className="text-slate-500 ml-1">Mijn Verzoeken</MicroLabel>
          {mySwaps.length > 0 ? (
            /* Compacte, uitklapbare rijen in een eigen scrollcontainer: deze
               lijst groeit onbegrensd mee met de historiek (wens Jarno). */
            <div className="max-h-[420px] overflow-y-auto overscroll-contain space-y-2 -mx-1 px-1">
              {mySwaps.map(swap => {
                const shift = shifts.find(s => s.id === swap.shiftId);
                const target = users.find(u => u.id === swap.targetDriverId);
                const open = expandedSwapIds.includes(swap.id);
                return (
                  <div key={swap.id} className="surface-card rounded-2xl overflow-hidden">
                    <button
                      type="button"
                      onClick={() => toggleSwapExpanded(swap.id)}
                      aria-expanded={open}
                      className="w-full flex items-center justify-between gap-3 p-3.5 pl-4 text-left"
                    >
                      <div className="min-w-0 flex items-baseline gap-2.5">
                        <span className="text-[13px] font-bold tracking-tight text-slate-800 whitespace-nowrap">Dienst {getServiceNumber(shift)}</span>
                        <span className="text-[11px] font-medium text-slate-400 capitalize truncate">{formatDateHuman(shift?.date)}</span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <StatusBadge status={swap.status} />
                        <ChevronDown size={15} className={`text-slate-400 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
                      </div>
                    </button>
                    {open && (
                      <div className="px-4 pb-4 pt-0.5">
                        <p className="text-xs font-medium text-slate-500 tabular-nums">{shift?.startTime} - {shift?.endTime}</p>
                        {target && (
                          <p className="text-xs font-medium text-slate-500 mt-1.5">Aan: <span className="font-semibold text-slate-800">{target.name}</span></p>
                        )}
                        {returnLabel(swap) && (
                          <p className="text-xs font-medium text-blue-600 dark:text-blue-400 mt-1">In ruil: {returnLabel(swap)}</p>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <EmptyState
              icon={<ArrowLeftRight size={28} />}
              title="Nog geen ruilverzoeken"
              message='Wil je een dienst wisselen met een collega? Klik op "Dienstruil aanvragen" — je collega en de planner keuren daarna goed.'
            />
          )}
        </div>

        <div className="space-y-4">
          <MicroLabel className="text-slate-500 ml-1">Openstaande Dienstruilen</MicroLabel>
          {availableSwaps.length > 0 ? (
            availableSwaps.map(swap => {
              const shift = shifts.find(s => s.id === swap.shiftId);
              const requester = users.find(u => u.id === swap.requesterId);
              const canRespond = canRespondToSwap(user, swap);
              return (
                <div key={swap.id} className="surface-card p-5 rounded-2xl space-y-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <MicroLabel>Dienst {getServiceNumber(shift)}</MicroLabel>
                      <p className="font-bold tracking-tight text-slate-800 mt-1 capitalize">{formatDateHuman(shift?.date)}</p>
                      <p className="text-xs font-medium text-slate-500 tabular-nums">{shift?.startTime} - {shift?.endTime}</p>
                      <p className="text-xs font-medium text-slate-500">Door: {requester?.name}</p>
                      {returnLabel(swap) && (
                        <p className="text-xs font-medium text-blue-600 dark:text-blue-400 mt-1">Jij geeft: {returnLabel(swap)}</p>
                      )}
                    </div>
                    <span className="shrink-0">
                      {canRespond ? <Badge tone="amber" dot>Jouw antwoord</Badge> : <StatusBadge status={swap.status} />}
                    </span>
                  </div>
                  {swap.reason && <p className="text-xs text-slate-500 italic">"{swap.reason}"</p>}
                  {canRespond ? (
                    <div className="flex gap-2 pt-1">
                      <Button variant="success" className="flex-1" icon={<Check size={15} />} onClick={() => handleAccept(swap.id)}>
                        Accepteren
                      </Button>
                      <Button variant="danger" className="flex-1" icon={<X size={15} />} onClick={() => handleDecline(swap.id)}>
                        Weigeren
                      </Button>
                    </div>
                  ) : swap.status === 'accepted' && swap.targetDriverId === user.id ? (
                    <p className="text-xs font-medium text-blue-600 dark:text-blue-400">Je accepteerde deze ruil — de planner valideert nog (rij-/rusttijden).</p>
                  ) : null}
                </div>
              );
            })
          ) : (
            <EmptyState
              icon={<ArrowLeftRight size={28} />}
              title="Geen openstaande wissels"
              message="Stelt een collega jou een ruil voor, dan verschijnt die hier en krijg je een melding."
            />
          )}
        </div>
      </div>

      <ConfirmationModal
        isOpen={!!confirmAction}
        onClose={() => setConfirmAction(null)}
        onConfirm={() => { confirmAction?.run(); setConfirmAction(null); }}
        title={confirmAction?.title ?? ''}
        message={confirmAction?.message ?? ''}
        confirmText={confirmAction?.confirmText ?? 'Bevestigen'}
        variant={confirmAction?.variant ?? 'warning'}
      />

      {isPlanner && (() => {
        const actionableSwaps = swaps.filter(s => {
          if (s.status !== 'pending' && s.status !== 'accepted' && s.status !== 'approved') return false;
          const requester = users.find(u => u.id === s.requesterId);
          const isBeheerder = requester?.name.toLowerCase() === 'beheerder';
          const isMe = s.requesterId === user.id;
          if (isBeheerder && !isMe) return false;
          return true;
        });

        return (
          <div className="space-y-4 pt-8">
            <MicroLabel className="text-slate-500 ml-1">Beheer Dienstruilen</MicroLabel>
            <TableShell>
              {/* Desktop table */}
              <div className="hidden md:block">
                <table className="w-full text-left">
                  <thead className="bg-slate-50 border-b border-slate-100">
                    <tr>
                      <Th>Chauffeur</Th>
                      <Th>Dienst</Th>
                      <Th>Status</Th>
                      <Th>Acties</Th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {actionableSwaps.map(swap => {
                      const shift = shifts.find(s => s.id === swap.shiftId);
                      const requester = users.find(u => u.id === swap.requesterId);
                      return (
                        <tr key={swap.id} className="hover:bg-slate-50/60 transition-colors">
                          <Td>
                            <button
                              type="button"
                              onClick={() => setReviewSwap(swap)}
                              title="Details bekijken"
                              className="group inline-flex items-center gap-1.5 text-left"
                            >
                              <span className="min-w-0">
                                <span className="block font-semibold text-slate-800">{requester?.name}</span>
                                {swap.targetDriverId && (
                                  <span className="block text-[11px] font-medium text-slate-400">→ {users.find(u => u.id === swap.targetDriverId)?.name || 'onbekend'}</span>
                                )}
                              </span>
                              <ChevronRight size={14} className="shrink-0 text-slate-300 transition-colors group-hover:text-slate-600" />
                            </button>
                          </Td>
                          <Td>
                            <span className="font-semibold text-oker-700">Dienst {getServiceNumber(shift)}</span>
                            <span className="text-slate-500 tabular-nums"> — {formatDateHuman(shift?.date)} ({shift?.startTime} - {shift?.endTime})</span>
                            {returnLabel(swap) && (
                              <span className="block text-[11px] font-medium text-blue-600 dark:text-blue-400 mt-0.5">↔ in ruil: {returnLabel(swap)}</span>
                            )}
                          </Td>
                          <Td><StatusBadge status={swap.status} /></Td>
                          <Td>
                            <div className="flex items-center gap-1.5">
                              <Button variant="ghost" size="sm" icon={<History size={16} />} aria-label="Wijzigingsgeschiedenis" title="Wijzigingsgeschiedenis" onClick={() => setHistorySwap(swap)} />
                              {swap.status === 'accepted' && (
                                <>
                                  <Button variant="ghost" size="sm" icon={<Check size={16} />} className="text-emerald-700 hover:text-emerald-700 hover:bg-emerald-50" aria-label="Goedkeuren" title="Goedkeuren (rij-/rusttijden ok)" onClick={() => handleStatusUpdate(swap.id, 'approved')} />
                                  <Button variant="ghost" size="sm" icon={<X size={16} />} className="text-red-700 hover:text-red-700 hover:bg-red-50" aria-label="Afwijzen" title="Afwijzen" onClick={() => handleStatusUpdate(swap.id, 'rejected')} />
                                </>
                              )}
                              {swap.status === 'pending' && (isAdmin ? (
                                <>
                                  <Button variant="ghost" size="sm" icon={<Check size={16} />} className="text-emerald-700 hover:text-emerald-700 hover:bg-emerald-50" aria-label="Direct goedkeuren" title="Direct goedkeuren — collega heeft nog niet bevestigd" onClick={() => handleAdminForceApprove(swap.id)} />
                                  <Button variant="ghost" size="sm" icon={<X size={16} />} className="text-red-700 hover:text-red-700 hover:bg-red-50" aria-label="Afwijzen" title="Afwijzen" onClick={() => handleStatusUpdate(swap.id, 'rejected')} />
                                </>
                              ) : (
                                <>
                                  <Badge tone="amber" dot className="whitespace-nowrap">wacht op collega</Badge>
                                  <Button variant="ghost" size="sm" icon={<X size={16} />} className="text-red-700 hover:text-red-700 hover:bg-red-50" aria-label="Afwijzen" title="Afwijzen" onClick={() => handleStatusUpdate(swap.id, 'rejected')} />
                                </>
                              ))}
                              {swap.status === 'approved' && (
                                <Button variant="danger" size="sm" onClick={() => handleCancel(swap.id)}>Annuleren</Button>
                              )}
                            </div>
                          </Td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Mobile cards */}
              <div className="md:hidden divide-y divide-slate-100">
                {actionableSwaps.map(swap => {
                  const shift = shifts.find(s => s.id === swap.shiftId);
                  const requester = users.find(u => u.id === swap.requesterId);
                  return (
                    <div key={swap.id} className="p-5 space-y-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <button
                            type="button"
                            onClick={() => setReviewSwap(swap)}
                            title="Details bekijken"
                            className="group flex items-center gap-1.5 text-left"
                          >
                            <span className="font-bold tracking-tight text-slate-800">
                              {requester?.name}
                              {swap.targetDriverId && <span className="font-medium text-slate-400"> → {users.find(u => u.id === swap.targetDriverId)?.name || 'onbekend'}</span>}
                            </span>
                            <ChevronRight size={14} className="shrink-0 text-slate-300 transition-colors group-hover:text-slate-600" />
                          </button>
                          <MicroLabel className="text-oker-700 mt-1">Dienst {getServiceNumber(shift)}</MicroLabel>
                          <p className="text-xs font-medium text-slate-500 mt-1 tabular-nums">{formatDateHuman(shift?.date)} · {shift?.startTime} - {shift?.endTime}</p>
                          {returnLabel(swap) && (
                            <p className="text-[11px] font-medium text-blue-600 dark:text-blue-400 mt-1">↔ in ruil: {returnLabel(swap)}</p>
                          )}
                        </div>
                        <StatusBadge status={swap.status} className="shrink-0" />
                      </div>
                      <div className="flex gap-2 pt-1">
                        {swap.status === 'accepted' && (
                          <>
                            <Button variant="success" className="flex-1" icon={<Check size={15} />} onClick={() => handleStatusUpdate(swap.id, 'approved')}>
                              Goedkeuren
                            </Button>
                            <Button variant="danger" className="flex-1" icon={<X size={15} />} onClick={() => handleStatusUpdate(swap.id, 'rejected')}>
                              Afwijzen
                            </Button>
                          </>
                        )}
                        {swap.status === 'pending' && (isAdmin ? (
                          <>
                            <Button variant="success" className="flex-1" icon={<Check size={15} />} onClick={() => handleAdminForceApprove(swap.id)}>
                              Goedkeuren
                            </Button>
                            <Button variant="danger" className="flex-1" icon={<X size={15} />} onClick={() => handleStatusUpdate(swap.id, 'rejected')}>
                              Afwijzen
                            </Button>
                          </>
                        ) : (
                          <div className="flex-1 flex items-center justify-between gap-2">
                            <Badge tone="amber" dot>Wacht op collega</Badge>
                            <Button variant="danger" size="sm" onClick={() => handleStatusUpdate(swap.id, 'rejected')}>
                              Afwijzen
                            </Button>
                          </div>
                        ))}
                        {swap.status === 'approved' && (
                          <Button variant="danger" full onClick={() => handleCancel(swap.id)}>
                            Annuleren
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })}
                {actionableSwaps.length === 0 && (
                  <p className="text-center text-slate-400 font-medium italic py-8">Geen openstaande of goedgekeurde dienstruilen.</p>
                )}
              </div>
            </TableShell>
          </div>
        );
      })()}

      {createPortal(
      <AnimatePresence>
        {showOfferModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm">
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="glass-modal rounded-3xl w-full max-w-md max-h-[90dvh] flex flex-col overflow-hidden">
              <div className="px-6 py-5 md:px-8 border-b border-white/70 flex items-center justify-between shrink-0 gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  {wizardStep > 1 && (
                    <button
                      type="button"
                      onClick={() => setWizardStep((s) => (s === 3 ? 2 : 1))}
                      aria-label="Vorige stap"
                      className="shrink-0 inline-flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 hover:bg-slate-50"
                    >
                      <ChevronRight size={18} className="rotate-180" />
                    </button>
                  )}
                  <div className="min-w-0">
                    <h4 className="text-lg font-bold tracking-tight truncate">
                      {wizardStep === 1 ? 'Welke dienst wil je ruilen?' : wizardStep === 2 ? 'Met welke collega?' : 'Wat neem jij in ruil?'}
                    </h4>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">Stap {wizardStep} van 3</p>
                  </div>
                </div>
                <button onClick={() => setShowOfferModal(false)} aria-label="Sluiten" className="p-2 text-slate-400 hover:bg-slate-50 rounded-xl shrink-0"><X size={22} /></button>
              </div>
              <form onSubmit={handleOfferShift} className="p-6 md:p-8 space-y-4 overflow-y-auto flex-1">
                {/* ── Stap 1: kies je eigen (komende) dienst ── */}
                {wizardStep === 1 && (
                  myShifts.length === 0 ? (
                    <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800">
                      Je hebt geen komende diensten om te ruilen. {isPlanner ? 'Je kan in de Debug-pagina een fictieve test-dienst aanmaken om de flow te proberen.' : 'Vraag de planning om hulp.'}
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {(showAllShifts ? myShifts : myShifts.slice(0, 8)).map((s) => (
                        <button
                          key={s.id}
                          type="button"
                          onClick={() => { setSelectedShift(s.id); setSelectedTargetDriver(''); setReturnPick(''); setWizardStep(2); }}
                          className={cnCard(selectedShift === s.id)}
                        >
                          <span className="min-w-0">
                            <span className="block text-sm font-bold text-slate-800 capitalize">{formatDateHuman(s.date)}</span>
                            <span className="block text-xs font-medium text-slate-500 tabular-nums">Dienst {getServiceNumber(s)} · {s.startTime} – {s.endTime}</span>
                          </span>
                          <ChevronRight size={16} className="shrink-0 text-slate-300" />
                        </button>
                      ))}
                      {!showAllShifts && myShifts.length > 8 && (
                        <button type="button" onClick={() => setShowAllShifts(true)} className="w-full text-center text-xs font-semibold text-oker-700 hover:text-oker-800 py-3 min-h-11">
                          Meer tonen ({myShifts.length - 8} extra)
                        </button>
                      )}
                    </div>
                  )
                )}

                {/* ── Stap 2: kies de collega (vrije eerst) ── */}
                {wizardStep === 2 && (
                  <>
                    <p className="text-xs font-medium text-slate-500">
                      Jouw dienst: <span className="font-bold text-slate-800">Dienst {getServiceNumber(shifts.find((s) => s.id === selectedShift))}</span>
                      {selectedShiftDate && <span className="capitalize"> · {formatDateHuman(selectedShiftDate)}</span>}
                    </p>
                    {matchLoading ? (
                      <p className="text-sm font-medium text-slate-400 py-6 text-center">Beschikbaarheid laden…</p>
                    ) : (
                      <>
                        <div className="space-y-2">
                          {eligibleTargetDrivers
                            .filter((u) => showBusyColleagues || !freeForDate || freeForDate.has(u.id))
                            .map((u) => {
                              const free = freeForDate?.has(u.id);
                              return (
                                <button
                                  key={u.id}
                                  type="button"
                                  onClick={() => { setSelectedTargetDriver(u.id); setReturnPick(''); setShowAllReturns(false); setWizardStep(3); }}
                                  className={cnCard(selectedTargetDriver === u.id)}
                                >
                                  <span className="text-sm font-bold text-slate-800 truncate">{u.name}</span>
                                  <span className="shrink-0 inline-flex items-center gap-2">
                                    {freeForDate && (
                                      free
                                        ? <Badge tone="emerald" dot>vrij</Badge>
                                        : <Badge tone="slate">bezet</Badge>
                                    )}
                                    <ChevronRight size={16} className="text-slate-300" />
                                  </span>
                                </button>
                              );
                            })}
                        </div>
                        {freeForDate && !showBusyColleagues && eligibleTargetDrivers.some((u) => !freeForDate.has(u.id)) && (
                          <button type="button" onClick={() => setShowBusyColleagues(true)} className="w-full text-center text-xs font-semibold text-oker-700 hover:text-oker-800 py-3 min-h-11">
                            Toon ook bezette collega's ({eligibleTargetDrivers.filter((u) => !freeForDate.has(u.id)).length})
                          </button>
                        )}
                        {freeForDate && freeCount === 0 && !showBusyColleagues && (
                          <p className="text-xs font-medium text-slate-400 text-center">Niemand is vrij op {formatDateHuman(selectedShiftDate)} — je kan wel een bezette collega vragen.</p>
                        )}
                        <p className="text-[11px] font-medium text-slate-400">"Vrij" = geen dienst en geen verlof op {selectedShiftDate ? formatDateHuman(selectedShiftDate) : 'die dag'}.</p>
                      </>
                    )}
                  </>
                )}

                {/* ── Stap 3: tegenprestatie + samenvatting + indienen ── */}
                {wizardStep === 3 && (() => {
                  const target = users.find((u) => u.id === selectedTargetDriver);
                  const offered = shifts.find((s) => s.id === selectedShift);
                  // Conflict-check op shift-niveau (niet dag-niveau): alleen de
                  // aangeboden shift zelf telt niet mee — een tweede eigen
                  // segment op dezelfde dag blijft een conflict. Ook eigen
                  // goedgekeurd verlof blokkeert een tegenprestatie.
                  const ownConflictOn = (date: string): string | undefined => {
                    const otherOwnShift = shifts.find(
                      (s) => s.driverId === user.id && s.date === date && s.id !== selectedShift,
                    );
                    if (otherOwnShift) return `dienst ${String(otherOwnShift.line || '?').trim()}`;
                    const ownLeave = leaveRequests.find(
                      (l) => l.userId === user.id && l.status === 'approved' && l.startDate <= date && date <= l.endDate,
                    );
                    if (ownLeave) return 'verlof';
                    return undefined;
                  };
                  const enriched = (returnOptions ?? []).map((o) => ({
                    ...o,
                    ownDuty: ownConflictOn(o.date),
                  }));
                  const pickable = enriched.filter((o) => !o.ownDuty);
                  const conflicted = enriched.filter((o) => !!o.ownDuty);
                  const visiblePickable = showAllReturns ? pickable : pickable.slice(0, 8);
                  const pick = returnPick ? { date: returnPick.slice(0, returnPick.indexOf('|')), code: returnPick.slice(returnPick.indexOf('|') + 1) } : null;
                  return (
                    <>
                      <p className="text-xs font-medium text-slate-500">
                        Jij geeft <span className="font-bold text-slate-800">dienst {getServiceNumber(offered)}</span>
                        {selectedShiftDate && <span> ({fmtShort(selectedShiftDate)})</span>} aan <span className="font-bold text-slate-800">{target?.name ?? '—'}</span>. Wat neem je van {target?.name?.split(' ')[0] ?? 'de collega'} over?
                      </p>
                      {returnLoading ? (
                        <p className="text-sm font-medium text-slate-400 py-6 text-center">Diensten laden…</p>
                      ) : pickable.length === 0 && conflicted.length === 0 ? (
                        <p className="text-sm font-medium text-slate-400 py-4 text-center">Geen diensten of vrije dagen van {target?.name ?? 'deze collega'} gevonden in de komende 8 weken.</p>
                      ) : (
                        <>
                          <div className="space-y-2">
                            {visiblePickable.map((o) => {
                              const val = `${o.date}|${o.code}`;
                              const selected = returnPick === val;
                              return (
                                <button
                                  key={val}
                                  type="button"
                                  onClick={() => setReturnPick(selected ? '' : val)}
                                  className={cnCard(selected)}
                                >
                                  <span className="min-w-0">
                                    <span className="block text-sm font-bold text-slate-800 capitalize">{formatDateHuman(o.date)}</span>
                                    <span className="block text-xs font-medium text-slate-500">{o.isFree ? 'Vrije dag van de collega' : `Dienst ${o.code}`}</span>
                                  </span>
                                  {selected ? <Check size={16} className="shrink-0 text-oker-600" /> : <span className="shrink-0 h-4 w-4 rounded-full border border-slate-300" />}
                                </button>
                              );
                            })}
                          </div>
                          {!showAllReturns && (pickable.length > 8 || conflicted.length > 0) && (
                            <button type="button" onClick={() => setShowAllReturns(true)} className="w-full text-center text-xs font-semibold text-oker-700 hover:text-oker-800 py-3 min-h-11">
                              Meer tonen{pickable.length > 8 ? ` (${pickable.length - 8} extra)` : ''}
                            </button>
                          )}
                          {showAllReturns && conflicted.length > 0 && (
                            <div className="space-y-2">
                              <MicroLabel className="text-slate-400">Niet mogelijk — jij bent die dag al ingepland</MicroLabel>
                              {conflicted.map((o) => (
                                <div key={`${o.date}|${o.code}`} className="flex items-center justify-between gap-3 rounded-2xl border border-slate-100 bg-slate-50/60 px-4 py-3 opacity-60">
                                  <span className="min-w-0">
                                    <span className="block text-sm font-semibold text-slate-500 capitalize">{formatDateHuman(o.date)}</span>
                                    <span className="block text-xs font-medium text-slate-400">{o.isFree ? "Vrije dag van de collega" : `Dienst ${o.code}`} — {o.ownDuty === "verlof" ? "jij hebt die dag verlof" : `jij rijdt al ${o.ownDuty}`}</span>
                                  </span>
                                </div>
                              ))}
                            </div>
                          )}
                        </>
                      )}
                      <div className="space-y-2 pt-1">
                        <MicroLabel className="ml-1">Info voor je collega (optioneel)</MicroLabel>
                        {/* onFocus: houd het veld boven het iOS-toetsenbord —
                            zonder scroll verdween de verstuurknop erachter. */}
                        <textarea
                          aria-label="Reden voor de ruil" value={reason}
                          onChange={(e) => setReason(e.target.value)}
                          onFocus={(e) => setTimeout(() => e.target.scrollIntoView({ block: 'center', behavior: 'smooth' }), 250)}
                          className="control-input w-full px-4 py-3 rounded-2xl font-medium text-sm outline-none h-14 resize-none"
                          placeholder="Waarom wil je ruilen?"
                        />
                      </div>
                      {pick && (
                        <div className="rounded-2xl border border-oker-200 bg-oker-50 px-4 py-3 text-sm font-medium text-slate-800">
                          Jij geeft <strong>dienst {getServiceNumber(offered)}</strong> ({selectedShiftDate ? fmtShort(selectedShiftDate) : '—'}) aan <strong>{target?.name}</strong> — jij neemt {pick.code.toLowerCase() === 'vrij' ? <>zijn <strong>vrije dag</strong></> : <>zijn <strong>dienst {pick.code}</strong></>} ({fmtShort(pick.date)}).
                        </div>
                      )}
                      <button
                        type="submit"
                        disabled={!selectedShift || !selectedTargetDriver || !returnPick || isSubmitting}
                        className="btn-primary ios-pressable w-full py-4 disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        {isSubmitting ? 'Versturen…' : 'Ruilverzoek versturen'}
                      </button>
                      <p className="text-[11px] font-medium text-slate-400 text-center">{target?.name?.split(' ')[0] ?? 'Je collega'} moet eerst accepteren; daarna keurt de planner goed.</p>
                    </>
                  );
                })()}
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>,
        document.body,
      )}

      {/* Beoordeling in een side panel: volledige ruil-context + dezelfde
          beslis-acties als de tabelrij, zonder paginawissel. */}
      <SlideOver
        open={!!reviewSwap}
        onClose={() => setReviewSwap(null)}
        title={reviewSwap ? (users.find((u) => u.id === reviewSwap.requesterId)?.name ?? 'Onbekend') : 'Dienstruil'}
        subtitle={reviewSwap ? `Aangevraagd op ${formatDateHuman(reviewSwap.createdAt)}` : undefined}
        icon={
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-oker-500/15 text-oker-600 dark:text-oker-400">
            <ArrowLeftRight size={17} />
          </span>
        }
        footer={reviewSwap ? (
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="md"
              icon={<History size={14} />}
              onClick={() => setHistorySwap(reviewSwap)}
              aria-label="Wijzigingsgeschiedenis"
              title="Wijzigingsgeschiedenis"
            />
            {reviewSwap.status === 'accepted' && (
              <>
                <Button
                  variant="danger"
                  size="lg"
                  className="flex-1"
                  onClick={() => { handleStatusUpdate(reviewSwap.id, 'rejected'); setReviewSwap(null); }}
                >
                  Afwijzen
                </Button>
                <Button
                  variant="success"
                  size="lg"
                  className="flex-1"
                  icon={<Check size={15} />}
                  onClick={() => { handleStatusUpdate(reviewSwap.id, 'approved'); setReviewSwap(null); }}
                >
                  Goedkeuren
                </Button>
              </>
            )}
            {reviewSwap.status === 'pending' && (isAdmin ? (
              <>
                <Button
                  variant="danger"
                  size="lg"
                  className="flex-1"
                  onClick={() => { handleStatusUpdate(reviewSwap.id, 'rejected'); setReviewSwap(null); }}
                >
                  Afwijzen
                </Button>
                <Button
                  variant="success"
                  size="lg"
                  className="flex-1"
                  icon={<Check size={15} />}
                  onClick={() => { handleAdminForceApprove(reviewSwap.id); setReviewSwap(null); }}
                >
                  Goedkeuren
                </Button>
              </>
            ) : (
              <>
                <Badge tone="amber" dot className="mr-auto">Wacht op collega</Badge>
                <Button
                  variant="danger"
                  size="lg"
                  onClick={() => { handleStatusUpdate(reviewSwap.id, 'rejected'); setReviewSwap(null); }}
                >
                  Afwijzen
                </Button>
              </>
            ))}
            {reviewSwap.status === 'approved' && (
              <Button
                variant="danger"
                size="lg"
                className="flex-1"
                onClick={() => { handleCancel(reviewSwap.id); setReviewSwap(null); }}
              >
                Annuleren
              </Button>
            )}
          </div>
        ) : undefined}
      >
        {reviewSwap && (() => {
          const shift = shifts.find((s) => s.id === reviewSwap.shiftId);
          const requester = users.find((u) => u.id === reviewSwap.requesterId);
          const target = reviewSwap.targetDriverId ? users.find((u) => u.id === reviewSwap.targetDriverId) : undefined;
          return (
            <div className="space-y-5">
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge status={reviewSwap.status} />
                <Badge tone="oker">Dienst {getServiceNumber(shift)}</Badge>
                {shift?.date && (
                  <Badge tone="slate" className="tabular-nums">{shift.date} · {shift.startTime} - {shift.endTime}</Badge>
                )}
              </div>

              <div className="surface-muted rounded-xl p-4">
                <MicroLabel className="text-slate-500">Ruil</MicroLabel>
                <p className="mt-1.5 text-sm font-semibold text-slate-800">
                  {requester?.name ?? 'Onbekend'}
                  <span className="mx-1.5 font-medium text-slate-400">→</span>
                  {target?.name ?? 'open verzoek'}
                </p>
                {returnLabel(reviewSwap) && (
                  <p className="mt-1 text-xs font-medium text-blue-600 dark:text-blue-400">↔ in ruil: {returnLabel(reviewSwap)}</p>
                )}
              </div>

              {reviewSwap.reason && (
                <div>
                  <MicroLabel>Toelichting van de aanvrager</MicroLabel>
                  <p className="mt-2 whitespace-pre-wrap rounded-xl bg-slate-50 border border-slate-100 px-4 py-3 text-sm font-normal leading-relaxed text-slate-700">
                    {reviewSwap.reason}
                  </p>
                </div>
              )}
            </div>
          );
        })()}
      </SlideOver>

      <EntityHistoryModal
        open={!!historySwap}
        onClose={() => setHistorySwap(null)}
        entityType="swap"
        entityId={historySwap?.id ?? ''}
        title={historySwap ? `${users.find((u) => u.id === historySwap.requesterId)?.name || 'Onbekend'} — ${shifts.find((s) => s.id === historySwap.shiftId)?.date ?? ''}` : undefined}
      />
    </PageShell>
  );
}
