/**
 * Eén gedeelde datum-weergave voor het hele portaal: "vr 18 juli" (of met
 * jaartal als de datum niet in het huidige jaar valt). Chauffeurs zagen op
 * verschillende schermen drie formaten door elkaar, incl. rauw ISO
 * ("2026-07-18") — dit is de enige plek die daarover beslist.
 */
import { vandaagBrussel } from './brussel';

/**
 * De kalenderdag ('YYYY-MM-DD') van een waarde die een dag óf een tijdstip
 * kan zijn. Een tijdstip met zone (Z of offset, zo slaat de server ze op)
 * gaat eerst naar de Brusselse dag: '2026-11-04T23:30:00.000Z' is bij ons al
 * 5 november, en de oude knip op tien tekens toonde tussen 00u en 01u
 * (winter) of 02u (zomer) de dag ervoor. Een zuivere dag of een zone-loze
 * waarde is al wandkloktijd en blijft zoals hij is (zelfde regel als
 * momentDelen hieronder).
 */
function kalenderDag(value: string): string {
  if (/^\d{4}-\d{2}-\d{2}T/.test(value) && /(Z|[+-]\d{2}:?\d{2})$/.test(value)) {
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) return vandaagBrussel(d);
  }
  return value.slice(0, 10);
}

/**
 * Eén tijdstip voor het hele portaal: de korte dag, een komma en het uur
 * ("do 8 okt, 14:02"); het jaar na de maand alleen buiten dit jaar ("do 8 okt
 * 2025, 14:02"). Stond er in tien schrijfwijzen (ronde 6, punt 8).
 * - een tijdstempel met zone (Z of offset, zo slaat de server ze op): de
 *   Brusselse dag en het Brusselse uur;
 * - datum en uur zonder zone: wandklok, zoals het er staat;
 * - alleen een datum: de korte dag ("za 19 sep");
 * - leeg: '';
 * - wat niet als datum te lezen is (een oude nl-BE-tekst van lastLogin,
 *   'gisteren'): ongewijzigd terug.
 * Opgebouwd uit de cijfers en de vaste tabellen van dit bestand, niet uit
 * Intl, zodat elke motor hetzelfde toont, zonder afkortingspunt.
 */
export function formatTijdstip(value: string | undefined | null, nu: Date = new Date()): string {
  if (!value) return '';
  const d = momentDelen(value);
  if (!d || !MAAND_KORT[+d.maand - 1]) return String(value);
  const dag = kortDag(+d.jaar, +d.maand, +d.dag, +d.jaar !== nu.getFullYear());
  return d.uur === undefined ? dag : `${dag}, ${d.uur}:${d.minuut}`;
}

/** Het uur ("14:02") van een tijdstempel, in Brusselse tijd (zonder zone: de
 *  wandklok zoals ze er staat). Leeg, onleesbaar of alleen een datum: ''. Het
 *  uur van nu of van een epoch is formatSyncedTime (klok van het toestel). */
export function formatUur(value: string | undefined | null): string {
  const d = momentDelen(value);
  return d && d.uur ? `${d.uur}:${d.minuut}` : '';
}

/** Doorgevers: dezelfde functie onder de oude namen, zodat er vanaf ronde 6 één
 *  tijdstip in beeld staat; deel 3 en 4 zetten hun aanroepers over, deel 4
 *  schrapt de namen. */
export const formatDateTimeHuman = formatTijdstip;
export const formatMomentKort = formatTijdstip;
export const formatMomentDMJ = formatTijdstip;

