import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'motion/react';
import { ArrowLeftRight, ChevronRight, History, X, Check } from 'lucide-react';
import type { Shift, SwapRequest, User } from '../types';
import { PageHeader, PageShell } from '../components/ui';
import { Badge, Button, MicroLabel, StatusBadge, TableShell, Td, Th } from '../components/primitives';
import { SlideOver } from '../components/SlideOver';
import { EntityHistoryModal } from '../components/EntityHistoryModal';
import { fetchAvailability, isoDate, addDays } from '../lib/availability';
import { canRespondToSwap } from '../lib/authorization';

type ReturnOption = { date: string; code: string; isFree: boolean };

export function SwapRequestsView({ user, swaps, shifts, users, onSave, onDecide }: { user: User, swaps: SwapRequest[], shifts: Shift[], users: User[], onSave: (s: SwapRequest[]) => void, onDecide?: (id: string, status: SwapRequest['status']) => Promise<boolean> }) {
  const [showOfferModal, setShowOfferModal] = useState(false);
  const [selectedShift, setSelectedShift] = useState<string>('');
  const [selectedTargetDriver, setSelectedTargetDriver] = useState<string>('');
  const [reason, setReason] = useState('');
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
  }, [selectedTargetDriver]);

  const isPlanner = user.role === 'planner' || user.role === 'admin';
  const isAdmin = user.role === 'admin';
  const myShifts = shifts.filter(s => s.driverId === user.id);
  const getServiceNumber = (shift: Shift | undefined) => String(shift?.line || '--').trim() || '--';
  const fmtShort = (iso: string) => {
    try { return new Date(`${iso}T00:00:00`).toLocaleDateString('nl-BE', { weekday: 'short', day: '2-digit', month: '2-digit' }); }
    catch { return iso; }
  };
  // "krijgt: dienst 4101 (vr 10/07)" of "krijgt: vrij (vr 10/07)"
  const returnLabel = (swap: SwapRequest) => {
    if (!swap.returnCode || !swap.returnDate) return null;
    const what = swap.returnCode.toLowerCase() === 'vrij' ? 'vrij' : `dienst ${swap.returnCode}`;
    return `${what} (${fmtShort(swap.returnDate)})`;
  };
  const eligibleTargetDrivers = useMemo(() => {
    const base = users
      .filter((u) => u.id !== user.id && u.isActive !== false && u.name.toLowerCase() !== 'beheerder')
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

  const handleOfferShift = (e: React.FormEvent) => {
    e.preventDefault();
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

    onSave([...swaps, newSwap]);
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
    if (!window.confirm('De collega heeft deze ruil nog niet bevestigd. Wil je hem als admin tóch rechtstreeks goedkeuren?')) return;
    handleStatusUpdate(swapId, 'approved');
  };

  // Collega-acties op een aan hem/haar gerichte, openstaande ruil.
  const handleAccept = (swapId: string) => handleStatusUpdate(swapId, 'accepted');
  const handleDecline = (swapId: string) => {
    if (!window.confirm('Deze dienstruil weigeren?')) return;
    handleStatusUpdate(swapId, 'rejected');
  };

  const handleCancel = (swapId: string) => {
    if (!window.confirm('Deze goedgekeurde dienstruil annuleren?')) return;
    handleStatusUpdate(swapId, 'cancelled');
  };

  return (
    <PageShell>
      <PageHeader
        title="Dienstruil"
        actions={(
          <button
            onClick={() => setShowOfferModal(true)}
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
            mySwaps.map(swap => {
              const shift = shifts.find(s => s.id === swap.shiftId);
              const target = users.find(u => u.id === swap.targetDriverId);
              return (
                <div key={swap.id} className="surface-card p-5 rounded-2xl flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <MicroLabel>Dienst {getServiceNumber(shift)}</MicroLabel>
                    <p className="font-bold tracking-tight text-slate-800 mt-1 tabular-nums">{shift?.date}</p>
                    <p className="text-xs font-medium text-slate-500 tabular-nums">{shift?.startTime} - {shift?.endTime}</p>
                    {target && (
                      <p className="text-xs font-medium text-slate-500 mt-2">Aan: <span className="font-semibold text-slate-800">{target.name}</span></p>
                    )}
                    {returnLabel(swap) && (
                      <p className="text-xs font-medium text-blue-600 dark:text-blue-400 mt-1">In ruil: {returnLabel(swap)}</p>
                    )}
                  </div>
                  <StatusBadge status={swap.status} className="shrink-0" />
                </div>
              );
            })
          ) : (
            <p className="text-slate-400 font-medium italic p-4">Geen actieve verzoeken.</p>
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
                      <p className="font-bold tracking-tight text-slate-800 mt-1 tabular-nums">{shift?.date}</p>
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
            <p className="text-slate-400 font-medium italic p-4">Geen openstaande wissels.</p>
          )}
        </div>
      </div>

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
                            <span className="text-slate-500 tabular-nums"> — {shift?.date} ({shift?.startTime} - {shift?.endTime})</span>
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
                          <p className="text-xs font-medium text-slate-500 mt-1 tabular-nums">{shift?.date} · {shift?.startTime} - {shift?.endTime}</p>
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
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="glass-modal rounded-3xl w-full max-w-md max-h-[90vh] flex flex-col overflow-hidden">
              <div className="p-8 border-b border-white/70 flex items-center justify-between shrink-0">
                <h4 className="text-xl font-bold tracking-tight">Dienstruil aanvragen</h4>
                <button onClick={() => setShowOfferModal(false)} className="p-2 text-slate-400 hover:bg-slate-50 rounded-xl"><X size={24} /></button>
              </div>
              <form onSubmit={handleOfferShift} className="p-8 space-y-6 overflow-y-auto flex-1">
                {myShifts.length === 0 && (
                  <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800">
                    Je hebt geen diensten op je naam staan om aan te bieden. {isPlanner ? 'Je kan in de Debug-pagina een fictieve test-dienst aanmaken om de flow te proberen.' : 'Vraag de planning om hulp.'}
                  </div>
                )}
                <div className="space-y-2">
                  <MicroLabel className="ml-1">Selecteer Dienst</MicroLabel>
                  <select
                    value={selectedShift}
                    onChange={(e) => setSelectedShift(e.target.value)}
                    className="control-input w-full px-4 py-3 rounded-2xl font-bold text-sm outline-none disabled:opacity-50 disabled:cursor-not-allowed"
                    required
                    disabled={myShifts.length === 0}
                  >
                    <option value="">Kies een dienst...</option>
                    {myShifts.map(s => (
                      <option key={s.id} value={s.id}>Dienst {getServiceNumber(s)} — {s.date} ({s.startTime} - {s.endTime})</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between ml-1">
                    <MicroLabel>Aan welke collega?</MicroLabel>
                    {selectedShiftDate && (
                      <span className="text-[10px] font-medium text-slate-400">
                        {matchLoading
                          ? 'Beschikbaarheid laden…'
                          : freeCount !== null
                            ? `${freeCount} vrij op ${selectedShiftDate}`
                            : ''}
                      </span>
                    )}
                  </div>
                  <select
                    value={selectedTargetDriver}
                    onChange={(e) => setSelectedTargetDriver(e.target.value)}
                    className="control-input w-full px-4 py-3 rounded-2xl font-bold text-sm outline-none disabled:opacity-50 disabled:cursor-not-allowed"
                    required
                    disabled={eligibleTargetDrivers.length === 0}
                  >
                    <option value="">Kies een collega...</option>
                    {eligibleTargetDrivers.map((u) => {
                      const free = freeForDate?.has(u.id);
                      return (
                        <option key={u.id} value={u.id}>
                          {u.name}{free ? ' · vrij' : freeForDate ? ' · bezet' : ''}
                        </option>
                      );
                    })}
                  </select>
                  {freeForDate && (
                    <p className="text-[10px] font-medium text-slate-400 ml-1">
                      "Vrij" = geen dienst en geen verlof op die dag. Bezette collega's blijven kiesbaar.
                    </p>
                  )}
                </div>
                <div className="space-y-2">
                  <MicroLabel className="ml-1">Wat neem jij in ruil?</MicroLabel>
                  <select
                    value={returnPick}
                    onChange={(e) => setReturnPick(e.target.value)}
                    className="control-input w-full px-4 py-3 rounded-2xl font-bold text-sm outline-none disabled:opacity-50 disabled:cursor-not-allowed"
                    required
                    disabled={!selectedTargetDriver || returnLoading || !returnOptions || returnOptions.length === 0}
                  >
                    <option value="">
                      {!selectedTargetDriver
                        ? 'Kies eerst een collega…'
                        : returnLoading
                          ? 'Diensten laden…'
                          : returnOptions && returnOptions.length === 0
                            ? 'Geen diensten/vrije dagen gevonden'
                            : 'Kies een dienst of vrije dag…'}
                    </option>
                    {(returnOptions ?? []).map((o) => (
                      <option key={`${o.date}|${o.code}`} value={`${o.date}|${o.code}`}>
                        {fmtShort(o.date)} · {o.isFree ? 'vrij' : `dienst ${o.code}`}
                      </option>
                    ))}
                  </select>
                  {selectedTargetDriver && (
                    <p className="text-[10px] font-medium text-slate-400 ml-1">
                      Jij neemt deze dienst/vrije dag over; de collega neemt jouw aangeboden dienst. (komende 8 weken)
                    </p>
                  )}
                </div>
                <div className="space-y-2">
                  <MicroLabel className="ml-1">Info (optioneel)</MicroLabel>
                  <textarea
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    className="control-input w-full px-4 py-3 rounded-2xl font-bold text-sm outline-none h-14 resize-none"
                    placeholder="Waarom wil je ruilen?"
                  />
                </div>
                <button
                  type="submit"
                  disabled={!selectedShift || !selectedTargetDriver || !returnPick}
                  className="btn-primary ios-pressable w-full py-4 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Dienstruil indienen
                </button>
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
        subtitle={reviewSwap ? `Aangevraagd op ${reviewSwap.createdAt.split('T')[0]}` : undefined}
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
