/**
 * Categoriseert een dienst op starttijd voor visuele groepering/kleurcode.
 * Ochtend: vóór 09:00 — Middag: 09:00–14:59 — Avond: 15:00+.
 *
 * Eén gedeelde bron zodat het rooster (ScheduleView) en de maandprint
 * (PrintMonthlyScheduleView) niet uit elkaar lopen als de drempels wijzigen.
 */
export const shiftCategory = (startTime: string): 'ochtend' | 'middag' | 'avond' => {
  const h = parseInt(String(startTime).split(':')[0] || '0', 10);
  if (h < 9) return 'ochtend';
  if (h < 15) return 'middag';
  return 'avond';
};
