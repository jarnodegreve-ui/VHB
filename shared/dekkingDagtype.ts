import { periodeVoorDatum, resolveDayTypeMetBron, type DayTypeBron } from './coverageGaps.js';
import { dagtypeLabel, dagtypeVanDag, isDagtypeCode, periodeUitNaam, type DagtypeKalender } from './dagtype.js';

/**
 * Dekking op De Lijn-codes (dagtypekalender deel 2, 11-10, keuze Jarno).
 *
 * De dekking kent haar verwachte diensten per eigen dagtypenaam ("schooldag
 * dinsdag", "vakantieperiode ma/di/wo", "zondag") en bepaalt per dag welke
 * naam geldt met haar eigen kalender: een naam in kolom B van de planning,
 * anders een uitzondering, een weekdagperiode of de basis. Sinds de Excel van
 * 28-09 draagt kolom B De Lijn-codes (21, 33, 41, 28) en kent de
 * dagtypekalender elke dag zo'n code; een code is geen lijstnaam, dus vond de
 * dekking op die dagen geen enkele verwachting meer.
 *
 * Deze functie vertaalt de code naar een lijst, zonder nieuwe instellingen:
 *   1. Een naam in kolom B wint, zoals vroeger.
 *   2. Zonder De Lijn-code (geen code in kolom B, dag niet in de
 *      dagtypekalender): de dekkingskalender, zoals vroeger.
 *   3. Met een code: de periode van de code uit de koppeling van Dienstopbouw ›
 *      Dagtypes (kolom portaal_dagtype), anders uit de code zelf; een lijst
 *      past als ze dezelfde periode heeft (een lijst "feestdag" voor 28) of,
 *      daarna, dezelfde klasse (schooldag, vakantie, examen, zaterdag, zondag;
 *      juli-augustus telt als vakantie en een feestdag als zondag). Geeft de
 *      dekkingskalender zo'n lijst, dan die (de lijst per weekdag blijft dus
 *      gelden). Anders de passende lijst die de dekking voor deze weekdag
 *      kent (de nieuwste periode eerst, dan de basis), anders een passende
 *      lijst die de weekdag noemt, anders een zonder weekdag, anders de
 *      kortste. Past niets (examen zonder examenlijst), dan de
 *      dekkingskalender zoals vroeger, met in de bron dat de code geen lijst
 *      heeft.
 * De herkomst reist mee in `bron`, zodat Openstaande diensten kan zeggen
 * waarom een dag deze lijst kreeg.
 */
export type DekkingDagtypeInvoer = {
  /** 'JJJJ-MM-DD' */
  datum: string;
  /** Kolom B van de planningsmatrix: een naam, een De Lijn-code of leeg. */
  rawDayType: unknown;
  /** De dekkingskalender plus de dagtypekalender (laadDagtypeKalender). */
  kalender: DagtypeKalender;
  /** De lijstnamen van de dekking (de niet-gereserveerde sleutels van coverage_expectations). */
  lijstNamen: readonly string[];
  /** De Lijn-code → portaal-dagtype uit public.dagtype_codes (leeg = alleen de code zelf telt). */
  koppeling?: Readonly<Record<string, string | null | undefined>>;
};

const WEEKDAG_WOORDEN: ReadonlyArray<readonly string[]> = [
  ['zondag', 'zo'], ['maandag', 'ma'], ['dinsdag', 'di'], ['woensdag', 'wo', 'woe'], ['donderdag', 'do'], ['vrijdag', 'vr', 'vrij'], ['zaterdag', 'za'],
];

/** De periode van periodeUitNaam als klasse: juli-augustus (4) is voor de
 *  dekking dezelfde vakantie als de schoolvakantie (3), een feestdag (28) rijdt
 *  de zondagregeling (27). */
const klasse = (periode: string): string => (periode === '4' ? '3' : periode === '28' ? '27' : periode);

/** De periode die in de code zelf zit: '2'…'5', '26', '27', '28'. */
const eigenPeriode = (code: string): string => (code === '26' || code === '27' || code === '28' ? code : code[0]);

/** De periode van de koppeling (portaal_dagtype), of null zonder koppeling. */
const gekoppeldePeriode = (code: string, koppeling?: Readonly<Record<string, string | null | undefined>>): string | null => {
  const portaal = String(koppeling?.[code] ?? '').trim();
  return portaal ? periodeUitNaam(portaal) : null;
};

/** De klasse van een De Lijn-code: via de koppeling als die er is, anders de code zelf. */
export const klasseVanCode = (code: string, koppeling?: Readonly<Record<string, string | null | undefined>>): string =>
  klasse(gekoppeldePeriode(code, koppeling) ?? eigenPeriode(code));

/** Hoe goed past een lijstnaam bij de code (tegenlezing 11-10): 0 = exact de
 *  periode van de code zelf of van haar koppeling (een lijst "feestdag" voor
 *  28, of "zondag" waar 28 aan zondag gekoppeld is), 1 = dezelfde klasse,
 *  null = past niet. */
