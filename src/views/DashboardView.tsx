import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { AlertTriangle, Calendar, Clock, MapPin, ChevronRight } from 'lucide-react';
import type { Diversion, Shift, User } from '../types';

/**
 * Dashboard in Bento-stijl (E-preview).
 *
 * - Grote oker hero-tegel voor "volgende dienst" (span 2 cols)
 * - Gekleurde KPI-tegels in een grid (warm + diepte via gradients)
 * - Wide planning-tegel (span 2 cols)
 * - Substantial radius rounded-3xl, soft ring-1 + zachte schaduw
 */
export function DashboardView({
  user,
  shifts,
  diversions,
  users,
}: {
  user: User;
  shifts: Shift[];
  diversions: Diversion[];
  users: User[];
}) {
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(timer);
  }, []);

  const myShifts = shifts.filter((s) => s.driverId === user.id);
  const today = now.toISOString().split('T')[0];
  const todaysShift = myShifts.find((shift) => shift.date === today);

  const nextShift = myShifts
    .map((s) => {
      const [year, month, day] = s.date.split('-').map(Number);
      const [hours, minutes] = s.startTime.split(':').map(Number);
      return { ...s, startDateTime: new Date(year, month - 1, day, hours, minutes) };
    })
    .filter((s) => s.startDateTime > now)
    .sort((a, b) => a.startDateTime.getTime() - b.startDateTime.getTime())[0];

  const newestDiversions = [...diversions].reverse().slice(0, 3);
  const visibleShifts = myShifts.slice(0, 3);

  const formatShiftDate = (date: string) =>
    new Date(`${date}T00:00:00`).toLocaleDateString('nl-BE', {
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
    <div className="space-y-4">
      {/* Bento-banner */}
      <div className="rounded-2xl bg-gradient-to-r from-oker-100 to-amber-100 ring-1 ring-oker-200/60 px-4 py-2.5 text-xs text-oker-900 font-bold flex items-center justify-between">
        <span>
          <span className="uppercase tracking-widest text-[10px] text-oker-700">Stijl E preview</span> · Bento / Apple-stijl tegels
        </span>
        <span className="text-oker-700/70">Andere schermen blijven in huidige stijl</span>
      </div>

      {/* Hero — volgende dienst als grote oker-tegel */}
      {nextShift && user.role === 'chauffeur' && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-3xl ring-1 ring-oker-200/60 bg-gradient-to-br from-oker-100 via-oker-200/60 to-amber-200/40 p-6 md:p-8 relative overflow-hidden"
        >
          <div className="absolute -top-20 -right-20 w-64 h-64 rounded-full bg-oker-300/30 blur-3xl" />
          <div className="relative flex flex-col md:flex-row items-start md:items-center justify-between gap-5">
            <div>
              <div className="inline-flex items-center gap-2 px-2.5 py-1 bg-white/60 ring-1 ring-oker-300/50 rounded-full mb-3">
                <div className="w-1.5 h-1.5 bg-oker-600 rounded-full animate-pulse" />
                <span className="text-[10px] font-black text-oker-800 uppercase tracking-widest">Volgende dienst</span>
              </div>
              <h3 className="text-4xl md:text-5xl font-black tracking-tight text-oker-950">
                Over <span className="text-oker-700">{getCountdown(nextShift.startDateTime)}</span>
              </h3>
              <p className="text-oker-900/80 text-sm font-bold mt-2">
                {nextShift.startDateTime.toLocaleDateString('nl-BE', { weekday: 'long', day: 'numeric', month: 'long' })} · dienst {getServiceNumber(nextShift)}
              </p>
            </div>
            <div className="flex gap-2.5 shrink-0">
              <div className="bg-white/70 ring-1 ring-oker-300/40 rounded-2xl px-5 py-3 text-center backdrop-blur-sm">
                <p className="text-[10px] font-bold text-oker-700 uppercase tracking-widest mb-0.5">Start</p>
                <p className="text-2xl font-black text-oker-900 tabular-nums">{nextShift.startTime}</p>
              </div>
              <div className="bg-white/70 ring-1 ring-oker-300/40 rounded-2xl px-5 py-3 text-center backdrop-blur-sm">
                <p className="text-[10px] font-bold text-oker-700 uppercase tracking-widest mb-0.5">Einde</p>
                <p className="text-2xl font-black text-oker-900 tabular-nums">{nextShift.endTime}</p>
              </div>
            </div>
          </div>
        </motion.div>
      )}

      {/* Bento KPI-tegels */}
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-3xl ring-1 ring-emerald-200/60 bg-gradient-to-br from-emerald-50 via-emerald-100/50 to-emerald-200/30 p-4">
          <div className="inline-flex items-center justify-center w-9 h-9 rounded-xl bg-emerald-500 text-white shadow-sm">
            <Clock size={20} />
          </div>
          <p className="mt-3 text-[10px] font-black uppercase tracking-widest text-emerald-700/70">Vandaag</p>
          <p className="mt-0.5 text-2xl font-black text-emerald-900 tabular-nums tracking-tight">
            {todaysShift?.startTime || 'Vrij'}
          </p>
          <p className="mt-1 text-xs font-bold text-emerald-700/70">
            {todaysShift ? `tot ${todaysShift.endTime}` : 'Geen dienst gepland'}
          </p>
        </div>

        <div className="rounded-3xl ring-1 ring-rose-200/60 bg-gradient-to-br from-rose-50 via-rose-100/50 to-rose-200/30 p-4">
          <div className="inline-flex items-center justify-center w-9 h-9 rounded-xl bg-rose-500 text-white shadow-sm">
            <AlertTriangle size={20} />
          </div>
          <p className="mt-3 text-[10px] font-black uppercase tracking-widest text-rose-700/70">Omleidingen</p>
          <p className="mt-0.5 text-2xl font-black text-rose-900 tabular-nums tracking-tight">
            {diversions.length}
          </p>
          <p className="mt-1 text-xs font-bold text-rose-700/70">Actief in netwerk</p>
        </div>
      </div>

      {/* Twee grote tegels — planning + omleidingen */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {/* Planning */}
        <div className="rounded-3xl ring-1 ring-slate-200/60 bg-gradient-to-br from-white via-slate-50/70 to-slate-100/40 overflow-hidden">
          <div className="flex items-center justify-between gap-3 p-4 pb-2">
            <div className="flex items-center gap-2.5">
              <div className="inline-flex items-center justify-center w-8 h-8 rounded-xl bg-slate-900 text-white shadow-sm">
                <Calendar size={16} />
              </div>
              <h3 className="text-sm font-black text-slate-900">Planning</h3>
            </div>
            <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
              {now.toLocaleDateString('nl-BE', { day: '2-digit', month: 'short' })}
            </span>
          </div>
          <div className="px-4 pb-4">
            {visibleShifts.length > 0 ? (
              <div className="space-y-2 mt-2">
                {visibleShifts.map((shift) => (
                  <div
                    key={shift.id}
                    className="flex items-center justify-between gap-3 bg-white/60 ring-1 ring-slate-200/40 rounded-2xl px-3 py-2.5"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-slate-500">{formatShiftDate(shift.date)}</span>
                        <span className="text-xs text-slate-300">·</span>
                        <span className="text-xs font-black text-oker-700">{getServiceNumber(shift)}</span>
                      </div>
                      <p className="mt-0.5 text-base font-black text-slate-900 tabular-nums">
                        {shift.startTime} – {shift.endTime}
                      </p>
                    </div>
                    {user.role !== 'chauffeur' && (
                      <span className="text-xs text-slate-500 truncate font-medium">
                        {users.find((u) => u.id === shift.driverId)?.name || 'Onbekend'}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center text-center py-8">
                <div className="w-12 h-12 rounded-2xl bg-white ring-1 ring-slate-200/50 flex items-center justify-center text-slate-300 mb-3 shadow-sm">
                  <Calendar size={20} />
                </div>
                <p className="text-sm font-black text-slate-700">Geen dienst vandaag</p>
                <p className="mt-0.5 text-xs font-medium text-slate-500">Geniet ervan.</p>
              </div>
            )}
          </div>
        </div>

        {/* Omleidingen */}
        <div className="rounded-3xl ring-1 ring-oker-200/60 bg-gradient-to-br from-oker-50 via-oker-100/40 to-amber-100/30 overflow-hidden">
          <div className="flex items-center justify-between gap-3 p-4 pb-2">
            <div className="flex items-center gap-2.5">
              <div className="inline-flex items-center justify-center w-8 h-8 rounded-xl bg-oker-500 text-white shadow-sm">
                <AlertTriangle size={16} />
              </div>
              <h3 className="text-sm font-black text-oker-950">Nieuwste omleidingen</h3>
            </div>
            <span className="text-[10px] font-bold uppercase tracking-widest text-oker-700/70">
              {newestDiversions.length} getoond
            </span>
          </div>
          <div className="px-4 pb-4">
            {newestDiversions.length > 0 ? (
              <div className="space-y-2 mt-2">
                {newestDiversions.map((div) => (
                  <div
                    key={div.id}
                    className="flex items-start gap-3 bg-white/60 ring-1 ring-oker-200/40 rounded-2xl px-3 py-2.5"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-black text-slate-900 truncate">{div.title}</p>
                        <span className="shrink-0 inline-block rounded-md bg-oker-500/15 px-1.5 py-0.5 text-[10px] font-black text-oker-800">
                          {div.line}
                        </span>
                      </div>
                      <p className="mt-0.5 text-xs font-medium text-slate-600/80 line-clamp-2">{div.description}</p>
                    </div>
                    <ChevronRight size={14} className="text-oker-400 mt-1 shrink-0" />
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center text-center py-8">
                <div className="w-12 h-12 rounded-2xl bg-white ring-1 ring-oker-200/40 flex items-center justify-center text-oker-300 mb-3 shadow-sm">
                  <MapPin size={20} />
                </div>
                <p className="text-sm font-black text-oker-900">Geen actieve hinder</p>
                <p className="mt-0.5 text-xs font-medium text-oker-700/70">Er zijn momenteel geen omleidingen.</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
