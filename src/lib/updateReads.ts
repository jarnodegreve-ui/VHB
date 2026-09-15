import { apiJson } from './api';

/**
 * Markeert de gegeven updates als gelezen door de ingelogde gebruiker.
 * Fire-and-forget vanuit de chauffeur-weergave; faalt stil (een gemiste
 * leesbevestiging is geen reden om de chauffeur een foutmelding te tonen).
 *
 * Sinds golf 3 (15-09) is "gelezen" = het bericht echt geopend: een gewone
 * update zodra ze in het paneel of de SlideOver staat, een dringende pas na
 * de knop "Gelezen en begrepen" (UpdatesView). Het scherm openen alleen
 * telt niet meer.
 */
export function markUpdatesRead(updateIds: string[]): Promise<void> {
  if (updateIds.length === 0) return Promise.resolve();
  return apiJson<void>('/api/updates/read', {
    method: 'POST',
    body: JSON.stringify({ updateIds }),
  });
}

export type MijnUpdateReads = {
  /** Ids van de updates die deze gebruiker al opende of bevestigde. */
  ids: string[];
  /** Telt deze gebruiker mee in de leesteller? Alleen chauffeurs; voor staf
   *  registreert de server niets en toont de client geen bevestigknop. */
  telt: boolean;
};

/** Wat de ingelogde gebruiker al las (voor de knop- en markeerstaat). */
export async function fetchMijnUpdateReads(): Promise<MijnUpdateReads> {
  const data = await apiJson<Partial<MijnUpdateReads> | unknown>('/api/updates/read');
  // Defensief: een onverwacht antwoord (bv. een lege lijst uit een mock) mag
  // het scherm niet breken; dan weten we alleen niets over eerdere reads.
  if (!data || typeof data !== 'object' || Array.isArray(data)) return { ids: [], telt: true };
  const d = data as Partial<MijnUpdateReads>;
  return { ids: Array.isArray(d.ids) ? d.ids.map(String) : [], telt: d.telt !== false };
}

export type UpdateReadCounts = {
  /** aantal chauffeurs dat de update opende of bevestigde, per update-id */
  counts: Record<string, number>;
  /** totaal aantal actieve chauffeurs, de noemer van "x van y" */
  totalChauffeurs: number;
};

/** Haalt per update op hoeveel chauffeurs ze geopend of bevestigd hebben (planner/admin). */
export function fetchUpdateReadCounts(): Promise<UpdateReadCounts> {
  return apiJson<UpdateReadCounts>('/api/updates/read-counts');
}
