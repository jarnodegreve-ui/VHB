/**
 * Eén bulk-lus voor het hele portaal (next-level ronde 2, punt 16).
 *
 * Vier schermen hadden elk een eigen `for … await` met eigen telling en eigen
 * "3 van 5 gelukt"-toast (vervaldata, voertuigfiche, herverdelen na ziekte,
 * verlof bulk-beslissen). Dit is die lus één keer: sequentieel (elke stap
 * ziet de stand mét de vorige, dus geen 409's door parallelle schrijfacties),
 * elke fout per item bewaard en één samenvattende toast achteraf.
 *
 * `fn` meldt een mislukking op drie manieren, zodat bestaande code zonder
 * omweg past: werpen (de melding van de Error), `false` teruggeven (de
 * standaardtekst) of `{ fout: '…' }` teruggeven (eigen tekst, bv. de
 * servermelding uit een niet-ok response).
 */
export type BulkUitkomst = void | boolean | { fout: string };

export type BulkFout<T> = { item: T; fout: string };

export type BulkResultaat<T> = {
  gelukt: T[];
  mislukt: BulkFout<T>[];
  /** Totaal aantal items dat aan de beurt kwam. */
  totaal: number;
};

export type BulkOpties = {
  /** Alles tegelijk i.p.v. na elkaar. Standaard uit: schrijfacties moeten
   *  elkaar zien (dubbele inplanning, revisies). */
  parallel?: boolean;
  /** Fouttekst als `fn` `false` teruggeeft of zonder melding werpt. */
  standaardFout?: string;
};

const STANDAARD_FOUT = 'Mislukt.';

const foutTekst = (e: unknown, standaard: string): string =>
  e instanceof Error && e.message ? e.message : typeof e === 'string' && e ? e : standaard;

/** Voer `fn` uit voor elk item en bewaar per item of het lukte. Werpt zelf nooit. */
export async function bulkUitvoeren<T>(
  items: readonly T[],
  fn: (item: T, index: number) => Promise<BulkUitkomst> | BulkUitkomst,
  opties: BulkOpties = {},
): Promise<BulkResultaat<T>> {
  const standaard = opties.standaardFout ?? STANDAARD_FOUT;
  const een = async (item: T, index: number): Promise<BulkFout<T> | null> => {
    try {
      const uitkomst = await fn(item, index);
      if (uitkomst === false) return { item, fout: standaard };
      if (uitkomst && typeof uitkomst === 'object' && 'fout' in uitkomst) return { item, fout: uitkomst.fout || standaard };
      return null;
    } catch (e) {
      return { item, fout: foutTekst(e, standaard) };
    }
  };
  const uitkomsten: Array<BulkFout<T> | null> = opties.parallel
    ? await Promise.all(items.map((item, i) => een(item, i)))
    : [];
  if (!opties.parallel) {
    for (let i = 0; i < items.length; i++) uitkomsten.push(await een(items[i], i));
  }
  const gelukt: T[] = [];
  const mislukt: BulkFout<T>[] = [];
  uitkomsten.forEach((u, i) => { if (u) mislukt.push(u); else gelukt.push(items[i]); });
  return { gelukt, mislukt, totaal: items.length };
}

export type BulkToon = 'success' | 'error' | 'info';

export type BulkLabels<T> = {
  /** Enkelvoud en meervoud van het item: ['aanvraag', 'aanvragen']. */
  item: [string, string];
  /** Voltooid deelwoord van de actie: 'goedgekeurd', 'herverdeeld', 'opgeslagen'. */
  gedaan: string;
  /** Eigen tekst als álles lukte (standaard "3 aanvragen goedgekeurd."). */
  allesGelukt?: string;
  /** Staart na "2 van 3 goedgekeurd" (standaard ", 1 mislukt"). De fouten
   *  staan erbij zodat een scherm de namen of soorten kan noemen. */
  rest?: (fouten: BulkFout<T>[]) => string;
  /** Toon bij gedeeltelijk of volledig mislukken (standaard 'error'). */
  misluktToon?: Exclude<BulkToon, 'success'>;
};

/** Samenvatting van een bulk-resultaat als tekst + toon; null als er niets te melden is. */
export function bulkSamenvatting<T>(resultaat: BulkResultaat<T>, labels: BulkLabels<T>): { tekst: string; toon: BulkToon } | null {
  const { gelukt, mislukt, totaal } = resultaat;
  if (totaal === 0) return null;
  const naam = (n: number) => (n === 1 ? labels.item[0] : labels.item[1]);
  if (mislukt.length === 0) {
    return { tekst: labels.allesGelukt ?? `${gelukt.length} ${naam(gelukt.length)} ${labels.gedaan}.`, toon: 'success' };
  }
  const staart = labels.rest ? labels.rest(mislukt) : `, ${mislukt.length} mislukt`;
  return {
    tekst: `${gelukt.length} van ${totaal} ${naam(totaal)} ${labels.gedaan}${staart}.`,
    toon: labels.misluktToon ?? 'error',
  };
}

/** Eén toast voor het hele bulk-resultaat (geen n stiltes, geen n toasts). */
export function meldBulkResultaat<T>(
  notify: (tekst: string, toon: BulkToon) => void,
  resultaat: BulkResultaat<T>,
  labels: BulkLabels<T>,
): void {
  const s = bulkSamenvatting(resultaat, labels);
  if (s) notify(s.tekst, s.toon);
}
