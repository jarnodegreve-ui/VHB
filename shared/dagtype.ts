/**
 * Dagtypes van De Lijn en afwijkende diensttijden per dagtype (10-10-2026,
 * keuze Jarno: de schoolritten rijden op woensdag een korter namiddagdeel, en
 * het dagtype is het model waar het portaal verder op bouwt).
 *
 * De Lijn kent elke dag een dagtypecode toe: periode × weekdag. Periode 2 is
 * schooldag (21 = maandag … 25 = vrijdag), 3 schoolvakantie (31-35), 4 juli en
 * augustus (41-45), 5 examen (51-55); 26 zaterdag, 27 zondag, 28 feestdag.
 * Dezelfde lijst staat in public.dagtype_codes (ET-import). De planningsmatrix
 * draagt de code per dag mee in day_type, maar niet altijd: dan leidt
 * `dagtypeVanDag` ze af uit de dekkingskalender en de weekdag.
 *
 * Een dienst in het dienstoverzicht heeft gewone tijden en nul of meer
 * afwijkingen (`varianten`): elk een lijstje dagtypes met een volledige set
 * tijden, delen en loopnummers. `tijdenOpDag` kiest per dag de juiste set.
 * Zuiver: geen zod, geen I/O, gedeeld door server en browser.
 */
import {
  DEFAULT_WEEKDAYS, WEEKDAY_PERIOD_KEY_RE, parseOverrides, resolveDayTypeMetBron,
  type DayTypeOverride, type WeekdagPeriode,
} from './coverageGaps.js';

// --- De lijst ----------------------------------------------------------------

/** Weekdagen in de volgorde van Date.getUTCDay (0 = zondag). */
export const WEEKDAG_NAAM = ['Zondag', 'Maandag', 'Dinsdag', 'Woensdag', 'Donderdag', 'Vrijdag', 'Zaterdag'] as const;
export const WEEKDAG_KORT = ['zo', 'ma', 'di', 'wo', 'do', 'vr', 'za'] as const;

export type DagtypeGroep = 'Schooldag' | 'Schoolvakantie' | 'Juli en augustus' | 'Examen' | 'Weekend en feestdag';
export type Dagtype = { code: string; label: string; groep: DagtypeGroep };

const PERIODES: ReadonlyArray<{ cijfer: string; groep: DagtypeGroep; achtervoegsel: string }> = [
  { cijfer: '2', groep: 'Schooldag', achtervoegsel: 'schooldag' },
  { cijfer: '3', groep: 'Schoolvakantie', achtervoegsel: 'schoolvakantie' },
  { cijfer: '4', groep: 'Juli en augustus', achtervoegsel: 'juli-augustus' },
  { cijfer: '5', groep: 'Examen', achtervoegsel: 'examen' },
];

/** Alle dagtypes, in de volgorde van de keuzelijst: per periode maandag tot
 *  vrijdag, dan zaterdag, zondag en feestdag. Labels zoals De Lijn ze noemt. */
export const DAGTYPES: readonly Dagtype[] = [
  ...PERIODES.flatMap((p) => [1, 2, 3, 4, 5].map((dag) => ({ code: `${p.cijfer}${dag}`, label: `${WEEKDAG_NAAM[dag]} ${p.achtervoegsel}`, groep: p.groep }))),
  { code: '26', label: 'Zaterdag', groep: 'Weekend en feestdag' },
  { code: '27', label: 'Zondag', groep: 'Weekend en feestdag' },
  { code: '28', label: 'Feestdag', groep: 'Weekend en feestdag' },
];

const LABEL_PER_CODE: Readonly<Record<string, string>> = Object.fromEntries(DAGTYPES.map((d) => [d.code, d.label]));

export const isDagtypeCode = (v: unknown): v is string => typeof v === 'string' && LABEL_PER_CODE[v] !== undefined;

/** "Woensdag schooldag", of "Dagtype 99" voor een onbekende code. */
export const dagtypeLabel = (code: string): string => LABEL_PER_CODE[code] ?? `Dagtype ${code}`;

// --- Welk dagtype is een dag? -------------------------------------------------

/** De dekkingskalender zoals de dekking ze bijhoudt: de weekdag-toewijzing,
 *  de periodes met ingangsdatum en de uitzonderingen. */
export type DagtypeKalender = { weekdays: string[]; perioden: WeekdagPeriode[]; overrides: DayTypeOverride[] };

const WEEKDAGEN_SLEUTEL = '__weekdagen__';
const UITZONDERINGEN_SLEUTEL = '__uitzonderingen__';

/** De kalender uit de opgeslagen dekkingsconfig (coverage_expectations):
 *  dezelfde gereserveerde sleutels als api/coverageRoutes.ts. */
