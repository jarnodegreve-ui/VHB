import type { RapportDefinitie, RapportRij } from './types.js';
import { sorteerRijen } from './opmaak.js';

/**
 * De actieve sortering van een rapport in de URL (23-09), zodat een gedeelde
 * link, het printblad en de CSV in dezelfde volgorde staan als het scherm.
 *
 * Eén parameter: `?sorteer=<kolom>` = oplopend, `?sorteer=-<kolom>` = aflopend
 * (het minteken zoals in veel API's). Staat de standaardsortering van de
 * definitie aan, dan ontbreekt de parameter: een rapport dat je gewoon opent
 * heeft een schone URL. Een onbekende kolom of een lege waarde telt als
 * "geen keuze" (standaard), nooit als fout.
 *
 * Geen filter: `filterParams` kent hem niet, "Filters wissen" laat hem staan
 * en de API krijgt hem niet (sorteren gebeurt in de client, met
 * `sorteerRijen`, één vergelijker voor scherm, blad en CSV).
 */
export const SORTEER_PARAM = 'sorteer';

export type RapportSortering = { kolom: string; richting: 'asc' | 'desc' };

export const standaardSortering = (def: RapportDefinitie): RapportSortering => ({ kolom: def.sortering.kolom, richting: def.sortering.richting });

const isStandaard = (def: RapportDefinitie, s: RapportSortering) => s.kolom === def.sortering.kolom && s.richting === def.sortering.richting;

/**
 * De sortering uit de URL. `def` = de effectieve definitie (`metKolommen`),
 * zodat ook een kolom die van de gegevens afhangt geldig is zodra die er is.
 */
export const leesSortering = (def: RapportDefinitie, params: URLSearchParams): RapportSortering => {
  const ruw = (params.get(SORTEER_PARAM) ?? '').trim();
  const af = ruw.startsWith('-');
  const kolom = af ? ruw.slice(1) : ruw;
  if (!kolom || !def.kolommen.some((k) => k.id === kolom)) return standaardSortering(def);
  return { kolom, richting: af ? 'desc' : 'asc' };
};

/** De waarde voor `?sorteer=`, of null als dit de standaardsortering is (dan hoort de parameter weg). */
export const sorteringNaarParam = (def: RapportDefinitie, s: RapportSortering): string | null =>
  isStandaard(def, s) ? null : `${s.richting === 'desc' ? '-' : ''}${s.kolom}`;

/** Klik op een kolomkop: dezelfde kolom keert de richting om, een andere kolom begint oplopend (zoals `useSort`). */
export const volgendeSortering = (huidig: RapportSortering, kolom: string): RapportSortering =>
  huidig.kolom === kolom ? { kolom, richting: huidig.richting === 'asc' ? 'desc' : 'asc' } : { kolom, richting: 'asc' };

/** De rijen in de gekozen volgorde: de ene vergelijker (`sorteerRijen`) voor scherm, printblad en CSV. */
export const sorteerVolgens = (def: RapportDefinitie, rijen: readonly RapportRij[], s: RapportSortering): RapportRij[] =>
  sorteerRijen(def, rijen, s.kolom, s.richting);
