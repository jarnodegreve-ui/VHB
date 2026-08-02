import type { LeaveRequest } from '../types';

/**
 * Eén statuskleurtaal voor de hele app (design-ronde 30/07, verzoek Jarno:
 * uniformiteit). De afspraak:
 *
 *   wachtend      amber-400    goedgekeurd   emerald-500
 *   geweigerd     red-400      geannuleerd   slate-300
 *   ziekte        rose-500     klein verlet  blue-400
 *
 * Views kiezen alleen de VORM (vlak, stip of zachte dagtint) — nooit meer
 * eigen tinten. StatusBadge (primitives) volgt dezelfde taal via zijn tones.
 */

type LeaveStatus = LeaveRequest['status'];
type LeaveType = LeaveRequest['type'] | string | undefined;

/** Vol kleurvlak (verlof-kalendercellen). */
export const leaveSolid = (status: LeaveStatus | undefined, type?: LeaveType): string => {
  if (!status) return 'bg-transparent';
  if (status === 'approved') {
    if (type === 'ziekte') return 'bg-rose-500';
    return type === 'klein_verlet' ? 'bg-blue-400' : 'bg-emerald-500';
  }
  if (status === 'pending') return 'bg-amber-400';
  if (status === 'rejected') return 'bg-red-400';
  if (status === 'cancelled') return 'bg-slate-300';
  return 'bg-transparent';
};

/** Klein stipje (maandkalender, legendes). */
export const leaveDot = (status: LeaveStatus | undefined, type?: LeaveType): string => {
  if (status === 'pending') return 'bg-amber-400';
  if (type === 'ziekte') return 'bg-rose-500';
  if (type === 'klein_verlet') return 'bg-blue-400';
  return 'bg-emerald-500';
};

/** Zachte chip: vlak + tekst (dagdetail in Mijn rooster). Bewust zonder eigen
 *  dark:-varianten — de blanket-overrides in index.css klappen deze tinten al
 *  om, net als bij leaveDayTint. Deze keten stond met de hand uitgeschreven in
 *  ScheduleView, met een nét andere donkere tint dan de dagcel er vlak boven. */
export const leaveChip = (status: LeaveStatus | undefined, type?: LeaveType): string => {
  if (status === 'pending') return 'bg-amber-50 text-amber-800';
  if (type === 'ziekte') return 'bg-rose-50 text-rose-700';
  if (type === 'klein_verlet') return 'bg-blue-50 text-blue-700';
  return 'bg-emerald-50 text-emerald-700';
};

/** Zachte dagtint (maandkalender-dagcellen). */
export const leaveDayTint = (status: LeaveStatus | undefined, type?: LeaveType): string => {
  if (status === 'pending') return 'bg-amber-50';
  if (status !== 'approved') return '';
  if (type === 'ziekte') return 'bg-rose-50';
  return type === 'klein_verlet' ? 'bg-blue-50' : 'bg-emerald-50';
};