export function kalenderUitDekking(stored: Record<string, unknown>): DagtypeKalender {
  const weekdaysRaw = stored[WEEKDAGEN_SLEUTEL];
  const weekdays = Array.isArray(weekdaysRaw) && weekdaysRaw.length === 7 ? weekdaysRaw.map((s) => String(s ?? '')) : [...DEFAULT_WEEKDAYS];
  const perioden: WeekdagPeriode[] = Object.entries(stored)
    .flatMap(([k, v]) => {
      const m = WEEKDAY_PERIOD_KEY_RE.exec(k);
      return m && Array.isArray(v) && v.length === 7 ? [{ vanaf: m[1], weekdays: v.map((s) => String(s ?? '')) }] : [];
    })
    .sort((a, b) => a.vanaf.localeCompare(b.vanaf));
  return { weekdays, perioden, overrides: parseOverrides(stored[UITZONDERINGEN_SLEUTEL]) };
}

export type DagtypeBron = 'excel' | 'kalender' | 'weekdag' | 'geen';

/** De periode (of het weekendtype) die in de naam van een dekkingsdagtype
 *  zit. De planner kiest die namen zelf ("vakantieperiode ma/di/wo",
 *  "schooldag dinsdag", "woensdag", "herfstverlof"): daarom op trefwoord, niet
 *  op gelijkheid. Een feestdag heet in de dekking vaak "zondag" (het
 *  zondagregime) en wordt dan 27; alleen "feest" in de naam geeft 28. */
const periodeUitNaam = (naam: string): string => {
  const n = naam.toLowerCase();
  if (/feest/.test(n)) return '28';
  if (/zondag/.test(n)) return '27';
  if (/zaterdag/.test(n)) return '26';
  if (/juli|augustus|zomer/.test(n)) return '4';
  if (/examen/.test(n)) return '5';
  if (/vakantie|verlof|kerst|paas|pasen|krokus|herfst/.test(n)) return '3';
  return '2';
};

const weekdagVan = (datum: string): number | null => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(datum ?? '').trim());
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  // Een echte kalenderdag: "2026-02-30" schuift anders stil door naar 2 maart.
  if (Number.isNaN(d.getTime()) || d.getUTCMonth() + 1 !== Number(m[2]) || d.getUTCDate() !== Number(m[3])) return null;
  return d.getUTCDay();
};

/**
 * De De Lijn-dagtypecode van een dag.
 *   1. De code uit de planningsmatrix (kolom day_type) wint, als het er een is.
 *      Staat daar een naam ("vakantie", "zondag"), dan telt die zoals de
 *      dekking ze telt: als het dagtype van die dag, op trefwoord.
 *   2. Anders de dekkingskalender: haar dagtype van die dag zegt de periode
 *      (schooldag, vakantie, juli-augustus, examen, of een weekend- of
 *      feestdagtype), de weekdag doet de rest.
 *   3. Zonder kalender: weekend op de weekdag, elke andere dag een schooldag.
 */
export function dagtypeVanDag(datum: string, excelDagtype?: unknown, kalender?: DagtypeKalender | null): { code: string | null; bron: DagtypeBron } {
  const expliciet = String(excelDagtype ?? '').trim();
  if (isDagtypeCode(expliciet)) return { code: expliciet, bron: 'excel' };
  const dow = weekdagVan(datum);
  if (dow === null) return { code: null, bron: 'geen' };
  // Zelfde beslisregels als de dekking (resolveDayTypeMetBron): een naam uit
  // kolom B wint, dan de uitzonderingen, dan de periode of de basis.
  const naam = kalender
    ? resolveDayTypeMetBron(expliciet, datum, kalender.weekdays, kalender.perioden, kalender.overrides).dayType
    : expliciet;
  const periode = naam ? periodeUitNaam(naam) : '2';
  const bron: DagtypeBron = expliciet ? 'excel' : naam ? 'kalender' : 'weekdag';
  if (periode.length === 2) return { code: periode, bron };
  if (dow === 6) return { code: '26', bron };
  if (dow === 0) return { code: '27', bron };
  return { code: `${periode}${dow}`, bron };
}

// --- Tijden per dagtype ---------------------------------------------------------

/** De velden van een dienst waar de planning-opbouw naar kijkt, per deel. */
export const DIENST_TIJD_VELDEN = [
  'startTime', 'endTime', 'loopnr',
  'startTime2', 'endTime2', 'loopnr2',
  'startTime3', 'endTime3', 'loopnr3',
] as const;
export type DienstTijdVeld = (typeof DIENST_TIJD_VELDEN)[number];
export type DienstTijden = Partial<Record<DienstTijdVeld, string | null | undefined>>;

