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

/** 'HH:MM' → minuten sinds middernacht, of null bij een ongeldige tijd. */
const parseHHMM = (t: string): number | null => {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(t ?? '').trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
};

/** Lokale yyyy-mm-dd (geen UTC-shift — zelfde conventie als isoDate elders). */
const localIso = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/**
 * Is dit dienstsegment op dit moment bezig? Gesplitste diensten zijn aparte
 * segmenten, dus een chauffeur met pauze tussen twee delen telt dan terecht
 * niet mee. Nachtdiensten (eindtijd ≤ starttijd) lopen over middernacht: die
 * zijn actief vanaf de start op hun eigen datum én tot de eindtijd op de dag
 * erna. Start is inclusief, einde exclusief; ongeldige tijden tellen nooit mee.
 */
export const isShiftActiveAt = (
  shift: { date: string; startTime: string; endTime: string },
  now: Date,
): boolean => {
  const start = parseHHMM(shift.startTime);
  const end = parseHHMM(shift.endTime);
  if (start === null || end === null || start === end) return false;
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const today = localIso(now);
  if (end > start) {
    return shift.date === today && nowMin >= start && nowMin < end;
  }
  // Over middernacht: vanavond ná de start, of vanochtend vóór het einde
  // (dan is de dienst gisteren gestart).
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  return (shift.date === today && nowMin >= start) || (shift.date === localIso(yesterday) && nowMin < end);
};
