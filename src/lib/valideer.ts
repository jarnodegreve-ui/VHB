/**
 * Formuliervalidatie met de gedeelde zod-schemas (shared/schemas/*): hetzelfde
 * schema dat de server op de request-body loslaat, vóór submit in de browser.
 *
 *   const check = valideer(userFormulierSchema, waarden);
 *   if (!check.ok) return setFouten(check.fouten);   // { email: 'Vul een e-mailadres in' }
 *
 * Fouten horen bij het veld (Field error-prop), nooit in een toast — ook de
 * server-veldfouten van een 400 komen via `veldfoutenUitAntwoord` in
 * hetzelfde formaat terug.
 */
export { valideer, type Validatie } from '../../shared/schemas/basis';

/** Veldfouten uit een 400-antwoord `{ error: 'Ongeldige invoer', veldfouten }`;
 *  null als het antwoord geen veldfouten draagt (andere fout → toast zoals altijd). */
export const veldfoutenUitAntwoord = (data: unknown): Record<string, string> | null => {
  const veldfouten = (data as { veldfouten?: unknown } | null | undefined)?.veldfouten;
  if (!veldfouten || typeof veldfouten !== 'object' || Array.isArray(veldfouten)) return null;
  const fouten: Record<string, string> = {};
  for (const [veld, tekst] of Object.entries(veldfouten as Record<string, unknown>)) {
    if (typeof tekst === 'string' && tekst) fouten[veld] = tekst;
  }
  return Object.keys(fouten).length > 0 ? fouten : null;
};
