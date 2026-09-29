import { herstelMelding } from './herstelMelding';

/**
 * Het herstel na "Ongedaan maken" van een verwijderde omleiding of update
 * (controle-ronde 29-09, nr. 12): het record opnieuw posten met de
 * herstel-header, eerlijk melden wat er van de PDF's terugkwam, en de lijst
 * verversen.
 *
 * Bewust een eigen module die pas bij de klik op "Ongedaan maken" laadt. De
 * datalaag (src/app/data/communicatie.ts) zit in de startbundel en die heeft
 * geen ruimte voor teksten die alleen na een zeldzame, bewuste klik nodig
 * zijn. scripts/check-bundle-size.mjs faalt als deze module of
 * herstelMelding.ts in index-*.js terugkeert.
 */
type MetBijlagen = { bijlagen?: unknown[] };

export async function herstel<T extends MetBijlagen>(
  soort: 'Omleiding' | 'Update',
  record: T,
  /** postDiversion of postUpdate uit de datalaag; de vierde parameter zet
   *  de herstel-header en krijgt het record zoals de server het teruggaf. */
  post: (record: T, successToast: undefined, opVeldfouten: undefined, naHerstel: (terug: T | null) => void) => Promise<boolean>,
  ververs: () => Promise<void> | void,
  toast: (tekst: string, toon: 'success' | 'info') => void,
): Promise<void> {
  // Mislukt de post, dan meldt de datalaag dat zelf (409, netwerk) en
  // ververst ze de lijst: hier valt dan niets meer te zeggen.
  const gelukt = await post(record, undefined, undefined, (terug) => {
    const melding = herstelMelding(soort, record.bijlagen?.length ?? 0, terug?.bijlagen?.length ?? 0);
    toast(melding.tekst, melding.toon);
  });
  if (gelukt) await ververs();
}
