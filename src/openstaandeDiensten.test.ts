import { describe, it, expect } from 'vitest';
import { openstaandeDienstenVanAfwezigen } from './lib/availability';
import type { LeaveRequest, Shift } from './types';

/**
 * Diensten die na een afwezigheidsmelding op naam blijven staan.
 *
 * Gegroeid uit een melding van Jarno (14-08): hij meldde iemand ziek voor zes
 * weken, zette vier diensten over en zag de melding "blijven staan". Dat was
 * terecht — er stonden er nog vier open — maar het dashboard toonde er maar
 * vier tegelijk, dus het leek alsof er niets veranderde. Deze test legt vast
 * dat de helper álle openstaande diensten teruggeeft, zodat de UI het totaal
 * kan tonen.
 */

const shift = (id: string, driverId: string, date: string, line: string): Shift => ({
  id, driverId, date, line, startTime: '06:00', endTime: '14:00',
} as Shift);

const ziek = (userId: string, startDate: string, endDate: string): LeaveRequest => ({
  id: `l-${userId}-${startDate}`, userId, startDate, endDate,
  type: 'ziekte', status: 'approved', createdAt: '2026-08-14T19:54:00Z',
} as LeaveRequest);

describe('openstaandeDienstenVanAfwezigen', () => {
  const langeZiekte = [ziek('bianca', '2026-08-17', '2026-09-25')];
  const planning = [
    shift('s1', 'bianca', '2026-08-17', '4102'),
    shift('s2', 'bianca', '2026-08-26', '4102'),
    shift('s3', 'bianca', '2026-08-27', '4109'),
    shift('s4', 'bianca', '2026-08-29', '2603'),
    shift('s5', 'bianca', '2026-08-31', '4104'),
    // Buiten de ziekteperiode → geen gat.
    shift('s6', 'bianca', '2026-10-01', '4101'),
    // Andere chauffeur, niet afwezig.
    shift('s7', 'diether', '2026-08-26', '4107'),
  ];

  it('geeft élke openstaande dienst in de hele afwezigheidsperiode terug', () => {
    const open = openstaandeDienstenVanAfwezigen(planning, langeZiekte, '2026-08-14');
    expect(open.map((s) => s.id)).toEqual(['s1', 's2', 's3', 's4', 's5']);
    expect(open[0].reden).toBe('Ziekte');
  });

  it('laat een overgezette dienst vallen (die staat niet meer op haar naam)', () => {
    const na = planning.map((s) => (s.id === 's1' ? { ...s, driverId: 'diether' } : s));
    const open = openstaandeDienstenVanAfwezigen(na, langeZiekte, '2026-08-14');
    expect(open.map((s) => s.id)).toEqual(['s2', 's3', 's4', 's5']);
  });

  it('kapt het verleden af — gisteren valt niets meer te herverdelen', () => {
    const open = openstaandeDienstenVanAfwezigen(planning, langeZiekte, '2026-08-28');
    expect(open.map((s) => s.id)).toEqual(['s4', 's5']);
  });

  it('telt alleen goedgekeurde afwezigheid', () => {
    const pending = [{ ...langeZiekte[0], status: 'pending' } as LeaveRequest];
    expect(openstaandeDienstenVanAfwezigen(planning, pending, '2026-08-14')).toEqual([]);
  });

  it('kan op één chauffeur en een einddatum filteren (ziekmeld-vervolgstap)', () => {
    const open = openstaandeDienstenVanAfwezigen(planning, langeZiekte, '2026-08-14', {
      driverId: 'bianca', totIso: '2026-08-27',
    });
    expect(open.map((s) => s.id)).toEqual(['s1', 's2', 's3']);
  });
});
