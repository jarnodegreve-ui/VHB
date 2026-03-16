import React, { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Plus, User as UserIcon, X } from 'lucide-react';
import type { LeaveRequest, User } from '../types';
import { cn } from '../lib/ui';

export function LeaveManagementView({ user, leaveRequests, users, onSave }: { user: User; leaveRequests: LeaveRequest[]; users: User[]; onSave: (l: LeaveRequest[]) => void }) {
  const [showRequestModal, setShowRequestModal] = useState(false);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [formData, setFormData] = useState({ startDate: '', endDate: '', type: 'vakantie' as LeaveRequest['type'], comment: '' });
  const [viewMonth] = useState(new Date(2026, 2, 1));

  const isPlanner = user.role === 'planner' || user.role === 'admin';
  const myRequests = leaveRequests.filter((r) => r.userId === user.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const handleRequestLeave = (e: React.FormEvent) => {
    e.preventDefault();
    onSave([...leaveRequests, { id: Date.now().toString(), userId: user.id, ...formData, status: 'pending', createdAt: new Date().toISOString() }]);
    setShowRequestModal(false);
    setFormData({ startDate: '', endDate: '', type: 'vakantie', comment: '' });
  };

  const handleStatusUpdate = (requestId: string, newStatus: LeaveRequest['status']) => {
    onSave(leaveRequests.map((r) => (r.id === requestId ? { ...r, status: newStatus } : r)));
  };

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
    <div className="max-w-6xl space-y-8 pb-20">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h3 className="text-2xl font-black tracking-tight">Verlof & Afwezigheid</h3>
          <p className="text-sm text-slate-500 font-medium">Beheer verlofaanvragen en bekijk de bezetting.</p>
        </div>
        {!isPlanner && (
          <button onClick={() => setShowRequestModal(true)} className="px-8 py-4 bg-oker-500 text-white rounded-2xl font-black text-sm hover:bg-oker-600 transition-all shadow-xl shadow-oker-500/20 active:scale-95 flex items-center gap-2">
            <Plus size={20} /> Verlof Aanvragen
          </button>
        )}
      </div>

      <div className="grid lg:grid-cols-12 gap-8">
        <div className="lg:col-span-8 space-y-6">
          <div className="surface-card p-8 rounded-[40px]">
            <div className="flex items-center justify-between mb-8">
              <h4 className="text-lg font-black tracking-tight capitalize">{monthName}</h4>
              <div className="flex gap-4">
                <div className="flex items-center gap-2"><div className="w-3 h-3 bg-emerald-500 rounded-full" /><span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Voldoende</span></div>
                <div className="flex items-center gap-2"><div className="w-3 h-3 bg-amber-500 rounded-full" /><span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Krap</span></div>
                <div className="flex items-center gap-2"><div className="w-3 h-3 bg-red-500 rounded-full" /><span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Onderbezet</span></div>
              </div>
            </div>
            <div className="grid grid-cols-7 gap-3">
              {['Ma', 'Di', 'Wo', 'Do', 'Vr', 'Za', 'Zo'].map((d) => <div key={d} className="text-center text-[10px] font-black text-slate-300 uppercase tracking-[0.2em] mb-2">{d}</div>)}
              {calendarDays.map((day, i) => {
                if (day === null) return <div key={`empty-${i}`} />;
                const dateStr = `${viewMonth.getFullYear()}-${(viewMonth.getMonth() + 1).toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
                const occupancyCount = getRequestsForDate(dateStr).length;
                const statusColor = occupancyCount >= 3 ? 'bg-red-500' : occupancyCount >= 2 ? 'bg-amber-500' : occupancyCount >= 1 ? 'bg-emerald-500' : 'bg-slate-100';
                const isSelected = selectedDate === dateStr;
                return (
                  <button key={day} onClick={() => setSelectedDate(isSelected ? null : dateStr)} className={cn('aspect-square rounded-2xl border transition-all flex flex-col items-center justify-center relative group', isSelected ? 'border-oker-500 bg-oker-50 ring-4 ring-oker-500/10' : 'border-slate-50 hover:border-slate-200 bg-white')}>
                    <span className={cn('text-sm font-black transition-colors', isSelected ? 'text-oker-600' : 'text-slate-400 group-hover:text-slate-600')}>{day}</span>
                    {occupancyCount > 0 && <div className={cn('w-1.5 h-1.5 rounded-full mt-1.5', statusColor)} />}
                  </button>
                );
              })}
            </div>
          </div>

          {selectedDate && (
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="surface-card p-8 rounded-[40px]">
              <div className="flex items-center justify-between mb-6">
                <h4 className="font-black text-slate-800">Afwezigheid op {new Date(selectedDate).toLocaleDateString('nl-BE', { day: 'numeric', month: 'long' })}</h4>
                <button onClick={() => setSelectedDate(null)} className="text-slate-400 hover:text-slate-600"><X size={20} /></button>
              </div>
              <div className="space-y-3">
                {getRequestsForDate(selectedDate).length > 0 ? getRequestsForDate(selectedDate).map((req) => {
                  const requester = users.find((u) => u.id === req.userId);
                  return <div key={req.id} className="flex items-center justify-between p-4 bg-slate-50 rounded-2xl"><div className="flex items-center gap-3"><div className="w-10 h-10 bg-white rounded-xl flex items-center justify-center text-slate-400 border border-slate-100"><UserIcon size={20} /></div><div><p className="font-black text-slate-800 text-sm">{requester?.name}</p><p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{req.type}</p></div></div><span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{req.startDate} - {req.endDate}</span></div>;
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

          <div className="space-y-4">
            <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] ml-2">Mijn Verlof Historie</h4>
            <div className="space-y-4">
              {myRequests.length > 0 ? myRequests.map((req) => <div key={req.id} className="surface-card p-6 rounded-[32px] relative overflow-hidden"><div className={cn('absolute top-0 left-0 w-1 h-full', req.status === 'approved' ? 'bg-emerald-500' : req.status === 'rejected' ? 'bg-red-500' : 'bg-amber-500')} /><div className="flex justify-between items-start mb-4"><span className="px-3 py-1 bg-slate-100 text-slate-600 rounded-full text-[8px] font-black uppercase tracking-widest">{req.type}</span><span className={cn('text-[10px] font-black uppercase tracking-widest', req.status === 'approved' ? 'text-emerald-500' : req.status === 'rejected' ? 'text-red-500' : 'text-amber-500')}>{req.status}</span></div><p className="font-black text-slate-800 text-sm mb-1">{new Date(req.startDate).toLocaleDateString('nl-BE', { day: 'numeric', month: 'short' })} - {new Date(req.endDate).toLocaleDateString('nl-BE', { day: 'numeric', month: 'short' })}</p><p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Aangevraagd op {req.createdAt.split('T')[0]}</p></div>) : <div className="surface-card p-8 rounded-[32px] text-center"><p className="text-slate-400 font-bold text-sm">Nog geen verlof aangevraagd.</p></div>}
            </div>
          </div>
        </div>
      </div>

      <AnimatePresence>
        {showRequestModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm">
            <motion.div initial={{ opacity: 0, scale: 0.95, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 20 }} className="glass-modal rounded-[40px] w-full max-w-md overflow-hidden">
              <div className="p-8 border-b border-white/70 flex items-center justify-between"><h4 className="text-xl font-black">Verlof Aanvragen</h4><button onClick={() => setShowRequestModal(false)} className="p-2 text-slate-400 hover:bg-slate-50 rounded-xl"><X size={24} /></button></div>
              <form onSubmit={handleRequestLeave} className="p-8 space-y-5">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2"><label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Startdatum</label><input type="date" required value={formData.startDate} onChange={(e) => setFormData({ ...formData, startDate: e.target.value })} className="w-full px-4 py-3 rounded-2xl border border-slate-200 font-bold text-sm outline-none focus:ring-4 focus:ring-oker-500/10 focus:border-oker-400 transition-all" /></div>
                  <div className="space-y-2"><label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Einddatum</label><input type="date" required value={formData.endDate} onChange={(e) => setFormData({ ...formData, endDate: e.target.value })} className="w-full px-4 py-3 rounded-2xl border border-slate-200 font-bold text-sm outline-none focus:ring-4 focus:ring-oker-500/10 focus:border-oker-400 transition-all" /></div>
                </div>
                <div className="space-y-2"><label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Type Verlof</label><select value={formData.type} onChange={(e) => setFormData({ ...formData, type: e.target.value as any })} className="control-input w-full px-4 py-3 rounded-2xl font-bold text-sm outline-none transition-all bg-white/60"><option value="vakantie">Vakantie</option><option value="ziekte">Ziekte</option><option value="persoonlijk">Persoonlijk</option><option value="overig">Overig</option></select></div>
                <div className="space-y-2"><label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Opmerking</label><textarea value={formData.comment} onChange={(e) => setFormData({ ...formData, comment: e.target.value })} className="w-full px-4 py-3 rounded-2xl border border-slate-200 font-bold text-sm outline-none focus:ring-4 focus:ring-oker-500/10 focus:border-oker-400 transition-all h-24 resize-none" placeholder="Optionele toelichting..." /></div>
                <button type="submit" className="w-full bg-oker-500 text-white font-black py-4 rounded-2xl hover:bg-oker-600 transition-all shadow-xl shadow-oker-500/20 active:scale-[0.98]">Aanvraag Indienen</button>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