function momentDelen(value: string | undefined | null): { jaar: string; maand: string; dag: string; uur?: string; minuut?: string } | null {
  if (!value) return null;
  const s = String(value);
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(s);
  if (!m) return null;
  let [, jaar, maand, dag, uur, minuut] = m;
  if (uur !== undefined && /(Z|[+-]\d{2}:?\d{2})$/.test(s)) {
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) return null;
    const delen = new Intl.DateTimeFormat('nl-BE', {
      timeZone: 'Europe/Brussels', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(d);
    const deel = (type: string) => delen.find((p) => p.type === type)?.value ?? '';
    jaar = deel('year'); maand = deel('month'); dag = deel('day'); uur = deel('hour'); minuut = deel('minute');
  }
  return { jaar, maand, dag, uur, minuut };
}

/** Aantal met enkelvoud of meervoud: aantal(1, 'dag', 'dagen') = "1 dag". */
export const aantal = (n: number, enkel: string, meer: string): string => `${n} ${n === 1 ? enkel : meer}`;

/** Tijdvak "04:36–07:52": één vorm overal, en-dash zonder spaties. */
export const tijdvak = (van: string, tot: string): string => `${van}–${tot}`;

/** Eerste letter hoofdletter, de rest ongemoeid: "do 24 september" →
 *  "Do 24 september". Nooit CSS `capitalize` op een datum, dat maakt er
 *  "Do 24 September" van (maandnamen zijn in het Nederlands kleine letters). */
export const hoofdletter = (s: string): string => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

export function formatDateHuman(iso: string | undefined | null): string {
  if (!iso) return '';
  const d = new Date(`${kalenderDag(String(iso))}T00:00:00`);
  if (Number.isNaN(d.getTime())) return String(iso);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  try {
    return d.toLocaleDateString('nl-BE', {
      weekday: 'short',
      day: 'numeric',
      month: 'long',
      ...(sameYear ? {} : { year: 'numeric' }),
    });
  } catch {
    return String(iso);
  }
}

/**
 * 'YYYY-MM-DD' → '17/09/2026'. Dag/maand/jaar, want dat is de enige volgorde
 * die in het portaal voorkomt: een rauwe ISO-datum las Jarno als
 * jaar/maand/dag en dat is onduidelijk (17-09). Gebruik deze vorm in
 * tabellen, periodes en titels waar een weekdag te breed is; in lopende tekst
 * leest formatDateHuman ("do 17 september") beter.
 */
export function formatDatumDMJ(iso: string | undefined | null): string {
  if (!iso) return '';
  const s = kalenderDag(String(iso));
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : String(iso);
}

/**
 * Periode compact: '17/09/2026' (één dag), '17/09 – 20/09/2026' (zelfde jaar)
 * of '28/12/2026 – 03/01/2027'. Voor lijstrijen op een telefoon, waar de
 * volledige vorm ('17/09/2026 t/m 20/09/2026') de rij doet omslaan; het jaar
 * staat er altijd één keer in, zodat een oude aanvraag herkenbaar blijft.
 */
export function formatPeriodeKort(start: string | undefined | null, eind?: string | undefined | null): string {
  const van = formatDatumDMJ(start);
  const tot = formatDatumDMJ(eind);
  if (!van) return tot;
  if (!tot || tot === van) return van;
  return van.slice(6) === tot.slice(6) ? `${van.slice(0, 5)} – ${tot}` : `${van} – ${tot}`;
}

/** Periode als '17/09/2026' of '17/09/2026 t/m 20/09/2026' — één bron voor de
 *  verlof-, ziekte- en omleidingslijsten, die dit elk apart uitschreven. */
export function formatPeriodeDMJ(start: string | undefined | null, eind?: string | undefined | null): string {
  const van = formatDatumDMJ(start);
  const tot = formatDatumDMJ(eind);
  if (!van) return tot;
  return !tot || tot === van ? van : `${van} t/m ${tot}`;
}

/** 'HH:MM' uit een epoch-ms — voor de 'Bijgewerkt om …'-versheidsindicatie. */
export function formatSyncedTime(ts: number | null | undefined): string {
  if (!ts) return '';
  try {
    return new Date(ts).toLocaleTimeString('nl-BE', { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

type DagVorm = (j: number, m: number, d: number, metJaar?: boolean) => string;

/** Een vorm op de kalenderdag van een waarde ('YYYY-MM-DD'; bij een tijdstempel
 *  de Brusselse dag): leeg geeft '', wat geen dag is komt ongewijzigd terug. */
const opDag = (iso: string | undefined | null, vorm: DagVorm, metJaar?: boolean): string => {
  if (!iso) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(kalenderDag(String(iso)));
  return m && MAAND_KORT[+m[2] - 1] ? vorm(+m[1], +m[2], +m[3], metJaar) : String(iso);
};

/** De weekdag uit de kalenderdag zelf, nooit uit een tijdstempel. */
const weekdag: DagVorm = (j, m, d) => WEEKDAY_SHORT_SUN[new Date(j, m - 1, d).getDay()];
const dagMaand: DagVorm = (j, m, d, metJaar) => `${d} ${MAAND_KORT[m - 1]}${metJaar ? ` ${j}` : ''}`;
const kortDag: DagVorm = (j, m, d, metJaar) => `${weekdag(j, m, d)} ${dagMaand(j, m, d, metJaar)}`;

/** Korte dag 'vr 18 jul' (weekdag + dag + korte maand, nooit een voorloopnul),
 *  met jaar alleen op vraag: 'vr 18 jul 2025'. Eén gedeelde vorm zodat lijsten
 *  die datums naast elkaar tonen (dashboard, rooster, dienstruil, dekking) er
 *  niet uit elkaar lopen. */
export const formatShortDay = (iso: string | undefined | null, metJaar?: boolean): string => opDag(iso, kortDag, metJaar);

/** Dag en korte maand '8 okt', met jaar alleen op vraag: '8 okt 2026'. */
export const formatDagMaand = (iso: string | undefined | null, metJaar?: boolean): string => opDag(iso, dagMaand, metJaar);

/** Alleen de korte weekdag 'do', voor wie dag en datum apart zet (de
 *  roosterkaart); de rest van de datum is formatDagMaand. */
export const formatWeekdag = (iso: string | undefined | null): string => opDag(iso, weekdag);

/** Volledig dag-label 'vrijdag 18 juli' — voor koppen en detailvensters, waar
 *  de korte vorm te krap aanvoelt. Het jaar alleen op vraag ('vrijdag 18 juli
 *  2027'), nooit vanzelf: de Planningsmatrix plakt het er zelf achter. Stond
 *  vijf keer los uitgeschreven (maandplanning, beide dashboards,
 *  activiteitenlog, rooster) terwijl dit bestand belooft de enige plek te zijn
 *  die over datumweergave beslist. */
export function formatDayLong(iso: string | undefined | null, metJaar?: boolean): string {
  if (!iso) return '';
  const d = new Date(`${kalenderDag(String(iso))}T00:00:00`);
  if (Number.isNaN(d.getTime())) return String(iso);
  try {
    return d.toLocaleDateString('nl-BE', { weekday: 'long', day: 'numeric', month: 'long', year: metJaar ? 'numeric' : undefined });
  } catch {
    return String(iso);
  }
}

/** Maand 'YYYY-MM' (of een dag) als 'oktober 2026'. */
export function formatMaand(maand: string): string {
  const m = /^(\d{4})-(\d{2})/.exec(maand);
  const naam = m ? MONTH_NAMES[+m[2] - 1] : undefined;
  return m && naam ? `${naam.toLowerCase()} ${m[1]}` : maand;
}

/** Weekdag-afkortingen, maandag eerst (index 0 = ma) — voor eigen
 *  dag-rasters. Zondag-eerst (JS getDay()) gaat via WEEKDAY_SHORT_SUN. */
export const WEEKDAY_SHORT_MON = ['ma', 'di', 'wo', 'do', 'vr', 'za', 'zo'];

/** Weekdag-afkortingen in JS-volgorde (index = Date#getDay(), 0 = zo). */
export const WEEKDAY_SHORT_SUN = ['zo', 'ma', 'di', 'wo', 'do', 'vr', 'za'];

/** Korte maandnamen (index 0 = jan), zonder afkortingspunt: wat Node 22 voor
 *  nl-BE geeft, maar vast, zodat elke motor hetzelfde toont. Eén tabel (stond
 *  er drie keer: kalender, MaandInput, Periodekiezer). */
export const MAAND_KORT = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];

/** Eén letter per weekdag, maandag eerst — voor de smalste rasters
 *  (capaciteit, verlof-kalender). 'D' en 'Z' komen dubbel voor: nooit als
 *  React-key gebruiken zonder index. */
export const WEEKDAY_LETTER_MON = ['M', 'D', 'W', 'D', 'V', 'Z', 'Z'];

/** Bestandsgrootte kort: 'B' / 'KB' / 'MB'. Eén bron — stond als
 *  prettySize/formatSize 3× (bijna-)identiek in Documenten, Gebruiker-
 *  documenten en Ritbladen. null/0 → lege string. */
export function prettySize(bytes: number | null | undefined): string {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** 'YYYY-MM-DD' → '4 mrt 2026' — de notatie voor updates/nieuws, gedeeld door
 *  de chauffeurs- en de beheerkant: dag en korte maand, altijd met jaar. Een
 *  waarde die geen dag is (de vrije tekst '8/10/2026') komt ongewijzigd terug. */
export const formatUpdateDate = (iso: string | undefined | null): string => formatDagMaand(iso, true);

/** Nederlandse maandnamen (index 0 = januari). Eén bron: stond eerder 4×
 *  woordelijk gedupliceerd in views. */
export const MONTH_NAMES = [
  'Januari', 'Februari', 'Maart', 'April', 'Mei', 'Juni',
  'Juli', 'Augustus', 'September', 'Oktober', 'November', 'December',
];

/** Labels van de verloftypes uit de verlof-module (stond 3× gedupliceerd);
 *  een nieuw type hoeft nu maar op één plek bij. */
export const LEAVE_TYPE_LABELS: Record<string, string> = {
  betaald_verlof: 'Betaald verlof',
  klein_verlet: 'Klein verlet',
  ziekte: 'Ziekte',
};

export const formatLeaveType = (type: string) => LEAVE_TYPE_LABELS[type] ?? type;

/** Vervaldata-soorten — bewuste kopie van api/_lib/helpers.ts (EXPIRY_SOORT_LABEL);
 *  de drift-test in sharedTypes.test.ts bewaakt gelijkheid.
 *  Rijbewijs is er bewust uit (Jarno 07-08): Code 95 en medische schifting
 *  volstaan. Deze map is dé bron — views leiden er hun velden uit af. */
export const EXPIRY_SOORT_LABELS: Record<string, string> = {
  code95: 'Code 95',
  medische_schifting: 'Medische schifting',
};

/**
 * Dienstnummer van een planning-rij, met een zichtbare val-terug. Stond vijf
 * keer woordelijk in de views (controle-ronde #35) — telkens dezelfde
 * normalisatie, telkens een eigen kopie die kon gaan afwijken.
 */
export const serviceNumberOf = (shift: { line?: string } | undefined | null) =>
  String(shift?.line || '--').trim() || '--';

/** Getal in Belgische notatie met maximaal `max` cijfers na de komma:
 *  123,46 · 6 559 · 57 529,6 · 0,5 · 48. Voor kW/kWh op de laadpalenpagina
 *  (verzoek Jarno 27-08): ChargEye levert tot vijf decimalen. Het duizendtal
 *  is een smalle vaste spatie (U+202F), níét de nl-BE-punt: "6.582 kWh" werd
 *  gelezen als 6,582 (melding Jarno 27-08) — naast een komma als decimaalteken
 *  is een punt nooit ondubbelzinnig. */
export function formatGetal(value: number, max = 2): string {
  if (!Number.isFinite(value)) return '—';
  // nl-BE gebruikt de komma als decimaalteken, dus elke punt is een duizendtal.
  return value.toLocaleString('nl-BE', { maximumFractionDigits: max }).replace(/\./g, '\u202F');
}

/**
 * Relatieve tijd voor "laatst gezien"/"laatste keer": zojuist, 5 min geleden,
 * 3 u geleden, gisteren, 4 d geleden; daarna de gewone datum. Toekomst en
 * onleesbare waarden vallen terug op de datum/lege string.
 */
export function formatRelatief(iso: string | undefined | null, nu: number = Date.now()): string {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return String(iso);
  const sec = Math.round((nu - t) / 1000);
  if (sec < 45) return 'zojuist';
  if (sec < 3600) return `${Math.max(1, Math.round(sec / 60))} min geleden`;
  if (sec < 86_400) return `${Math.round(sec / 3600)} u geleden`;
  const dagen = Math.round(sec / 86_400);
  if (dagen === 1) return 'gisteren';
  if (dagen < 14) return `${dagen} d geleden`;
  // Het tijdstip zelf doorgeven: formatDateHuman kiest de Brusselse dag.
  return formatDateHuman(String(iso));
}

/**
 * Getal + eenheid met een smalle vaste spatie (U+202F) ertussen: "12 kW",
 * "3 u", "45 min". Typografisch juist én onbreekbaar — "112" en "kW" komen
 * nooit op verschillende regels terecht. Neem een al geformatteerd getal
 * (formatGetal) of een ruwe waarde; een niet-eindig getal wordt '—'.
 */
export function metEenheid(waarde: number | string, eenheid: string): string {
  const tekst = typeof waarde === 'number' ? (Number.isFinite(waarde) ? String(waarde) : '—') : waarde;
  return tekst === '—' ? tekst : `${tekst}\u202F${eenheid}`;
}
