import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { AlertTriangle, Calendar, Clock, MapPin } from 'lucide-react';
import type { Diversion, Shift, Update, User } from '../types';
import { EmptyState } from '../components/ui';
import { StatCard } from '../components/StatCard';

export function DashboardView({ user, shifts, diversions, users }: { user: User, shifts: Shift[], diversions: Diversion[], users: User[] }) {
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60000); // Update every minute
    return () => clearInterval(timer);
  }, []);

  const myShifts = shifts.filter(s => s.driverId === user.id);
  const today = now.toISOString().split('T')[0];
  const todaysShift = myShifts.find((shift) => shift.date === today);
  
  const nextShift = myShifts
    .map(s => {
      const [year, month, day] = s.date.split('-').map(Number);
      const [hours, minutes] = s.startTime.split(':').map(Number);
      return { ...s, startDateTime: new Date(year, month - 1, day, hours, minutes) };
    })
    .filter(s => s.startDateTime > now)
    .sort((a, b) => a.startDateTime.getTime() - b.startDateTime.getTime())[0];
  const newestDiversions = [...diversions].reverse().slice(0, 3);
  const visibleShifts = shifts.filter(s => {
    const isMe = s.driverId === user.id;
    const isPlanner = user.role !== 'chauffeur';

    if (isMe) return true;
    if (!isPlanner) return false;

    const driver = users.find(u => u.id === s.driverId);
    return driver?.name.toLowerCase() !== 'beheerder';
  }).slice(0, 2);

  const formatShiftDate = (date: string) => new Date(`${date}T00:00:00`).toLocaleDateString('nl-BE', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
  });

  const getServiceNumber = (shift: Shift) => String(shift.line || '--').trim() || '--';

  const getCountdown = (target: Date) => {
    const diff = target.getTime() - now.getTime();
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    
    if (hours > 24) return `${Math.floor(hours / 24)} dagen`;
    if (hours > 0) return `${hours}u ${minutes}m`;
    return `${minutes} minuten`;
  };

  return (
    <div className="space-y-8">
      {/* Next Shift Hero */}
      {nextShift && user.role === 'chauffeur' && (
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          className="relative overflow-hidden rounded-[28px] p-7 md:p-9"
          style={{ background: 'linear-gradient(135deg, #1e293b 0%, #0f172a 60%, #231509 100%)' }}
        >
          <div className="absolute top-0 right-0 w-80 h-80 rounded-full -mr-40 -mt-40 blur-3xl" style={{ background: 'radial-gradient(circle, rgba(245,158,11,0.18) 0%, transparent 70%)' }} />
          <div className="absolute bottom-0 left-0 w-48 h-48 rounded-full -ml-24 -mb-24 blur-3xl" style={{ background: 'radial-gradient(circle, rgba(245,158,11,0.08) 0%, transparent 70%)' }} />

          <div className="relative flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
            <div>
              <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-oker-500/15 border border-oker-500/20 rounded-full mb-4">
                <div className="w-1.5 h-1.5 bg-oker-400 rounded-full animate-pulse" />
                <span className="text-[11px] font-bold text-oker-400 uppercase tracking-widest">Volgende dienst</span>
              </div>
              <h3 className="text-3xl md:text-4xl font-black tracking-tight text-white">
                Over <span className="text-oker-400">{getCountdown(nextShift.startDateTime)}</span>
              </h3>
              <p className="text-slate-400 text-sm font-medium mt-2">
                {nextShift.startDateTime.toLocaleDateString('nl-BE', { weekday: 'long', day: 'numeric', month: 'long' })} · aanvang {nextShift.startTime}
              </p>
            </div>

            <div className="flex gap-3 shrink-0">
              <div className="bg-white/6 border border-white/10 rounded-2xl px-6 py-4 text-center">
                <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-widest mb-1">Start</p>
                <p className="text-2xl font-black text-oker-400">{nextShift.startTime}</p>
              </div>
              <div className="bg-white/6 border border-white/10 rounded-2xl px-6 py-4 text-center">
                <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-widest mb-1">Einde</p>
                <p className="text-2xl font-black text-white">{nextShift.endTime}</p>
              </div>
            </div>
          </div>
        </motion.div>
      )}

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <StatCard 
          icon={<Clock className="text-oker-600" />} 
          label="Vandaag" 
          value={todaysShift?.startTime || '--:--'} 
          subValue={todaysShift ? `${todaysShift.startTime} - ${todaysShift.endTime}` : 'Geen dienst vandaag'} 
        />
        <StatCard 
          icon={<AlertTriangle className="text-red-500" />} 
          label="Actieve Omleidingen" 
          value={diversions.length.toString()} 
          subValue="Totaal aantal" 
        />
      </div>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[1.2fr_0.8fr] lg:items-stretch">
        <section className="panel flex h-full min-h-[31rem] flex-col rounded-[32px] p-8">
          <div className="mb-8 flex items-center justify-between">
            <h3 className="font-black text-xl tracking-tight">Planning voor vandaag</h3>
            <span className="text-[10px] font-black bg-oker-50 text-oker-700 px-4 py-1.5 rounded-full uppercase tracking-widest">
              {now.toLocaleDateString('nl-BE', { day: '2-digit', month: 'short' })}
            </span>
          </div>
          <div className="flex flex-1 flex-col gap-4">
            {visibleShifts.map(shift => (
              <div key={shift.id} className="grid min-h-[8.25rem] grid-cols-[5.25rem_minmax(0,1fr)] items-center gap-5 rounded-[28px] border border-slate-100 bg-slate-50/55 p-5 transition-all duration-300 hover:bg-white hover:shadow-md">
                <div className="flex h-20 flex-col items-center justify-center rounded-[24px] border border-white/80 bg-white shadow-sm">
                  <p className="text-[9px] font-black uppercase tracking-[0.18em] text-slate-400">Dienst</p>
                  <p className="mt-1 text-xl font-black text-oker-500">{getServiceNumber(shift)}</p>
                </div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">{formatShiftDate(shift.date)}</p>
                    <span className="rounded-full border border-white/80 bg-white/80 px-3 py-1 text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">
                      {shift.startTime} - {shift.endTime}
                    </span>
                  </div>
                  <p className="mt-3 text-xl font-black tracking-tight text-slate-900">{shift.startTime} - {shift.endTime}</p>
                  <p className="mt-1 text-sm font-medium text-slate-500">
                    {user.role === 'chauffeur'
                      ? 'Jouw eerstvolgende zichtbare inzet.'
                      : `Chauffeur: ${users.find(u => u.id === shift.driverId)?.name || 'Onbekend'}`}
                  </p>
                </div>
              </div>
            ))}
            {shifts.filter(s => s.driverId === user.id).length === 0 && user.role === 'chauffeur' && (
              <div className="flex flex-1 items-center justify-center text-center py-12">
                <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mx-auto mb-4">
                  <Calendar className="text-slate-200" size={32} />
                </div>
                <p className="text-slate-400 font-medium italic">Geen diensten gepland voor vandaag.</p>
              </div>
            )}
          </div>
        </section>

        <section className="panel flex h-full min-h-[31rem] flex-col rounded-[32px] p-8">
          <div className="mb-8 flex items-center justify-between">
            <h3 className="font-black text-xl tracking-tight">Nieuwe Omleidingen</h3>
            <span className="text-[10px] font-black bg-slate-100 text-slate-500 px-4 py-1.5 rounded-full uppercase tracking-widest">
              {Math.min(newestDiversions.length, 3)} getoond
            </span>
          </div>
          <div className="flex flex-1 flex-col gap-4">
            {newestDiversions.map(div => (
              <div key={div.id} className="flex min-h-[8.25rem] gap-5 rounded-[28px] border border-oker-100/80 bg-oker-50/25 p-5 transition-all group hover:bg-oker-50/45">
                <div className="shrink-0 mt-1">
                  <AlertTriangle size={24} className="text-oker-600" />
                </div>
                <div className="flex min-w-0 flex-1 flex-col justify-between">
                  <p className="font-black text-lg text-slate-900">{div.title}</p>
                  <p className="text-sm text-slate-500 mt-1 line-clamp-2 font-medium leading-relaxed">{div.description}</p>
                  <div className="flex items-center gap-2 mt-3">
                    <span className="px-2 py-0.5 bg-oker-100 text-oker-700 rounded text-[10px] font-black uppercase">{div.line}</span>
                  </div>
                </div>
              </div>
            ))}
            {diversions.length === 0 && (
              <div className="flex flex-1 items-center justify-center">
                <EmptyState
                  icon={<MapPin size={28} />}
                  title="Geen actieve hinder"
                  message="Er zijn momenteel geen omleidingen geregistreerd."
                />
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

