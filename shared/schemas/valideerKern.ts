import type { z } from './zod.js';

/**
 * Validatie zonder zod aan boord (tranche 3A, 23-09). `valideer` roept alleen
 * `schema.safeParse` aan op het schema dat de aanroeper meegeeft; zod zelf
 * wordt hier alleen als type geïmporteerd. Zo sleept de formulierlaag
 * (src/lib/formulier.ts, src/lib/valideer.ts) zod niet mee in schermen die
 * geen schema gebruiken, zoals de ruilwizard in de warmup van de chauffeur.
 * shared/schemas/basis.ts exporteert alles hieruit door.
 */

/** Nederlandse terugvaltekst voor checks zonder eigen tekst. */
export const nlFoutmap = (issue: { code: string; input?: unknown }): string => {
  if (issue.code === 'invalid_type') return issue.input === undefined ? 'Dit veld is verplicht' : 'Ongeldige waarde';
  return 'Ongeldige invoer';
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
