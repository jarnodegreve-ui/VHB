import { useEffect, useState } from 'react';
import { AlertTriangle, Calendar, Clock, MapPin } from 'lucide-react';
import type { Diversion, Shift, Update, User } from '../types';

export function DashboardView({ user, shifts, diversions, users }: { user: User; shifts: Shift[]; diversions: Diversion[]; users: User[]; updates?: Update[] }) {
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
    <div
      className="space-y-6 -mx-4 md:-mx-8 -my-6 md:-my-8 px-4 md:px-8 py-6 md:py-8 min-h-[calc(100vh-200px)]"
      style={{ background: '#fafafa' }}
    >
      {/* Style B banner — markeert deze view als preview-stijl */}
      <div className="rounded-md border border-slate-300 bg-slate-100 px-3 py-2 text-xs text-slate-600 flex items-center justify-between">
        <span>
          <span className="font-semibold text-slate-800">Stijl B preview</span> · Linear/Notion-clean (alleen Dashboard)
        </span>
        <span className="text-slate-400">Andere schermen blijven in huidige stijl</span>
      </div>

      {/* Next-shift hero — clean, no gradient */}
      {nextShift && user.role === 'chauffeur' && (
        <div className="rounded-lg border border-slate-200 bg-white p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="inline-flex items-center gap-1.5 text-xs font-medium text-oker-700">
                <span className="h-1.5 w-1.5 rounded-full bg-oker-500 animate-pulse" />
                Volgende dienst
              </div>
              <h3 className="mt-2 text-3xl font-semibold text-slate-900 tracking-tight">
                Over <span className="text-oker-600">{getCountdown(nextShift.startDateTime)}</span>
              </h3>
              <p className="mt-1 text-sm text-slate-500">
                {nextShift.startDateTime.toLocaleDateString('nl-BE', {
                  weekday: 'long',
                  day: 'numeric',
                  month: 'long',
                })}
              </p>
            </div>
            <div className="flex gap-2 shrink-0">
              <div className="rounded-md border border-slate-200 px-4 py-2.5 text-center">
                <p className="text-xs text-slate-500">Start</p>
                <p className="text-lg font-semibold text-oker-700 tabular-nums">{nextShift.startTime}</p>
              </div>
              <div className="rounded-md border border-slate-200 px-4 py-2.5 text-center">
                <p className="text-xs text-slate-500">Einde</p>
                <p className="text-lg font-semibold text-slate-900 tabular-nums">{nextShift.endTime}</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Twee snelle stats — clean borders */}
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <Clock size={14} className="text-slate-400" />
            Vandaag
          </div>
          <p className="mt-2 text-xl font-semibold text-slate-900 tabular-nums">
            {todaysShift?.startTime || 'Vrij'}
          </p>
          <p className="mt-0.5 text-xs text-slate-500">
            {todaysShift ? `tot ${todaysShift.endTime}` : 'Geen dienst gepland'}
          </p>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <AlertTriangle size={14} className="text-slate-400" />
            Actieve omleidingen
          </div>
          <p className="mt-2 text-xl font-semibold text-slate-900 tabular-nums">{diversions.length}</p>
          <p className="mt-0.5 text-xs text-slate-500">Totaal aantal</p>
        </div>
      </div>

      {/* Twee panelen: planning vandaag + nieuwste omleidingen */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Planning */}
        <div className="rounded-lg border border-slate-200 bg-white">
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-100">
            <h3 className="text-sm font-semibold text-slate-900">Planning</h3>
            <span className="text-xs text-slate-500">
              {now.toLocaleDateString('nl-BE', { day: '2-digit', month: 'short' })}
            </span>
          </div>

          {visibleShifts.length > 0 ? (
            <div className="divide-y divide-slate-100">
              {visibleShifts.map((shift) => (
                <div key={shift.id} className="flex items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-slate-500">{formatShiftDate(shift.date)}</span>
                      <span className="text-xs text-slate-300">·</span>
                      <span className="text-xs font-medium text-oker-700">Dienst {getServiceNumber(shift)}</span>
                    </div>
                    <p className="mt-0.5 text-sm font-medium text-slate-900 tabular-nums">
                      {shift.startTime} – {shift.endTime}
                    </p>
                  </div>
                  {user.role !== 'chauffeur' && (
                    <span className="text-xs text-slate-500 truncate">
                      {users.find((u) => u.id === shift.driverId)?.name || 'Onbekend'}
                    </span>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center text-center py-10 px-4">
              <Calendar size={20} className="text-slate-300 mb-2" />
              <p className="text-sm font-medium text-slate-700">Geen dienst vandaag</p>
              <p className="mt-0.5 text-xs text-slate-500">Geniet ervan.</p>
            </div>
          )}
        </div>

        {/* Omleidingen */}
        <div className="rounded-lg border border-slate-200 bg-white">
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-100">
            <h3 className="text-sm font-semibold text-slate-900">Nieuwste omleidingen</h3>
            <span className="text-xs text-slate-500">{newestDiversions.length} getoond</span>
          </div>

          {newestDiversions.length > 0 ? (
            <div className="divide-y divide-slate-100">
              {newestDiversions.map((div) => (
                <div key={div.id} className="flex items-start gap-3 px-4 py-3">
                  <span className="mt-1 h-1.5 w-1.5 rounded-full bg-oker-500 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-slate-900 truncate">{div.title}</p>
                      <span className="shrink-0 inline-block rounded border border-slate-200 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">
                        {div.line}
                      </span>
                    </div>
                    <p className="mt-0.5 text-xs text-slate-500 line-clamp-2">{div.description}</p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center text-center py-10 px-4">
              <MapPin size={20} className="text-slate-300 mb-2" />
              <p className="text-sm font-medium text-slate-700">Geen actieve hinder</p>
              <p className="mt-0.5 text-xs text-slate-500">Er zijn momenteel geen omleidingen.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
