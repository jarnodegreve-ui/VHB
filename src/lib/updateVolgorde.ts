/**
 * Volgorde van de updates (15-10). Een eigen module en niet in format.ts:
 * dat zit in de startbundel, en alleen de twee updateschermen (lui) hebben
 * dit nodig.
 */

/** Sorteersleutel voor de datum van een update: 'YYYY-MM-DD'. Het veld is
 *  vrije tekst (shared/schemas/update.ts): de UI schrijft een nl-BE-datum
 *  ('3/9/2026'), oudere rijen een ISO-dag. Als tekst gesorteerd stond
 *  '2/10/2026' daardoor vóór '14/10/2026'. Onleesbaar = '' (achteraan bij
 *  nieuwste eerst). */
export function updateDatumSleutel(datum: string | undefined | null): string {
  const tekst = String(datum ?? '').trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(tekst)) return tekst.slice(0, 10);
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(tekst);
  return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : '';
}

/** Nieuwste update eerst: op de datum, dan op het id (een tijdstempel bij
 *  wat in het portaal gemaakt is), zodat twee berichten van dezelfde dag in
 *  de volgorde van plaatsen staan. */
export const nieuwsteUpdateEerst = (a: { date: string; id: string }, b: { date: string; id: string }): number =>
  updateDatumSleutel(b.date).localeCompare(updateDatumSleutel(a.date)) || b.id.localeCompare(a.id, undefined, { numeric: true });
