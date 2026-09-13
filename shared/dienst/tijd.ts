/**
 * Tijdhulpjes voor de dienstopbouw. De ET-export schrijft tijden als
 * '07u24' en laat de klok na middernacht doorlopen ('25u10' of, in oudere
 * exports, '01u10' voor de vroege ochtend). Intern rekenen we in minuten
 * sinds 00:00 van de dienstdag.
 */
export const parseUurNotatie = (t: string | null | undefined): number | null => {
  const s = String(t ?? '').trim().toLowerCase();
  const m = /^(\d{1,2})[u:h.](\d{2})$/.exec(s);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
};

/** Minuten → 'HH:MM'; boven 23:59 loopt de klok door ('25:10'), tenzij `wrap24`. */
export const formatHHMM = (min: number, opts: { wrap24?: boolean } = {}): string => {
  let h = Math.floor(min / 60);
  const mm = min % 60;
  if (opts.wrap24 && h >= 24) h -= 24;
  return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
};

/** Access: uren boven 23 worden '0' & (h-24) → '01:10' voor 25u10; JD/JA-vlag 1. */
export const formatEasypayTijd = (min: number): string => {
  const h = Math.floor(min / 60);
  const mm = min % 60;
  if (h > 23) return `0${h - 24}:${String(mm).padStart(2, '0')}`;
  return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
};

export const naMiddernacht = (min: number): 0 | 1 => (Math.floor(min / 60) > 23 ? 1 : 0);

/** Nachtwrap voor volgordecontroles: tijden vóór 04:00 horen bij de nacht ná de dienstdag (Access qry-controle 05). */
export const metNachtwrap = (min: number): number => (min < 240 ? min + 1440 : min);
