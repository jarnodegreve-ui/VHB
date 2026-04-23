import { Calendar, Clock, Download } from 'lucide-react';
import type { Shift, User } from '../types';
import { EmptyState } from '../components/ui';

export function ScheduleView({ user, shifts: allShifts, users }: { user: User, shifts: Shift[], users: User[] }) {
  const shifts = allShifts.filter(s => {
    const isMe = s.driverId === user.id;
    const isPlanner = user.role !== 'chauffeur';
    
    if (isMe) return true;
    if (!isPlanner) return false;

    const driver = users.find(u => u.id === s.driverId);
    if (driver?.name.toLowerCase() === 'beheerder') return false;
    
    return true;
  });
  const formatShiftDate = (date: string) => new Date(`${date}T00:00:00`).toLocaleDateString('nl-BE', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });
  const getServiceNumber = (shift: Shift) => String(shift.line || '--').trim() || '--';

  const exportToICS = () => {
    const calendarHeader = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//VHB Portaal//NL',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH'
    ].join('\r\n');

    const calendarFooter = 'END:VCALENDAR';

    const events = shifts.map(shift => {
      const [year, month, day] = shift.date.split('-').map(Number);
      const [startH, startM] = shift.startTime.split(':').map(Number);
      const [endH, endM] = shift.endTime.split(':').map(Number);

      const startDate = new Date(year, month - 1, day, startH, startM);
      const endDate = new Date(year, month - 1, day, endH, endM);

      const formatICSDate = (date: Date) => {
        return date.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
      };

      return [
        'BEGIN:VEVENT',
        `UID:${shift.id}@vhb-portaal.be`,
        `DTSTAMP:${formatICSDate(new Date())}`,
        `DTSTART:${formatICSDate(startDate)}`,
        `DTEND:${formatICSDate(endDate)}`,
        `SUMMARY:VHB Dienst`,
        `DESCRIPTION:Dienst ${shift.startTime} - ${shift.endTime}`,
        'END:VEVENT'
      ].join('\r\n');
    }).join('\r\n');

    const fullCalendar = `${calendarHeader}\r\n${events}\r\n${calendarFooter}`;
    const blob = new Blob([fullCalendar], { type: 'text/calendar;charset=utf-8' });
    const link = document.createElement('a');
    link.href = window.URL.createObjectURL(blob);
    link.setAttribute('download', `VHB_Rooster_${user.name.replace(/\s+/g, '_')}.ics`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="max-w-4xl space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <h3 className="text-2xl font-black tracking-tight">Mijn Werkrooster</h3>
          <p className="mt-1 text-sm font-medium text-slate-500">Overzicht van je komende diensten, met dienstnummer en tijdsvenster.</p>
        </div>
        <button 
          onClick={exportToICS}
          className="control-button-soft flex items-center gap-2 px-6 py-3 rounded-2xl font-black text-xs uppercase tracking-widest text-slate-600 transition-all active:scale-95"
        >
          <Download size={16} className="text-oker-500" />
          Export naar Agenda
        </button>
      </div>

      {/* Desktop Table */}
      <div className="hidden md:block surface-table rounded-[32px] overflow-hidden">
        {shifts.length > 0 ? (
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50/50 border-b border-slate-100">
                <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">Datum</th>
                <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">Dienst</th>
                <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">Tijd</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {shifts.map(shift => (
                <tr key={shift.id} className="hover:bg-slate-50/50 transition-colors group">
                  <td className="px-8 py-6">
                    <div className="space-y-1">
                      <p className="font-black text-slate-800">{formatShiftDate(shift.date)}</p>
                      <p className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">{shift.date}</p>
                    </div>
                  </td>
                  <td className="px-8 py-6">
                    <div className="inline-flex min-w-[7rem] flex-col rounded-[22px] border border-white/80 bg-white/80 px-4 py-3 shadow-sm">
                      <p className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">Dienstnummer</p>
                      <p className="mt-1 font-black text-oker-700">{getServiceNumber(shift)}</p>
                    </div>
                  </td>
                  <td className="px-8 py-6">
                    <div className="space-y-1">
                      <div className="flex items-center gap-3 text-slate-700 font-bold">
                        <Clock size={16} className="text-oker-400" />
                        {shift.startTime} - {shift.endTime}
                      </div>
                      <p className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">Geplande inzet</p>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="p-6">
            <EmptyState
              icon={<Calendar size={28} />}
              title="Geen diensten gepland"
              message="Zodra er planning beschikbaar is, verschijnt die hier."
            />
          </div>
        )}
      </div>

      {/* Mobile Cards */}
      <div className="md:hidden space-y-4">
        {shifts.map(shift => (
          <div key={shift.id} className="surface-card p-6 rounded-[32px] space-y-4">
            <div>
              <p className="text-[10px] font-black text-slate-300 uppercase tracking-widest mb-1">Datum</p>
              <p className="font-black text-slate-800">{formatShiftDate(shift.date)}</p>
              <p className="mt-1 text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">{shift.date}</p>
            </div>

            <div className="rounded-[24px] border border-white/80 bg-white/75 px-4 py-4">
              <p className="text-[10px] font-black text-slate-300 uppercase tracking-widest mb-1">Dienstnummer</p>
              <p className="font-black text-oker-700">{getServiceNumber(shift)}</p>
            </div>
            
            <div className="flex items-center gap-4 p-4 surface-muted rounded-2xl">
              <div className="w-12 h-12 bg-white/80 rounded-xl flex items-center justify-center shadow-sm ring-1 ring-white/80">
                <Clock size={20} className="text-oker-500" />
              </div>
              <div>
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Tijdstip</p>
                <p className="font-black text-slate-800">{shift.startTime} - {shift.endTime}</p>
              </div>
            </div>
          </div>
        ))}
        {shifts.length === 0 && (
          <EmptyState
            icon={<Calendar size={28} />}
            title="Geen diensten gepland"
            message="Zodra er planning beschikbaar is, verschijnt die hier."
          />
        )}
      </div>
    </div>
  );
}

