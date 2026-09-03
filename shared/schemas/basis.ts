import { z } from 'zod';

/**
 * Bouwstenen voor de gedeelde API-contracten (shared/schemas/*).
 *
 * Eén schema valideert het formulier in de browser én de request-body op de
 * server; de Nederlandse foutteksten per veld komen dus uit dezelfde bron.
 * `shared/` hoort noch bij `api/` noch bij `src/` — beide importeren eruit,
 * zonder de verboden cross-import api↔src.
 *
 * Conventies:
 * - Optionele velden accepteren ook `null` en `''` (de database levert null
 *   voor lege kolommen, formulieren leveren '') en normaliseren naar undefined,
 *   zodat het afgeleide type gewoon `veld?: string` blijft.
 * - Elke check draagt zijn eigen NL-tekst; wat geen tekst heeft valt terug
 *   op `nlFoutmap`, zodat er nooit Engelse zod-teksten in de UI belanden.
 */

export const leegNaarUndefined = (waarde: unknown): unknown =>
  waarde === null || waarde === '' ? undefined : waarde;

/** Optioneel veld: null/'' → undefined, anders het schema. */
export const optioneel = <S extends z.ZodType>(schema: S) => z.preprocess(leegNaarUndefined, schema.optional());

/** Verplichte tekst: ontbreekt, geen string of leeg (na trim) → dezelfde tekst. */
export const verplichteTekst = (fout: string) => z.string({ error: fout }).trim().min(1, fout);

/** Kalenderdag als 'JJJJ-MM-DD' (echte datum: 2026-02-30 valt af). */
export const isoDatum = (fout: string) => z.iso.date(fout);

/** Nederlandse terugvaltekst voor checks zonder eigen tekst. */
export const nlFoutmap = (issue: { code: string; input?: unknown }): string => {
  if (issue.code === 'invalid_type') return issue.input === undefined ? 'Dit veld is verplicht' : 'Ongeldige waarde';
  return 'Ongeldige invoer';
};

/** Leesbare veldnamen voor samengestelde meldingen (bv. de details van een 400). */
export const VELD_LABELS: Record<string, string> = {
  name: 'naam',
  role: 'rol',
  employeeId: 'personeelsnummer',
  email: 'e-mailadres',
  phone: 'GSM-nummer',
  password: 'wachtwoord',
  verlofBudget: 'verlofbudget',
  section: 'sectie',
  startDate: 'startdatum',
  endDate: 'einddatum',
  line: 'lijn',
  title: 'titel',
  description: 'omschrijving',
  date: 'datum',
  content: 'inhoud',
  category: 'categorie',
};

/** Sleutel van een issue-pad: 'email', 'endDate', bij lijsten '3.email'; wortelfouten '_'. */
export const veldSleutel = (pad: ReadonlyArray<PropertyKey>): string =>
  pad.length === 0 ? '_' : pad.map(String).join('.');

/** Eén tekst per veld (de eerste issue wint — de checks staan in leesvolgorde). */
export const veldfoutenVan = (error: z.ZodError): Record<string, string> => {
  const fouten: Record<string, string> = {};
  for (const issue of error.issues) {
    const sleutel = veldSleutel(issue.path);
    if (!(sleutel in fouten)) fouten[sleutel] = issue.message;
  }
  return fouten;
};

export type Validatie<T> =
  | { ok: true; data: T }
  | { ok: false; fouten: Record<string, string> };

/** Valideert `waarden` tegen `schema`; bij fouten één NL-tekst per veld. */
export function valideer<S extends z.ZodType>(schema: S, waarden: unknown): Validatie<z.output<S>> {
  const resultaat = schema.safeParse(waarden, { error: nlFoutmap });
  return resultaat.success
    ? { ok: true, data: resultaat.data }
    : { ok: false, fouten: veldfoutenVan(resultaat.error) };
}

/** 'e-mailadres: Vul een geldig e-mailadres in' — voor toasts en logregels. */
export const leesbareVeldfout = (veld: string, tekst: string): string => {
  const laatste = veld.split('.').pop() ?? veld;
  const label = VELD_LABELS[laatste] ?? laatste;
  return laatste === '_' ? tekst : `${label}: ${tekst}`;
};
