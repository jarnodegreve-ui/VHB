import React, { useState } from 'react';
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

  return (
    <PageShell>
      <PageHeader
        title="Wissel Aanvragen"
        actions={!isPlanner ? (
          <button
            onClick={() => setShowOfferModal(true)}
            className="px-6 py-3 bg-oker-500 text-white rounded-2xl font-black text-sm hover:bg-oker-600 transition-all shadow-lg shadow-oker-500/20"
          >
            Dienst Aanbieden
          </button>
        ) : undefined}
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
                    swap.status === 'pending' ? "bg-amber-50 text-amber-600" :
                    swap.status === 'approved' ? "bg-green-50 text-green-600" : "bg-red-50 text-red-600"
                  )}>
                    {swap.status}
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

      {isPlanner && (
        <div className="space-y-4 pt-8">
          <h4 className="text-xs font-black text-slate-400 uppercase tracking-widest ml-1">Goedkeuring Planner</h4>
          <div className="surface-table rounded-[32px] overflow-hidden">
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
                {swaps.filter(s => {
                  if (s.status !== 'pending') return false;
                  const requester = users.find(u => u.id === s.requesterId);
                  const isBeheerder = requester?.name.toLowerCase() === 'beheerder';
                  const isMe = s.requesterId === user.id;
                  if (isBeheerder && !isMe) return false;
                  return true;
                }).map(swap => {
                  const shift = shifts.find(s => s.id === swap.shiftId);
                  const requester = users.find(u => u.id === swap.requesterId);
                  return (
                    <tr key={swap.id}>
                      <td className="px-6 py-4 font-bold text-sm">{requester?.name}</td>
                      <td className="px-6 py-4 text-xs font-medium">{shift?.date} ({shift?.startTime} - {shift?.endTime})</td>
                      <td className="px-6 py-4">
                        <span className="px-2 py-1 bg-amber-50 text-amber-600 rounded-full text-[10px] font-black uppercase tracking-widest">Pending</span>
                      </td>
                      <td className="px-6 py-4 flex gap-2">
                        <button onClick={() => handleStatusUpdate(swap.id, 'approved')} className="p-2 text-green-600 hover:bg-green-50 rounded-lg transition-colors"><Plus size={18} /></button>
                        <button onClick={() => handleStatusUpdate(swap.id, 'rejected')} className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"><X size={18} /></button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <AnimatePresence>
        {showOfferModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm">
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="glass-modal rounded-[40px] w-full max-w-md overflow-hidden">
              <div className="p-8 border-b border-white/70 flex items-center justify-between">
                <h4 className="text-xl font-black">Dienst Aanbieden</h4>
                <button onClick={() => setShowOfferModal(false)} className="p-2 text-slate-400 hover:bg-slate-50 rounded-xl"><X size={24} /></button>
              </div>
              <form onSubmit={handleOfferShift} className="p-8 space-y-6">
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Selecteer Dienst</label>
                  <select 
                    value={selectedShift} 
                    onChange={(e) => setSelectedShift(e.target.value)}
                    className="control-input w-full px-4 py-3 rounded-2xl font-bold text-sm outline-none"
                    required
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
                <button type="submit" className="w-full bg-oker-500 text-white font-black py-4 rounded-2xl hover:bg-oker-600 transition-all shadow-xl shadow-oker-500/20">
                  Aanbieden
                </button>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </PageShell>
  );
}
