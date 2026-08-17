/**
 * Advies voor openstaande diensten: past een onbemande dienst in het schema
 * van een vrije chauffeur? Twee harde regels (vraag Jarno 17-08):
 *
 *  1. Minstens MIN_RUST_UREN uur rust t.o.v. de dienst van de dag ervoor — en
 *     spiegelbeeldig ook t.o.v. de dag erna, want dat is dezelfde regel
 *     bekeken vanaf morgen: anders maakt de toewijzing van vandaag de rust
 *     van een al ingeplande dienst kapot.
 *  2. Maximum MAX_WERKDAGEN_NA_ELKAAR gewerkte dagen na elkaar.
 *
 * Pure logica zonder storage, zodat src/advisor.test.ts hem direct kan
 * testen; de endpoint (/api/coverage-advisor) voert alleen de data aan.
 */

export const MIN_RUST_UREN = 8;
export const MAX_WERKDAGEN_NA_ELKAAR = 6;

export type TijdRij = { startTime: string; endTime: string };

/** 'HH:MM' → minuten sinds middernacht van de dienstdag. Busvak-uren ≥ 24
 *  ("26:16" = 02:16 de nacht erna) zijn geldig tot 47:59 — zelfde regels als
 *  parseHHMM in src/lib/shiftTime.ts. */
const parseBusvakMin = (t: string): number | null => {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(t ?? "").trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 47 || min > 59) return null;
  return h * 60 + min;
};

/**
 * Werkvenster van één dag (gesplitste dienst = meerdere rijen): vroegste
 * start t/m laatste einde, in minuten sinds middernacht van de dienstdag.
 * Een impliciete nachtdienst (einde ≤ start met gewone uren, bv.
 * 22:00–06:00) wordt +24u genormaliseerd — zelfde conventie als
 * isShiftActiveAt in src/lib/shiftTime.ts. Rijen met kapotte tijden tellen
 * niet mee; null = geen bruikbare tijden.
 */
export const dagVenster = (rijen: TijdRij[]): { start: number; eind: number } | null => {
  let start: number | null = null;
  let eind: number | null = null;
  for (const rij of rijen) {
    const s = parseBusvakMin(rij.startTime);
    const e = parseBusvakMin(rij.endTime);
    if (s === null || e === null) continue;
    const eNorm = e <= s ? e + 24 * 60 : e;
    start = start === null ? s : Math.min(start, s);
    eind = eind === null ? eNorm : Math.max(eind, eNorm);
  }
  return start === null || eind === null ? null : { start, eind };
};

/** ISO-dag ± n dagen (puur datumrekenen in UTC-frame, geen tijdzones). */
export const addDagen = (iso: string, n: number): string => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/**
 * Rust in minuten tussen het einde van de vorige werkdag en het begin van de
 * aangeboden dienst. Beide staan in minuten t.o.v. hun éigen dienstdag-
 * middernacht; de vorige dag ligt 24u eerder, vandaar de +24u op de start.
 * null = geen dienst de dag ervoor → de regel legt niets op.
 */
export const rustTovVorigeDag = (vorigeDag: TijdRij[], dienstStart: number): number | null => {
  const v = dagVenster(vorigeDag);
  return v === null ? null : dienstStart + 24 * 60 - v.eind;
};

/** Spiegelbeeld: rust tussen het einde van de aangeboden dienst en de start
 *  van de dienst op de dag erna. */
export const rustTovVolgendeDag = (volgendeDag: TijdRij[], dienstEind: number): number | null => {
  const v = dagVenster(volgendeDag);
  return v === null ? null : v.start + 24 * 60 - dienstEind;
};

/** Hoeveel dagen na elkaar werkt de chauffeur als `datum` een werkdag wordt?
 *  Telt de aaneengesloten reeks bestaande werkdagen in beide richtingen
 *  (guard tegen ontsporen op een corrupte set). */
export const dagenNaElkaarMet = (gewerkteDagen: Set<string>, datum: string): number => {
  let n = 1;
  for (let d = addDagen(datum, -1), g = 0; gewerkteDagen.has(d) && g < 366; d = addDagen(d, -1), g++) n++;
  for (let d = addDagen(datum, 1), g = 0; gewerkteDagen.has(d) && g < 366; d = addDagen(d, 1), g++) n++;
  return n;
};

/** "8u" / "7u53" — compacte urennotatie voor redenen en badges. */
export const formatUren = (minuten: number): string => {
  const heel = Math.max(0, minuten);
  const u = Math.floor(heel / 60);
  const m = heel % 60;
  return m === 0 ? `${u}u` : `${u}u${String(m).padStart(2, "0")}`;
};

export type KandidaatAdvies = {
  id: string;
  name: string;
  /** Rust in minuten t.o.v. de vorige/volgende werkdag; null = geen dienst die dag. */
  rustVoor: number | null;
  rustNa: number | null;
  /** Gewerkte dagen na elkaar mét deze toewijzing erbij. */
  dagenNaElkaar: number;
  /** Hoe vaak dit jaar al ingevallen (eerlijke verdeling, zie src/lib/vervangers.ts). */
  keren: number;
  past: boolean;
  redenen: string[];
};

export const beoordeelKandidaat = (invoer: {
  id: string;
  name: string;
  /** Venster van de aangeboden dienst; null = tijden onbekend → alleen de 6-dagenregel telt. */
  dienstVenster: { start: number; eind: number } | null;
  vorigeDag: TijdRij[];
  volgendeDag: TijdRij[];
  gewerkteDagen: Set<string>;
  datum: string;
  keren: number;
}): KandidaatAdvies => {
  const rustVoor = invoer.dienstVenster ? rustTovVorigeDag(invoer.vorigeDag, invoer.dienstVenster.start) : null;
  const rustNa = invoer.dienstVenster ? rustTovVolgendeDag(invoer.volgendeDag, invoer.dienstVenster.eind) : null;
  const dagen = dagenNaElkaarMet(invoer.gewerkteDagen, invoer.datum);
  const grens = MIN_RUST_UREN * 60;
  const redenen: string[] = [];
  if (rustVoor !== null && rustVoor < grens) redenen.push(`maar ${formatUren(rustVoor)} rust na de dienst van de dag ervoor`);
  if (rustNa !== null && rustNa < grens) redenen.push(`maar ${formatUren(rustNa)} rust vóór de dienst van de dag erna`);
  if (dagen > MAX_WERKDAGEN_NA_ELKAAR) redenen.push(`zou ${dagen} dagen na elkaar werken`);
  return {
    id: invoer.id,
    name: invoer.name,
    rustVoor,
    rustNa,
    dagenNaElkaar: dagen,
    keren: invoer.keren,
    past: redenen.length === 0,
    redenen,
  };
};

/** Passend eerst; daarbinnen wie dit jaar het minst inviel, dan op naam —
 *  zelfde eerlijke volgorde als rangschikKandidaten (src/lib/vervangers.ts). */
export const sorteerKandidaten = (ks: KandidaatAdvies[]): KandidaatAdvies[] =>
  [...ks].sort(
    (a, b) => Number(b.past) - Number(a.past) || a.keren - b.keren || a.name.localeCompare(b.name),
  );
