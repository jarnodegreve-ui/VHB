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

/** 'HH:MM' → minuten sinds middernacht van de dienstdag, of null bij een
 *  ongeldige tijd. Uren ≥ 24 zijn geldig: het Dienstoverzicht gebruikt de
 *  busvak-notatie voor ná middernacht ("26:16" = 02:16 de volgende nacht).
 *  Cap op 47:59 (GTFS-conventie) — daarboven is het geen tijd maar vuil. */
const parseHHMM = (t: string): number | null => {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(t ?? '').trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 47 || min > 59) return null;
  return h * 60 + min;
};

/** Lokale yyyy-mm-dd (geen UTC-shift — zelfde conventie als isoDate elders). */
const localIso = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/**
 * Is dit dienstsegment op dit moment bezig? Gesplitste diensten zijn aparte
 * segmenten, dus een chauffeur met pauze tussen twee delen telt dan terecht
 * niet mee. Over middernacht kan op twee manieren: expliciet via de busvak-
 * notatie (eindtijd ≥ 24:00, bv. "26:16") of impliciet (eindtijd ≤ starttijd
 * met gewone uren, bv. 22:00–06:00) — beide lopen door tot op de dag na de
 * dienstdatum. Start is inclusief, einde exclusief; ongeldige tijden tellen
 * nooit mee.
 */
export const isShiftActiveAt = (
  shift: { date: string; startTime: string; endTime: string },
  now: Date,
): boolean => {
  const start = parseHHMM(shift.startTime);
  const end = parseHHMM(shift.endTime);
  if (start === null || end === null || start === end) return false;
  // Alles in minuten t.o.v. middernacht van de díenstdag: een impliciete
  // nachtdienst (einde ≤ start, gewone uren) wordt +24u genormaliseerd;
  // busvak-uren ≥ 24 zijn al volgende-dag.
  const endNorm = end <= start ? end + 24 * 60 : end;
  const nowMin = now.getHours() * 60 + now.getMinutes();
  if (shift.date === localIso(now)) {
    return nowMin >= start && nowMin < endNorm;
  }
  // Dienst van gisteren die na middernacht nog loopt: bekijk 'nu' als
  // minuten voorbij gisterenmiddernacht.
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (shift.date !== localIso(yesterday)) return false;
  const nowSinceShiftDay = nowMin + 24 * 60;
  return nowSinceShiftDay >= start && nowSinceShiftDay < endNorm;
};
