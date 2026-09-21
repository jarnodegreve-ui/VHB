/**
 * Eén gedeelde datum-weergave voor het hele portaal: "vr 18 juli" (of met
 * jaartal als de datum niet in het huidige jaar valt). Chauffeurs zagen op
 * verschillende schermen drie formaten door elkaar, incl. rauw ISO
 * ("2026-07-18") — dit is de enige plek die daarover beslist.
 */
/**
 * Datum + tijd in Belgische tijd ("vr 18 juli, 14:32"). Verwacht een
 * ISO-timestamp; oudere niet-ISO-waarden (bv. al opgeslagen nl-BE-strings)
 * worden ongewijzigd teruggegeven.
 */
export function formatDateTimeHuman(value: string | undefined | null): string {
  if (!value) return '';
  const s = String(value);
  if (!/^\d{4}-\d{2}-\d{2}T/.test(s)) return s;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  try {
    return d.toLocaleString('nl-BE', {
      timeZone: 'Europe/Brussels',
      weekday: 'short',
      day: 'numeric',
      month: 'long',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return s;
  }
}

/**
 * Kort moment voor een tijdlijn of verloop: "19/09 14:02", met jaartal als het
 * niet dit jaar is ("19/09/2025 14:02"). Een timestamp mét zone (Z of offset,
 * zo slaat de server ze op) wordt naar Belgische tijd omgerekend; een
 * zone-loze waarde is al wandkloktijd en blijft staan. Alleen een datum → dd/mm.
 */
export function formatMomentKort(value: string | undefined | null, nu: Date = new Date()): string {
  if (!value) return '';
  const s = String(value);
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(s);
  if (!m) return '';
  let [, jaar, maand, dag, uur, minuut] = m;
  if (uur !== undefined && /(Z|[+-]\d{2}:?\d{2})$/.test(s)) {
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) return '';
    const delen = new Intl.DateTimeFormat('nl-BE', {
      timeZone: 'Europe/Brussels', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(d);
    const deel = (type: string) => delen.find((p) => p.type === type)?.value ?? '';
    jaar = deel('year'); maand = deel('month'); dag = deel('day'); uur = deel('hour'); minuut = deel('minute');
  }
  const datum = `${dag}/${maand}${Number(jaar) === nu.getFullYear() ? '' : `/${jaar}`}`;
  return uur === undefined ? datum : `${datum} ${uur}:${minuut}`;
}

export function formatDateHuman(iso: string | undefined | null): string {
  if (!iso) return '';
  const d = new Date(`${String(iso).slice(0, 10)}T00:00:00`);
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
  const s = String(iso).slice(0, 10);
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

/** Compact dag-label 'vr 18 jul' (weekdag + dag + korte maand) uit een
 *  'YYYY-MM-DD'-string. Eén gedeelde vorm zodat lijsten die datums naast
 *  elkaar tonen (dienstruil, dekking) er niet uit elkaar lopen. */
export function formatShortDay(iso: string | undefined | null): string {
  if (!iso) return '';
  const d = new Date(`${String(iso).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(d.getTime())) return String(iso);
  try {
    return d.toLocaleDateString('nl-BE', { weekday: 'short', day: 'numeric', month: 'short' });
  } catch {
    return String(iso);
  }
}

/** Volledig dag-label 'vrijdag 18 juli' uit een 'YYYY-MM-DD'-string — voor
 *  koppen en detailvensters, waar de korte vorm te krap aanvoelt. Stond vijf
 *  keer los uitgeschreven (maandplanning, beide dashboards, activiteitenlog,
 *  rooster) terwijl dit bestand belooft de enige plek te zijn die over
 *  datumweergave beslist. */
export function formatDayLong(iso: string | undefined | null): string {
  if (!iso) return '';
  const d = new Date(`${String(iso).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(d.getTime())) return String(iso);
  try {
    return d.toLocaleDateString('nl-BE', { weekday: 'long', day: 'numeric', month: 'long' });
  } catch {
    return String(iso);
  }
}

/** Weekdag-afkortingen, maandag eerst (index 0 = ma) — voor eigen
 *  dag-rasters. Zondag-eerst (JS getDay()) gaat via WEEKDAY_SHORT_SUN. */
export const WEEKDAY_SHORT_MON = ['ma', 'di', 'wo', 'do', 'vr', 'za', 'zo'];

/** Weekdag-afkortingen in JS-volgorde (index = Date#getDay(), 0 = zo). */
export const WEEKDAY_SHORT_SUN = ['zo', 'ma', 'di', 'wo', 'do', 'vr', 'za'];

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
 *  de chauffeurs- en de beheerkant (stond er 2× woordelijk). */
export function formatUpdateDate(iso: string | undefined | null): string {
  if (!iso) return '';
  const d = new Date(`${String(iso).slice(0, 10)}T00:00:00`);
  return Number.isNaN(d.getTime())
    ? String(iso)
    : d.toLocaleDateString('nl-BE', { day: 'numeric', month: 'short', year: 'numeric' });
}

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

/** Vervaldata-soorten — bewuste kopie van api/helpers.ts (EXPIRY_SOORT_LABEL);
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

/**
 * Zelfde vorm als formatShortDay maar met een nul-geprefixte dag ("vr 08 jul").
 * Rooster en dashboard gebruiken deze variant, de ruilwizard en Dekking de
 * niet-geprefixte — dat verschil is zichtbaar voor de chauffeur ("vr 8 jul"
 * tegenover "vr 08 jul") en dus een openstaande keuze, geen toeval. Het staat
 * nu tenminste op één plek in plaats van vier keer los uitgeschreven.
 */
export function formatShortDayPadded(iso: string | undefined | null): string {
  if (!iso) return '';
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleDateString('nl-BE', { weekday: 'short', day: '2-digit', month: 'short' });
}

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
  return formatDateHuman(String(iso).slice(0, 10));
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
