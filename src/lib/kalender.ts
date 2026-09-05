import { MONTH_NAMES, WEEKDAY_SHORT_SUN } from './format';
import { addDagen, isoDate, maandPlus } from './datum';

/**
 * Kalenderhelpers voor de datumkiezer (DatePicker.tsx). Alles op ISO-strings
 * ('YYYY-MM-DD' / 'YYYY-MM') in het UTC-frame, net als datum.ts: een dag
 * verschuift zo nooit door zomertijd of de lokale klok. Alleen `vandaagIso`
 * kijkt naar de lokale kalender — dat is de dag die de gebruiker beleeft.
 */

export const ISO_DAG_RE = /^\d{4}-\d{2}-\d{2}$/;

const vanIso = (iso: string) => new Date(`${iso}T00:00:00Z`);
const naarIso = (d: Date) => d.toISOString().slice(0, 10);

/** Geldige kalenderdag in 'YYYY-MM-DD'? ('2026-02-30' is dat niet.) */
export const isIsoDag = (s: string | undefined | null): s is string =>
  !!s && ISO_DAG_RE.test(s) && !Number.isNaN(vanIso(s).getTime()) && naarIso(vanIso(s)) === s;

/** Vandaag als 'YYYY-MM-DD' in lokale tijd — dunne wrapper om `isoDate` (datum.ts). */
export const vandaagIso = (nu: Date = new Date()): string => isoDate(nu);

/** 'YYYY-MM' van een dag. */
export const maandVan = (iso: string) => iso.slice(0, 7);

/** Aantal dagen in een maand ('YYYY-MM'). */
export const dagenInMaand = (maand: string): number => {
  const [j, m] = maand.split('-').map(Number);
  return new Date(Date.UTC(j, m, 0)).getUTCDate();
};

/** Weekdag met maandag = 0 … zondag = 6. */
export const weekdagMa = (iso: string): number => (vanIso(iso).getUTCDay() + 6) % 7;

/**
 * Het 6×7-raster van een maand: 42 dagen, beginnend op de maandag van de
 * week waarin de 1e valt (dus met de staart van de vorige maand en de kop
 * van de volgende — die staan gedempt in de kiezer).
 */
export const maandGrid = (maand: string): string[] => {
  const eerste = `${maand}-01`;
  const start = addDagen(eerste, -weekdagMa(eerste));
  return Array.from({ length: 42 }, (_, i) => addDagen(start, i));
};

/** Dezelfde dag n maanden verder/terug; de dag klemt op de maandlengte (31 jan + 1 = 28/29 feb). */
export const dagPlusMaand = (iso: string, delta: number): string => {
  const maand = maandPlus(maandVan(iso), delta);
  const dag = Math.min(Number(iso.slice(8, 10)), dagenInMaand(maand));
  return `${maand}-${String(dag).padStart(2, '0')}`;
};

/** Valt de dag binnen [min, max] (beide optioneel, inclusief)? */
export const binnenBereik = (iso: string, min?: string, max?: string): boolean =>
  !(min && iso < min) && !(max && iso > max);

/** Klem een dag op [min, max]. */
export const klemOpBereik = (iso: string, min?: string, max?: string): string =>
  min && iso < min ? min : max && iso > max ? max : iso;

/** Ligt de héle maand buiten het bereik (dan kan de kiezer er niet heen)? */
export const maandBuitenBereik = (maand: string, min?: string, max?: string): boolean =>
  (!!min && `${maand}-${String(dagenInMaand(maand)).padStart(2, '0')}` < min) || (!!max && `${maand}-01` > max);

/** 'September 2026' voor de maandkop. */
export const maandLabel = (maand: string): string => {
  const [j, m] = maand.split('-').map(Number);
  return `${MONTH_NAMES[m - 1]} ${j}`;
};

const MAAND_KORT = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];

/** Waarde van de kiezer: 'di 8 sep 2026' — vast (geen Intl), zodat elke browser hetzelfde toont. */
export const formatDatumKiezer = (iso: string): string => {
  if (!isIsoDag(iso)) return iso;
  const d = vanIso(iso);
  return `${WEEKDAY_SHORT_SUN[d.getUTCDay()]} ${d.getUTCDate()} ${MAAND_KORT[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
};
