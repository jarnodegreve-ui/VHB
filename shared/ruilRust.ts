/**
 * Rusttijd bij een dienstruil (wens Jarno 20-09, gebouwd 22-09).
 *
 * Tussen twee diensten hoort minstens 8 uur rust te zitten. De goedkeuring
 * door de planner bestaat precies voor die controle, maar het portaal hielp er
 * niet bij: Jarno rekende het na in Excel. Deze module rekent het uit voor
 * iedereen die door de ruil een dienst KRIJGT, in de situatie zoals ze na de
 * ruil zou zijn.
 *
 * Bewust een waarschuwing, geen blokkade: de planner beslist.
 *
 * - Op dienstniveau, niet per deel: een gesplitste dienst telt van zijn eerste
 *   begin tot zijn laatste einde (`dagVenster`).
 * - De regel kijkt naar de dag ervoor en de dag erna. Ligt er een vrije dag
 *   tussen, dan is de rust per definitie ruim genoeg en zegt de regel niets.
 * - De rekenkern is dezelfde als die van het herverdeeladvies (api/advisor.ts
 *   exporteert ze door), zodat beide nooit een andere uitkomst geven.
 */

export const MIN_RUST_UREN = 8;

export type TijdRij = { startTime: string; endTime: string };

/** 'HH:MM' → minuten sinds middernacht van de dienstdag. Busvak-uren ≥ 24
 *  ("26:16" = 02:16 de nacht erna) zijn geldig tot 47:59 — zelfde regels als
 *  parseHHMM in src/lib/shiftTime.ts. */
const parseBusvakMin = (t: string): number | null => {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(t ?? '').trim());
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
export const dagVenster = (rijen: readonly TijdRij[]): { start: number; eind: number } | null => {
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

/**
 * Rust in minuten tussen het einde van de vorige werkdag en het begin van de
 * dienst. Beide staan in minuten t.o.v. hun éigen dienstdag-middernacht; de
 * vorige dag ligt 24u eerder, vandaar de +24u op de start.
 * null = geen dienst de dag ervoor → de regel legt niets op.
 */
export const rustTovVorigeDag = (vorigeDag: readonly TijdRij[], dienstStart: number): number | null => {
  const v = dagVenster(vorigeDag);
  return v === null ? null : dienstStart + 24 * 60 - v.eind;
};

/** Spiegelbeeld: rust tussen het einde van de dienst en de start van de
 *  dienst op de dag erna. */
export const rustTovVolgendeDag = (volgendeDag: readonly TijdRij[], dienstEind: number): number | null => {
  const v = dagVenster(volgendeDag);
  return v === null ? null : v.start + 24 * 60 - dienstEind;
};

/** "8u" / "7u53" — compacte urennotatie. */
export const formatRust = (minuten: number): string => {
  const heel = Math.max(0, minuten);
  const u = Math.floor(heel / 60);
  const m = heel % 60;
  return m === 0 ? `${u}u` : `${u}u${String(m).padStart(2, '0')}`;
};

// --- de ruil zelf ------------------------------------------------------------

export type RustPlanningRij = TijdRij & { date: string; driverId: string; line?: string | null };

export type RuilVoorRust = {
  requesterId: string;
  targetDriverId?: string | null;
  status?: string;
  shiftDate?: string | null;
  shiftLine?: string | null;
  returnDate?: string | null;
  returnCode?: string | null;
};

export type RuilRustRegel = {
  /** Wie deze dienst door de ruil krijgt. */
  wie: 'aanvrager' | 'collega';
  datum: string;
  dienst: string;
  /** Minuten rust t.o.v. de dienst van de dag ervoor; null = die is er niet. */
  rustVoor: number | null;
  /** Minuten rust tot de dienst van de dag erna; null = die is er niet. */
  rustNa: number | null;
  /** Minstens één van beide ligt onder het minimum. */
  teKort: boolean;
};

const dagErbij = (iso: string, n: number): string => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

const zelfde = (a: unknown, b: unknown) => String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase();

/** Alleen een ruil die nog beslist moet worden heeft zin om na te rekenen:
 *  daarna staat de planning er al zoals ze is. */
export const RUST_TE_BEOORDELEN = new Set(['pending', 'accepted']);

/**
 * De rust van iedereen die door deze ruil een dienst krijgt, in de situatie NA
 * de ruil. `planning` = de rijen van beide chauffeurs rond de betrokken dagen
 * (meer mag, de rest wordt genegeerd).
 */
export const beoordeelRuilRust = (ruil: RuilVoorRust, planning: readonly RustPlanningRij[]): RuilRustRegel[] => {
  const aanvrager = String(ruil.requesterId ?? '');
  const collega = String(ruil.targetDriverId ?? '');
  const dag = String(ruil.shiftDate ?? '');
  const dienst = String(ruil.shiftLine ?? '');
  if (!aanvrager || !collega || !dag || !dienst) return [];
  if (ruil.status && !RUST_TE_BEOORDELEN.has(ruil.status)) return [];

  const terugDag = String(ruil.returnDate ?? '');
  const terugDienst = String(ruil.returnCode ?? '');
  const heeftTerugdienst = !!terugDag && !!terugDienst && !zelfde(terugDienst, 'vrij');

  const gegeven = planning.filter((r) => String(r.driverId) === aanvrager && r.date === dag && zelfde(r.line, dienst));
  const terug = heeftTerugdienst
    ? planning.filter((r) => String(r.driverId) === collega && r.date === terugDag && zelfde(r.line, terugDienst))
    : [];

  // De planning zoals ze na de ruil zou zijn, per persoon.
  const naRuil = (persoon: string, datum: string): RustPlanningRij[] => {
    const eigen = planning.filter((r) => String(r.driverId) === persoon && r.date === datum);
    if (persoon === aanvrager) {
      const zonder = eigen.filter((r) => !gegeven.includes(r));
      return datum === terugDag ? [...zonder, ...terug] : zonder;
    }
    const zonder = eigen.filter((r) => !terug.includes(r));
    return datum === dag ? [...zonder, ...gegeven] : zonder;
  };

  const grens = MIN_RUST_UREN * 60;
  const regel = (wie: RuilRustRegel['wie'], persoon: string, datum: string, naam: string, rijen: RustPlanningRij[]): RuilRustRegel | null => {
    const venster = dagVenster(rijen);
    if (!venster) return null;
    const rustVoor = rustTovVorigeDag(naRuil(persoon, dagErbij(datum, -1)), venster.start);
    const rustNa = rustTovVolgendeDag(naRuil(persoon, dagErbij(datum, 1)), venster.eind);
    return { wie, datum, dienst: naam, rustVoor, rustNa, teKort: (rustVoor !== null && rustVoor < grens) || (rustNa !== null && rustNa < grens) };
  };

  const uit: RuilRustRegel[] = [];
  const voorCollega = regel('collega', collega, dag, dienst, gegeven);
  if (voorCollega) uit.push(voorCollega);
  if (heeftTerugdienst) {
    const voorAanvrager = regel('aanvrager', aanvrager, terugDag, terugDienst, terug);
    if (voorAanvrager) uit.push(voorAanvrager);
  }
  return uit;
};