/** Eén afwijking: op deze dagtypes gelden déze tijden, delen en loopnummers
 *  (een volledige set; wat ontbreekt is leeg, niet "zoals gewoon"). */
export type DienstVariant = DienstTijden & { dagtypes: string[] };

export type MetVarianten = DienstTijden & { varianten?: DienstVariant[] | null };

const tekst = (v: unknown): string => (v === null || v === undefined ? '' : String(v).trim());

/** Alleen de tijdvelden van een dienst of variant, leeg = weggelaten. */
export const tijdenVan = (bron: DienstTijden): DienstTijden => {
  const uit: DienstTijden = {};
  for (const veld of DIENST_TIJD_VELDEN) {
    const w = tekst(bron[veld]);
    if (w) uit[veld] = w;
  }
  return uit;
};

/** Minstens één deel met begin én einde; anders is het geen set tijden. */
const heeftTijden = (t: DienstTijden): boolean =>
  Boolean((t.startTime && t.endTime) || (t.startTime2 && t.endTime2) || (t.startTime3 && t.endTime3));

/**
 * Varianten zoals ze opgeslagen en vergeleken worden: alleen bekende
 * dagtypecodes, elk hoogstens in één variant (de eerste wint), zonder lege
 * varianten en zonder varianten zonder één volledig deel (een afwijking
 * "rijdt niet" bestaat niet: dan hoort de code niet in de matrix); undefined
 * als er niets overblijft.
 */
export function variantenSchoon(raw: unknown): DienstVariant[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const gezien = new Set<string>();
  const uit: DienstVariant[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const { dagtypes } = item as { dagtypes?: unknown };
    const codes = (Array.isArray(dagtypes) ? dagtypes : [])
      .map((c) => tekst(c))
      .filter((c) => isDagtypeCode(c) && !gezien.has(c));
    if (codes.length === 0) continue;
    const tijden = tijdenVan(item as DienstTijden);
    if (!heeftTijden(tijden)) continue;
    for (const c of codes) gezien.add(c);
    uit.push({ dagtypes: [...new Set(codes)], ...tijden });
  }
  return uit.length > 0 ? uit : undefined;
}

/** De variant die op dit dagtype geldt, of null. */
export const variantVoor = (dienst: MetVarianten, dagtype: string | null | undefined): DienstVariant | null =>
  (dagtype && variantenSchoon(dienst.varianten)?.find((v) => v.dagtypes.includes(dagtype))) || null;

/** De tijden, delen en loopnummers die op een dag gelden: de variant van dat
 *  dagtype, anders de gewone tijden. Zonder dagtype altijd de gewone. */
export function tijdenOpDag(dienst: MetVarianten, dagtype: string | null | undefined): DienstTijden {
  const variant = variantVoor(dienst, dagtype);
  return tijdenVan(variant ?? dienst);
}

/** Vaste tekstafdruk van de varianten voor vergelijkingen (versies, "is het
 *  dienstoverzicht inhoudelijk gewijzigd?"): volgorde-onafhankelijk, leeg
 *  zonder varianten. */
export function variantenAfdruk(raw: unknown): string {
  const varianten = variantenSchoon(raw) ?? [];
  return varianten
    .map((v) => `${[...v.dagtypes].sort().join(',')}:${DIENST_TIJD_VELDEN.map((veld) => tekst(v[veld])).join('|')}`)
    .sort()
    .join(';');
}

/** "07:10–08:40, 12:05–13:10 (loop 4612)": de delen van een set tijden. */
export const delenTekst = (t: DienstTijden): string => {
  const paren: Array<[string, string, string]> = [
    [tekst(t.startTime), tekst(t.endTime), tekst(t.loopnr)],
    [tekst(t.startTime2), tekst(t.endTime2), tekst(t.loopnr2)],
    [tekst(t.startTime3), tekst(t.endTime3), tekst(t.loopnr3)],
  ];
  return paren
    .filter(([s, e]) => s && e)
    .map(([s, e, loop]) => `${s}–${e}${loop ? ` (loop ${loop})` : ''}`)
    .join(', ');
};

/** Leesbare tekst van één variant: "Woensdag schooldag: 07:10–08:40, 12:05–13:10". */
export const variantTekst = (v: DienstVariant): string =>
  `${v.dagtypes.map(dagtypeLabel).join(', ')}: ${delenTekst(v) || 'geen tijden'}`;

/** Leesbare tekst van alle varianten, gescheiden door "; "; leeg zonder varianten. */
export const variantenTekst = (raw: unknown): string => (variantenSchoon(raw) ?? []).map(variantTekst).join('; ');
