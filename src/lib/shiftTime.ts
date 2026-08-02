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
/** Busvak-tijdvalidatie voor invoer/import: uur 0–47, minuten 0–59.
 *  Eén bron van waarheid — de server-import en het beheerformulier
 *  accepteerden elk hun eigen (lossere) variant, waardoor "08:75" een
 *  geldige planningsrij kon worden die elke component anders las. */
export const isValidBusvakTime = (t: string): boolean => parseHHMM(t) !== null;

/** "6:00" → "06:00": niet-gepadde uren sorteren lexicografisch fout
 *  ("14:00" < "6:00") — normaliseren op de invoergrens houdt alle
 *  string-sorteringen elders correct. */
export const normalizeTimeString = (t: string): string => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(t ?? '').trim());
  if (!m) return String(t ?? '').trim();
  return `${m[1].padStart(2, '0')}:${m[2]}`;
};

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

/**
 * Is dit segment al voorbij op `now`? Zelfde tijdframe als isShiftActiveAt
 * (minuten t.o.v. middernacht van de dienstdag, busvak-uren en middernacht
 * inbegrepen), zodat een chauffeur alleen zijn nog te rijden delen ziet.
 * Ongeldige tijden gelden als "niet voorbij" — liever tonen dan verbergen.
 */
export const hasShiftEnded = (
  shift: { date: string; startTime: string; endTime: string },
  now: Date,
): boolean => {
  const start = parseHHMM(shift.startTime);
  const end = parseHHMM(shift.endTime);
  if (start === null || end === null) return false;
  // start === eind: isShiftActiveAt behandelt zo'n rij als "nooit actief" —
  // hier dan "meteen voorbij" op de dienstdag zelf i.p.v. de eind≤start-regel
  // (+24u), die hem een etmaal ongedempt liet staan.
  const endNorm = end < start ? end + 24 * 60 : end;
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const dayDiff = Math.round(
    (new Date(`${localIso(now)}T00:00:00`).getTime() - new Date(`${shift.date}T00:00:00`).getTime()) / 86400000,
  );
  if (dayDiff < 0) return false; // dienstdag ligt nog in de toekomst
  return nowMin + dayDiff * 24 * 60 >= endNorm;
};

/**
 * Hoeveel minuten loopt dit segment nog? null als de tijden ongeldig zijn of
 * het segment niet (meer) bezig is — de aanroeper toont dan gewoon niets.
 *
 * Zelfde tijdframe als isShiftActiveAt: alles in minuten t.o.v. middernacht
 * van de dienstdag, zodat de busvak-notatie ("24:20" = 00:20 de nacht erna)
 * en een dienst van gisteren die nu nog loopt allebei goed uitkomen.
 */
export const minutesUntilShiftEnd = (
  shift: { date: string; startTime: string; endTime: string },
  now: Date,
): number | null => {
  if (!isShiftActiveAt(shift, now)) return null;
  const start = parseHHMM(shift.startTime);
  const end = parseHHMM(shift.endTime);
  if (start === null || end === null) return null;
  const endNorm = end <= start ? end + 24 * 60 : end;
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const dagVerschil = Math.round(
    (new Date(`${localIso(now)}T00:00:00`).getTime() - new Date(`${shift.date}T00:00:00`).getTime()) / 86400000,
  );
  const resterend = endNorm - (nowMin + dagVerschil * 24 * 60);
  return resterend > 0 ? resterend : null;
};

/** "nog 1u 32min" / "nog 47min" / "nog 2u". Compact, want dit staat als
 *  terzijde naast de diensttijden. */
export const formatRemaining = (minuten: number): string => {
  const u = Math.floor(minuten / 60);
  const m = minuten % 60;
  if (u === 0) return `nog ${m}min`;
  if (m === 0) return `nog ${u}u`;
  return `nog ${u}u ${m}min`;
};
