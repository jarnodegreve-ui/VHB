import { buildCalendar, type IcsEvent } from './ics';
import { serviceNumberOf } from './format';
import { downloadBlob } from './ui';
import type { Shift } from '../types';

/**
 * Download het rooster van één chauffeur als agendabestand (.ics). Gedeeld
 * door het rooster ("Aan agenda toevoegen") en Instellingen › Agenda-koppeling.
 * De ICS-builder schrijft floating local time en zet DTEND een dag verder
 * bij een nachtdienst (eind <= start).
 */
export function downloadRoosterIcs(userName: string, shifts: Shift[]) {
  const dtstamp = new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
  const events: IcsEvent[] = shifts
    .filter((shift) => shift.startTime && shift.endTime)
    .map((shift) => ({
      uid: `${shift.id}@vhb-portaal.be`,
      date: shift.date,
      startTime: shift.startTime,
      endTime: shift.endTime,
      summary: `Dienst ${serviceNumberOf(shift)}`,
      description: `VHB · ${shift.startTime} - ${shift.endTime}`,
    }));
  const fullCalendar = buildCalendar(events, { calName: `VHB Rooster ${userName}`, dtstamp });
  const blob = new Blob([fullCalendar], { type: 'text/calendar;charset=utf-8' });
  void downloadBlob(`VHB_Rooster_${userName.replace(/\s+/g, '_')}.ics`, blob);
}
