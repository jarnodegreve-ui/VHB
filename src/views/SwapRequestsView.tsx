import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'motion/react';
import { History, X, Check } from 'lucide-react';
import type { Shift, SwapRequest, User } from '../types';
import { cn } from '../lib/ui';
import { PageHeader, PageShell } from '../components/ui';
import { EntityHistoryModal } from '../components/EntityHistoryModal';
import { fetchAvailability, isoDate, addDays } from '../lib/availability';
import { canRespondToSwap } from '../lib/authorization';

type ReturnOption = { date: string; code: string; isFree: boolean };

export function SwapRequestsView({ user, swaps, shifts, users, onSave }: { user: User, swaps: SwapRequest[], shifts: Shift[], users: User[], onSave: (s: SwapRequest[]) => void }) {
  const [showOfferModal, setShowOfferModal] = useState(false);
  const [selectedShift, setSelectedShift] = useState<string>('');
  const [selectedTargetDriver, setSelectedTargetDriver] = useState<string>('');
  const [reason, setReason] = useState('');
  const [historySwap, setHistorySwap] = useState<SwapRequest | null>(null);
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
      id: Date.now().toString(),
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

  const statusLabels: Record<SwapRequest['status'], string> = {
    pending: 'In behandeling',
    accepted: 'Wacht op planner',
    approved: 'Goedgekeurd',
    rejected: 'Afgewezen',
    cancelled: 'Geannuleerd',
    completed: 'Voltooid',
  };
  const statusStyles: Record<SwapRequest['status'], string> = {
    pending: 'bg-amber-50 text-amber-600',
    accepted: 'bg-indigo-50 text-indigo-600',
    approved: 'bg-emerald-50 text-emerald-600',
    rejected: 'bg-red-50 text-red-600',
    cancelled: 'bg-slate-100 text-slate-500',
    completed: 'bg-blue-50 text-blue-600',
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
          <h4 className="text-xs font-black text-slate-400 uppercase tracking-[0.08em] ml-1">Mijn Verzoeken</h4>
          {mySwaps.length > 0 ? (
            mySwaps.map(swap => {
              const shift = shifts.find(s => s.id === swap.shiftId);
              const target = users.find(u => u.id === swap.targetDriverId);
              return (
                <div key={swap.id} className="surface-card p-6 rounded-3xl flex items-center justify-between gap-4">
                  <div>
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.08em]">Dienst {getServiceNumber(shift)}</p>
                    <p className="font-black text-slate-800 mt-1">{shift?.date}</p>
                    <p className="text-xs font-bold text-slate-400 uppercase tracking-[0.08em]">{shift?.startTime} - {shift?.endTime}</p>
                    {target && (
                      <p className="text-xs font-bold text-slate-500 mt-2">Aan: <span className="text-slate-800">{target.name}</span></p>
                    )}
                    {returnLabel(swap) && (
                      <p className="text-xs font-bold text-indigo-600 mt-1">In ruil: {returnLabel(swap)}</p>
                    )}
                  </div>
                  <span className={cn(
                    "px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-[0.08em]",
                    statusStyles[swap.status]
                  )}>
                    {statusLabels[swap.status]}
                  </span>
                </div>
              );
            })
          ) : (
            <p className="text-slate-400 font-medium italic p-4">Geen actieve verzoeken.</p>
          )}
        </div>

        <div className="space-y-4">
          <h4 className="text-xs font-black text-slate-400 uppercase tracking-[0.08em] ml-1">Openstaande Dienstruilen</h4>
          {availableSwaps.length > 0 ? (
            availableSwaps.map(swap => {
              const shift = shifts.find(s => s.id === swap.shiftId);
              const requester = users.find(u => u.id === swap.requesterId);
              const canRespond = canRespondToSwap(user, swap);
              return (
                <div key={swap.id} className="surface-card p-6 rounded-3xl space-y-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.08em]">Dienst {getServiceNumber(shift)}</p>
                      <p className="font-black text-slate-800 mt-1">{shift?.date}</p>
                      <p className="text-xs font-bold text-slate-400 uppercase tracking-[0.08em]">{shift?.startTime} - {shift?.endTime}</p>
                      <p className="text-xs font-bold text-slate-400 uppercase tracking-[0.08em]">Door: {requester?.name}</p>
                      {returnLabel(swap) && (
                        <p className="text-xs font-bold text-indigo-600 mt-1 normal-case tracking-normal">Jij geeft: {returnLabel(swap)}</p>
                      )}
                    </div>
                    <span className={cn(
                      'px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-[0.08em] shrink-0',
                      swap.status === 'accepted' ? statusStyles.accepted : 'bg-amber-50 text-amber-600',
                    )}>
                      {swap.status === 'accepted' ? 'Wacht op planner' : canRespond ? 'Jouw antwoord' : 'Wacht op planner'}
                    </span>
                  </div>
                  {swap.reason && <p className="text-xs text-slate-500 italic">"{swap.reason}"</p>}
                  {canRespond ? (
                    <div className="flex gap-2 pt-1">
                      <button
                        onClick={() => handleAccept(swap.id)}
                        className="flex-1 flex items-center justify-center gap-2 py-3 rounded-2xl bg-emerald-50 text-emerald-600 font-black text-xs uppercase tracking-[0.08em] active:scale-95 transition-all"
                      >
                        <Check size={16} /> Accepteren
                      </button>
                      <button
                        onClick={() => handleDecline(swap.id)}
                        className="flex-1 flex items-center justify-center gap-2 py-3 rounded-2xl bg-red-50 text-red-600 font-black text-xs uppercase tracking-[0.08em] active:scale-95 transition-all"
                      >
                        <X size={16} /> Weigeren
                      </button>
                    </div>
                  ) : swap.status === 'accepted' && swap.targetDriverId === user.id ? (
                    <p className="text-[11px] font-bold text-indigo-500">Je accepteerde deze ruil — de planner valideert nog (rij-/rusttijden).</p>
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
            <h4 className="text-xs font-black text-slate-400 uppercase tracking-[0.08em] ml-1">Beheer Dienstruilen</h4>
            <div className="surface-table rounded-3xl overflow-hidden">
              {/* Desktop table */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-left">
                  <thead className="bg-slate-50 border-b border-slate-100">
                    <tr>
                      <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-[0.08em]">Chauffeur</th>
                      <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-[0.08em]">Dienst</th>
                      <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-[0.08em]">Status</th>
                      <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-[0.08em]">Acties</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {actionableSwaps.map(swap => {
                      const shift = shifts.find(s => s.id === swap.shiftId);
                      const requester = users.find(u => u.id === swap.requesterId);
                      return (
                        <tr key={swap.id}>
                          <td className="px-6 py-4 font-bold text-sm">
                            {requester?.name}
                            {swap.targetDriverId && (
                              <span className="block text-[11px] font-medium text-slate-400">→ {users.find(u => u.id === swap.targetDriverId)?.name || 'onbekend'}</span>
                            )}
                          </td>
                          <td className="px-6 py-4 text-xs font-medium">
                            <span className="font-black text-oker-700">Dienst {getServiceNumber(shift)}</span>
                            <span className="text-slate-500"> — {shift?.date} ({shift?.startTime} - {shift?.endTime})</span>
                            {returnLabel(swap) && (
                              <span className="block text-[11px] font-bold text-indigo-600 mt-0.5">↔ in ruil: {returnLabel(swap)}</span>
                            )}
                          </td>
                          <td className="px-6 py-4">
                            <span className={cn('px-2 py-1 rounded-full text-[10px] font-black uppercase tracking-[0.08em]', statusStyles[swap.status])}>{statusLabels[swap.status]}</span>
                          </td>
                          <td className="px-6 py-4 flex gap-2">
                            <button onClick={() => setHistorySwap(swap)} title="Wijzigingsgeschiedenis" className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-50 rounded-lg transition-colors"><History size={18} /></button>
                            {swap.status === 'accepted' && (
                              <>
                                <button onClick={() => handleStatusUpdate(swap.id, 'approved')} title="Goedkeuren (rij-/rusttijden ok)" className="p-2 text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors"><Check size={18} /></button>
                                <button onClick={() => handleStatusUpdate(swap.id, 'rejected')} title="Afwijzen" className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"><X size={18} /></button>
                              </>
                            )}
                            {swap.status === 'pending' && (
                              <button onClick={() => handleStatusUpdate(swap.id, 'rejected')} title="Afwijzen (wacht op collega)" className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"><X size={18} /></button>
                            )}
                            {swap.status === 'approved' && (
                              <button onClick={() => handleCancel(swap.id)} className="px-3 py-2 text-[10px] font-black uppercase tracking-[0.08em] text-red-500 border border-red-200 rounded-lg hover:bg-red-50 transition-colors">Annuleren</button>
                            )}
                          </td>
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
                        <div>
                          <p className="font-black text-slate-800 tracking-tight">
                            {requester?.name}
                            {swap.targetDriverId && <span className="font-medium text-slate-400"> → {users.find(u => u.id === swap.targetDriverId)?.name || 'onbekend'}</span>}
                          </p>
                          <p className="text-[10px] font-black text-oker-700 uppercase tracking-[0.08em] mt-1">Dienst {getServiceNumber(shift)}</p>
                          <p className="text-xs font-medium text-slate-500 mt-1">{shift?.date} · {shift?.startTime} - {shift?.endTime}</p>
                          {returnLabel(swap) && (
                            <p className="text-[11px] font-bold text-indigo-600 mt-1">↔ in ruil: {returnLabel(swap)}</p>
                          )}
                        </div>
                        <span className={cn('px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-[0.08em] shrink-0', statusStyles[swap.status])}>{statusLabels[swap.status]}</span>
                      </div>
                      <div className="flex gap-2 pt-1">
                        {swap.status === 'accepted' && (
                          <>
                            <button onClick={() => handleStatusUpdate(swap.id, 'approved')} className="flex-1 flex items-center justify-center gap-2 py-3 rounded-2xl bg-emerald-50 text-emerald-600 font-black text-xs uppercase tracking-[0.08em] active:scale-95 transition-all">
                              <Check size={16} /> Goedkeuren
                            </button>
                            <button onClick={() => handleStatusUpdate(swap.id, 'rejected')} className="flex-1 flex items-center justify-center gap-2 py-3 rounded-2xl bg-red-50 text-red-600 font-black text-xs uppercase tracking-[0.08em] active:scale-95 transition-all">
                              <X size={16} /> Afwijzen
                            </button>
                          </>
                        )}
                        {swap.status === 'pending' && (
                          <div className="flex-1 flex items-center justify-between gap-2">
                            <span className="text-[11px] font-bold text-amber-600">Wacht op antwoord collega</span>
                            <button onClick={() => handleStatusUpdate(swap.id, 'rejected')} className="py-2 px-3 rounded-xl bg-red-50 text-red-600 font-black text-[10px] uppercase tracking-[0.08em] active:scale-95 transition-all">
                              Afwijzen
                            </button>
                          </div>
                        )}
                        {swap.status === 'approved' && (
                          <button onClick={() => handleCancel(swap.id)} className="flex-1 py-3 rounded-2xl border border-red-200 text-red-500 font-black text-xs uppercase tracking-[0.08em] hover:bg-red-50 transition-colors">
                            Annuleren
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
                {actionableSwaps.length === 0 && (
                  <p className="text-center text-slate-400 font-medium italic py-8">Geen openstaande of goedgekeurde dienstruilen.</p>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {createPortal(
      <AnimatePresence>
        {showOfferModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm">
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="glass-modal rounded-3xl w-full max-w-md max-h-[90vh] flex flex-col overflow-hidden">
              <div className="p-8 border-b border-white/70 flex items-center justify-between shrink-0">
                <h4 className="text-xl font-black">Dienstruil aanvragen</h4>
                <button onClick={() => setShowOfferModal(false)} className="p-2 text-slate-400 hover:bg-slate-50 rounded-xl"><X size={24} /></button>
              </div>
              <form onSubmit={handleOfferShift} className="p-8 space-y-6 overflow-y-auto flex-1">
                {myShifts.length === 0 && (
                  <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800">
                    Je hebt geen diensten op je naam staan om aan te bieden. {isPlanner ? 'Je kan in de Debug-pagina een fictieve test-dienst aanmaken om de flow te proberen.' : 'Vraag de planning om hulp.'}
                  </div>
                )}
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.08em] ml-1">Selecteer Dienst</label>
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
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.08em]">Aan welke collega?</label>
                    {selectedShiftDate && (
                      <span className="text-[10px] font-bold text-slate-400">
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
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.08em] ml-1">Wat neem jij in ruil?</label>
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
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.08em] ml-1">Info (optioneel)</label>
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
