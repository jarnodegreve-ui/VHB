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
