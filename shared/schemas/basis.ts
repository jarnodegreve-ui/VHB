import { z } from './zod.js';

export { nlFoutmap, veldSleutel, veldfoutenVan, valideer, type Validatie } from './valideerKern.js';

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

/**
 * Kalenderdag als 'JJJJ-MM-DD' met twee meldingen: ontbreekt ("Vul een datum
 * in") of bestaat niet ("Ongeldige datum": ook 2026-02-30, dat het oude
 * regex-patroon in loon en techniek doorliet). Datumtranche PR 2, 23-09.
 */
export const kalenderdag = z
  .string({ error: 'Vul een datum in' })
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Ongeldige datum')
  .refine((v) => {
    const d = new Date(`${v}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
  }, 'Ongeldige datum');

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
  vehicleId: 'bus',
  werktype: 'soort',
  werkcode: 'werkcode',
  omschrijving: 'omschrijving',
  werkuren: 'uren',
  busnr: 'busnummer',
  kortNr: 'kort nummer',
  nummerplaat: 'nummerplaat',
  datum: 'datum',
  validUntil: 'vervaldatum',
};

/** 'e-mailadres: Vul een geldig e-mailadres in' — voor toasts en logregels. */
export const leesbareVeldfout = (veld: string, tekst: string): string => {
  const laatste = veld.split('.').pop() ?? veld;
  const label = VELD_LABELS[laatste] ?? laatste;
  return laatste === '_' ? tekst : `${label}: ${tekst}`;
};