const pastBij = (code: string, koppeling?: Readonly<Record<string, string | null | undefined>>) => {
  const exact = new Set([eigenPeriode(code), gekoppeldePeriode(code, koppeling)].filter((p): p is string => !!p));
  const kl = klasseVanCode(code, koppeling);
  return (naam: string): 0 | 1 | null => {
    const p = periodeUitNaam(naam);
    return exact.has(p) ? 0 : klasse(p) === kl ? 1 : null;
  };
};

/** Weekdag van een echte kalenderdag, anders -1 ("2026-02-30" schuift niet door naar 2 maart). */
const weekdagVan = (datum: string): number => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(datum);
  if (!m) return -1;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return Number.isNaN(d.getTime()) || d.getUTCMonth() + 1 !== Number(m[2]) || d.getUTCDate() !== Number(m[3]) ? -1 : d.getUTCDay();
};

/** Noemt de naam een andere weekdag dan deze? ("vakantie donderdag" op een maandag) */
const noemtAndereWeekdag = (naam: string, dow: number): boolean => WEEKDAG_WOORDEN.some((_, i) => i !== dow && noemtWeekdag(naam, i));

const noemtWeekdag = (naam: string, dow: number): boolean => {
  const n = naam.toLowerCase();
  return (WEEKDAG_WOORDEN[dow] ?? []).some((w) => new RegExp(`(^|[^a-z])${w}([^a-z]|$)`).test(n));
};

export function dekkingDagtypeVanDag(invoer: DekkingDagtypeInvoer): { dayType: string; bron: DayTypeBron } {
  const { datum, kalender, lijstNamen, koppeling } = invoer;
  const raw = String(invoer.rawDayType ?? '').trim();
  const eigen = (naam: string) => resolveDayTypeMetBron(naam, datum, kalender.weekdays, kalender.perioden, kalender.overrides);
  // 1. Een naam in kolom B wint, zoals vroeger.
  if (raw && !isDagtypeCode(raw)) return eigen(raw);
  // 2. De De Lijn-code van de dag: kolom B, anders de dagtypekalender. Zonder
  //    code beslist de dekkingskalender, zoals vroeger.
  const afgeleid = dagtypeVanDag(datum, raw, kalender);
  const code = afgeleid.code;
  if (!code || (afgeleid.bron !== 'excel' && afgeleid.bron !== 'kalender')) return eigen('');
  const past = pastBij(code, koppeling);
  const bestaat = new Set(lijstNamen.map((n) => n.trim()).filter(Boolean));
  const standaard = eigen('');
  const metDekking = (extra: { code?: string; zonderLijst?: { code: string; label: string } }): { dayType: string; bron: DayTypeBron } => ({
    dayType: standaard.dayType,
    bron: standaard.bron.soort === 'geen' || standaard.bron.soort === 'excel' ? standaard.bron : { ...standaard.bron, ...extra },
  });
  const metCode = (naam: string): { dayType: string; bron: DayTypeBron } => ({ dayType: naam, bron: { soort: 'dagtype', code, label: dagtypeLabel(code), naam } });
  // Eerst een lijst van exact dezelfde periode ("feestdag" voor 28), dan een
  // van dezelfde klasse (de zondaglijst voor 28); in elke stap die volgorde.
  for (const graad of [0, 1] as const) {
    // 3a. De dekkingskalender geeft al zo'n lijst: die blijft (ook als ze leeg
    //     is: dat is dan de keuze van de planner).
    if (standaard.dayType && bestaat.has(standaard.dayType) && past(standaard.dayType) === graad) return metDekking({ code });
    const dow = weekdagVan(datum);
    if (dow >= 0) {
      // 3b. Wat de dekking voor deze weekdag kent: de nieuwste periode eerst
      //     (ook een al aangemaakte toekomstige: de lijsten horen bij de
      //     nieuwste dienstregeling), dan de basis.
      const perioden = [...kalender.perioden].sort((a, b) => b.vanaf.localeCompare(a.vanaf));
      const actieve = periodeVoorDatum(kalender.perioden, datum);
      const kandidaten = [
        ...(actieve ? [actieve.weekdays[dow]] : []),
        ...perioden.map((p) => p.weekdays[dow]),
        kalender.weekdays[dow],
      ].map((n) => String(n ?? '').trim());
      for (const naam of kandidaten) {
        if (naam && bestaat.has(naam) && past(naam) === graad) return metCode(naam);
      }
      // 3c. Elke lijst die past: een naam die deze weekdag noemt eerst, dan
      //     een zonder weekdag, dan pas een met een andere weekdag; bij
      //     gelijke stand de kortste naam. Zonder echte datum slaan we dit
      //     over: dan zou de kortste naam een willekeurige lijst kiezen.
      const passend = [...bestaat].filter((n) => past(n) === graad);
      if (passend.length > 0) {
        const rang = (n: string) => (noemtWeekdag(n, dow) ? 0 : noemtAndereWeekdag(n, dow) ? 2 : 1);
        passend.sort((a, b) => rang(a) - rang(b) || a.length - b.length || a.localeCompare(b));
        return metCode(passend[0]);
      }
    }
  }
  // 4. Geen enkele lijst van die periode of klasse (examen zonder examenlijst):
  //    de dekkingskalender zoals vroeger; de bron zegt dat de code geen lijst heeft.
  return metDekking({ zonderLijst: { code, label: dagtypeLabel(code) } });
}
