import { apiFetch } from './api';

/**
 * Gedeelde stukken van "meerdere gaten in één keer voorinvullen" (punt 16):
 * het batch-advies van /api/coverage-advisor/batch en het dag-bewuste
 * voorinvullen. Gebruikt door Beheer › Ziekte (alle open diensten van één
 * zieke) en Openstaande diensten (alle gaten van één dag). Nooit view→view
 * importeren: dit is de plek waar beide op steunen.
 */
export type BatchAdvies = {
  date: string;
  code: string;
  /** De collega-zin van de server ("Pascal past, 9u rust …"). */
  samenvatting?: string;
  /** Top 3 passende kandidaten (id + naam), best eerst. */
  passend: Array<{ id: string; name: string }>;
};

export type BatchItem = { date: string; code: string };

/** Sleutel waaronder een advies per gat bewaard wordt: dag + genormaliseerde code. */
export const adviesSleutel = (date: string, code: string) => `${date}|${String(code).trim().toLowerCase()}`;

export const MAX_BATCH = 40;

/**
 * Batch-advies ophalen. Een netwerkfout gaat ongewijzigd door; een fout-
 * antwoord wordt een Error met de servertekst én de HTTP-status, zodat de
 * view `meldSchrijffout('Kandidaten voorstellen', e)` de juiste vervolgstap
 * laat kiezen (src/lib/fouten.ts).
 */
export async function haalBatchAdvies(items: BatchItem[]): Promise<Record<string, BatchAdvies>> {
  const res = await apiFetch('/api/coverage-advisor/batch', {
    method: 'POST',
    body: JSON.stringify({ items: items.slice(0, MAX_BATCH).map((i) => ({ date: i.date, code: i.code })) }),
  });
  const body = await res.json().catch(() => ({} as { error?: string; items?: BatchAdvies[] }));
  if (!res.ok) throw Object.assign(new Error(body.error || ''), { status: res.status });
  const per: Record<string, BatchAdvies> = {};
  for (const item of body.items ?? []) {
    per[adviesSleutel(item.date, item.code)] = { ...item, passend: Array.isArray(item.passend) ? item.passend : [] };
  }
  return per;
}

/**
 * Dag-bewust voorinvullen: per gat de beste passende kandidaat die op die dag
 * nog niet aan een ander gat (of aan een bestaande handmatige keuze) hangt.
 * Twee gaten op dezelfde dag mogen niet dezelfde topkandidaat krijgen: de
 * server weigert de tweede wissel terecht met een 409 en de batch strandt
 * half. Alleen invullen waar nog niets staat, de planner blijft de baas over
 * elke rij. Geeft een nieuw object terug (`huidig` blijft onaangeroerd).
 */
export function vulVervangersVoor<T>(
  gaten: readonly T[],
  opties: {
    /** Sleutel van het gat in de keuzemap (bv. shift-id of `dag|code`). */
    sleutelVan: (gat: T) => string;
    dagVan: (gat: T) => string;
    adviesVan: (gat: T) => BatchAdvies | undefined;
    /** Bestaande keuzes (sleutel → chauffeur-id); tellen mee als bezet. */
    huidig: Record<string, string>;
  },
): Record<string, string> {
  const next = { ...opties.huidig };
  const bezetPerDag = new Map<string, Set<string>>();
  const bezet = (dag: string) => {
    let s = bezetPerDag.get(dag);
    if (!s) { s = new Set(); bezetPerDag.set(dag, s); }
    return s;
  };
  for (const g of gaten) {
    const keuze = next[opties.sleutelVan(g)];
    if (keuze) bezet(opties.dagVan(g)).add(String(keuze));
  }
  for (const g of gaten) {
    const sleutel = opties.sleutelVan(g);
    if (next[sleutel]) continue;
    const dag = opties.dagVan(g);
    const kandidaat = (opties.adviesVan(g)?.passend ?? []).find((k) => !bezet(dag).has(String(k.id)));
    if (kandidaat) {
      next[sleutel] = String(kandidaat.id);
      bezet(dag).add(String(kandidaat.id));
    }
  }
  return next;
}
