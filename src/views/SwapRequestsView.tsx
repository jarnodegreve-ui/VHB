import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'motion/react';
import { Plus, X } from 'lucide-react';
import type { Shift, SwapRequest, User } from '../types';
import { cn } from '../lib/ui';
import { PageHeader, PageShell } from '../components/ui';

export function SwapRequestsView({ user, swaps, shifts, users, onSave }: { user: User, swaps: SwapRequest[], shifts: Shift[], users: User[], onSave: (s: SwapRequest[]) => void }) {
  const [showOfferModal, setShowOfferModal] = useState(false);
  const [selectedShift, setSelectedShift] = useState<string>('');
  const [reason, setReason] = useState('');

  const isPlanner = user.role === 'planner' || user.role === 'admin';
  const myShifts = shifts.filter(s => s.driverId === user.id);
  const mySwaps = swaps.filter(s => s.requesterId === user.id);
  const availableSwaps = swaps.filter(s => {
    if (s.status !== 'pending' || s.requesterId === user.id) return false;
    
    const requester = users.find(u => u.id === s.requesterId);
    const isBeheerder = requester?.name.toLowerCase() === 'beheerder';
    const isMe = s.requesterId === user.id; // Already covered by s.requesterId !== user.id but for clarity

    if (isBeheerder && !isMe) return false;
    return true;
  });

  const handleOfferShift = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedShift) return;

    const newSwap: SwapRequest = {
      id: Date.now().toString(),
      shiftId: selectedShift,
      requesterId: user.id,
      status: 'pending',
      createdAt: new Date().toISOString(),
      reason
    };

    onSave([...swaps, newSwap]);
    setShowOfferModal(false);
    setSelectedShift('');
    setReason('');
  };

  const handleStatusUpdate = (swapId: string, newStatus: SwapRequest['status']) => {
    const updatedSwaps = swaps.map(s => s.id === swapId ? { ...s, status: newStatus } : s);
    onSave(updatedSwaps);
  };

  const handleCancel = (swapId: string) => {
    if (!window.confirm('Dit goedgekeurd wisselverzoek annuleren?')) return;
    handleStatusUpdate(swapId, 'cancelled');
  };

  const statusLabels: Record<SwapRequest['status'], string> = {
    pending: 'In behandeling',
    approved: 'Goedgekeurd',
    rejected: 'Afgewezen',
    cancelled: 'Geannuleerd',
    completed: 'Voltooid',
  };
  const statusStyles: Record<SwapRequest['status'], string> = {
    pending: 'bg-amber-50 text-amber-600',
    approved: 'bg-emerald-50 text-emerald-600',
    rejected: 'bg-red-50 text-red-600',
    cancelled: 'bg-slate-100 text-slate-500',
    completed: 'bg-blue-50 text-blue-600',
  };

  return (
    <PageShell>
      <PageHeader
        title="Wissel Aanvragen"
        actions={(
          <button
            onClick={() => setShowOfferModal(true)}
            className="btn-primary ios-pressable px-6 py-3 text-sm"
          >
            Dienst Aanbieden
          </button>
        )}
      />

      <div className="grid md:grid-cols-2 gap-8">
        <div className="space-y-4">
          <h4 className="text-xs font-black text-slate-400 uppercase tracking-widest ml-1">Mijn Verzoeken</h4>
          {mySwaps.length > 0 ? (
            mySwaps.map(swap => {
              const shift = shifts.find(s => s.id === swap.shiftId);
              return (
                <div key={swap.id} className="surface-card p-6 rounded-[32px] flex items-center justify-between">
                  <div>
                    <p className="font-black text-slate-800">{shift?.date}</p>
                    <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">{shift?.startTime} - {shift?.endTime}</p>
                  </div>
                  <span className={cn(
                    "px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest",
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
          <h4 className="text-xs font-black text-slate-400 uppercase tracking-widest ml-1">Openstaande Wissels</h4>
          {availableSwaps.length > 0 ? (
            availableSwaps.map(swap => {
              const shift = shifts.find(s => s.id === swap.shiftId);
              const requester = users.find(u => u.id === swap.requesterId);
              return (
                <div key={swap.id} className="surface-card p-6 rounded-[32px] space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-black text-slate-800">{shift?.date}</p>
                      <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">{shift?.startTime} - {shift?.endTime}</p>
                      <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">Door: {requester?.name}</p>
                    </div>
                    <button className="px-4 py-2 bg-oker-50 text-oker-600 rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-oker-100 transition-all">
                      Overnemen
                    </button>
                  </div>
                  {swap.reason && <p className="text-xs text-slate-500 italic">"{swap.reason}"</p>}
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
          if (s.status !== 'pending' && s.status !== 'approved') return false;
          const requester = users.find(u => u.id === s.requesterId);
          const isBeheerder = requester?.name.toLowerCase() === 'beheerder';
          const isMe = s.requesterId === user.id;
          if (isBeheerder && !isMe) return false;
          return true;
        });

        return (
          <div className="space-y-4 pt-8">
            <h4 className="text-xs font-black text-slate-400 uppercase tracking-widest ml-1">Beheer Wisselverzoeken</h4>
            <div className="surface-table rounded-[32px] overflow-hidden">
              {/* Desktop table */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-left">
                  <thead className="bg-slate-50 border-b border-slate-100">
                    <tr>
                      <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Chauffeur</th>
                      <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Dienst</th>
                      <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Status</th>
                      <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Acties</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {actionableSwaps.map(swap => {
                      const shift = shifts.find(s => s.id === swap.shiftId);
                      const requester = users.find(u => u.id === swap.requesterId);
                      return (
                        <tr key={swap.id}>
                          <td className="px-6 py-4 font-bold text-sm">{requester?.name}</td>
                          <td className="px-6 py-4 text-xs font-medium">{shift?.date} ({shift?.startTime} - {shift?.endTime})</td>
                          <td className="px-6 py-4">
                            <span className={cn('px-2 py-1 rounded-full text-[10px] font-black uppercase tracking-widest', statusStyles[swap.status])}>{statusLabels[swap.status]}</span>
                          </td>
                          <td className="px-6 py-4 flex gap-2">
                            {swap.status === 'pending' && (
                              <>
                                <button onClick={() => handleStatusUpdate(swap.id, 'approved')} title="Goedkeuren" className="p-2 text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors"><Plus size={18} /></button>
                                <button onClick={() => handleStatusUpdate(swap.id, 'rejected')} title="Afwijzen" className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"><X size={18} /></button>
                              </>
                            )}
                            {swap.status === 'approved' && (
                              <button onClick={() => handleCancel(swap.id)} className="px-3 py-2 text-[10px] font-black uppercase tracking-widest text-red-500 border border-red-200 rounded-lg hover:bg-red-50 transition-colors">Annuleren</button>
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
                          <p className="font-black text-slate-800 tracking-tight">{requester?.name}</p>
                          <p className="text-xs font-medium text-slate-500 mt-1">{shift?.date} · {shift?.startTime} - {shift?.endTime}</p>
                        </div>
                        <span className={cn('px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest shrink-0', statusStyles[swap.status])}>{statusLabels[swap.status]}</span>
                      </div>
                      <div className="flex gap-2 pt-1">
                        {swap.status === 'pending' && (
                          <>
                            <button onClick={() => handleStatusUpdate(swap.id, 'approved')} className="flex-1 flex items-center justify-center gap-2 py-3 rounded-2xl bg-emerald-50 text-emerald-600 font-black text-xs uppercase tracking-widest active:scale-95 transition-all">
                              <Plus size={16} /> Goedkeuren
                            </button>
                            <button onClick={() => handleStatusUpdate(swap.id, 'rejected')} className="flex-1 flex items-center justify-center gap-2 py-3 rounded-2xl bg-red-50 text-red-600 font-black text-xs uppercase tracking-widest active:scale-95 transition-all">
                              <X size={16} /> Afwijzen
                            </button>
                          </>
                        )}
                        {swap.status === 'approved' && (
                          <button onClick={() => handleCancel(swap.id)} className="flex-1 py-3 rounded-2xl border border-red-200 text-red-500 font-black text-xs uppercase tracking-widest hover:bg-red-50 transition-colors">
                            Annuleren
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
                {actionableSwaps.length === 0 && (
                  <p className="text-center text-slate-400 font-medium italic py-8">Geen openstaande of goedgekeurde wisselverzoeken.</p>
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
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="glass-modal rounded-[28px] w-full max-w-md max-h-[90vh] flex flex-col overflow-hidden">
              <div className="p-8 border-b border-white/70 flex items-center justify-between shrink-0">
                <h4 className="text-xl font-black">Dienst Aanbieden</h4>
                <button onClick={() => setShowOfferModal(false)} className="p-2 text-slate-400 hover:bg-slate-50 rounded-xl"><X size={24} /></button>
              </div>
              <form onSubmit={handleOfferShift} className="p-8 space-y-6 overflow-y-auto flex-1">
                {myShifts.length === 0 && (
                  <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800">
                    Je hebt geen diensten op je naam staan om aan te bieden. {isPlanner ? 'Je kan in de Debug-pagina een fictieve test-dienst aanmaken om de flow te proberen.' : 'Vraag de planning om hulp.'}
                  </div>
                )}
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Selecteer Dienst</label>
                  <select
                    value={selectedShift}
                    onChange={(e) => setSelectedShift(e.target.value)}
                    className="control-input w-full px-4 py-3 rounded-2xl font-bold text-sm outline-none disabled:opacity-50 disabled:cursor-not-allowed"
                    required
                    disabled={myShifts.length === 0}
                  >
                    <option value="">Kies een dienst...</option>
                    {myShifts.map(s => (
                      <option key={s.id} value={s.id}>{s.date} ({s.startTime} - {s.endTime})</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Reden (optioneel)</label>
                  <textarea 
                    value={reason} 
                    onChange={(e) => setReason(e.target.value)}
                    className="control-input w-full px-4 py-3 rounded-2xl font-bold text-sm outline-none h-24 resize-none"
                    placeholder="Waarom wil je ruilen?"
                  />
                </div>
                <button type="submit" className="btn-primary ios-pressable w-full py-4">
                  Aanbieden
                </button>
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
